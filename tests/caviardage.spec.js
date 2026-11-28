// Module PDF — caviardage : zones tracées à la main ou posées par recherche ; à l'export, chaque page
// caviardée devient une page neuve ne contenant que son image (zones noircies dans les pixels). Ce qui
// est vérifié est le fichier produit, relu par PDF.js et pdf-lib : texte, annotations, métadonnées, pixels.
'use strict';

const fs = require('fs');
const { test, expect, ouvrirApp } = require('./aide');

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1300, height: 1300 });
  await ouvrirApp(page);
});

const bouton = (page, nom) => page.getByRole('button', { name: nom, exact: true });
const pret = page => page.waitForFunction(() => {
  const s = document.querySelector('.pdf-calque'), z = parseFloat(document.getElementById('pdf-zoom').textContent) / 100;
  return s && Math.abs(s.getBoundingClientRect().width - s.viewBox.baseVal.width * z) < 3;
});
// Affiche le document ouvert à 100 % : 1 point = 1 pixel
async function cent(page) {
  await pret(page);
  while (parseInt(await page.locator('#pdf-zoom').textContent(), 10) > 100) { await bouton(page, 'Zoom arrière').click(); await pret(page); }
}
const ecran = (page, x, y) => page.evaluate(([x, y]) => {
  const s = document.querySelector('.pdf-calque'), b = s.getBoundingClientRect(), v = s.viewBox.baseVal;
  return { x: b.left + x * b.width / v.width, y: b.top + y * b.height / v.height };
}, [x, y]);
async function tracer(page, x0, y0, x1, y1) {
  const a = await ecran(page, x0, y0), b = await ecran(page, x1, y1);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 6 }); await page.mouse.up();
}
async function exporter(page) {
  const [dl] = await Promise.all([page.waitForEvent('download'), bouton(page, 'Enregistrer le PDF').click()]);
  return { nom: dl.suggestedFilename(), octets: fs.readFileSync(await dl.path()) };
}
// Relit le fichier : par page, texte, annotations, rotation ; métadonnées du document
const relire = (page, octets) => page.evaluate(async o => {
  const d = await (await MPDS.pdfjs.ouvrir(new Uint8Array(o).buffer)).promise, pages = [];
  for (let i = 1; i <= d.numPages; i++) {
    const p = await d.getPage(i);
    pages.push({ texte: (await p.getTextContent()).items.map(t => t.str).join(''), annots: (await p.getAnnotations()).length, rotation: p.rotate, view: p.view });
  }
  const { info } = await d.getMetadata();
  return { pages, auteur: info.Author || null, titre: info.Title || null };
}, [...octets]);
// Pixels (RGB) du rendu à l'échelle 1 de la page n (rotation de la page comprise)
const pixels = (page, octets, n, pts) => page.evaluate(async ({ o, n, pts }) => {
  const d = await (await MPDS.pdfjs.ouvrir(new Uint8Array(o).buffer)).promise, p = await d.getPage(n), vue = p.getViewport({ scale: 1 });
  const cv = Object.assign(document.createElement('canvas'), { width: Math.round(vue.width), height: Math.round(vue.height) }), g = cv.getContext('2d');
  await p.render({ canvasContext: g, viewport: vue }).promise;
  return pts.map(([x, y]) => [...g.getImageData(Math.round(x), Math.round(y), 1, 1).data].slice(0, 3));
}, { o: [...octets], n, pts });
const noir = px => px.every(v => v < 60), blanc = px => px.every(v => v > 200);
// Structure d'une page du fichier : clés de /Resources non vides, nombre d'images, polices
const structure = (page, octets, n) => page.evaluate(async ({ o, n }) => {
  await MPDS.chargerScript(MPDS.pdfExport.URL_LIB);
  const { PDFDocument, PDFDict, PDFName } = PDFLib, d = await PDFDocument.load(new Uint8Array(o)), res = d.getPage(n - 1).node.Resources();
  const taille = k => { const v = res.lookup(PDFName.of(k)); return v instanceof PDFDict ? v.keys().length : 0; };
  return { polices: taille('Font'), images: taille('XObject') };
}, { o: [...octets], n });

