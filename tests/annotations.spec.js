// Module PDF — annotations (surligneur, texte, dessin, sélection, gomme, annuler/rétablir). Les gestes sont
// joués à la souris sur le calque SVG ; les exports sont interceptés puis relus avec PDF.js
// (pixels du rendu, texte et position) : ce qui est vérifié est ce qui est écrit dans le fichier.
// Les coordonnées passées aux helpers sont celles du viewport à l'échelle 1 (en points, origine en haut
// à gauche, page A4 : 595 × 842) ; la page est affichée à 100 % pour que 1 point = 1 pixel.
'use strict';

const fs = require('fs');
const { test, expect, ouvrirApp } = require('./aide');

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1300, height: 1300 });
  await ouvrirApp(page);
});

const bouton = (page, nom) => page.getByRole('button', { name: nom, exact: true });
const calque = page => page.locator('.pdf-calque');
const annots = (page, type) => page.locator(`.pdf-calque [data-type="${type}"]`);
const MODIF = '● Modifications non enregistrées';

// Calque posé à l'échelle courante : largeur du SVG = largeur du viewBox × zoom affiché
const pret = page => page.waitForFunction(() => {
  const s = document.querySelector('.pdf-calque'), z = parseFloat(document.getElementById('pdf-zoom').textContent) / 100;
  return s && Math.abs(s.getBoundingClientRect().width - s.viewBox.baseVal.width * z) < 3;
});

// Ouvre un PDF de n pages (A4) et l'affiche à 100 %
async function ouvrir(page, n = 1) {
  await page.evaluate(n => MPDS.envoyer(Fab.pdf('a.pdf', Array.from({ length: n }, (_, i) =>
    [{ t: 'Page ' + (i + 1), x: 72, y: 760, taille: 30, gras: true }])), 'pdf'), n);
  await expect(page.locator('.pdf-mini')).toHaveCount(n);
  await pret(page);
  while (parseInt(await page.locator('#pdf-zoom').textContent(), 10) > 100) {
    await bouton(page, 'Zoom arrière').click();
    await pret(page);
  }
  expect(await page.locator('#pdf-zoom').textContent()).toBe('100 %');
}

// Point du viewport à l'échelle 1 → coordonnées de la fenêtre
const ecran = (page, x, y) => page.evaluate(([x, y]) => {
  const s = document.querySelector('.pdf-calque'), b = s.getBoundingClientRect(), v = s.viewBox.baseVal;
  return { x: b.left + x * b.width / v.width, y: b.top + y * b.height / v.height };
}, [x, y]);
async function glisser(page, pts) {
  const e = [];
  for (const [x, y] of pts) e.push(await ecran(page, x, y));
  await page.mouse.move(e[0].x, e[0].y);
  await page.mouse.down();
  for (const p of e.slice(1)) await page.mouse.move(p.x, p.y, { steps: 6 });
  await page.mouse.up();
}
async function cliquer(page, x, y) { const p = await ecran(page, x, y); await page.mouse.click(p.x, p.y); }
// Change de page par un bouton et attend que le calque de la nouvelle page soit posé
async function aller(page, nom) {
  await page.evaluate(() => { window.__ancien = document.querySelector('.pdf-calque'); });
  await bouton(page, nom).click();
  await page.waitForFunction(() => document.querySelector('.pdf-calque') !== window.__ancien);
}
const outil = (page, nom) => bouton(page, nom).click();
const surligner = (page, x0, y0, x1, y1) => glisser(page, [[x0, y0], [x1, y1]]);
async function ecrire(page, x, y, texte) {
  await outil(page, 'Texte (T)');
  await cliquer(page, x, y);
  await page.keyboard.type(texte);
  await page.keyboard.press('Enter');
}

