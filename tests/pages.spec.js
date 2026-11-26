// Module PDF — gestion des pages : chaque action est vérifiée sur le PDF EXPORTÉ (intercepté au
// téléchargement puis relu avec PDF.js : nombre de pages, ordre, rotation).
'use strict';

const fs = require('fs');
const { test, expect, ouvrirApp } = require('./aide');
const { pdfChiffre } = require('./pdf-chiffre');

test.beforeEach(async ({ page }) => { await ouvrirApp(page); });

const bouton = (page, nom) => page.getByRole('button', { name: nom, exact: true });
const mini = (page, n) => page.locator(`.pdf-mini[data-page="${n}"]`);
const coche = (page, n) => page.getByLabel(`Sélectionner la page ${n}`);

// Envoie un PDF dont la page k porte le texte « <préfixe> k »
async function ouvrirDoc(page, nom, n, prefixe = 'Page') {
  await page.evaluate(({ nom, n, prefixe }) => MPDS.envoyer(Fab.pdf(nom, Array.from({ length: n }, (_, i) =>
    [{ t: prefixe + ' ' + (i + 1), x: 72, y: 700, taille: 48, gras: true }])), 'pdf'), { nom, n, prefixe });
  await expect(page.locator('#pdf-canvas')).toBeVisible();
  await expect(page.locator('.pdf-mini')).toHaveCount(n);
}
// Texte et rotation de chaque page d'un PDF (octets), lus par PDF.js
const lire = (page, octets) => page.evaluate(async o => {
  const d = await (await MPDS.pdfjs.ouvrir(new Uint8Array(o).buffer)).promise, sortie = [];
  for (let i = 1; i <= d.numPages; i++) {
    const p = await d.getPage(i);
    sortie.push({ texte: (await p.getTextContent()).items.map(x => x.str).join(''), rotation: p.rotate });
  }
  return sortie;
}, [...octets]);
// Clique sur un bouton qui télécharge un PDF ; renvoie son nom et son contenu relu
async function exporter(page, nomBouton) {
  const [dl] = await Promise.all([page.waitForEvent('download'), bouton(page, nomBouton).click()]);
  const octets = fs.readFileSync(await dl.path());
  expect(octets.subarray(0, 5).toString()).toBe('%PDF-');
  return { nom: dl.suggestedFilename(), pages: await lire(page, octets) };
}
const textes = r => r.pages.map(p => p.texte);
const rotations = r => r.pages.map(p => p.rotation);

test('actions désactivées sans document, activées avec', async ({ page }) => {
  await page.evaluate(() => { location.hash = '#/pdf'; });
  for (const n of ['Pivoter à gauche', 'Pivoter à droite', 'Monter la page', 'Descendre la page', 'Supprimer', 'Ajouter un PDF', 'Extraire la sélection', 'Enregistrer le PDF']) {
    await expect(bouton(page, n), n).toBeDisabled();
  }
  await expect(page.locator('#pdf-modif')).toHaveText('');
  await ouvrirDoc(page, 'a.pdf', 3);
  for (const n of ['Pivoter à gauche', 'Pivoter à droite', 'Descendre la page', 'Supprimer', 'Ajouter un PDF', 'Enregistrer le PDF']) {
    await expect(bouton(page, n), n).toBeEnabled();
  }
  await expect(bouton(page, 'Monter la page')).toBeDisabled();          // page 1
  await expect(bouton(page, 'Extraire la sélection')).toBeDisabled();   // rien de coché
  await expect(page.locator('#pdf-modif')).toHaveText('');
  await expect(page.getByRole('toolbar', { name: 'Actions sur les pages' })).toBeVisible();
});

