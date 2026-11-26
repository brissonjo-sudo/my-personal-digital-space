// Module PDF — signature (dessinée ou importée, fond retiré) et tampons. Les gestes sont joués à la
// souris ; les exports sont interceptés puis relus avec PDF.js (pixels, texte, opérateurs d'image) :
// ce qui est vérifié est ce qui est écrit dans le fichier. Coordonnées des helpers : viewport à
// l'échelle 1 (points, origine en haut à gauche, A4 595 × 842), page affichée à 100 %.
'use strict';

const fs = require('fs');
const { test, expect, ouvrirApp } = require('./aide');

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1300, height: 1300 });
  await ouvrirApp(page);
});

const bouton = (page, nom) => page.getByRole('button', { name: nom, exact: true });
const annots = (page, type) => page.locator(`.pdf-calque [data-type="${type}"]`);
const pret = page => page.waitForFunction(() => {
  const s = document.querySelector('.pdf-calque'), z = parseFloat(document.getElementById('pdf-zoom').textContent) / 100;
  return s && Math.abs(s.getBoundingClientRect().width - s.viewBox.baseVal.width * z) < 3;
});
async function ouvrir(page, n = 1) {
  await page.evaluate(n => MPDS.envoyer(Fab.pdf('a.pdf', Array.from({ length: n }, (_, i) =>
    [{ t: 'Page ' + (i + 1), x: 72, y: 760, taille: 30, gras: true }])), 'pdf'), n);
  await expect(page.locator('.pdf-mini')).toHaveCount(n);
  await installer(page);
  await pret(page);
  while (parseInt(await page.locator('#pdf-zoom').textContent(), 10) > 100) { await bouton(page, 'Zoom arrière').click(); await pret(page); }
}
const ecran = (page, x, y) => page.evaluate(([x, y]) => {
  const s = document.querySelector('.pdf-calque'), b = s.getBoundingClientRect(), v = s.viewBox.baseVal;
  return { x: b.left + x * b.width / v.width, y: b.top + y * b.height / v.height };
}, [x, y]);
async function cliquer(page, x, y) { const p = await ecran(page, x, y); await page.mouse.click(p.x, p.y); }
async function exporter(page) {
  const [dl] = await Promise.all([page.waitForEvent('download'), bouton(page, 'Enregistrer le PDF').click()]);
  return fs.readFileSync(await dl.path());
}
// Rendu PDF.js (échelle 1) de la page n d'un PDF exporté ; fonctions fournies par la page (la CSP interdit eval)
const installer = page => page.evaluate(() => {
  window.__rendu = async (o, n) => {
    const d = await (await MPDS.pdfjs.ouvrir(new Uint8Array(o).buffer)).promise, p = await d.getPage(n), vue = p.getViewport({ scale: 1 });
    const cv = Object.assign(document.createElement('canvas'), { width: Math.round(vue.width), height: Math.round(vue.height) });
    const g = cv.getContext('2d');
    await p.render({ canvasContext: g, viewport: vue }).promise;
    return { g, p, vue };
  };
});
// Plus sombre pixel (somme r+v+b) dans le carré de rayon r autour de chaque point
const sombres = (page, o, pts, r = 2, n = 1) => page.evaluate(async ({ o, n, pts, r }) => {
  const { g } = await window.__rendu(o, n);
  return pts.map(([x, y]) => { let m = 765; for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
    const v = g.getImageData(Math.round(x) + dx, Math.round(y) + dy, 1, 1).data; m = Math.min(m, v[0] + v[1] + v[2]); } return m; });
}, { o: [...o], n, pts, r });
// Nombre de pixels bleus (b), rouges (r) ou verts (v) francs
const couleurs = (page, o) => page.evaluate(async o => {
  const { g, vue } = await window.__rendu(o, 1), d = g.getImageData(0, 0, vue.width, vue.height).data, n = { b: 0, r: 0, v: 0 };
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 2] > 170 && d[i] < 90) n.b++;
    else if (d[i] > 180 && d[i + 1] < 90 && d[i + 2] < 90) n.r++;
    else if (d[i + 1] > 100 && d[i] < 60 && d[i + 2] < 100) n.v++;
  }
  return n;
}, [...o]);
// Images de la page : position et taille (points PDF) de chaque image peinte, matrices composées
const images = (page, o) => page.evaluate(async o => {
  const d = await (await MPDS.pdfjs.ouvrir(new Uint8Array(o).buffer)).promise, p = await d.getPage(1);
  const L = await p.getOperatorList(), O = pdfjsLib.OPS, mul = (m, n) => [m[0]*n[0]+m[1]*n[2], m[0]*n[1]+m[1]*n[3], m[2]*n[0]+m[3]*n[2], m[2]*n[1]+m[3]*n[3], m[4]*n[0]+m[5]*n[2]+n[4], m[4]*n[1]+m[5]*n[3]+n[5]];
  let c = [1, 0, 0, 1, 0, 0]; const pile = [], sortie = [];
  L.fnArray.forEach((f, i) => {
    if (f === O.save) pile.push(c); else if (f === O.restore) c = pile.pop() || c;
    else if (f === O.transform) c = mul(L.argsArray[i], c);
    else if (f === O.paintImageXObject || f === O.paintImageMaskXObject) sortie.push({ w: Math.hypot(c[0], c[1]), h: Math.hypot(c[2], c[3]), x: c[4], y: c[5] });
  });
  return sortie;
}, [...o]);
const textes = (page, o, n = 1) => page.evaluate(async ({ o, n }) => {
  const d = await (await MPDS.pdfjs.ouvrir(new Uint8Array(o).buffer)).promise, p = await d.getPage(n), vue = p.getViewport({ scale: 1 });
  return (await p.getTextContent()).items.filter(i => i.str.trim()).map(i => { const t = pdfjsLib.Util.transform(vue.transform, i.transform); return { str: i.str, a: t[0], b: t[1], x: t[4], y: t[5] }; });
}, { o: [...o], n });
const rotations = (page, o) => page.evaluate(async o => {
  const d = await (await MPDS.pdfjs.ouvrir(new Uint8Array(o).buffer)).promise, r = [];
  for (let i = 1; i <= d.numPages; i++) r.push((await d.getPage(i)).rotate);
  return r;
}, [...o]);