// Clique sur un bouton qui télécharge un PDF ; renvoie ses octets
async function exporter(page, nom = 'Enregistrer le PDF') {
  const [dl] = await Promise.all([page.waitForEvent('download'), bouton(page, nom).click()]);
  return fs.readFileSync(await dl.path());
}
// Pixel (RGBA) du rendu à l'échelle 1 de la page n, aux points donnés ; rayon > 0 : le plus sombre alentour
const pixels = (page, octets, n, pts, rayon = 0) => page.evaluate(async ({ o, n, pts, rayon }) => {
  const d = await (await MPDS.pdfjs.ouvrir(new Uint8Array(o).buffer)).promise, p = await d.getPage(n), vue = p.getViewport({ scale: 1 });
  const cv = Object.assign(document.createElement('canvas'), { width: Math.round(vue.width), height: Math.round(vue.height) });
  const g = cv.getContext('2d');
  await p.render({ canvasContext: g, viewport: vue }).promise;
  return pts.map(([x, y]) => {
    let meilleur = null;
    for (let dx = -rayon; dx <= rayon; dx++) for (let dy = -rayon; dy <= rayon; dy++) {
      const v = Array.from(g.getImageData(Math.round(x) + dx, Math.round(y) + dy, 1, 1).data);
      if (!meilleur || v[0] + v[1] + v[2] < meilleur[0] + meilleur[1] + meilleur[2]) meilleur = v;
    }
    return meilleur;
  });
}, { o: [...octets], n, pts, rayon });
// Éléments de texte de la page n, avec position et orientation dans le viewport (rotation de la page comprise)
const textes = (page, octets, n = 1) => page.evaluate(async ({ o, n }) => {
  const d = await (await MPDS.pdfjs.ouvrir(new Uint8Array(o).buffer)).promise, p = await d.getPage(n), vue = p.getViewport({ scale: 1 });
  const tc = await p.getTextContent();
  return tc.items.map(i => {
    const t = pdfjsLib.Util.transform(vue.transform, i.transform);
    return { str: i.str, a: t[0], b: t[1], c: t[2], d: t[3], x: t[4], y: t[5], famille: (tc.styles[i.fontName] || {}).fontFamily };
  });
}, { o: [...octets], n });
const rotations = (page, octets) => page.evaluate(async o => {
  const d = await (await MPDS.pdfjs.ouvrir(new Uint8Array(o).buffer)).promise, r = [];
  for (let i = 1; i <= d.numPages; i++) r.push((await d.getPage(i)).rotate);
  return r;
}, [...octets]);

const colore = p => p[0] > 235 && p[2] < 215;     // jaune à 25 % sur blanc : (255, 242, 197)
const blanc = p => p[0] > 250 && p[1] > 250 && p[2] > 250;
const sombre = p => p[0] < 100 && p[1] < 100 && p[2] < 100;

test('chaque outil crée son annotation, l\'indicateur de modifications s\'allume', async ({ page }) => {
  await ouvrir(page);
  await expect(page.locator('#pdf-modif')).toHaveText('');
  await page.keyboard.press('h');
  await expect(bouton(page, 'Surligneur (H)')).toHaveAttribute('aria-pressed', 'true');
  await expect(bouton(page, 'Sélection (V)')).toHaveAttribute('aria-pressed', 'false');
  await surligner(page, 100, 300, 300, 360);
  await expect(annots(page, 'surlig')).toHaveCount(1);
  await expect(page.locator('#pdf-modif')).toHaveText(MODIF);
  await page.keyboard.press('d');
  await expect(bouton(page, 'Dessin (D)')).toHaveAttribute('aria-pressed', 'true');
  await glisser(page, [[100, 450], [200, 500], [300, 450]]);
  await expect(annots(page, 'dessin')).toHaveCount(1);
  await page.keyboard.press('t');
  await cliquer(page, 100, 600);
  await page.keyboard.type('Bonjour');
  await page.keyboard.press('Enter');
  await expect(annots(page, 'texte')).toHaveCount(1);
  await expect(annots(page, 'texte')).toHaveText('Bonjour');
  await expect(page.locator('.pdf-saisie')).toHaveCount(0);
  // Un clic sans glisser, ou un rectangle minuscule, ne crée rien
  await page.keyboard.press('h');
  await cliquer(page, 400, 300);
  await page.keyboard.press('d');
  await cliquer(page, 400, 400);
  await expect(annots(page, 'surlig')).toHaveCount(1);
  await expect(annots(page, 'dessin')).toHaveCount(1);
});

