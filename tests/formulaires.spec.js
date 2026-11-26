// Module PDF — formulaires AcroForm : détection, saisie dans de vrais contrôles, export aplati.
// Les fixtures sont fabriquées ici avec @cantoo/pdf-lib (aucun binaire au dépôt) ; les exports sont
// interceptés puis relus : texte avec PDF.js (getTextContent), pixels d'un rendu PDF.js pour les
// cases et boutons radio, structure avec pdf-lib (plus aucun champ après aplatissement).
// Géométrie des fixtures (points PDF, A4 595 × 842, origine en bas à gauche) : voir CHAMPS.
'use strict';

const fs = require('fs');
const P = require('@cantoo/pdf-lib');
const { test, expect, ouvrirApp } = require('./aide');

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1300, height: 1300 });
  await ouvrirApp(page);
});

const CHAMPS = {   // [x, y, largeur, hauteur]
  nom: [72, 700, 200, 20], adresse: [72, 600, 300, 60], accord: [72, 560, 20, 20],
  A: [72, 520, 20, 20], B: [120, 520, 20, 20], ville: [72, 480, 200, 20], fige: [72, 440, 200, 20],
};
const rect = ([x, y, width, height]) => ({ x, y, width, height });

// Formulaire : texte, multiligne (20 car. max), case, radio A/B, liste, lecture seule.
// opts : pages (2 : le champ « nom » est aussi sur la page 2, plus un champ « suite »), chiffre, xfa ('hybride' | 'pur'), signature
async function formulaire(opts = {}) {
  const doc = await P.PDFDocument.create(), ctx = doc.context;
  doc.preserveXFA = true;   // sinon save() retire le XFA ajouté à la main
  const p1 = doc.addPage([595, 842]), form = doc.getForm();
  if (opts.xfa !== 'pur') {
    const nom = form.createTextField('nom'); nom.addToPage(p1, rect(CHAMPS.nom));
    const adr = form.createTextField('adresse'); adr.enableMultiline(); adr.setMaxLength(20); adr.addToPage(p1, rect(CHAMPS.adresse));
    form.createCheckBox('accord').addToPage(p1, rect(CHAMPS.accord));
    const choix = form.createRadioGroup('choix');
    choix.addOptionToPage('A', p1, rect(CHAMPS.A)); choix.addOptionToPage('B', p1, rect(CHAMPS.B));
    const ville = form.createDropdown('ville'); ville.addOptions(['Paris', 'Lyon', 'Besançon']); ville.addToPage(p1, rect(CHAMPS.ville));
    const fige = form.createTextField('fige'); fige.setText('Verrouillé'); fige.enableReadOnly(); fige.addToPage(p1, rect(CHAMPS.fige));
    if (opts.pages === 2) {
      const p2 = doc.addPage([595, 842]);
      nom.addToPage(p2, rect(CHAMPS.nom));
      form.createTextField('suite').addToPage(p2, { x: 72, y: 600, width: 200, height: 20 });
    }
    if (opts.signature) {
      const w = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Sig', T: P.PDFString.of('signature'), Rect: [72, 300, 272, 350], F: 4, P: p1.ref }));
      p1.node.addAnnot(w); form.acroForm.addField(w);
    }
  }
  if (opts.xfa) {
    const flux = ctx.register(ctx.stream('<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/"/>'));
    form.acroForm.dict.set(P.PDFName.of('XFA'), ctx.obj([P.PDFString.of('template'), flux]));
  }
  if (opts.chiffre) doc.encrypt({ ownerPassword: 'proprio', userPassword: '', algorithm: 'AES-128' });   // comme les Cerfa : mot de passe propriétaire seul
  return Buffer.from(await doc.save());
}

async function ouvrir(page, octets, nom = 'form.pdf') {
  await page.evaluate(({ o, nom }) => MPDS.envoyer(new File([new Uint8Array(o)], nom), 'pdf'), { o: [...octets], nom });
  await expect(page.locator('#pdf-canvas')).toBeVisible();
}
const champ = (page, nom) => page.getByLabel(nom, { exact: true });
const bouton = (page, nom) => page.getByRole('button', { name: nom, exact: true });
const bandeau = page => page.locator('#pdf-bandeau-form');