// ---- Fenêtre de signature ----
const dialogue = page => page.getByRole('dialog');
const ouvrirModale = async page => { await bouton(page, 'Signature (S)').click(); await expect(dialogue(page)).toBeVisible(); };
// Trace dans le canvas de la fenêtre : points en fractions (0–1) de sa taille
async function tracer(page, pts) {
  const b = await page.locator('.pdf-sig-canvas').boundingBox();
  const e = pts.map(([x, y]) => [b.x + x * b.width, b.y + y * b.height]);
  await page.mouse.move(...e[0]); await page.mouse.down();
  for (const p of e.slice(1)) await page.mouse.move(...p, { steps: 8 });
  await page.mouse.up();
}
const Z = [[0.15, 0.2], [0.85, 0.2], [0.15, 0.8], [0.85, 0.8]];
async function signerEtPoser(page, x = 300, y = 400) {
  await ouvrirModale(page);
  await tracer(page, Z);
  await bouton(page, 'Valider').click();
  await expect(dialogue(page)).toHaveCount(0);
  await expect(bouton(page, 'Signature (S)')).toHaveAttribute('aria-pressed', 'true');
  await cliquer(page, x, y);
}
// PNG ou JPEG généré dans la page : fond gris papier, trait noir ; renvoie les octets
const image = (page, type, fond) => page.evaluate(async ([type, fond]) => {
  const cv = Object.assign(document.createElement('canvas'), { width: 300, height: 120 }), g = cv.getContext('2d');
  g.fillStyle = fond; g.fillRect(0, 0, 300, 120);
  g.strokeStyle = '#000'; g.lineWidth = 6; g.beginPath(); g.moveTo(60, 60); g.lineTo(240, 60); g.stroke();
  const b = await new Promise(r => cv.toBlob(r, type));
  return Array.from(new Uint8Array(await b.arrayBuffer()));
}, [type, fond]);
const fichier = (nom, buffer, mimeType = 'image/png') => ({ name: nom, mimeType, buffer });