test('surligneur : opacité 25 % par défaut, réglable ; pixel coloré à l\'endroit exporté', async ({ page }) => {
  await ouvrir(page);
  await outil(page, 'Surligneur (H)');
  await expect(page.locator('#pdf-opacite')).toHaveValue('25');
  await surligner(page, 100, 300, 300, 360);
  await page.locator('#pdf-opacite').fill('60');
  await surligner(page, 100, 400, 300, 460);
  await expect(annots(page, 'surlig').first().locator('rect')).toHaveAttribute('fill-opacity', '0.25');
  await expect(annots(page, 'surlig').last().locator('rect')).toHaveAttribute('fill-opacity', '0.6');
  const px = await pixels(page, await exporter(page), 1, [[200, 330], [200, 430], [95, 330], [305, 330], [200, 380], [200, 295]]);
  expect(colore(px[0]), 'rectangle à 25 %').toBe(true);
  expect(px[0][2]).toBeGreaterThan(170);   // 25 % de jaune sur blanc : bleu ≈ 197
  expect(px[1][2], 'à 60 %, plus soutenu').toBeLessThan(150);
  for (const i of [2, 3, 4, 5]) expect(blanc(px[i]), 'hors des rectangles : page blanche (point ' + i + ')').toBe(true);
});

test('dessin : pixels sombres le long du tracé, épaisseur et couleur réglables', async ({ page }) => {
  await ouvrir(page);
  await outil(page, 'Dessin (D)');
  await expect(page.locator('#pdf-epaisseur')).toHaveValue('3');
  await bouton(page, 'Couleur : Noir').click();
  await glisser(page, [[100, 300], [300, 300], [300, 420]]);
  await bouton(page, 'Couleur : Rouge').click();
  await page.locator('#pdf-epaisseur').fill('9');
  await glisser(page, [[100, 500], [300, 500]]);
  await expect(annots(page, 'dessin').first().locator('polyline').last()).toHaveAttribute('stroke-width', '3');
  await expect(annots(page, 'dessin').last().locator('polyline').last()).toHaveAttribute('stroke-width', '9');
  const o = await exporter(page);
  const noir = await pixels(page, o, 1, [[130, 300], [200, 300], [270, 300], [300, 340], [300, 400]], 1);
  noir.forEach((p, i) => expect(sombre(p), 'tracé noir, point ' + i).toBe(true));
  const [loin, haut, rouge] = await pixels(page, o, 1, [[200, 330], [200, 285], [200, 500]]);
  expect(blanc(loin) && blanc(haut), 'rien à côté du tracé').toBe(true);
  expect(rouge[0] > 180 && rouge[1] < 90, 'tracé rouge').toBe(true);
  const [epais] = await pixels(page, o, 1, [[200, 503]]);    // à 3 px de l'axe : atteint seulement par le trait de 9
  expect(epais[0] > 180 && epais[1] < 90, 'trait de 9 pt').toBe(true);
});