test('pivoter : page courante, puis sélection ; affichage et export', async ({ page }) => {
  await ouvrirDoc(page, 'rot.pdf', 3);
  const dims = () => page.evaluate(() => { const c = document.getElementById('pdf-canvas'); return c.width > c.height ? 'paysage' : 'portrait'; });
  expect(await dims()).toBe('portrait');
  await bouton(page, 'Pivoter à droite').click();
  await expect.poll(dims).toBe('paysage');                                  // la visionneuse applique la rotation
  await expect(page.locator('#pdf-modif')).toHaveText('● Modifications non enregistrées');
  await page.waitForTimeout(300);
  await expect.poll(() => page.evaluate(() => { const c = document.querySelector('.pdf-mini[data-page="1"] canvas'); return c.width > c.height; })).toBe(true);   // miniature aussi
  expect(rotations(await exporter(page, 'Enregistrer le PDF'))).toEqual([90, 0, 0]);

  await coche(page, 2).check(); await coche(page, 3).check();               // la sélection prime sur la page courante
  await bouton(page, 'Pivoter à gauche').click();                           // 0 − 90 = 270
  expect(rotations(await exporter(page, 'Enregistrer le PDF'))).toEqual([90, 270, 270]);
  await bouton(page, 'Pivoter à droite').click();                           // 270 + 90 = retour à 0
  expect(rotations(await exporter(page, 'Enregistrer le PDF'))).toEqual([90, 0, 0]);
});

test('supprimer : page courante, sélection, jamais la dernière', async ({ page }) => {
  await ouvrirDoc(page, 'sup.pdf', 4);
  await page.keyboard.press('ArrowRight');                                  // page 2
  await bouton(page, 'Supprimer').click();
  await expect(page.locator('.pdf-mini')).toHaveCount(3);
  await expect(page.locator('#pdf-nb')).toHaveText('3 pages');
  await expect(page.locator('#pdf-num')).toHaveValue('2');                  // la page suivante prend la place
  expect(textes(await exporter(page, 'Enregistrer le PDF'))).toEqual(['Page 1', 'Page 3', 'Page 4']);

  await coche(page, 1).check(); await coche(page, 3).check();
  await bouton(page, 'Supprimer').click();
  expect(textes(await exporter(page, 'Enregistrer le PDF'))).toEqual(['Page 3']);
  await expect(page.locator('#pdf-nb')).toHaveText('1 page');
  await expect(bouton(page, 'Supprimer')).toBeDisabled();                   // dernière page
  await expect(bouton(page, 'Supprimer')).toHaveAttribute('title', /toutes les pages/);
  await expect(bouton(page, 'Enregistrer le PDF')).toBeEnabled();
});

test('supprimer toute la sélection est interdit (bouton inactif)', async ({ page }) => {
  await ouvrirDoc(page, 'tout.pdf', 2);
  await coche(page, 1).check(); await coche(page, 2).check();
  await expect(bouton(page, 'Supprimer')).toBeDisabled();
  await coche(page, 2).uncheck();
  await expect(bouton(page, 'Supprimer')).toBeEnabled();
});

test('réordonner : boutons monter / descendre (clavier)', async ({ page }) => {
  await ouvrirDoc(page, 'ordre.pdf', 3);
  await bouton(page, 'Descendre la page').focus();
  await page.keyboard.press('Enter');                                       // page 1 → position 2
  await expect(page.locator('#pdf-num')).toHaveValue('2');                  // la page courante suit son déplacement
  await expect(bouton(page, 'Descendre la page')).toBeFocused();
  await page.keyboard.press('Enter');                                       // → position 3
  await expect(bouton(page, 'Descendre la page')).toBeDisabled();
  await expect(page.locator('#pdf-modif')).toHaveText('● Modifications non enregistrées');
  expect(textes(await exporter(page, 'Enregistrer le PDF'))).toEqual(['Page 2', 'Page 3', 'Page 1']);
  await bouton(page, 'Monter la page').click();
  expect(textes(await exporter(page, 'Enregistrer le PDF'))).toEqual(['Page 2', 'Page 1', 'Page 3']);
});

test('réordonner : glisser-déposer des miniatures', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1500 });                // pas de défilement du panneau sous le pointeur
  await ouvrirDoc(page, 'dnd.pdf', 3);
  await mini(page, 3).dragTo(mini(page, 1));                                // la page 3 prend la place de la page 1
  await expect.poll(() => page.evaluate(() => [...document.querySelectorAll('.pdf-mini')].map(b => b.dataset.page).join())).toBe('1,2,3');
  expect(textes(await exporter(page, 'Enregistrer le PDF'))).toEqual(['Page 3', 'Page 1', 'Page 2']);
  await expect(page.locator('.pdf-module')).not.toHaveClass(/pdf-survol/);  // pas pris pour un dépôt de fichier
  await expect(page.locator('#pdf-etat')).not.toHaveClass(/pdf-erreur/);
  await mini(page, 1).dragTo(mini(page, 3));
  expect(textes(await exporter(page, 'Enregistrer le PDF'))).toEqual(['Page 1', 'Page 2', 'Page 3']);
});