test('signature dessinée : posée au clic, image dans le PDF exporté, pixels sombres au bon endroit', async ({ page }) => {
  await ouvrir(page);
  await signerEtPoser(page);
  await expect(annots(page, 'signature')).toHaveCount(1);
  await expect(page.locator('#pdf-modif')).toHaveText('● Modifications non enregistrées');
  const o = await exporter(page);
  const im = await images(page, o);
  expect(im).toHaveLength(1);
  expect(im[0].w).toBeCloseTo(150, 0);                      // largeur de pose par défaut
  expect(im[0].h / im[0].w).toBeCloseTo(0.31, 1);          // proportions du « Z » : 0,7 × 0,6 du canvas (640 × 220), marges comprises
  // Centrée sur le clic (300, 400) : x PDF 225–375, y PDF = 842 − 400 ± h/2 ; trait du haut du « Z » et diagonale
  const hautY = 842 - im[0].y - im[0].h;                    // haut de l'image à l'écran
  const [haut, centre, loin] = await sombres(page, o, [[300, hautY + 2], [300, 400], [300, 300]], 3);
  expect(haut).toBeLessThan(200);
  expect(centre).toBeLessThan(200);
  expect(loin).toBeGreaterThan(740);
  expect(Math.abs(im[0].x + im[0].w / 2 - 300)).toBeLessThan(2);
});

test('import : fond gris retiré par seuil, tolérance en direct, trait conservé, image rognée', async ({ page }) => {
  await ouvrir(page);
  await ouvrirModale(page);
  await page.getByRole('tab', { name: 'Importer une image' }).click();
  await page.locator('#pdf-sig-fichier').setInputFiles(fichier('s.png', Buffer.from(await image(page, 'image/png', '#e0e0e0'))));
  await page.waitForFunction(() => document.getElementById('pdf-sig-apercu').width === 300);
  const alpha = (x, y) => page.evaluate(([x, y]) => document.getElementById('pdf-sig-apercu').getContext('2d').getImageData(x, y, 1, 1).data[3], [x, y]);
  expect(await alpha(5, 5)).toBe(0);                         // fond gris papier : transparent
  expect(await alpha(150, 60)).toBe(255);                    // trait : conservé
  await page.locator('#pdf-sig-tolerance').fill('0');        // aperçu en direct : seuil plus sévère, le fond reparaît
  expect(await alpha(5, 5)).toBeGreaterThan(100);
  await page.locator('#pdf-sig-tolerance').fill('40');
  expect(await alpha(5, 5)).toBe(0);
  await bouton(page, 'Valider').click();
  const png = await page.evaluate(async () => {
    const s = MPDS.pdfSignature.courante(), i = new Image(); i.src = s.url; await i.decode();
    const cv = Object.assign(document.createElement('canvas'), { width: i.width, height: i.height }), g = cv.getContext('2d');
    g.drawImage(i, 0, 0);
    return { url: s.url.slice(0, 22), w: i.width, h: i.height, coin: g.getImageData(0, 0, 1, 1).data[3], milieu: g.getImageData(i.width >> 1, i.height >> 1, 1, 1).data[3] };
  });
  expect(png.url).toBe('data:image/png;base64,');
  expect(png.w).toBeLessThan(200);                           // 300 × 120 d'origine : rogné au trait (180 + marges)
  expect(png.h).toBeLessThan(20);
  expect(png.coin).toBeLessThan(80);
  expect(png.milieu).toBe(255);
  // JPEG accepté lui aussi
  await ouvrirModale(page);
  await page.getByRole('tab', { name: 'Importer une image' }).click();
  await page.locator('#pdf-sig-fichier').setInputFiles(fichier('s.jpg', Buffer.from(await image(page, 'image/jpeg', '#e8e8e8')), 'image/jpeg'));
  await page.waitForFunction(() => document.getElementById('pdf-sig-apercu').width === 300);
  await bouton(page, 'Valider').click();
  await expect(dialogue(page)).toHaveCount(0);
});