test('texte : présent dans le PDF, à la position cliquée, police et taille réglables', async ({ page }) => {
  await ouvrir(page);
  await ecrire(page, 100, 600, 'Bonjour 42 € é');
  await outil(page, 'Texte (T)');
  await page.locator('#pdf-police').selectOption('Courier');
  await page.locator('#pdf-taille').fill('30');
  await bouton(page, 'Couleur : Rouge').click();
  await cliquer(page, 100, 700);
  await page.keyboard.type('Gros');
  await page.keyboard.press('Enter');
  await expect(annots(page, 'texte')).toHaveCount(2);
  const t = await textes(page, await exporter(page));
  const a = t.find(x => x.str === 'Bonjour 42 € é'), b = t.find(x => x.str === 'Gros');
  expect(a, 'texte relu par getTextContent').toBeTruthy();
  expect([a.x, a.y].map(Math.round)).toEqual([100, 600]);
  expect(a.a).toBeCloseTo(18, 0);
  expect(Math.abs(a.b)).toBeLessThan(0.01);
  expect([b.x, b.y].map(Math.round)).toEqual([100, 700]);
  expect(b.a).toBeCloseTo(30, 0);
  expect(b.famille).toMatch(/mono/i);
});

test('texte sur une page pivotée : droit à l\'écran, lisible au bon endroit dans le PDF exporté', async ({ page }) => {
  await ouvrir(page);
  await bouton(page, 'Pivoter à droite').click();
  await page.waitForFunction(() => document.querySelector('.pdf-calque').viewBox.baseVal.width > 800);   // 842 × 595
  await pret(page);
  await ecrire(page, 200, 100, 'Pivote');
  const rendu = await page.evaluate(() => {
    const t = document.querySelector('.pdf-calque text'), b = t.getBoundingClientRect();
    return { l: b.width, h: b.height, transform: t.getAttribute('transform') };
  });
  expect(rendu.l, 'texte horizontal à l\'écran').toBeGreaterThan(rendu.h);
  expect(parseFloat(rendu.transform.replace('rotate(', ''))).toBeCloseTo(0, 5);
  const o = await exporter(page);
  expect(await rotations(page, o)).toEqual([90]);
  const t = (await textes(page, o)).find(x => x.str === 'Pivote');
  expect(t, 'texte relu').toBeTruthy();
  expect([t.x, t.y].map(Math.round)).toEqual([200, 100]);
  expect(t.a).toBeCloseTo(18, 0);                  // droit : même orientation qu'un texte horizontal
  expect(Math.abs(t.b) + Math.abs(t.c)).toBeLessThan(0.01);
  expect(t.d).toBeCloseTo(-18, 0);
});

test('le zoom ne déplace pas les annotations', async ({ page }) => {
  await ouvrir(page);
  await outil(page, 'Surligneur (H)');
  await surligner(page, 100, 300, 200, 360);
  const x0 = Number(await annots(page, 'surlig').locator('rect').getAttribute('x'));
  await bouton(page, 'Zoom avant').click();
  await expect(page.locator('#pdf-zoom')).toHaveText('110 %');
  await pret(page);
  await expect(annots(page, 'surlig')).toHaveCount(1);
  expect(Number(await annots(page, 'surlig').locator('rect').getAttribute('x'))).toBeCloseTo(x0, 3);
  await surligner(page, 300, 300, 400, 360);           // même repère, autre zoom
  await bouton(page, 'Zoom arrière').click();
  await bouton(page, 'Zoom arrière').click();
  await expect(page.locator('#pdf-zoom')).toHaveText('90 %');
  await pret(page);
  const box = await page.locator('#pdf-canvas').boundingBox(), cote = await calque(page).boundingBox();
  expect(cote.width).toBeCloseTo(box.width, 0);        // le calque suit exactement le canvas
  const px = await pixels(page, await exporter(page), 1, [[150, 330], [350, 330], [250, 330]]);
  expect(colore(px[0]) && colore(px[1]), 'deux rectangles aux positions voulues').toBe(true);
  expect(blanc(px[2])).toBe(true);
});

