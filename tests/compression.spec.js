// Module PDF — compresser : sans perte (flux bruts compressés, flux d'objets, contenu inchangé) et pages
// en image (chaque page devient un JPEG). Ce qui est vérifié est le fichier produit : poids, pages, texte,
// pixels, signets, métadonnées. Sans gain, rien n'est proposé ; un document modifié n'est jamais remplacé
// par le fichier d'origine.
'use strict';

const fs = require('fs');
const { test, expect, ouvrirApp } = require('./aide');
const { pdfChiffre } = require('./pdf-chiffre');

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1300, height: 1300 });
  await ouvrirApp(page);
});

const bouton = (page, nom) => page.getByRole('button', { name: nom, exact: true });
async function calculer(page, { dpi, qualite } = {}) {
  if (!(await page.locator('#pdf-comp').isVisible())) await bouton(page, 'Compresser').click();
  if (dpi) await page.locator('#pdf-comp-dpi').selectOption(String(dpi));
  if (qualite) await page.locator('#pdf-comp-qualite').selectOption(String(qualite));
  await bouton(page, 'Calculer').click();
  await expect(page.locator('#pdf-comp-image')).toBeVisible({ timeout: 30000 });
}
async function enregistrer(page, nom) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: nom }).click()]);
  return { nom: dl.suggestedFilename(), octets: fs.readFileSync(await dl.path()) };
}
// Relit un fichier : par page, texte, cadre, rotation et somme des pixels du rendu ; auteur
const relire = (page, octets) => page.evaluate(async o => {
  const d = await (await MPDS.pdfjs.ouvrir(new Uint8Array(o).buffer)).promise, pages = [];
  for (let i = 1; i <= d.numPages; i++) {
    const p = await d.getPage(i), vue = p.getViewport({ scale: 1 });
    const cv = Object.assign(document.createElement('canvas'), { width: Math.ceil(vue.width), height: Math.ceil(vue.height) });
    await p.render({ canvasContext: cv.getContext('2d'), viewport: vue }).promise;
    const px = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let somme = 0; for (let k = 0; k < px.length; k += 4) somme += px[k];
    pages.push({ texte: (await p.getTextContent()).items.map(x => x.str).join(''), view: p.view, rotate: p.rotate, somme });
  }
  return { pages, auteur: (await d.getMetadata()).info.Author || null };
}, [...octets]);