async function exporter(page) {
  const [dl] = await Promise.all([page.waitForEvent('download'), bouton(page, 'Enregistrer le PDF').click()]);
  const octets = fs.readFileSync(await dl.path());
  expect(octets.subarray(0, 5).toString()).toBe('%PDF-');
  return octets;
}
const textes = (page, octets) => page.evaluate(async o => {
  const d = await (await MPDS.pdfjs.ouvrir(new Uint8Array(o).buffer)).promise, sortie = [];
  for (let i = 1; i <= d.numPages; i++) sortie.push((await (await d.getPage(i)).getTextContent()).items.map(x => x.str).join(''));
  return sortie;
}, [...octets]);
const nbChamps = async octets => (await P.PDFDocument.load(octets, { password: '' })).getForm().getFields().length;
// Pixels sombres à l'intérieur d'un champ (rendu PDF.js à l'échelle 2, bord de 4 pt exclu) : la coche ou le point
const sombres = (page, octets, [x, y, w, h]) => page.evaluate(async ({ o, r: [x, y, w, h] }) => {
  const d = await (await MPDS.pdfjs.ouvrir(new Uint8Array(o).buffer)).promise, p = await d.getPage(1), vue = p.getViewport({ scale: 2 });
  const cv = Object.assign(document.createElement('canvas'), { width: Math.round(vue.width), height: Math.round(vue.height) });
  const g = cv.getContext('2d');
  await p.render({ canvasContext: g, viewport: vue }).promise;
  const px = g.getImageData((x + 4) * 2, (842 - y - h + 4) * 2, (w - 8) * 2, (h - 8) * 2).data;
  let n = 0;
  for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] < 300) n++;
  return n;
}, { o: [...octets], r: [x, y, w, h] });

test('détection : bandeau, nombre de champs ; PDF sans formulaire : rien', async ({ page }) => {
  await ouvrir(page, await formulaire());
  await expect(bandeau(page)).toHaveText(/Ce PDF contient un formulaire \(6 champs\)\./);
  await expect(page.locator('.pdf-champ')).toHaveCount(7);   // 6 champs, 7 widgets (2 boutons radio)
  await page.evaluate(() => MPDS.envoyer(Fab.pdf('simple.pdf', [[{ t: 'Rien', x: 72, y: 700 }]]), 'pdf'));
  await expect(page.locator('#pdf-nom')).toHaveText('simple.pdf');
  await expect(bandeau(page)).toBeHidden();
  await expect(page.locator('.pdf-champ')).toHaveCount(0);
});

test('champ de signature numérique : signalé non pris en charge, sans contrôle', async ({ page }) => {
  await ouvrir(page, await formulaire({ signature: true }));
  await expect(bandeau(page)).toContainText('1 champ de signature numérique : non pris en charge');
  await expect(page.locator('.pdf-champ')).toHaveCount(7);
});

test('XFA pur : message affiché, document visible et annotable', async ({ page }) => {
  await ouvrir(page, await formulaire({ xfa: 'pur' }));
  await expect(bandeau(page)).toContainText('formulaire XFA : non pris en charge');
  await expect(bandeau(page)).not.toContainText('champs');
  await expect(page.locator('.pdf-champ')).toHaveCount(0);
  await expect(page.locator('.pdf-calque')).toBeVisible();
});