test('les annotations suivent leur page : réordonner, pivoter, supprimer, extraire', async ({ page }) => {
  await ouvrir(page, 3);
  await outil(page, 'Surligneur (H)');
  await surligner(page, 100, 300, 300, 360);                        // sur la page 1
  await bouton(page, 'Descendre la page').click();                   // elle passe en position 2
  await expect(page.locator('#pdf-num')).toHaveValue('2');
  await expect(annots(page, 'surlig')).toHaveCount(1);
  await bouton(page, 'Page précédente').click();                     // la nouvelle page 1 : aucune annotation
  await expect(page.locator('#pdf-num')).toHaveValue('1');
  await expect(annots(page, 'surlig')).toHaveCount(0);
  await bouton(page, 'Page suivante').click();
  await expect(annots(page, 'surlig')).toHaveCount(1);
  const o = await exporter(page);
  const point = [[200, 330]];
  expect(colore((await pixels(page, o, 2, point))[0])).toBe(true);
  expect(blanc((await pixels(page, o, 1, point))[0]) && blanc((await pixels(page, o, 3, point))[0])).toBe(true);
  // Pivoter la page annotée : le rectangle reste au même endroit de la page (PDF 200, 512 → écran 512, 200)
  await bouton(page, 'Pivoter à droite').click();
  await page.waitForFunction(() => document.querySelector('.pdf-calque').viewBox.baseVal.width > 800);
  await expect(annots(page, 'surlig')).toHaveCount(1);
  const r = await exporter(page);
  expect(await rotations(page, r)).toEqual([0, 90, 0]);
  expect(colore((await pixels(page, r, 2, [[512, 200]]))[0])).toBe(true);
  // Extraire la sélection (page 2 cochée) : l'annotation part avec sa page
  await page.getByLabel('Sélectionner la page 2').check();
  const e = await exporter(page, 'Extraire la sélection');
  expect(await rotations(page, e)).toEqual([90]);
  expect(colore((await pixels(page, e, 1, [[512, 200]]))[0])).toBe(true);
  await page.getByLabel('Sélectionner la page 2').uncheck();
  // Supprimer la page annotée : l'annotation disparaît avec elle
  await bouton(page, 'Supprimer').click();
  const s = await exporter(page);
  expect(await rotations(page, s)).toEqual([0, 0]);
  for (const n of [1, 2]) expect(blanc((await pixels(page, s, n, point))[0]) && blanc((await pixels(page, s, n, [[512, 200]]))[0])).toBe(true);
});