test('sans perte : flux brut compressé, texte, pixels, signets et auteur conservés', async ({ page }) => {
  const src = await page.evaluate(async () => {
    await MPDS.chargerScript(MPDS.pdfExport.URL_LIB);
    const { PDFDocument, PDFName, StandardFonts, pushGraphicsState, popGraphicsState, concatTransformationMatrix, drawObject } = PDFLib;
    const d = await PDFDocument.create(), f = await d.embedFont(StandardFonts.Helvetica);
    d.setAuthor('Auteur Test');
    const p = d.addPage([595, 842]);
    p.drawText('Bonjour compression', { x: 72, y: 760, size: 18, font: f });
    // image en niveaux de gris SANS filtre (dégradé : très compressible), comme certains logiciels de numérisation
    const pix = new Uint8Array(300 * 300).map((_, i) => (i % 300) * 255 / 299);
    const ref = d.context.register(d.context.stream(pix, { Type: 'XObject', Subtype: 'Image', Width: 300, Height: 300, ColorSpace: 'DeviceGray', BitsPerComponent: 8 }));
    p.node.setXObject(PDFName.of('Im0'), ref);
    // image déjà filtrée (ASCIIHex, compressible) : elle ne doit pas être touchée, une 2e couche de filtre la casserait
    const hex = new TextEncoder().encode([...new Uint8Array(100 * 100).map((_, i) => (i * 7) % 256)].map(v => v.toString(16).padStart(2, '0')).join('') + '>');
    const ref2 = d.context.register(d.context.stream(hex, { Type: 'XObject', Subtype: 'Image', Width: 100, Height: 100, ColorSpace: 'DeviceGray', BitsPerComponent: 8, Filter: 'ASCIIHexDecode' }));
    p.node.setXObject(PDFName.of('Im1'), ref2);
    p.pushOperators(pushGraphicsState(), concatTransformationMatrix(300, 0, 0, 300, 72, 300), drawObject('Im0'), popGraphicsState(),
      pushGraphicsState(), concatTransformationMatrix(100, 0, 0, 100, 400, 300), drawObject('Im1'), popGraphicsState());
    d.addPage([595, 842]).drawText('Seconde page', { x: 72, y: 760, size: 18, font: f });
    d.catalog.set(PDFName.of('Outlines'), d.context.register(d.context.obj({ Type: 'Outlines', Count: 0 })));
    const o = await d.save({ useObjectStreams: false });
    await MPDS.envoyer(new File([o], 'scan brut.pdf'), 'pdf');
    return [...o];
  });
  await expect(page.locator('.pdf-mini')).toHaveCount(2);
  await calculer(page);
  await expect(page.locator('#pdf-comp-etat')).toContainText('Fichier d\'origine : ');
  await expect(page.locator('#pdf-comp-sans-perte')).toContainText(/Sans perte : [\d,]+ Ko \(−\d+ %\)\. Contenu inchangé\./);
  const r = await enregistrer(page, 'Enregistrer la version sans perte');
  expect(r.nom).toBe('scan brut (compressé).pdf');
  expect(r.octets.length).toBeLessThan(src.length * 0.6);
  const avant = await relire(page, Buffer.from(src)), apres = await relire(page, r.octets);
  expect(apres).toEqual(avant);   // même texte, même cadre, mêmes pixels (flux recompressé décodé à l'identique)
  expect(apres.pages[0].texte).toBe('Bonjour compression');
  expect(apres.auteur).toBe('Auteur Test');
  const structure = await page.evaluate(async o => {
    const d = await PDFLib.PDFDocument.load(new Uint8Array(o), { updateMetadata: false });
    const im = d.getPage(0).node.Resources().lookup(PDFLib.PDFName.of('XObject')).lookup(PDFLib.PDFName.of('Im0'));
    return { signets: d.catalog.has(PDFLib.PDFName.of('Outlines')), filtre: String(im.dict.get(PDFLib.PDFName.of('Filter'))) };
  }, [...r.octets]);
  expect(structure).toEqual({ signets: true, filtre: '/FlateDecode' });
});