test('import : faux PNG (octets) et fichier trop gros refusés avec un message', async ({ page }) => {
  await ouvrir(page);
  await ouvrirModale(page);
  await page.getByRole('tab', { name: 'Importer une image' }).click();
  const msg = dialogue(page).getByRole('alert');
  await page.locator('#pdf-sig-fichier').setInputFiles(fichier('faux.png', Buffer.from('Ceci n\'est pas une image, malgré l\'extension .png')));
  await expect(msg).toContainText('PNG ou JPEG');
  await page.locator('#pdf-sig-fichier').setInputFiles(fichier('gros.png', Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.alloc(11 * 1024 * 1024)])));
  await expect(msg).toContainText('trop volumineux');
  await bouton(page, 'Valider').click();
  await expect(msg).toContainText('Choisissez');
  await expect(dialogue(page)).toBeVisible();
});

test('fenêtre accessible : focus piégé, Échap ferme et rend le focus, raccourcis inactifs', async ({ page }) => {
  await ouvrir(page);
  await expect(bouton(page, 'Signature (S)')).toHaveAttribute('title', 'Signature (S)');
  await expect(bouton(page, 'Tampon (P)')).toHaveAttribute('title', 'Tampon (P)');
  await page.keyboard.press('s');                            // raccourci : ouvre la fenêtre
  await expect(dialogue(page)).toBeVisible();
  await expect(dialogue(page)).toHaveAttribute('aria-modal', 'true');
  for (const t of ['h', 'p', 'e']) await page.keyboard.press(t);
  await page.keyboard.press('ArrowRight');                   // ne change pas de page ; passe à l'onglet suivant
  await expect(bouton(page, 'Sélection (V)')).toHaveAttribute('aria-pressed', 'true');
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement.closest('.pdf-modale')), 'le focus reste dans la fenêtre').toBe(true);
  }
  await page.keyboard.press('Shift+Tab');
  expect(await page.evaluate(() => !!document.activeElement.closest('.pdf-modale'))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialogue(page)).toHaveCount(0);
  await ouvrirModale(page);                                  // ouverte au bouton : Échap lui rend le focus
  await page.keyboard.press('Escape');
  await expect(dialogue(page)).toHaveCount(0);
  await expect(bouton(page, 'Signature (S)')).toBeFocused();
  await expect(bouton(page, 'Sélection (V)')).toHaveAttribute('aria-pressed', 'true');   // rien n'a été activé
  await page.locator('#pdf-num').focus();                    // champ de saisie : raccourci inactif
  await page.keyboard.press('s');
  await expect(dialogue(page)).toHaveCount(0);
  await page.evaluate(() => { location.hash = '#/convertir'; });
  await page.waitForFunction(() => MPDS.actif() === 'convertir');
  await page.keyboard.press('s'); await page.keyboard.press('p');
  await expect(dialogue(page)).toHaveCount(0);
});

test('signature : déplacement, redimensionnement (proportions), annulation, gomme', async ({ page }) => {
  await ouvrir(page);
  await signerEtPoser(page);
  const base = (await images(page, await exporter(page)))[0];
  await bouton(page, 'Sélection (V)').click();
  await cliquer(page, 300, 400);
  await expect(page.locator('.pdf-poignee')).toHaveCount(1);
  // Poignée du coin haut-droit tirée à deux fois sa distance au coin bas-gauche fixe
  const hb = await page.locator('.pdf-poignee').boundingBox(), c = { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 };
  const coin = await ecran(page, base.x, 842 - base.y);                 // coin bas-gauche, à l'écran
  await page.mouse.move(c.x, c.y); await page.mouse.down();
  await page.mouse.move(coin.x + 2 * (c.x - coin.x), coin.y + 2 * (c.y - coin.y), { steps: 8 });
  await page.mouse.up();
  const grand = (await images(page, await exporter(page)))[0];
  expect(grand.w).toBeCloseTo(2 * base.w, 0);
  expect(grand.h).toBeCloseTo(2 * base.h, 0);
  expect(grand.w / grand.h).toBeCloseTo(base.w / base.h, 2);
  expect(grand.x).toBeCloseTo(base.x, 0);                               // coin fixe
  expect(grand.y).toBeCloseTo(base.y, 0);
  // Annuler : taille d'origine ; rétablir : agrandie
  await page.keyboard.press('Control+z');
  expect((await images(page, await exporter(page)))[0].w).toBeCloseTo(base.w, 0);
  await page.keyboard.press('Control+y');
  expect((await images(page, await exporter(page)))[0].w).toBeCloseTo(2 * base.w, 0);
  // Déplacement : glisser le corps de la signature
  const a = await ecran(page, 330, 380), b = await ecran(page, 380, 430);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 5 }); await page.mouse.up();
  const dep = (await images(page, await exporter(page)))[0];
  expect(dep.x - grand.x).toBeCloseTo(50, 0);
  expect(dep.y - grand.y).toBeCloseTo(-50, 0);
  // Gomme
  await bouton(page, 'Gomme (E)').click();
  await cliquer(page, 380, 430);
  await expect(annots(page, 'signature')).toHaveCount(0);
  expect(await images(page, await exporter(page))).toHaveLength(0);
});