test('sélection : contour, déplacement (annulable), Suppr ; gomme ; annuler et rétablir', async ({ page }) => {
  await ouvrir(page);
  await expect(bouton(page, 'Annuler (Ctrl+Z)')).toBeDisabled();
  await expect(bouton(page, 'Rétablir (Ctrl+Y)')).toBeDisabled();
  await outil(page, 'Surligneur (H)');
  await surligner(page, 100, 300, 200, 360);
  await surligner(page, 300, 300, 400, 360);
  await expect(bouton(page, 'Annuler (Ctrl+Z)')).toBeEnabled();
  // Sélection + déplacement
  await page.keyboard.press('v');
  await expect(page.locator('.pdf-contour')).toHaveCount(0);
  await cliquer(page, 150, 330);
  await expect(page.locator('.pdf-contour')).toHaveCount(1);
  await glisser(page, [[150, 330], [250, 400]]);
  await expect(page.locator('.pdf-contour')).toHaveCount(1);
  expect(Number(await annots(page, 'surlig').first().locator('rect').getAttribute('x'))).toBeCloseTo(200, 0);
  expect(Number(await annots(page, 'surlig').first().locator('rect').getAttribute('y'))).toBeCloseTo(370, 0);
  const px = await pixels(page, await exporter(page), 1, [[250, 400], [150, 330]]);
  expect(colore(px[0]) && blanc(px[1]), 'exporté à la nouvelle position').toBe(true);
  await page.keyboard.press('Control+z');
  expect(Number(await annots(page, 'surlig').first().locator('rect').getAttribute('x'))).toBeCloseTo(100, 0);
  await page.keyboard.press('Control+y');
  expect(Number(await annots(page, 'surlig').first().locator('rect').getAttribute('x'))).toBeCloseTo(200, 0);
  // Cliquer dans le vide désélectionne ; Suppr supprime la sélection
  await cliquer(page, 500, 600);
  await expect(page.locator('.pdf-contour')).toHaveCount(0);
  await cliquer(page, 350, 330);
  await page.keyboard.press('Delete');
  await expect(annots(page, 'surlig')).toHaveCount(1);
  // Gomme : un clic sur l'annotation la supprime
  await page.keyboard.press('e');
  await cliquer(page, 500, 600);
  await expect(annots(page, 'surlig')).toHaveCount(1);
  await cliquer(page, 250, 400);
  await expect(annots(page, 'surlig')).toHaveCount(0);
  // Annuler / rétablir : gomme, Suppr, déplacement, 2 créations
  await page.keyboard.press('Control+z');
  await expect(annots(page, 'surlig')).toHaveCount(1);
  await bouton(page, 'Annuler (Ctrl+Z)').click();
  await expect(annots(page, 'surlig')).toHaveCount(2);
  await page.keyboard.press('Control+z');            // le déplacement (rejoué plus haut)
  await page.keyboard.press('Control+z');            // la 2e création
  await expect(annots(page, 'surlig')).toHaveCount(1);
  await page.keyboard.press('Control+Shift+z');
  await expect(annots(page, 'surlig')).toHaveCount(2);
  await bouton(page, 'Rétablir (Ctrl+Y)').click();
  await expect(bouton(page, 'Rétablir (Ctrl+Y)')).toBeEnabled();
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await expect(annots(page, 'surlig')).toHaveCount(0);
  await expect(bouton(page, 'Annuler (Ctrl+Z)')).toBeDisabled();
});

test('annuler ramène à la page concernée ; une page supprimée est ignorée', async ({ page }) => {
  await ouvrir(page, 3);
  await outil(page, 'Surligneur (H)');
  await surligner(page, 100, 300, 300, 360);                   // page 1
  await aller(page, 'Page suivante');
  await surligner(page, 100, 400, 300, 460);                   // page 2
  await aller(page, 'Page suivante');
  await expect(annots(page, 'surlig')).toHaveCount(0);
  await page.keyboard.press('Control+z');                      // annule la création sur la page 2 : on s'y rend
  await expect(page.locator('#pdf-num')).toHaveValue('2');
  await expect(annots(page, 'surlig')).toHaveCount(0);
  await page.keyboard.press('Control+y');
  await expect(annots(page, 'surlig')).toHaveCount(1);
  await bouton(page, 'Supprimer').click();                     // supprime la page 2 (et son annotation)
  await page.keyboard.press('Control+z');                      // la commande de la page 2 est ignorée : celle de la page 1
  await expect(page.locator('#pdf-num')).toHaveValue('1');
  await expect(annots(page, 'surlig')).toHaveCount(0);
});