test('saisie dans les contrôles, ordre de tabulation, lecture seule, maxLen', async ({ page }) => {
  await ouvrir(page, await formulaire());
  await expect(page.locator('.pdf-champ-liste')).toHaveCount(1);
  await champ(page, 'nom').focus();
  const suite = [];
  for (let i = 0; i < 5; i++) { await page.keyboard.press('Tab'); suite.push(await page.evaluate(() => document.activeElement.getAttribute('aria-label'))); }
  expect(suite).toEqual(['adresse', 'accord', 'choix : option 1', 'ville', 'fige']);   // de haut en bas, un seul arrêt pour le groupe radio
  await expect(champ(page, 'fige')).toHaveValue('Verrouillé');
  await expect(champ(page, 'fige')).not.toBeEditable();
  await champ(page, 'adresse').fill('x'.repeat(30));
  await expect(champ(page, 'adresse')).toHaveValue('x'.repeat(20));
  expect(await page.locator('textarea.pdf-champ').count()).toBe(1);        // multiligne : textarea
  await champ(page, 'nom').fill('Élodie');
  await champ(page, 'accord').check();
  await page.locator('.pdf-champ-radio').nth(1).check();
  await expect(page.locator('.pdf-champ-radio').nth(0)).not.toBeChecked();  // groupés par nom : un seul choisi
  await champ(page, 'ville').selectOption('Lyon');
  await expect(page.locator('#pdf-modif')).toHaveText('● Modifications non enregistrées');
});

test('raccourcis à une lettre inactifs dans les champs', async ({ page }) => {
  await ouvrir(page, await formulaire());
  await champ(page, 'nom').click();
  await page.keyboard.type('hdtvs');
  await expect(champ(page, 'nom')).toHaveValue('hdtvs');
  await expect(page.locator('#pdf-outil-sel')).toHaveAttribute('aria-pressed', 'true');
});

test('couche de saisie interactive avec l\'outil Sélection seulement', async ({ page }) => {
  await ouvrir(page, await formulaire());
  const evts = () => champ(page, 'nom').evaluate(e => getComputedStyle(e).pointerEvents);
  expect(await evts()).toBe('auto');
  await page.locator('#pdf-outil-surlig').click();
  expect(await evts()).toBe('none');
  const b = await champ(page, 'nom').boundingBox();                          // le surligneur passe à travers le champ
  await page.mouse.move(b.x + 10, b.y + 5); await page.mouse.down(); await page.mouse.move(b.x + 100, b.y + 15); await page.mouse.up();
  await expect(page.locator('.pdf-calque [data-type="surlig"]')).toHaveCount(1);
  await page.locator('#pdf-outil-sel').click();
  expect(await evts()).toBe('auto');
});

test('export : texte accentué, formulaire aplati, case et radio visibles', async ({ page }) => {
  await ouvrir(page, await formulaire());
  await champ(page, 'nom').fill('Élodie Brégeaux');
  await champ(page, 'adresse').fill('12 rue de l\'Été');
  await champ(page, 'ville').selectOption('Besançon');
  await champ(page, 'accord').check();
  await page.locator('.pdf-champ-radio').nth(0).check();
  const sortie = await exporter(page);
  const [t] = await textes(page, sortie);
  for (const attendu of ['ÉlodieBrégeaux', 'ruedel\'Été', 'Besançon', 'Verrouillé']) expect(t.replace(/\s/g, '')).toContain(attendu);   // PDF.js peut perdre les espaces
  expect(await nbChamps(sortie)).toBe(0);
  expect(await sombres(page, sortie, CHAMPS.accord)).toBeGreaterThan(10);    // coche dessinée
  expect(await sombres(page, sortie, CHAMPS.A)).toBeGreaterThan(10);         // point du radio choisi
  expect(await sombres(page, sortie, CHAMPS.B)).toBe(0);                     // l'autre reste vide
  // contre-épreuve : case décochée → intérieur vide
  await champ(page, 'accord').uncheck();
  expect(await sombres(page, await exporter(page), CHAMPS.accord)).toBe(0);
});

test('formulaire chiffré (mot de passe propriétaire seul) : remplir puis exporter', async ({ page }) => {
  await ouvrir(page, await formulaire({ chiffre: true }));
  await expect(bandeau(page)).toContainText('6 champs');
  await champ(page, 'nom').fill('Chiffré Été');
  const sortie = await exporter(page);
  expect((await textes(page, sortie))[0]).toContain('Chiffré Été');
  expect(await nbChamps(sortie)).toBe(0);
});

