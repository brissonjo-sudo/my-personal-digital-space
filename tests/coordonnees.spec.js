// Écriture de PDF : bibliothèque (@cantoo/pdf-lib) chargée à la demande et vérifiée par SRI,
// PDF chiffré « propriétaire seulement » (Cerfa), conversion de coordonnées (rotation, CropBox
// décalée) et encodage WinAnsi du texte dessiné.
'use strict';

const { test, expect, ouvrirApp } = require('./aide');
const { pdfChiffre, MODES } = require('./pdf-chiffre');

test.beforeEach(async ({ page }) => { await ouvrirApp(page); });
const charger = page => page.evaluate(() => MPDS.chargerScript(MPDS.pdfExport.URL_LIB));

test('chargement à la demande : absent au départ, vérifié, mémoïsé, sans violation de la CSP', async ({ page }) => {
  expect(await page.evaluate(() => typeof PDFLib)).toBe('undefined');
  expect(await page.evaluate(() => !!document.querySelector('script[src*="pdf-lib"]'))).toBe(false);   // pas dans le <head>
  await charger(page);
  expect(await page.evaluate(() => typeof PDFLib.PDFDocument)).toBe('function');
  expect(await page.evaluate(() => MPDS.chargerScript(MPDS.pdfExport.URL_LIB) === MPDS.chargerScript(MPDS.pdfExport.URL_LIB))).toBe(true);
  expect(await page.evaluate(() => window.__violationsCsp)).toEqual([]);   // blob: autorisé par la CSP actuelle
});

test('chargerScript refuse un fichier altéré ou sans empreinte, puis réessaie', async ({ page }) => {
  page.securiteAttendue = true;   // l'échec de vérification SRI est le comportement testé
  await page.route('**/__npm__/@cantoo/**', route => route.fulfill({ body: 'window.PIRATE = 1;', contentType: 'text/javascript', headers: { 'Access-Control-Allow-Origin': '*' } }));
  const echec = await page.evaluate(() => MPDS.chargerScript(MPDS.pdfExport.URL_LIB).then(() => 'chargé', e => e.message));
  expect(echec).toMatch(/integrity|network|failed/i);
  expect(await page.evaluate(() => window.PIRATE)).toBeUndefined();
  expect(await page.evaluate(() => MPDS.chargerScript('https://cdn.jsdelivr.net/npm/inconnu@1.0.0/x.js').then(() => 'chargé', e => e.message))).toContain('aucune empreinte');
  await page.unroute('**/__npm__/@cantoo/**');
  await charger(page);   // l'échec n'a pas été mémorisé
  expect(await page.evaluate(() => typeof PDFLib.PDFDocument)).toBe('function');
});

// ---- Critère 1 : PDF chiffré avec mot de passe propriétaire seulement ----
for (const mode of Object.keys(MODES)) {
  test(`PDF chiffré (${mode}, mot de passe utilisateur vide) : ouvrir, pivoter, enregistrer, relire`, async ({ page }) => {
    await charger(page);
    const r = await page.evaluate(async octets => {
      const { PDFDocument, degrees } = PDFLib;
      const lecteur = async b => {
        const d = await (await MPDS.pdfjs.ouvrir(b)).promise, o = [];
        for (let i = 1; i <= d.numPages; i++) {
          const p = await d.getPage(i);
          o.push({ texte: (await p.getTextContent()).items.map(x => x.str).join(''), rotation: p.rotate });
        }
        return o;
      };
      const source = new Uint8Array(octets);
      const avant = await lecteur(source.slice().buffer);
      const doc = await PDFDocument.load(source, { password: '', updateMetadata: false });
      doc.getPage(0).setRotation(degrees(90));
      return { avant, apres: await lecteur((await doc.save()).buffer) };
    }, [...pdfChiffre(['Alpha chiffre', 'Beta'], mode)]);
    expect(r.avant.map(p => p.texte)).toEqual(['Alpha chiffre', 'Beta']);   // la fixture est valide pour PDF.js
    expect(r.apres).toEqual([{ texte: 'Alpha chiffre', rotation: 90 }, { texte: 'Beta', rotation: 0 }]);
  });
}

