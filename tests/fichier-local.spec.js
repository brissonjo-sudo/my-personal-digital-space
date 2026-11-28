// L'application ouverte directement depuis le disque (file://), sans serveur : usage
// documenté dans le README. Origine « nulle », pas de service worker : la CSP,
// les workers blob: et la vérification d'intégrité doivent tout de même fonctionner.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, expect } = require('./aide');
const { fichierLocal, empreintesLocales, URL_CDN } = require('./serveur');

test('conversions fonctionnelles en file://, sous CSP et SRI', async ({ page }) => {
  // Copie de l'application entière (index.html, commun/, modules/…) avec les empreintes
  // des copies locales (les URLs restent celles des CDN, interceptées ci-dessous et
  // servies depuis node_modules)
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'mpds-'));
  const racine = path.join(__dirname, '..');
  for (const f of ['index.html', 'manifest.webmanifest', 'icone.svg', 'commun', 'modules']) {
    fs.cpSync(path.join(racine, f), path.join(dossier, f), { recursive: true });
  }
  const fichiersTexte = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? fichiersTexte(path.join(d, e.name)) : /\.(html|js)$/.test(e.name) ? [path.join(d, e.name)] : []);
  for (const f of fichiersTexte(dossier)) fs.writeFileSync(f, empreintesLocales(fs.readFileSync(f, 'utf8')));
  const fichier = path.join(dossier, 'index.html');

  await page.route(url => URL_CDN.test(url.href), route => {
    const local = fichierLocal(route.request().url());
    if (!local || !fs.existsSync(local)) return route.abort();
    route.fulfill({ path: local, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'text/javascript' } });
  });
  await page.goto('file://' + fichier);
  await page.waitForFunction(() => window.mammoth && window.TurndownService && window.pdfjsLib && window.XLSX && window.Papa && window.JSZip
    && document.getElementById('zone-depot'));

  const r = await page.evaluate(async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Nom'], ['Alice']]), 'F');
    await traiterFichiers([
      Fab.texte('a.csv', 'x,y\n1,2\n'),
      await Fab.classeur('b.xlsx', wb),
      Fab.pdf('c.pdf', [[{ t: 'Arrêté municipal du maire', x: 72, y: 700 }]]),
      await Fab.docx('d.docx', Fab.docxPara('Titre', 'Heading1')),
      Fab.texte('e.html', '<h2>Page</h2><p>Texte</p>'),
    ]);
    return __resume();
  });
  expect(r.journal.map(j => `${j.nom}:${j.statut}`)).toEqual(['a.csv:ok', 'b.xlsx:ok', 'c.pdf:ok', 'd.docx:ok', 'e.html:ok']);
  expect(r.resultats.find(x => x.nom === 'c.pdf').md).toContain('Arrêté municipal du maire');
  expect(r.stats).toEqual({ converties: 2, replis: 0 });   // worker blob construit depuis codePartage() aussi en file://
  // Visionneuse PDF : worker PDF.js vérifié (SRI) et rendu, aussi en file://
  await page.evaluate(() => MPDS.envoyer(Fab.pdf('v.pdf', [[{ t: 'Un', x: 72, y: 700, taille: 40 }], [{ t: 'Deux', x: 72, y: 700, taille: 40 }]]), 'pdf'));
  await expect(page.locator('#pdf-canvas')).toBeVisible();
  await expect(page.locator('#pdf-nb')).toHaveText('2 pages');
  await expect(page.locator('.pdf-mini')).toHaveCount(2);
  // Annotation : surligneur tracé sur le calque, aplati à l'export
  await page.keyboard.press('h');
  const calque = await page.locator('.pdf-calque').boundingBox();
  await page.mouse.move(calque.x + 100, calque.y + 120);
  await page.mouse.down();
  await page.mouse.move(calque.x + 250, calque.y + 180, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('.pdf-calque [data-type="surlig"]')).toHaveCount(1);
  // Export : bibliothèque d'écriture chargée à la demande (fetch vérifié + <script src=blob:>) aussi en file://
  const [telechargement] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Pivoter à droite', exact: true }).click()
    .then(() => page.getByRole('button', { name: 'Enregistrer le PDF', exact: true }).click())]);
  expect(telechargement.suggestedFilename()).toBe('v (modifié).pdf');
  expect(fs.readFileSync(await telechargement.path()).subarray(0, 5).toString()).toBe('%PDF-');
  // Caviardage : rendu PDF.js en image (toBlob) puis relecture du fichier produit, aussi en file://
  await page.keyboard.press('r');
  const cv = await page.locator('.pdf-calque').boundingBox();
  await page.mouse.move(cv.x + 20, cv.y + 20); await page.mouse.down(); await page.mouse.move(cv.x + 200, cv.y + 120, { steps: 5 }); await page.mouse.up();
  await expect(page.locator('.pdf-calque [data-type="caviar"]')).toHaveCount(1);
  const [caviarde] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Enregistrer le PDF', exact: true }).click()]);
  expect(caviarde.suggestedFilename()).toBe('v (caviardé).pdf');
  const texteP1 = await page.evaluate(async o => {
    const d = await (await MPDS.pdfjs.ouvrir(new Uint8Array(o).buffer)).promise;
    return (await (await d.getPage(1)).getTextContent()).items.length;
  }, [...fs.readFileSync(await caviarde.path())]);
  expect(texteP1).toBe(0);
  // Module Images : retrait sans perte, vignette blob: et téléchargement, aussi en file://
  await page.locator('.rail-lien[data-module="images"]').click();
  await page.evaluate(async () => MPDS.envoyer(await Fab.jpegAvecMeta('photo.jpg'), 'images'));
  await page.getByRole('button', { name: 'Traiter les images' }).click();
  await expect(page.locator('.img-retires')).toContainText('Retiré : EXIF (dont la position GPS)');
  const [image] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /^Télécharger « photo/ }).click()]);
  expect(image.suggestedFilename()).toBe('photo (sans métadonnées).jpg');
  expect(fs.readFileSync(await image.path()).includes('Ville-Secrete')).toBe(false);
  expect(await page.evaluate(() => navigator.serviceWorker.controller)).toBeNull();
  fs.rmSync(dossier, { recursive: true, force: true });
});