test('signature réutilisable pendant la session, absente après rechargement, rien de stocké', async ({ page }) => {
  await ouvrir(page);
  await signerEtPoser(page, 200, 200);
  await ouvrirModale(page);
  await dialogue(page).getByRole('button', { name: 'Réutiliser cette signature' }).click();
  await cliquer(page, 400, 600);
  await expect(annots(page, 'signature')).toHaveCount(2);
  const im = await images(page, await exporter(page));
  expect(im).toHaveLength(2);
  expect(im[0].w).toBeCloseTo(im[1].w, 0);
  const stocke = await page.evaluate(async () => JSON.stringify([{ ...localStorage }, { ...sessionStorage }, (await indexedDB.databases()).map(d => d.name)]));
  expect(stocke).not.toContain('data:image');
  expect(stocke).toBe('[{},{},[]]');
  await ouvrirApp(page);                                     // rechargement
  await ouvrir(page);
  await ouvrirModale(page);
  await expect(dialogue(page).getByRole('button', { name: 'Réutiliser cette signature' })).toHaveCount(0);
  expect(await page.evaluate(() => MPDS.pdfSignature.courante())).toBeNull();
});

test('signature sur page pivotée : posée droite, exportée au même endroit', async ({ page }) => {
  await ouvrir(page);
  await bouton(page, 'Pivoter à droite').click();
  await page.waitForFunction(() => document.querySelector('.pdf-calque').viewBox.baseVal.width > 800);
  await pret(page);
  await signerEtPoser(page, 400, 300);
  const droit = await page.evaluate(() => { const b = document.querySelector('.pdf-calque image').getBoundingClientRect(); return b.width > b.height; });
  expect(droit, 'signature horizontale à l\'écran').toBe(true);
  const o = await exporter(page);
  expect(await rotations(page, o)).toEqual([90]);
  const im = (await images(page, o))[0];
  expect(im.w).toBeCloseTo(150, 0);
  // Rendu PDF.js de la page pivotée (595 × 842 → 842 × 595) : trait sombre à l'endroit cliqué (écran 400, 300)
  const [centre, loin] = await sombres(page, o, [[400, 300], [100, 100]], 3);
  expect(centre).toBeLessThan(200);
  expect(loin).toBeGreaterThan(740);
});