test('fusionner : « Ajouter un PDF » ajoute les pages à la fin', async ({ page }) => {
  await ouvrirDoc(page, 'a.pdf', 2, 'Alpha');
  const b = await page.evaluate(() => Fab.pdf('b.pdf', [[{ t: 'Beta 1', x: 72, y: 700, taille: 48 }], [{ t: 'Beta 2', x: 72, y: 700, taille: 48 }], [{ t: 'Beta 3', x: 72, y: 700, taille: 48 }]]).arrayBuffer().then(ab => [...new Uint8Array(ab)]));
  await page.locator('#pdf-ajout').setInputFiles({ name: 'b.pdf', mimeType: 'application/pdf', buffer: Buffer.from(b) });
  await expect(page.locator('.pdf-mini')).toHaveCount(5);
  await expect(page.locator('#pdf-nb')).toHaveText('5 pages');
  await expect(page.locator('#pdf-etat')).toContainText('3 pages ajoutées depuis « b.pdf »');
  await expect(page.locator('#pdf-nom')).toHaveText('a.pdf');
  await mini(page, 4).click();                                              // la page ajoutée s'affiche
  await expect(page.locator('#pdf-num')).toHaveValue('4');
  await bouton(page, 'Pivoter à droite').click();                           // action sur une page du 2e document
  const r = await exporter(page, 'Enregistrer le PDF');
  expect(r.nom).toBe('a (modifié).pdf');
  expect(textes(r)).toEqual(['Alpha 1', 'Alpha 2', 'Beta 1', 'Beta 2', 'Beta 3']);
  expect(rotations(r)).toEqual([0, 0, 0, 90, 0]);
  await page.locator('#pdf-ajout').setInputFiles({ name: 'x.pdf', mimeType: 'application/pdf', buffer: Buffer.from('pas un pdf') });
  await expect(page.locator('#pdf-etat')).toContainText('n\'est pas un PDF');   // refus : le document reste intact
  await expect(page.locator('.pdf-mini')).toHaveCount(5);
});

test('extraire : seulement les pages cochées, dans l\'ordre affiché ; le document n\'est pas modifié', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1500 });                // les 5 miniatures visibles : le glisser-déposer a besoin des deux cibles
  await ouvrirDoc(page, 'gros.pdf', 5);
  await expect(bouton(page, 'Extraire la sélection')).toBeDisabled();
  await coche(page, 4).check(); await coche(page, 2).check();
  await expect(bouton(page, 'Extraire la sélection')).toBeEnabled();
  const r = await exporter(page, 'Extraire la sélection');
  expect(r.nom).toBe('gros (extrait).pdf');
  expect(textes(r)).toEqual(['Page 2', 'Page 4']);
  await expect(page.locator('.pdf-mini')).toHaveCount(5);
  await expect(page.locator('#pdf-modif')).toHaveText('');                  // l'extraction ne modifie pas le document
  await mini(page, 4).dragTo(mini(page, 1));                                // et suit l'ordre affiché
  expect(textes(await exporter(page, 'Extraire la sélection'))).toEqual(['Page 4', 'Page 2']);
  await coche(page, 1).uncheck(); await coche(page, 3).uncheck();           // décocher tout désactive à nouveau
  await expect(bouton(page, 'Extraire la sélection')).toBeDisabled();
});