// ---- Critère 2 : coordonnées ----
test('versPdf : un carré dessiné au point cliqué est rendu à cet endroit (4 rotations, CropBox décalée)', async ({ page }) => {
  await charger(page);
  const resultats = await page.evaluate(async () => {
    const { PDFDocument, degrees, rgb } = PDFLib;
    const rendu = async octets => {   // centre de gravité des pixels sombres, repère du viewport à l'échelle 1
      const doc = await (await MPDS.pdfjs.ouvrir(octets)).promise, p = await doc.getPage(1);
      const vue = p.getViewport({ scale: 1 });
      const cv = Object.assign(document.createElement('canvas'), { width: Math.round(vue.width), height: Math.round(vue.height) });
      await p.render({ canvasContext: cv.getContext('2d'), viewport: vue }).promise;
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      let n = 0, sx = 0, sy = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] < 100) { n++; sx += (i / 4) % cv.width; sy += Math.floor(i / 4 / cv.width); }
      return { n, x: sx / n + 0.5, y: sy / n + 0.5, largeur: cv.width, hauteur: cv.height };
    };
    const sortie = [];
    for (const rotate of [0, 90, 180, 270]) for (const pivot of [0, 90]) {   // /Rotate de la page, puis pivotement de l'utilisateur
      const doc = await PDFDocument.create();
      const pg = doc.addPage([595, 842]);
      pg.setCropBox(50, 100, 400, 600);        // CropBox décalée : x 50–450, y 100–700
      pg.setRotation(degrees(rotate));
      const octets0 = await doc.save();
      const pdfjsPage = await (await (await MPDS.pdfjs.ouvrir(octets0.slice())).promise).getPage(1);
      const clic = { x: 120, y: 80 };
      const pt = MPDS.pdfCoord.versPdf(MPDS.pdfCoord.infoPage(pdfjsPage, pivot), clic.x, clic.y);
      // chemin réel de l'application : copie + pivotement, puis dessin sur le résultat
      const copie = await PDFDocument.load(await MPDS.pdfExport.construire([{ source: { nom: 't.pdf', octets: octets0.slice().buffer }, index: 0, rotation: pivot }]));
      copie.getPage(0).drawRectangle({ x: pt.x - 3, y: pt.y - 3, width: 6, height: 6, color: rgb(0, 0, 0) });
      sortie.push({ rotate, pivot, clic, ...(await rendu((await copie.save()).buffer)) });
    }
    return sortie;
  });
  expect(resultats).toHaveLength(8);
  for (const r of resultats) {
    expect(r.n, `pixels sombres (${r.rotate}/${r.pivot})`).toBeGreaterThan(20);
    expect(Math.abs(r.x - r.clic.x), `x pour /Rotate ${r.rotate} + ${r.pivot}`).toBeLessThanOrEqual(2);
    expect(Math.abs(r.y - r.clic.y), `y pour /Rotate ${r.rotate} + ${r.pivot}`).toBeLessThanOrEqual(2);
  }
  expect(resultats.find(r => r.rotate === 0 && r.pivot === 0)).toMatchObject({ largeur: 400, hauteur: 600 });
  expect(resultats.find(r => r.rotate === 90 && r.pivot === 0)).toMatchObject({ largeur: 600, hauteur: 400 });
});

test('versPdf : fonction pure, valeurs exactes et rotation invalide', async ({ page }) => {
  const r = await page.evaluate(() => {
    const v = [50, 100, 450, 700], f = (rotation, x, y) => MPDS.pdfCoord.versPdf({ view: v, rotation }, x, y);
    let erreur = '';
    try { f(45, 0, 0); } catch (e) { erreur = e.message; }
    return [f(0, 0, 0), f(0, 10, 20), f(90, 10, 20), f(180, 10, 20), f(270, 10, 20), f(-90, 10, 20), f(360, 10, 20), erreur];
  });
  expect(r).toEqual([{ x: 50, y: 700 }, { x: 60, y: 680 }, { x: 70, y: 110 }, { x: 440, y: 120 }, { x: 430, y: 690 }, { x: 430, y: 690 }, { x: 60, y: 680 }, expect.stringContaining('45')]);
});

// ---- Critère 3 : encodage ----
test('encodage : accents français passent (et se relisent), hors WinAnsi signalé clairement', async ({ page }) => {
  await charger(page);
  const r = await page.evaluate(async () => {
    const { PDFDocument, StandardFonts } = PDFLib, T = MPDS.pdfTexte;
    const ok = T.verifier('é è à ç œ « » € – ’');
    const doc = await PDFDocument.create(), pg = doc.addPage([300, 100]), police = await doc.embedFont(StandardFonts.Helvetica);
    pg.drawText(ok, { x: 10, y: 50, size: 14, font: police });
    const pdfDoc = await (await MPDS.pdfjs.ouvrir((await doc.save()).buffer)).promise;
    const relu = (await (await pdfDoc.getPage(1)).getTextContent()).items.map(x => x.str).join('');
    const essai = t => { try { T.verifier(t); return 'accepté'; } catch (e) { return e.message; } };
    // Sans le contrôle, le fork remplace en silence un caractère hors WinAnsi par « ? » (pdf-lib 1.17.1 lève une erreur)
    const d2 = await PDFDocument.create();
    d2.addPage([200, 50]).drawText('a→b', { x: 5, y: 20, font: await d2.embedFont(StandardFonts.Helvetica) });
    const natif = (await (await (await MPDS.pdfjs.ouvrir((await d2.save()).buffer)).promise).getPage(1).then(p => p.getTextContent())).items.map(x => x.str).join('');
    return {
      relu, fleche: essai('Aller →'), emoji: essai('Bravo 😀'), deux: essai('→ et ★'), natif,
      compose: essai('é'), espaceFine: T.verifier('« Oui »'), tab: essai('a\tb\nc'),
      filtre: T.filtrer('a→b😀é'), vide: essai(''),
    };
  });
  expect(r.relu).toBe('é è à ç œ « » € – ’');
  expect(r.fleche).toContain('Caractère non pris en charge : → (U+2192)');
  expect(r.emoji).toContain('😀 (U+1F600)');
  expect(r.deux).toMatch(/^Caractères non pris en charge : → \(U\+2192\), ★ \(U\+2605\)/);
  expect(r.natif).toBe('a?b');   // d'où l'utilité de verifier() avant dessin
  expect([r.compose, r.tab, r.vide]).toEqual(['accepté', 'accepté', 'accepté']);   // é décomposé normalisé ; tabulation, saut de ligne
  expect(r.espaceFine).toBe('« Oui »');
  expect(r.filtre).toEqual({ texte: 'abé', retires: ['→', '😀'] });
});