test('tampon « Reçu le » : date du jour modifiable, texte, couleur, inclinaison, position', async ({ page }) => {
  await ouvrir(page);
  await bouton(page, 'Tampon (P)').click();
  const attendue = await page.evaluate(() => new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }));
  await expect(page.locator('#pdf-date')).toHaveValue(attendue);
  expect(attendue).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
  await page.locator('#pdf-date').fill('26/11/2026');
  await cliquer(page, 300, 300);
  await expect(annots(page, 'tampon')).toHaveCount(1);
  const o = await exporter(page);
  expect(await images(page, o)).toHaveLength(0);              // dessin vectoriel : pas d'image
  const t = (await textes(page, o)).find(x => x.str === 'REÇU LE 26/11/2026');
  expect(t, 'texte relu').toBeTruthy();
  expect(Math.atan2(-t.b, t.a) * 180 / Math.PI).toBeCloseTo(8, 0);   // incliné, montant vers la droite
  expect(Math.abs(t.x - 300)).toBeLessThan(100);
  expect(Math.abs(t.y - 300)).toBeLessThan(40);
  const n = await couleurs(page, o);
  expect(n.b, 'cadre et texte bleus').toBeGreaterThan(100);
  expect(n.r + n.v).toBeLessThan(5);
  // Date invalide : refusée avec un message, rien posé
  await page.locator('#pdf-date').fill('hier');
  await cliquer(page, 300, 500);
  await expect(page.locator('#pdf-etat')).toContainText('JJ/MM/AAAA');
  await expect(annots(page, 'tampon')).toHaveCount(1);
});

test('tampon : couleur par type (rouge, vert), rotation de page respectée', async ({ page }) => {
  await ouvrir(page);
  await bouton(page, 'Tampon (P)').click();
  await page.locator('#pdf-tampon').selectOption({ label: 'Refusé' });
  await cliquer(page, 300, 200);
  await page.locator('#pdf-tampon').selectOption({ label: 'Approuvé' });
  await expect(page.locator('#pdf-reglage-date')).toBeHidden();
  await cliquer(page, 300, 500);
  const o = await exporter(page);
  const n = await couleurs(page, o);
  expect(n.r).toBeGreaterThan(100);
  expect(n.v).toBeGreaterThan(100);
  expect((await textes(page, o)).map(x => x.str).sort()).toEqual(['APPROUVÉ', 'Page 1', 'REFUSÉ']);
  // Page pivotée : le tampon reste lisible, incliné de 8° par rapport à la lecture
  await bouton(page, 'Pivoter à droite').click();
  await page.waitForFunction(() => document.querySelector('.pdf-calque').viewBox.baseVal.width > 800);
  await pret(page);
  await page.locator('#pdf-tampon').selectOption({ label: 'Urgent' });
  await cliquer(page, 400, 300);
  const r = await exporter(page);
  expect(await rotations(page, r)).toEqual([90]);
  const u = (await textes(page, r)).find(x => x.str === 'URGENT');
  expect(Math.atan2(-u.b, u.a) * 180 / Math.PI).toBeCloseTo(8, 0);
  expect(Math.abs(u.x - 400)).toBeLessThan(80);
  expect(Math.abs(u.y - 300)).toBeLessThan(80);
});

test('tous les tampons du catalogue s\'exportent', async ({ page }) => {
  await ouvrir(page);
  await bouton(page, 'Tampon (P)').click();
  const noms = await page.locator('#pdf-tampon option').allTextContents();
  expect(noms).toEqual(['Reçu le', 'Comptabilisé le', 'Duplicata', 'Diffusion restreinte', 'Approuvé', 'Refusé', 'Confidentiel', 'Brouillon', 'Urgent', 'Copie']);
  await page.locator('#pdf-date').fill('01/02/2027');
  for (const [i, nom] of noms.entries()) {
    await page.locator('#pdf-tampon').selectOption({ label: nom });
    await cliquer(page, 300, 60 + i * 75);
  }
  await expect(annots(page, 'tampon')).toHaveCount(10);
  const attendus = noms.map(n => (/ le$/.test(n) ? n + ' 01/02/2027' : n).toLocaleUpperCase('fr-FR'));
  const lus = (await textes(page, await exporter(page))).map(x => x.str);
  for (const a of attendus) expect(lus, a).toContain(a);
});