// Document de recherche (pdf-lib) : nom en capitales (p. 1), dans l'adresse d'un lien (p. 2), coupé sur deux
// lignes avec un accent (p. 3), absent (p. 4), page sans texte (p. 5, image seule) ; auteur et titre renseignés
async function ouvrirDossier(page) {
  await page.evaluate(async () => {
    await MPDS.chargerScript(MPDS.pdfExport.URL_LIB);
    const { PDFDocument, StandardFonts, PDFName, PDFString } = PDFLib;
    const d = await PDFDocument.create();
    d.setAuthor('Jean Dupont'); d.setTitle('Dossier Dupont');
    const f = await d.embedFont(StandardFonts.Helvetica);
    const ecrire = (p, t, y) => p.drawText(t, { x: 72, y, size: 14, font: f });
    ecrire(d.addPage([595, 842]), 'Monsieur Jean DUPONT demeure ici.', 760);
    const p2 = d.addPage([595, 842]);
    ecrire(p2, 'Contact : voir le site.', 760);
    const lien = d.context.register(d.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [72, 700, 300, 720], Border: [0, 0, 0],
      A: { Type: 'Action', S: 'URI', URI: PDFString.of('https://exemple.fr/JeanDupont') } }));
    p2.node.set(PDFName.of('Annots'), d.context.obj([lien]));
    const p3 = d.addPage([595, 842]);
    ecrire(p3, 'Signé : Jéan Du', 760); ecrire(p3, 'pont, agent.', 740);
    ecrire(d.addPage([595, 842]), 'Rien à signaler.', 760);
    const img = await d.embedPng(Uint8Array.from(atob(Fab.PNG_B64), c => c.charCodeAt(0)));
    d.addPage([595, 842]).drawImage(img, { x: 72, y: 600, width: 200, height: 100 });
    await MPDS.envoyer(new File([await d.save()], 'dossier.pdf'), 'pdf');
  });
  await expect(page.locator('.pdf-mini')).toHaveCount(5);
  await cent(page);
}

test('outil Caviarder : la page devient une image noircie, sans texte ni police ; les autres pages restent intactes', async ({ page }) => {
  await page.evaluate(() => MPDS.envoyer(Fab.pdf('a.pdf', [[{ t: 'Secret page un', x: 72, y: 760, taille: 30 }, { t: 'Public', x: 72, y: 600, taille: 30 }],
    [{ t: 'Page deux', x: 72, y: 760, taille: 30 }]]), 'pdf'));
  await expect(page.locator('.pdf-mini')).toHaveCount(2);
  await cent(page);
  await bouton(page, 'Caviarder (R)').click();
  await tracer(page, 60, 50, 330, 95);   // ligne « Secret page un » (base à y = 842 − 760 = 82)
  await expect(page.locator('.pdf-calque [data-type="caviar"]')).toHaveCount(1);
  const { nom, octets } = await exporter(page);
  expect(nom).toBe('a (caviardé).pdf');
  const r = await relire(page, octets);
  expect(r.pages.map(p => p.texte)).toEqual(['', 'Page deux']);   // page 1 : plus aucun texte, même « Public »
  expect(await structure(page, octets, 1)).toEqual({ polices: 0, images: 1 });
  expect((await structure(page, octets, 2)).polices).toBeGreaterThan(0);
  const [cache, garde, fond] = await pixels(page, octets, 1, [[150, 72], [80, 252], [400, 450]]);
  expect(noir(cache)).toBe(true);
  expect(noir(garde)).toBe(false);   // « Public » reste visible (en image)
  expect(blanc(fond)).toBe(true);
  await expect(page.locator('#pdf-etat')).toContainText('« a (caviardé).pdf » enregistré.');
});

test('recherche : casse, accents, coupure de ligne, adresse de lien ; pages sans texte signalées ; métadonnées retirées', async ({ page }) => {
  await ouvrirDossier(page);
  await page.getByRole('button', { name: 'Rechercher et caviarder' }).click();
  await page.getByLabel('Mot ou expression à caviarder').fill('jean dupont');
  await page.getByRole('button', { name: 'Chercher', exact: true }).click();
  await expect(page.locator('#pdf-cav-resultat')).toHaveText('« jean dupont » : 3 occurrences, pages 1, 2, 3. Attention, page 5 sans texte (image ou scan) : la recherche n\'y voit rien, caviardez à la main.');
  await page.getByRole('button', { name: 'Caviarder les 3 occurrences' }).click();
  await expect(page.locator('#pdf-cav-resultat')).toContainText('zones noires posées');
  const { octets } = await exporter(page);
  const r = await relire(page, octets);
  expect(r.pages.map(p => p.texte)).toEqual(['', '', '', 'Rien à signaler.', '']);
  expect(r.pages[1].annots).toBe(0);   // le lien vers l'adresse portant le nom a disparu avec la page
  expect([r.auteur, r.titre]).toEqual([null, null]);
  // « Jean DUPONT » (Helvetica 14 : de x ≈ 133,5 à 226,9, ligne de base y = 82) entièrement noirci, marge comprise ;
  // le reste de la page est blanc
  const px = await pixels(page, octets, 1, [[134, 78], [150, 78], [170, 78], [200, 72], [226, 80], [400, 450]]);
  expect(px.slice(0, 5).every(noir)).toBe(true);
  expect(blanc(px[5])).toBe(true);
  // Rien ne reste lisible : pas d'avertissement « reste lisible »
  await expect(page.locator('#pdf-etat')).not.toContainText('reste lisible');
});