test('pages en image : scan nettement allégé, pages, cadres et rotation conservés, plus de texte', async ({ page }) => {
  const taille = await page.evaluate(async () => {
    await MPDS.chargerScript(MPDS.pdfExport.URL_LIB);
    const { PDFDocument, StandardFonts, degrees } = PDFLib;
    const d = await PDFDocument.create(), f = await d.embedFont(StandardFonts.Helvetica);
    // « scan » à 150 ppp en PNG (sans perte) avec un grain de papier : lourd, comme une vraie numérisation
    const cv = Object.assign(document.createElement('canvas'), { width: 1240, height: 1754 }), g = cv.getContext('2d');
    const im = g.createImageData(cv.width, cv.height);
    for (let k = 0; k < im.data.length; k += 4) { const v = 235 + Math.floor(Math.random() * 20); im.data[k] = im.data[k + 1] = im.data[k + 2] = v; im.data[k + 3] = 255; }
    g.putImageData(im, 0, 0);
    g.fillStyle = '#000'; g.font = '60px serif'; g.fillText('Arrêté municipal', 150, 300);
    const png = await d.embedPng(new Uint8Array(await (await new Promise(ok => cv.toBlob(ok, 'image/png'))).arrayBuffer()));
    for (let i = 0; i < 3; i++) {
      const p = d.addPage([595, 842]);
      p.drawImage(png, { x: 0, y: 0, width: 595, height: 842 });
      p.drawText('couche OCR ' + (i + 1), { x: 72, y: 700, size: 12, font: f, opacity: 0 });   // texte invisible d'un scan océrisé
      if (i === 1) p.setRotation(degrees(90));
    }
    const o = await d.save();
    await MPDS.envoyer(new File([o], 'scan.pdf'), 'pdf');
    return o.length;
  });
  await expect(page.locator('.pdf-mini')).toHaveCount(3);
  await calculer(page, { dpi: 72, qualite: 0.5 });
  await expect(page.locator('#pdf-comp-image')).toContainText(/Pages en image \(72 ppp\) : [\d,]+ Ko \(−\d+ %\)\. Le texte ne sera plus sélectionnable ni cherchable\./);
  const r = await enregistrer(page, 'Enregistrer la version en image');
  expect(r.nom).toBe('scan (compressé).pdf');
  expect(r.octets.length).toBeLessThan(taille * 0.3);
  const l = await relire(page, r.octets);
  expect(l.pages.map(p => [p.texte, p.view.join(), p.rotate])).toEqual([['', '0,0,595,842', 0], ['', '0,0,595,842', 90], ['', '0,0,595,842', 0]]);
  // résolution demandée respectée : 595 points à 72 ppp = 595 pixels de large
  const largeur = await page.evaluate(async o => {
    const d = await PDFLib.PDFDocument.load(new Uint8Array(o)), xo = d.getPage(0).node.Resources().lookup(PDFLib.PDFName.of('XObject'));
    return xo.keys().map(k => xo.lookup(k).dict.get(PDFLib.PDFName.of('Width')).asNumber());
  }, [...r.octets]);
  expect(largeur).toEqual([595]);
  // qualité demandée respectée : Haute est plus lourde que Basse
  await calculer(page, { dpi: 72, qualite: 0.85 });
  expect((await enregistrer(page, 'Enregistrer la version en image')).octets.length).toBeGreaterThan(r.octets.length * 1.2);
});

test('terme caviardé puis zones annulées : sans perte indisponible, terme lisible signalé en erreur', async ({ page }) => {
  await page.evaluate(async () => {
    await MPDS.chargerScript(MPDS.pdfExport.URL_LIB);
    const { PDFDocument, StandardFonts } = PDFLib, d = await PDFDocument.create(), f = await d.embedFont(StandardFonts.Helvetica);
    d.addPage([595, 842]).drawText('Monsieur Jean Dupont, agent.', { x: 72, y: 760, size: 14, font: f });
    await MPDS.envoyer(new File([await d.save()], 'dossier.pdf'), 'pdf');
  });
  await expect(page.locator('.pdf-mini')).toHaveCount(1);
  await bouton(page, 'Rechercher et caviarder').click();
  await page.getByLabel('Mot ou expression à caviarder').fill('Dupont');
  await page.keyboard.press('Enter');
  await bouton(page, 'Caviarder l\'occurrence').click();
  await page.locator('#pdf-scene').click();
  await page.keyboard.press('Control+z');
  await expect(page.locator('.pdf-calque [data-type="caviar"]')).toHaveCount(0);
  await calculer(page);
  await expect(page.locator('#pdf-comp-sans-perte')).toContainText('Sans perte : indisponible');
  await expect(page.locator('#pdf-etat')).toHaveClass(/pdf-erreur/);
  await expect(page.locator('#pdf-etat')).toContainText('« Dupont » reste lisible en clair, page 1.');
});