test('indicateur de modifications : apparaît, disparaît à l\'enregistrement ; garde-fou à l\'ouverture', async ({ page }) => {
  await ouvrirDoc(page, 'un.pdf', 2);
  const indic = page.locator('#pdf-modif');
  await expect(indic).toHaveText('');
  await bouton(page, 'Pivoter à droite').click();
  await expect(indic).toHaveText('● Modifications non enregistrées');
  const dialogues = [];
  page.on('dialog', d => { dialogues.push(d.message()); d.dismiss(); });
  await page.evaluate(() => MPDS.envoyer(Fab.pdf('deux.pdf', [[{ t: 'Autre', x: 72, y: 700 }]]), 'pdf'));
  await expect.poll(() => dialogues.length).toBe(1);                        // refusé : le travail en cours n'est pas perdu
  expect(dialogues[0]).toContain('Des modifications ne sont pas enregistrées');
  await expect(page.locator('#pdf-nom')).toHaveText('un.pdf');
  await exporter(page, 'Enregistrer le PDF');
  await expect(indic).toHaveText('');
  await expect(page.locator('#pdf-etat')).toContainText('« un (modifié).pdf » enregistré');
  await bouton(page, 'Pivoter à gauche').click();
  page.removeAllListeners('dialog');
  page.on('dialog', d => d.accept());
  await page.evaluate(() => MPDS.envoyer(Fab.pdf('trois.pdf', [[{ t: 'Nouveau', x: 72, y: 700 }]]), 'pdf'));
  await expect(page.locator('#pdf-nom')).toHaveText('trois.pdf');
  await expect(page.locator('.pdf-mini')).toHaveCount(1);
  await expect(indic).toHaveText('');
});

test('PDF chiffré (mot de passe propriétaire seulement) : pivoter, fusionner, enregistrer, relire', async ({ page }) => {
  await page.evaluate(o => MPDS.envoyer(new File([new Uint8Array(o)], 'cerfa.pdf'), 'pdf'), [...pdfChiffre(['Cerfa un', 'Cerfa deux'], 'rc4_128')]);
  await expect(page.locator('#pdf-canvas')).toBeVisible();
  await bouton(page, 'Pivoter à droite').click();
  await page.locator('#pdf-ajout').setInputFiles({ name: 'cerfa2.pdf', mimeType: 'application/pdf', buffer: pdfChiffre(['AES'], 'aes_128') });
  await expect(page.locator('.pdf-mini')).toHaveCount(3);
  const r = await exporter(page, 'Enregistrer le PDF');
  expect(r.pages).toEqual([{ texte: 'Cerfa un', rotation: 90 }, { texte: 'Cerfa deux', rotation: 0 }, { texte: 'AES', rotation: 0 }]);
});

test('échec du chargement de la bibliothèque : message clair, modèle intact, nouvel essai possible', async ({ page }) => {
  await ouvrirDoc(page, 'e.pdf', 2);
  await bouton(page, 'Pivoter à droite').click();
  await page.route('**/__npm__/@cantoo/**', route => route.abort());
  await bouton(page, 'Enregistrer le PDF').click();
  await expect(page.locator('#pdf-etat')).toContainText('L\'export a échoué');
  await expect(page.locator('#pdf-etat')).toContainText('composant d\'écriture PDF est inaccessible');
  await expect(page.locator('#pdf-etat')).toHaveAttribute('role', 'alert');
  await expect(bouton(page, 'Enregistrer le PDF')).toBeEnabled();
  await expect(page.locator('#pdf-modif')).toHaveText('● Modifications non enregistrées');
  await page.unroute('**/__npm__/@cantoo/**');
  expect(rotations(await exporter(page, 'Enregistrer le PDF'))).toEqual([90, 0]);   // l'échec n'a pas été mémorisé
});

test('échec de l\'export : message, aucun téléchargement, boutons rendus', async ({ page }) => {
  await ouvrirDoc(page, 'f.pdf', 2);
  await page.evaluate(() => MPDS.chargerScript(MPDS.pdfExport.URL_LIB));
  await page.evaluate(() => { PDFLib.PDFDocument.create = () => { throw new Error('mémoire insuffisante'); }; });
  let telecharge = false;
  page.on('download', () => { telecharge = true; });
  await bouton(page, 'Enregistrer le PDF').click();
  await expect(page.locator('#pdf-etat')).toContainText('L\'export a échoué : mémoire insuffisante');
  await expect(bouton(page, 'Enregistrer le PDF')).toBeEnabled();
  expect(telecharge).toBe(false);
});