test('zone retirée exprès : le terme encore lisible est signalé ; Ctrl+Z retire tout le lot', async ({ page }) => {
  await ouvrirDossier(page);
  await page.getByRole('button', { name: 'Rechercher et caviarder' }).click();
  await page.getByLabel('Mot ou expression à caviarder').fill('Jean Dupont');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Caviarder les 3 occurrences' }).click();
  // Page 1 affichée : sa zone est retirée (sélection + Suppr)
  await expect(page.locator('.pdf-calque [data-type="caviar"]')).toHaveCount(1);
  await bouton(page, 'Sélection (V)').click();
  const z = await page.locator('.pdf-calque [data-type="caviar"] rect').boundingBox();
  await page.mouse.click(z.x + z.width / 2, z.y + z.height / 2);
  await page.keyboard.press('Delete');
  await expect(page.locator('.pdf-calque [data-type="caviar"]')).toHaveCount(0);
  const { octets } = await exporter(page);
  expect((await relire(page, octets)).pages[0].texte).toBe('Monsieur Jean DUPONT demeure ici.');
  await expect(page.locator('#pdf-etat')).toContainText('« Jean Dupont » reste lisible en clair, page 1.');
  // Ctrl+Z : la suppression, puis tout le lot de zones
  await page.keyboard.press('Control+z');
  await expect(page.locator('.pdf-calque [data-type="caviar"]')).toHaveCount(1);
  await page.keyboard.press('Control+z');
  expect(await page.evaluate(() => document.querySelectorAll('.pdf-calque [data-type="caviar"]').length)).toBe(0);
});

test('page tournée (source à 90° puis pivotée) : rotation gardée, zone au bon endroit ; aucune occurrence sur un scan', async ({ page }) => {
  await page.evaluate(async () => {
    await MPDS.chargerScript(MPDS.pdfExport.URL_LIB);
    const { PDFDocument, StandardFonts, degrees } = PDFLib, d = await PDFDocument.create(), f = await d.embedFont(StandardFonts.Helvetica);
    const p = d.addPage([595, 842]); p.drawText('Haut gauche', { x: 40, y: 780, size: 20, font: f }); p.setRotation(degrees(90));
    await MPDS.envoyer(new File([await d.save()], 'tourne.pdf'), 'pdf');
  });
  await expect(page.locator('.pdf-mini')).toHaveCount(1);
  await bouton(page, 'Pivoter à droite').click();   // 90 + 90 = 180 à l'affichage
  await cent(page);
  // À 180°, le coin haut-gauche de la page apparaît en bas à droite : zone de 100 × 60 points en bas à droite
  await bouton(page, 'Caviarder (R)').click();
  await tracer(page, 595 - 120, 842 - 80, 595 - 20, 842 - 20);
  const { octets } = await exporter(page);
  const r = await relire(page, octets);
  expect(r.pages[0].rotation).toBe(180);
  expect(r.pages[0].texte).toBe('');
  const [dedans, dehors] = await pixels(page, octets, 1, [[595 - 70, 842 - 50], [100, 100]]);
  expect(noir(dedans)).toBe(true);
  expect(blanc(dehors)).toBe(true);
  // Recherche sur un document sans texte : jamais « document propre »
  await page.evaluate(async () => MPDS.envoyer(await Fab.pdfScanne('scan.pdf', [['Jean Dupont']]), 'pdf'));
  await expect(page.locator('#pdf-nom')).toHaveText('scan.pdf');
  await page.getByRole('button', { name: 'Rechercher et caviarder' }).click();
  await page.getByLabel('Mot ou expression à caviarder').fill('Dupont');
  await page.keyboard.press('Enter');
  await expect(page.locator('#pdf-cav-resultat')).toHaveText('Aucune occurrence de « Dupont » dans le texte du document. Attention, page 1 sans texte (image ou scan) : la recherche n\'y voit rien, caviardez à la main.');
  await expect(page.getByRole('button', { name: /^Caviarder l/ })).toBeHidden();
});

test('grande page : résolution réduite et signalée, page sans texte', async ({ page }) => {
  await page.evaluate(async () => {
    await MPDS.chargerScript(MPDS.pdfExport.URL_LIB);
    const { PDFDocument, StandardFonts } = PDFLib, d = await PDFDocument.create(), f = await d.embedFont(StandardFonts.Helvetica);
    d.addPage([5000, 5000]).drawText('Plan', { x: 100, y: 4800, size: 100, font: f });
    await MPDS.envoyer(new File([await d.save()], 'plan.pdf'), 'pdf');
  });
  await expect(page.locator('.pdf-mini')).toHaveCount(1);
  await pret(page);
  // Zone posée directement dans le modèle (la page entière ne tient pas à l'écran à 100 %)
  await page.evaluate(() => document.querySelector('#pdf-outil-caviar').click());
  const b = await page.locator('.pdf-calque').boundingBox();
  await page.mouse.move(b.x + 5, b.y + 5); await page.mouse.down(); await page.mouse.move(b.x + 60, b.y + 40, { steps: 4 }); await page.mouse.up();
  const { octets } = await exporter(page);
  expect((await relire(page, octets)).pages[0].texte).toBe('');
  await expect(page.locator('#pdf-etat')).toContainText('Page 1 : grande page, caviardée à 91 ppp au lieu de 200.');
});