test('tampon : redimensionnable, annulable, gomme ; tampon et signature suivent leur page', async ({ page }) => {
  await ouvrir(page, 3);
  await bouton(page, 'Tampon (P)').click();
  await page.locator('#pdf-tampon').selectOption({ label: 'Copie' });
  await cliquer(page, 300, 300);
  await bouton(page, 'Sélection (V)').click();
  await cliquer(page, 300, 300);
  const avant = (await textes(page, await exporter(page))).find(x => x.str === 'COPIE');   // avant la mesure : l'export décale la mise en page
  const hb = await page.locator('.pdf-poignee').boundingBox(), c = { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 };
  await page.mouse.move(c.x, c.y); await page.mouse.down(); await page.mouse.move(c.x + 60, c.y - 20, { steps: 6 }); await page.mouse.up();
  const apres = (await textes(page, await exporter(page))).find(x => x.str === 'COPIE');
  expect(Math.hypot(apres.a, apres.b)).toBeGreaterThan(Math.hypot(avant.a, avant.b) * 1.2);   // corps du texte agrandi
  await page.keyboard.press('Control+z');
  const annule = (await textes(page, await exporter(page))).find(x => x.str === 'COPIE');
  expect(Math.hypot(annule.a, annule.b)).toBeCloseTo(Math.hypot(avant.a, avant.b), 1);
  // Signature sur la même page, puis page descendue : les deux suivent
  await signerEtPoser(page, 300, 600);
  await bouton(page, 'Descendre la page').click();
  await expect(page.locator('#pdf-num')).toHaveValue('2');
  await expect(annots(page, 'tampon')).toHaveCount(1);
  await expect(annots(page, 'signature')).toHaveCount(1);
  await bouton(page, 'Page précédente').click();
  await expect(annots(page, 'tampon')).toHaveCount(0);
  const o = await exporter(page);
  expect((await textes(page, o, 2)).map(x => x.str)).toContain('COPIE');
  expect((await textes(page, o, 1)).map(x => x.str)).not.toContain('COPIE');
  // Gomme, puis annuler / rétablir
  await bouton(page, 'Page suivante').click();
  await expect(annots(page, 'tampon')).toHaveCount(1);
  await bouton(page, 'Gomme (E)').click();
  await cliquer(page, 300, 300);
  await expect(annots(page, 'tampon')).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(annots(page, 'tampon')).toHaveCount(1);
  await page.keyboard.press('Control+z');                      // annule la pose de la signature
  await expect(annots(page, 'signature')).toHaveCount(0);
  await page.keyboard.press('Control+y');
  await expect(annots(page, 'signature')).toHaveCount(1);
  // Supprimer la page : tampon et signature partent avec elle
  await bouton(page, 'Supprimer').click();
  const s = await exporter(page);
  expect(await images(page, s)).toHaveLength(0);
  expect((await textes(page, s, 1)).map(x => x.str)).not.toContain('COPIE');
});

// Revue PR #4 : un clic sur la zone de dessin sortait le focus de la fenêtre (canvas non focalisable)
test('fenêtre : après un clic dans la zone de dessin, Ctrl+Z, flèches et Échap restent à la fenêtre', async ({ page }) => {
  await ouvrir(page, 2);
  await page.keyboard.press('h');                                           // surligneur : une annotation derrière la fenêtre
  const a = await ecran(page, 100, 300), b = await ecran(page, 300, 340);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 5 }); await page.mouse.up();
  await expect(annots(page, 'surlig')).toHaveCount(1);
  await page.keyboard.press('s');
  await expect(dialogue(page)).toBeVisible();
  await page.locator('.pdf-sig-canvas').click({ position: { x: 40, y: 40 } });   // un point tracé
  await page.keyboard.press('Control+z');
  await page.keyboard.press('ArrowRight');
  await expect(annots(page, 'surlig')).toHaveCount(1);                      // rien d'annulé derrière
  await expect(page.locator('#pdf-num')).toHaveValue('1');                  // pas de changement de page
  await page.keyboard.press('Escape');
  await expect(dialogue(page)).toHaveCount(0);
});

test('image JPEG : en-tête piégé (FF 00) refusé, en-tête normal lu', async ({ page }) => {
  const r = await page.evaluate(() => {
    const d = a => MPDS.pdfDetourage.dimensions(new Uint8Array(a), 'jpeg');
    const sof = [0xFF, 0xC0, 0x00, 0x11, 0x08, 0x00, 0x64, 0x00, 0xC8, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];   // 200 × 100
    const app0 = [0xFF, 0xE0, 0x00, 0x10, ...Array(14).fill(0)];
    return {
      normal: d([0xFF, 0xD8, ...app0, ...sof]),
      piege: d([0xFF, 0xD8, 0xFF, 0x00, 0x00, 0x14, ...Array(12).fill(0), ...sof]),
      bruit: d([0xFF, 0xD8, 0x12, ...app0, ...sof]),
    };
  });
  expect(r).toEqual({ normal: [200, 100], piege: null, bruit: null });
});