test('les valeurs suivent la page : champ partagé, pivotement, réordonnancement', async ({ page }) => {
  await ouvrir(page, await formulaire({ pages: 2 }));
  await expect(bandeau(page)).toContainText('7 champs');
  await champ(page, 'nom').fill('Partagé');
  await bouton(page, 'Page suivante').click();
  await expect(page.locator('#pdf-num')).toHaveValue('2');
  await expect(champ(page, 'nom')).toHaveValue('Partagé');                   // même champ, autre page
  await champ(page, 'suite').fill('Suite');
  await bouton(page, 'Pivoter à droite').click();
  await expect.poll(() => page.evaluate(() => { const c = document.getElementById('pdf-canvas'); return c.width > c.height; })).toBe(true);
  // page pivotée de 90° : le rectangle PDF (x 72–272, y 700–720) devient x 700–720, y 72–272 de l'affichage
  await expect(champ(page, 'nom')).toHaveValue('Partagé');
  const g = await page.evaluate(() => {
    const c = document.getElementById('pdf-canvas').getBoundingClientRect(), n = document.querySelector('.pdf-champ[aria-label="nom"]').getBoundingClientRect();
    const k = c.width / 842;
    return { x: (n.left - c.left) / k, y: (n.top - c.top) / k, w: n.width / k, h: n.height / k };
  });
  expect(g.x).toBeCloseTo(700, -1); expect(g.y).toBeCloseTo(72, -1); expect(g.w).toBeCloseTo(20, -1); expect(g.h).toBeCloseTo(200, -1);
  await bouton(page, 'Monter la page').click();                              // la page 2 passe en tête
  await expect(champ(page, 'suite')).toHaveValue('Suite');
  const sortie = await exporter(page);
  const t = await textes(page, sortie);
  expect(t[0]).toContain('Suite'); expect(t[0]).toContain('Partagé'); expect(t[1]).toContain('Partagé');
  expect(await nbChamps(sortie)).toBe(0);
});

test('fusion de deux formulaires : chaque source garde ses valeurs', async ({ page }) => {
  await ouvrir(page, await formulaire(), 'a.pdf');
  await champ(page, 'nom').fill('Alice');
  const b = await formulaire();
  await page.locator('#pdf-ajout').setInputFiles({ name: 'b.pdf', mimeType: 'application/pdf', buffer: b });
  await expect(page.locator('#pdf-nb')).toHaveText('2 pages');
  await expect(bandeau(page)).toContainText('12 champs');
  await bouton(page, 'Page suivante').click();
  await expect(champ(page, 'nom')).toHaveValue('');                          // même nom, autre source : pas de partage
  await champ(page, 'nom').fill('Bob');
  await bouton(page, 'Page précédente').click();
  await expect(champ(page, 'nom')).toHaveValue('Alice');
  const t = await textes(page, await exporter(page));
  expect(t[0]).toContain('Alice'); expect(t[0]).not.toContain('Bob');
  expect(t[1]).toContain('Bob'); expect(t[1]).not.toContain('Alice');
});

test('réinitialiser le formulaire', async ({ page }) => {
  await ouvrir(page, await formulaire());
  await champ(page, 'nom').fill('Effacé');
  await champ(page, 'accord').check();
  page.once('dialog', d => d.accept());
  await bouton(page, 'Réinitialiser le formulaire').click();
  await expect(champ(page, 'nom')).toHaveValue('');
  await expect(champ(page, 'accord')).not.toBeChecked();
});