test('document déjà optimal et texte seul : aucun gain, rien à enregistrer', async ({ page }) => {
  await page.evaluate(async () => {
    await MPDS.chargerScript(MPDS.pdfExport.URL_LIB);
    const { PDFDocument, StandardFonts } = PDFLib, d = await PDFDocument.create(), f = await d.embedFont(StandardFonts.Helvetica);
    d.addPage([595, 842]).drawText('Une note de service.', { x: 72, y: 760, size: 12, font: f });
    await MPDS.envoyer(new File([await d.save()], 'note.pdf'), 'pdf');
  });
  await expect(page.locator('.pdf-mini')).toHaveCount(1);
  await calculer(page);
  await expect(page.locator('#pdf-comp-sans-perte')).toHaveText('Sans perte : aucun gain, le fichier est déjà optimisé.');
  await expect(page.locator('#pdf-comp-image')).toContainText('plus lourd que le document actuel : rien à gagner.');
  await expect(page.locator('#pdf-comp-liste button')).toHaveCount(0);
});

test('document modifié : sans perte indisponible, caviardage conservé, calcul périmé refusé', async ({ page }) => {
  await page.evaluate(async () => {
    await MPDS.chargerScript(MPDS.pdfExport.URL_LIB);
    const { PDFDocument, StandardFonts } = PDFLib, d = await PDFDocument.create(), f = await d.embedFont(StandardFonts.Helvetica);
    d.addPage([595, 842]).drawText('Monsieur Jean Dupont, agent.', { x: 72, y: 760, size: 14, font: f });
    d.addPage([595, 842]).drawText('Page sans le nom.', { x: 72, y: 760, size: 14, font: f });
    await MPDS.envoyer(new File([await d.save()], 'dossier.pdf'), 'pdf');
  });
  await expect(page.locator('.pdf-mini')).toHaveCount(2);
  await bouton(page, 'Rechercher et caviarder').click();
  await page.getByLabel('Mot ou expression à caviarder').fill('Dupont');
  await page.keyboard.press('Enter');
  await bouton(page, 'Caviarder l\'occurrence').click();
  await calculer(page, { dpi: 72, qualite: 0.5 });
  await expect(page.locator('#pdf-comp-etat')).toContainText('Document modifié, enregistré normalement : ');
  await expect(page.locator('#pdf-comp-sans-perte')).toContainText('Sans perte : indisponible, le document a été modifié.');
  await expect(page.locator('#pdf-comp-sans-perte button')).toHaveCount(0);
  const r = await enregistrer(page, 'Enregistrer la version en image');
  expect(r.nom).toBe('dossier (caviardé, compressé).pdf');
  const l = await relire(page, r.octets);
  expect(l.pages.map(p => p.texte)).toEqual(['', '']);
  await expect(page.locator('#pdf-etat')).not.toHaveClass(/pdf-erreur/);
  // Le document change après le calcul : l'ancien résultat n'est plus enregistrable
  await calculer(page, { dpi: 72, qualite: 0.5 });
  await page.getByRole('button', { name: 'Pivoter à droite', exact: true }).click();
  let telecharge = false;
  page.on('download', () => { telecharge = true; });
  await page.getByRole('button', { name: 'Enregistrer la version en image' }).click();
  await expect(page.locator('#pdf-comp-etat')).toHaveText('Le document a changé depuis le calcul : recalculez.');
  await expect(page.locator('#pdf-comp-liste button')).toHaveCount(0);
  expect(telecharge).toBe(false);
});

