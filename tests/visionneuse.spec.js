// Module PDF — visionneuse : ouverture, pagination, zoom, miniatures, erreurs, isolement.
// (tests/pdf.spec.js couvre la CONVERSION des PDF en Markdown, pas la visionneuse.)
'use strict';

const crypto = require('crypto');
const { test, expect, ouvrirApp } = require('./aide');

test.beforeEach(async ({ page }) => { await ouvrirApp(page); });

// Envoie un PDF de `n` pages (« Page k » en gros caractères) à la visionneuse
async function ouvrirDoc(page, nom = 'dossier.pdf', n = 3) {
  await page.evaluate(({ nom, n }) => MPDS.envoyer(Fab.pdf(nom, Array.from({ length: n }, (_, i) =>
    [{ t: 'Page ' + (i + 1), x: 72, y: 700, taille: 48, gras: true }])), 'pdf'), { nom, n });
  await expect(page.locator('#pdf-canvas')).toBeVisible();
}
const largeurCanvas = page => page.evaluate(() => document.getElementById('pdf-canvas').width);
// Largeur une fois le rendu en cours terminé (deux lectures identiques à 100 ms)
const largeurStable = async page => { let a = -1, b = await largeurCanvas(page); while (a !== b) { a = b; await page.waitForTimeout(100); b = await largeurCanvas(page); } return b; };
const numero = page => page.locator('#pdf-num');
const couranteMini = page => page.locator('.pdf-mini[aria-current="page"]');
// Nombre de pixels sombres d'un canvas : prouve qu'un rendu a réellement eu lieu
const pixelsSombres = (page, selecteur) => page.evaluate(s => {
  const c = document.querySelector(s);
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] < 100 && d[i + 3] > 0) n++;
  return n;
}, selecteur);

test('ouverture via MPDS.envoyer : nom, nombre de pages, rendu réel', async ({ page }) => {
  await ouvrirDoc(page);
  expect(await page.evaluate(() => location.hash)).toBe('#/pdf');
  await expect(page.locator('.rail-lien[data-module="pdf"]')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#pdf-nom')).toHaveText('dossier.pdf');
  await expect(page.locator('#pdf-nb')).toHaveText('3 pages');
  await expect(page.locator('#pdf-total')).toHaveText('/ 3');
  await expect(numero(page)).toHaveValue('1');
  await expect(page.locator('#pdf-vide')).toBeHidden();
  expect(await pixelsSombres(page, '#pdf-canvas')).toBeGreaterThan(200);
  await expect(page.locator('#pdf-etat')).toHaveText('');
});

test('navigation : boutons, champ de page (borné), clavier, miniature', async ({ page }) => {
  await ouvrirDoc(page, 'a.pdf', 5);
  const prec = page.getByRole('button', { name: 'Page précédente' });
  const suiv = page.getByRole('button', { name: 'Page suivante' });
  await expect(prec).toBeDisabled();
  await suiv.click();
  await expect(numero(page)).toHaveValue('2');
  await expect(couranteMini(page)).toHaveAttribute('data-page', '2');
  await prec.click();
  await expect(numero(page)).toHaveValue('1');

  await numero(page).fill('4');
  await numero(page).press('Enter');
  await expect(numero(page)).toHaveValue('4');
  await numero(page).fill('99');                     // borné à la dernière page
  await numero(page).press('Enter');
  await expect(numero(page)).toHaveValue('5');
  await expect(suiv).toBeDisabled();
  await numero(page).fill('0');                      // borné à la première
  await numero(page).press('Enter');
  await expect(numero(page)).toHaveValue('1');
  await numero(page).fill('');                       // invalide : on garde la page
  await numero(page).press('Enter');
  await expect(numero(page)).toHaveValue('1');

  await page.locator('.pdf-mini[data-page="3"]').click();
  await expect(numero(page)).toHaveValue('3');
  await expect(couranteMini(page)).toHaveCount(1);
  await expect(couranteMini(page)).toHaveAttribute('data-page', '3');
});

test('clavier : flèches, PageUp/PageDown, Début/Fin ; ignoré dans un champ de saisie', async ({ page }) => {
  await ouvrirDoc(page, 'a.pdf', 5);
  const attendre = async v => expect(numero(page)).toHaveValue(v);
  await page.keyboard.press('ArrowRight'); await attendre('2');
  await page.keyboard.press('PageDown');   await attendre('3');
  await page.keyboard.press('End');        await attendre('5');
  await page.keyboard.press('ArrowRight'); await attendre('5');   // borne
  await page.keyboard.press('ArrowLeft');  await attendre('4');
  await page.keyboard.press('PageUp');     await attendre('3');
  await page.keyboard.press('Home');       await attendre('1');
  await numero(page).focus();                                      // champ de saisie : pas de navigation
  await page.keyboard.press('End');
  await page.keyboard.press('PageDown');
  await attendre('1');
});

test('zoom : +, −, bornes, Ctrl +/−, ajuster à la largeur', async ({ page }) => {
  await ouvrirDoc(page);
  const largeur = page.getByRole('button', { name: 'Ajuster à la largeur' });
  await expect(largeur).toHaveAttribute('aria-pressed', 'true');
  const ajustee = await largeurCanvas(page);
  const zoom = page.locator('#pdf-zoom');

  await page.getByRole('button', { name: 'Zoom avant' }).click();
  await expect(largeur).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => largeurCanvas(page)).toBeGreaterThan(ajustee);
  const agrandie = await largeurCanvas(page);
  await page.getByRole('button', { name: 'Zoom arrière' }).click();
  await page.getByRole('button', { name: 'Zoom arrière' }).click();
  await expect.poll(() => largeurCanvas(page)).toBeLessThan(agrandie);

  await page.keyboard.press('Control+=');
  await page.keyboard.press('Control+-');
  await page.keyboard.press('Control+-');
  const avant = await largeurStable(page);
  await page.keyboard.press('Control+=');
  await expect.poll(() => largeurCanvas(page)).toBeGreaterThan(avant);

  for (let i = 0; i < 20; i++) await page.keyboard.press('Control+=');
  await expect(zoom).toHaveText('400 %');
  await expect(page.getByRole('button', { name: 'Zoom avant' })).toBeDisabled();
  for (let i = 0; i < 20; i++) await page.keyboard.press('Control+-');
  await expect(zoom).toHaveText('25 %');
  await expect(page.getByRole('button', { name: 'Zoom arrière' })).toBeDisabled();

  await largeur.click();
  await expect.poll(() => largeurCanvas(page)).toBe(ajustee);
  await expect(largeur).toHaveAttribute('aria-pressed', 'true');
});