test('texte hors WinAnsi : refusé dès la saisie, et à l\'export avec le nom du champ', async ({ page }) => {
  await ouvrir(page, await formulaire());
  await champ(page, 'nom').fill('Ωmega');
  await expect(champ(page, 'nom')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#pdf-etat')).toContainText('Champ « nom »');
  await expect(page.locator('#pdf-etat')).toContainText('U+03A9');
  await bouton(page, 'Enregistrer le PDF').click();
  await expect(page.locator('#pdf-etat')).toContainText('L\'export a échoué : Champ « nom » de « form.pdf » : Caractère non pris en charge');
  await champ(page, 'nom').fill('Omega');
  await expect(champ(page, 'nom')).not.toHaveAttribute('aria-invalid', 'true');
  expect(await nbChamps(await exporter(page))).toBe(0);
});

test('échec de remplissage : le message nomme le champ', async ({ page }) => {
  const octets = await formulaire();
  const erreur = await page.evaluate(async o => {
    await MPDS.chargerScript(MPDS.pdfExport.URL_LIB);
    const source = { nom: 'x.pdf', octets: new Uint8Array(o).buffer, valeurs: new Map([['fantome', 'a']]) };
    try { await MPDS.pdfExport.construire([{ source, index: 0, rotation: 0 }]); return null; } catch (e) { return e.message; }
  }, [...octets]);
  expect(erreur).toContain('Champ « fantome » de « x.pdf »');
});

test('XFA hybride : partie XFA abandonnée, avertissement, formulaire rempli', async ({ page }) => {
  await ouvrir(page, await formulaire({ xfa: 'hybride' }));
  await expect(bandeau(page)).toContainText('6 champs');
  await champ(page, 'nom').fill('Hybride');
  const sortie = await exporter(page);
  await expect(page.locator('#pdf-etat')).toContainText('XFA');
  expect((await textes(page, sortie))[0]).toContain('Hybride');
  expect(await nbChamps(sortie)).toBe(0);
});

// Revue PR #5 : cases « Oui » / « Non » de même nom (un seul champ, deux états « coché » différents,
// courant sur les Cerfa) et radio dont les options /Opt ressemblent à des indices ('1', '2' ; états '0', '1')
const OUI = [72, 560, 20, 20], NON = [120, 560, 20, 20], UN = [72, 480, 20, 20], DEUX = [120, 480, 20, 20];
async function boutons() {
  const doc = await P.PDFDocument.create(), ctx = doc.context, p1 = doc.addPage([595, 842]);
  const flux = contenu => ctx.register(ctx.stream(contenu, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 20, 20] }));
  const champ = ctx.register(ctx.obj({ FT: 'Btn', T: P.PDFString.of('reponse'), V: 'Off', Kids: [] }));
  for (const [etat, [x, y, w, h]] of [['Oui', OUI], ['Non', NON]]) {
    const wd = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Widget', Rect: [x, y, x + w, y + h], F: 4, P: p1.ref, Parent: champ, AS: 'Off',
      AP: { N: { [etat]: flux('0 0 0 rg 2 2 16 16 re f'), Off: flux('') } } }));
    p1.node.addAnnot(wd); ctx.lookup(champ).lookup(P.PDFName.of('Kids')).push(wd);
  }
  doc.catalog.set(P.PDFName.of('AcroForm'), ctx.obj({ Fields: [champ] }));
  const num = doc.getForm().createRadioGroup('numero');
  num.addOptionToPage('1', p1, rect(UN)); num.addOptionToPage('2', p1, rect(DEUX));
  return Buffer.from(await doc.save());
}

test('cases de même nom (Oui/Non) et radio /Opt numérique : l\'écran et l\'export cochent le bon bouton', async ({ page }) => {
  await ouvrir(page, await boutons());
  const oui = champ(page, 'reponse : Oui'), non = champ(page, 'reponse : Non');   // libellés distincts
  await non.check();
  await expect(non).toBeChecked(); await expect(oui).not.toBeChecked();          // elles s'excluent
  await page.getByLabel('numero : option 2', { exact: true }).check();
  let sortie = await exporter(page);
  expect(await sombres(page, sortie, NON)).toBeGreaterThan(10);
  expect(await sombres(page, sortie, OUI)).toBe(0);
  expect(await sombres(page, sortie, DEUX)).toBeGreaterThan(10);
  expect(await sombres(page, sortie, UN)).toBe(0);
  await oui.check();
  await expect(non).not.toBeChecked();
  sortie = await exporter(page);
  expect(await sombres(page, sortie, OUI)).toBeGreaterThan(10);
  expect(await sombres(page, sortie, NON)).toBe(0);
});

test('export sans saisie : le formulaire est aplati quand même (plus aucun widget, valeurs du fichier figées)', async ({ page }) => {
  await ouvrir(page, await formulaire());
  const sortie = await exporter(page);
  const doc = await P.PDFDocument.load(sortie), annots = doc.getPage(0).node.Annots();
  expect(annots ? annots.size() : 0).toBe(0);
  expect((await textes(page, sortie))[0]).toContain('Verrouillé');
});