// ---- Revue PR #4 (n° 5) : date du tampon ----
test('tampon : date inexistante refusée (31/02, 00/00)', async ({ page }) => {
  await ouvrir(page);
  await bouton(page, 'Tampon (P)').click();
  for (const d of ['31/02/2026', '00/00/2026', '29/02/2025']) {
    await page.locator('#pdf-date').fill(d);
    await cliquer(page, 300, 300);
    await expect(page.locator('#pdf-etat')).toContainText('Date inexistante');
  }
  await expect(annots(page, 'tampon')).toHaveCount(0);
  await page.locator('#pdf-date').fill('29/02/2028');   // bissextile
  await cliquer(page, 300, 300);
  await expect(annots(page, 'tampon')).toHaveCount(1);
});

test('tampon : la date d\'office suit le jour (après minuit), une date saisie est gardée', async ({ page }) => {
  await page.clock.setFixedTime(new Date(2026, 10, 26, 23, 58));
  await ouvrirApp(page);
  await ouvrir(page);
  await bouton(page, 'Tampon (P)').click();
  await expect(page.locator('#pdf-date')).toHaveValue('26/11/2026');
  await bouton(page, 'Sélection (V)').click();
  await page.clock.setFixedTime(new Date(2026, 10, 27, 0, 3));
  await bouton(page, 'Tampon (P)').click();
  await expect(page.locator('#pdf-date')).toHaveValue('27/11/2026');
  await page.locator('#pdf-date').fill('01/12/2026');
  await bouton(page, 'Sélection (V)').click();
  await page.clock.setFixedTime(new Date(2026, 10, 28, 9, 0));
  await bouton(page, 'Tampon (P)').click();
  await expect(page.locator('#pdf-date')).toHaveValue('01/12/2026');
});

// ---- Revue PR #4 (n° 6) : orientation de la signature exportée, 90/180/270° ----
for (const R of [90, 180, 270]) {
  test(`signature asymétrique sur page pivotée à ${R}° : orientation exportée`, async ({ page }) => {
    await ouvrir(page);
    for (let i = 0; i < R / 90; i++) await bouton(page, 'Pivoter à droite').click();
    await page.waitForFunction(r => document.querySelector('.pdf-calque').viewBox.baseVal.width > (r % 180 ? 800 : 500), R);
    await pret(page);
    await ouvrirModale(page);
    await tracer(page, [[0.1, 0.15], [0.9, 0.15]]);          // trait en haut, toute la largeur
    await tracer(page, [[0.1, 0.85], [0.18, 0.85]]);         // marque en bas à gauche seulement
    await bouton(page, 'Valider').click();
    await cliquer(page, 400, 300);
    // Boîte de la signature à l'écran, en unités du calque (= rendu PDF.js de la page exportée à l'échelle 1)
    const b = await page.evaluate(() => {
      const s = document.querySelector('.pdf-calque'), c = s.getBoundingClientRect(), k = s.viewBox.baseVal.width / c.width, i = s.querySelector('image').getBoundingClientRect();
      return { x: (i.left - c.left) * k, y: (i.top - c.top) * k, w: i.width * k, h: i.height * k };
    });
    const o = await exporter(page);
    expect(await rotations(page, o)).toEqual([R]);
    const [hautMilieu, basGauche, basDroite] = await sombres(page, o, [[b.x + b.w / 2, b.y + b.h * 0.1], [b.x + b.w * 0.06, b.y + b.h * 0.9], [b.x + b.w * 0.85, b.y + b.h * 0.9]], 4);
    expect(hautMilieu, 'trait du haut').toBeLessThan(300);
    expect(basGauche, 'marque en bas à gauche').toBeLessThan(300);
    expect(basDroite, 'rien en bas à droite').toBeGreaterThan(700);
  });
}