test('l\'ajustement à la largeur suit la taille de la fenêtre', async ({ page }) => {
  await ouvrirDoc(page);
  const large = await largeurCanvas(page);
  await page.setViewportSize({ width: 900, height: 700 });
  await expect.poll(() => largeurCanvas(page)).toBeLessThan(large);
});

test('miniatures : une par page, rendu paresseux, active signalée', async ({ page }) => {
  await ouvrirDoc(page, 'long.pdf', 40);
  await expect(page.locator('.pdf-mini')).toHaveCount(40);
  await expect(page.locator('.pdf-mini[data-page="1"]')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.pdf-mini[data-page="1"]')).toHaveAccessibleName(/Page 1/);
  await expect.poll(() => pixelsSombres(page, '.pdf-mini[data-page="1"] canvas')).toBeGreaterThan(20);
  // Hors de la zone visible : pas encore dessinée (canvas vierge)
  expect(await pixelsSombres(page, '.pdf-mini[data-page="40"] canvas')).toBe(0);
  await page.keyboard.press('End');
  await expect(page.locator('.pdf-mini[data-page="40"]')).toHaveAttribute('aria-current', 'page');
  await expect.poll(() => pixelsSombres(page, '.pdf-mini[data-page="40"] canvas')).toBeGreaterThan(20);
});

test('ouverture : bouton (input file), glisser-déposer, remplacement par un nouveau document', async ({ page }) => {
  await page.goto('index.html#/pdf');
  await page.waitForFunction(() => document.getElementById('pdf-fichier'));
  await expect(page.locator('#pdf-vide')).toBeVisible();
  await expect(page.locator('#pdf-outils')).toBeHidden();
  await page.evaluate(() => {   // compte les destructions de documents PDF.js (message « Terminate » au worker)
    window.__detruits = 0;
    const envoi = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (m, ...r) {
      if (m && m.action === 'Terminate') window.__detruits++;
      return envoi.call(this, m, ...r);
    };
  });
  const octets = await page.evaluate(async () => [...new Uint8Array(await Fab.pdf('x', [[{ t: 'Un', x: 72, y: 700 }]]).arrayBuffer())]);
  await page.locator('#pdf-fichier').setInputFiles({ name: 'premier.pdf', mimeType: 'application/pdf', buffer: Buffer.from(octets) });
  await expect(page.locator('#pdf-nom')).toHaveText('premier.pdf');
  await expect(page.locator('#pdf-nb')).toHaveText('1 page');

  await page.evaluate(() => {   // dépôt de deux fichiers sur le module : le premier seul est ouvert
    const dt = new DataTransfer();
    dt.items.add(Fab.pdf('depose.pdf', [[{ t: 'A', x: 72, y: 700 }], [{ t: 'B', x: 72, y: 700 }]]));
    dt.items.add(Fab.pdf('autre.pdf', [[{ t: 'C', x: 72, y: 700 }]]));
    document.querySelector('.pdf-module').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  await expect(page.locator('#pdf-nom')).toHaveText('depose.pdf');
  await expect(page.locator('#pdf-nb')).toHaveText('2 pages');
  await expect(page.locator('.pdf-mini')).toHaveCount(2);
  await expect(page.locator('#pdf-etat')).toContainText('Un seul document à la fois');
  expect(await page.evaluate(() => window.__detruits)).toBe(1);
  // le fichier glissé n'est pas parti au convertisseur
  expect(await page.evaluate(() => document.querySelectorAll('.journal-item').length)).toBe(0);
});

test('fichier corrompu, non-PDF, vide : message clair, document ouvert conservé', async ({ page }) => {
  const envoyer = (nom, contenu) => page.evaluate(({ nom, contenu }) =>
    MPDS.envoyer(new File([contenu], nom), 'pdf'), { nom, contenu });
  const etat = page.locator('#pdf-etat');

  await envoyer('casse.pdf', '%PDF-1.4\nceci n\'est pas un vrai PDF\n%%EOF');
  await expect(etat).toContainText('corrompu ou illisible');
  await expect(etat).toHaveAttribute('role', 'alert');
  await expect(page.locator('#pdf-vide')).toBeVisible();      // rien d'ouvert : retour à l'invite

  await envoyer('notes.txt', 'juste du texte');
  await expect(etat).toContainText('« notes.txt » n\'est pas un PDF');
  await envoyer('vide.pdf', '');
  await expect(etat).toContainText('vide');

  await ouvrirDoc(page);
  await envoyer('casse2.pdf', '%PDF-1.4\nrien');
  await expect(etat).toContainText('corrompu');
  await expect(page.locator('#pdf-nom')).toHaveText('dossier.pdf');   // l'ancien reste affiché
  await expect(page.locator('#pdf-canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Page suivante' }).click();  // et utilisable
  await expect(numero(page)).toHaveValue('2');
});

// PDF chiffré (RC4 40 bits, mot de passe utilisateur « secret ») construit à la main
function pdfProtege() {
  const PAD = Buffer.from('28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A', 'hex');
  const rc4 = (cle, donnees) => {
    const s = [...Array(256).keys()];
    for (let i = 0, j = 0; i < 256; i++) { j = (j + s[i] + cle[i % cle.length]) & 255; [s[i], s[j]] = [s[j], s[i]]; }
    let i = 0, j = 0;
    return Buffer.from(donnees.map(o => { i = (i + 1) & 255; j = (j + s[i]) & 255; [s[i], s[j]] = [s[j], s[i]]; return o ^ s[(s[i] + s[j]) & 255]; }));
  };
  const O = Buffer.alloc(32, 7), P = Buffer.from('FCFFFFFF', 'hex'), ID = Buffer.alloc(16, 9);
  const mdp = Buffer.concat([Buffer.from('secret'), PAD]).subarray(0, 32);
  const cle = crypto.createHash('md5').update(Buffer.concat([mdp, O, P, ID])).digest().subarray(0, 5);
  const U = rc4(cle, [...PAD]);
  const objets = ['<</Type/Catalog/Pages 2 0 R>>', '<</Type/Pages/Kids[3 0 R]/Count 1>>', '<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>',
    `<</Filter/Standard/V 1/R 2/O<${O.toString('hex')}>/U<${U.toString('hex')}>/P -4>>`];
  let sortie = '%PDF-1.4\n';
  const positions = objets.map((o, i) => { const p = sortie.length; sortie += `${i + 1} 0 obj\n${o}\nendobj\n`; return p; });
  const xref = sortie.length;
  sortie += `xref\n0 5\n0000000000 65535 f \n${positions.map(p => String(p).padStart(10, '0') + ' 00000 n \n').join('')}` +
    `trailer\n<</Size 5/Root 1 0 R/Encrypt 4 0 R/ID[<${ID.toString('hex')}><${ID.toString('hex')}>]>>\nstartxref\n${xref}\n%%EOF`;
  return [...Buffer.from(sortie, 'latin1')];
}

test('PDF protégé par mot de passe : message explicite', async ({ page }) => {
  await page.evaluate(o => MPDS.envoyer(new File([new Uint8Array(o)], 'protege.pdf'), 'pdf'), pdfProtege());
  await expect(page.locator('#pdf-etat')).toContainText('protégé par mot de passe');
  await expect(page.locator('#pdf-etat')).toContainText("non pris en charge pour l'instant");
  await expect(page.locator('#pdf-vide')).toBeVisible();
});

test('isolement des écouteurs : collage et flèches', async ({ page }) => {
  await ouvrirDoc(page);
  const journal = () => page.evaluate(() => document.querySelectorAll('.journal-item').length);
  await page.evaluate(() => {   // Ctrl+V sur le module PDF : le convertisseur ne réagit pas
    const dt = new DataTransfer();
    dt.setData('text/plain', 'du texte collé');
    document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(300);
  expect(await journal()).toBe(0);

  await page.evaluate(() => { location.hash = '#/convertir'; });   // flèches sur Convertir : la page PDF ne bouge pas
  await expect(page.locator('#zone-depot')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('End');
  await page.evaluate(() => { location.hash = '#/pdf'; });
  await expect(numero(page)).toHaveValue('1');

  await page.evaluate(() => { location.hash = '#/convertir'; });   // et le collage y fonctionne toujours
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', 'du texte collé');
    document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await expect(page.locator('.journal-item')).toHaveCount(1);
});

test('changer de module conserve le document ouvert (monté une seule fois)', async ({ page }) => {
  await ouvrirDoc(page, 'garde.pdf', 4);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(numero(page)).toHaveValue('3');
  await page.locator('.rail-lien[data-module="convertir"]').click();
  await expect(page.locator('section[data-module="pdf"]')).toBeHidden();
  await page.locator('.rail-lien[data-module="pdf"]').click();
  await expect(page.locator('#pdf-nom')).toHaveText('garde.pdf');
  await expect(numero(page)).toHaveValue('3');
  await expect(page.locator('#pdf-canvas')).toBeVisible();
  await expect(page.locator('.pdf-mini')).toHaveCount(4);
  expect(await page.evaluate(() => MPDS.montages.get('pdf'))).toBe(1);
});

// Revue PR #1 : la tâche de chargement PDF.js (et son worker) doit être détruite quand l'ouverture échoue
test('ouverture ratée : la tâche PDF.js et son worker sont libérés', async ({ page }) => {
  await page.evaluate(() => {
    const ouvrir = MPDS.pdfjs.ouvrir;
    window.__taches = [];
    MPDS.pdfjs.ouvrir = async ab => { const t = await ouvrir(ab); __taches.push(t); return t; };
  });
  await page.evaluate(() => MPDS.envoyer(new File(['%PDF-1.4\nrien\n%%EOF'], 'casse.pdf'), 'pdf'));
  await expect(page.locator('#pdf-etat')).toContainText('corrompu');
  await expect.poll(() => page.evaluate(() => __taches.length === 1 && __taches[0].destroyed)).toBe(true);
});

// Revue PR #1 n° 5 : à fort zoom, ←/→ font défiler la page quand la scène a le focus (WCAG 2.1.1)
test('zoom : ←/→ font défiler la scène horizontalement, PageDown change de page', async ({ page }) => {
  await ouvrirDoc(page, 'large.pdf', 2);
  for (let i = 0; i < 6; i++) await page.getByRole('button', { name: 'Zoom avant', exact: true }).click();
  await page.waitForFunction(() => { const s = document.getElementById('pdf-scene'); return s.scrollWidth > s.clientWidth; });
  await page.locator('#pdf-scene').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(numero(page)).toHaveValue('1');
  expect(await page.evaluate(() => document.getElementById('pdf-scene').scrollLeft)).toBeGreaterThan(0);
  await page.keyboard.press('PageDown');
  await expect(numero(page)).toHaveValue('2');
});

// Revue PR #2 n° 6 : fermer ou recharger l'onglet avec des modifications demande confirmation
test('beforeunload : confirmation seulement si des modifications ne sont pas enregistrées', async ({ page }) => {
  await ouvrirDoc(page, 'a.pdf', 2);
  const demande = () => page.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; });
  expect(await demande()).toBe(false);
  await page.getByRole('button', { name: 'Pivoter à droite', exact: true }).click();
  expect(await demande()).toBe(true);
});