test('texte : refusé hors WinAnsi (message, zone ouverte), Échap annule, la perte du focus valide', async ({ page }) => {
  await ouvrir(page);
  await outil(page, 'Texte (T)');
  await cliquer(page, 100, 300);
  await page.keyboard.type('Aller →');
  await page.keyboard.press('Enter');
  await expect(page.locator('#pdf-etat')).toContainText('Caractère non pris en charge : → (U+2192)');
  await expect(page.locator('#pdf-etat')).toHaveAttribute('role', 'alert');
  await expect(page.locator('.pdf-saisie')).toBeVisible();
  await expect(page.locator('.pdf-saisie')).toHaveAttribute('aria-invalid', 'true');
  await expect(annots(page, 'texte')).toHaveCount(0);
  await page.keyboard.press('Control+a');
  await page.keyboard.type('Aller');
  await page.keyboard.press('Enter');
  await expect(annots(page, 'texte')).toHaveCount(1);
  await expect(page.locator('#pdf-etat')).toHaveText('');
  // Échap annule
  await cliquer(page, 100, 400);
  await page.keyboard.type('annulé');
  await page.keyboard.press('Escape');
  await expect(page.locator('.pdf-saisie')).toHaveCount(0);
  await expect(annots(page, 'texte')).toHaveCount(1);
  // Perte du focus : valide un texte correct…
  await cliquer(page, 100, 500);
  await page.keyboard.type('Validé');
  await page.locator('.pdf-nom').click();
  await expect(annots(page, 'texte')).toHaveCount(2);
  // … et refuse un texte invalide en gardant la zone ouverte
  await cliquer(page, 100, 600);
  await page.keyboard.type('😀');
  await page.locator('.pdf-nom').click();
  await expect(page.locator('#pdf-etat')).toContainText('😀 (U+1F600)');
  await expect(page.locator('.pdf-saisie')).toBeFocused();
  await expect(annots(page, 'texte')).toHaveCount(2);
  // Zone vide : rien n'est créé
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Enter');
  await expect(page.locator('.pdf-saisie')).toHaveCount(0);
  await expect(annots(page, 'texte')).toHaveCount(2);
});

test('raccourcis : inactifs dans un champ de saisie et hors du module PDF', async ({ page }) => {
  await ouvrir(page);
  const pressee = nom => expect(bouton(page, nom)).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#pdf-num').focus();
  for (const t of ['h', 't', 'd', 'e']) await page.keyboard.press(t);
  await pressee('Sélection (V)');
  // Dans la zone de saisie du texte : les lettres s'écrivent
  await outil(page, 'Texte (T)');
  await cliquer(page, 100, 300);
  await page.keyboard.type('hdev');
  await page.keyboard.press('Enter');
  await pressee('Texte (T)');
  await expect(annots(page, 'texte')).toHaveText('hdev');
  await page.keyboard.press('Control+z');                      // focus rendu à la page : annule l'annotation
  await expect(annots(page, 'texte')).toHaveCount(0);
  await page.keyboard.press('Control+y');
  await expect(annots(page, 'texte')).toHaveCount(1);
  // Module Convertir : ni outil, ni annulation
  await page.evaluate(() => { location.hash = '#/convertir'; });
  await page.waitForFunction(() => MPDS.actif() === 'convertir');
  await page.keyboard.press('h');
  await page.keyboard.press('Control+z');
  await page.evaluate(() => { location.hash = '#/pdf'; });
  await page.waitForFunction(() => MPDS.actif() === 'pdf');
  await pressee('Texte (T)');
  await expect(annots(page, 'texte')).toHaveCount(1);
  await page.keyboard.press('h');                              // de retour dans le module : actif
  await pressee('Surligneur (H)');
});

test('accessibilité : boutons d\'outil avec aria-pressed, libellés et infobulles avec raccourci', async ({ page }) => {
  await ouvrir(page);
  for (const [nom, touche] of [['Sélection', 'V'], ['Surligneur', 'H'], ['Texte', 'T'], ['Dessin', 'D'], ['Gomme', 'E']]) {
    const b = bouton(page, `${nom} (${touche})`);
    await expect(b).toHaveAttribute('aria-pressed', /true|false/);
    await expect(b).toHaveAttribute('title', `${nom} (${touche})`);
    await b.click();
    await expect(page.locator('.pdf-barre-annot > [aria-pressed="true"]')).toHaveCount(1);
  }
  await expect(page.locator('.pdf-barre-annot')).toHaveAttribute('role', 'toolbar');
  await outil(page, 'Texte (T)');
  await expect(bouton(page, 'Couleur : Rouge')).toHaveAttribute('aria-pressed', 'false');
  await expect(bouton(page, 'Couleur : Noir')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.locator('.pdf-pastille').count()).toBe(6);
});