test('formulaire rempli dans l\'application : la valeur saisie figure sur la page en image', async ({ page }) => {
  await page.evaluate(async () => {
    await MPDS.chargerScript(MPDS.pdfExport.URL_LIB);
    const { PDFDocument } = PDFLib, d = await PDFDocument.create(), p = d.addPage([595, 842]);
    // fond scanné clair (PNG, lourd) : la version en image allège, le bouton d'enregistrement est proposé
    const cv = Object.assign(document.createElement('canvas'), { width: 1240, height: 1754 }), g = cv.getContext('2d'), im = g.createImageData(1240, 1754);
    for (let k = 0; k < im.data.length; k += 4) { im.data[k] = im.data[k + 1] = im.data[k + 2] = 235 + Math.floor(Math.random() * 20); im.data[k + 3] = 255; }
    g.putImageData(im, 0, 0);
    p.drawImage(await d.embedPng(new Uint8Array(await (await new Promise(ok => cv.toBlob(ok, 'image/png'))).arrayBuffer())), { x: 0, y: 0, width: 595, height: 842 });
    d.getForm().createTextField('nom').addToPage(p, { x: 72, y: 700, width: 300, height: 30, borderWidth: 0, backgroundColor: undefined });
    await MPDS.envoyer(new File([await d.save()], 'cerfa.pdf'), 'pdf');
  });
  await page.getByLabel('nom', { exact: true }).fill('MMMMMMMMMM');
  await calculer(page, { dpi: 150, qualite: 0.85 });
  const r = await enregistrer(page, 'Enregistrer la version en image');
  // pixels sombres dans le cadre du champ (y de 700 à 730 points → 112 à 142 pixels depuis le haut, à l'échelle 1)
  const sombres = await page.evaluate(async o => {
    const d = await (await MPDS.pdfjs.ouvrir(new Uint8Array(o).buffer)).promise, p = await d.getPage(1), vue = p.getViewport({ scale: 1 });
    const cv = Object.assign(document.createElement('canvas'), { width: Math.ceil(vue.width), height: Math.ceil(vue.height) });
    await p.render({ canvasContext: cv.getContext('2d'), viewport: vue }).promise;
    const px = cv.getContext('2d').getImageData(74, 114, 296, 26).data;
    let n = 0; for (let k = 0; k < px.length; k += 4) if (px[k] < 128) n++;
    return n;
  }, [...r.octets]);
  expect(sombres).toBeGreaterThan(200);
});

test('Cerfa chiffré (mot de passe propriétaire) : relu, protection non conservée signalée', async ({ page }) => {
  const r = await page.evaluate(async o => {
    const octets = new Uint8Array(o).buffer, doc = await (await MPDS.pdfjs.ouvrir(octets.slice(0))).promise, avis = [];
    const sortie = await MPDS.pdfOptimisation.optimiser({ nom: 'cerfa.pdf', doc, octets }, avis);
    const relu = await (await MPDS.pdfjs.ouvrir(sortie.slice().buffer)).promise, p = await relu.getPage(1);
    return { avis, texte: (await p.getTextContent()).items.map(x => x.str).join(''), chiffre: !!(await relu.getMetadata()).info.EncryptFilterName };
  }, [...pdfChiffre(['Formulaire Cerfa'], 'rc4_128')]);
  expect(r).toEqual({ avis: ['La protection du fichier (mot de passe propriétaire, restrictions d\'usage) n\'est pas conservée.'], texte: 'Formulaire Cerfa', chiffre: false });
});

test('panneau : fermé à l\'ouverture d\'un autre document, changement de réglage efface le résultat', async ({ page }) => {
  const ouvrir = nom => page.evaluate(async n => {
    await MPDS.chargerScript(MPDS.pdfExport.URL_LIB);
    const { PDFDocument, StandardFonts } = PDFLib, d = await PDFDocument.create(), f = await d.embedFont(StandardFonts.Helvetica);
    d.addPage([595, 842]).drawText(n, { x: 72, y: 760, size: 12, font: f });
    await MPDS.envoyer(new File([await d.save()], n), 'pdf');
  }, nom);
  await ouvrir('a.pdf');
  await expect(page.locator('.pdf-mini')).toHaveCount(1);
  await calculer(page);
  await page.locator('#pdf-comp-dpi').selectOption('100');
  await expect(page.locator('#pdf-comp-liste li')).toHaveCount(0);
  await ouvrir('b.pdf');
  await expect(page.locator('#pdf-nom')).toHaveText('b.pdf');
  await expect(page.locator('#pdf-comp')).toBeHidden();
});
