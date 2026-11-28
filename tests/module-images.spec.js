// Module Images : retrait des métadonnées sans perte (liste blanche JPEG / PNG), redimensionnement,
// compression, conversion, lot en .zip, erreurs, passerelle vers Convertir.
'use strict';

const fs = require('fs');
const { test, expect, ouvrirApp } = require('./aide');

// « Exif » n'y figure pas : une photo tournée garde un EXIF minimal (l'orientation seule), vérifié octet pour octet
const SECRETS_JPEG = ['Ville-Secrete', 'mpf-secret', 'c2pa-secret', 'iptc-secret', 'commentaire-secret', 'video-secrete'];
const SECRETS_PNG = ['png-secret', 'exif-secret', 'tIME', 'prive-secret', 'apres-secret'];

async function ouvrirImages(page) {
  await ouvrirApp(page);
  await page.locator('.rail-lien[data-module="images"]').click();
  await expect(page.locator('#img-depot')).toBeVisible();
}
const traiter = async page => {
  await page.getByRole('button', { name: 'Traiter les images' }).click();
  await expect(page.locator('#img-etat')).toContainText('Rien n\'a quitté votre appareil');
};
async function telecharger(page, declencheur) {
  const [dl] = await Promise.all([page.waitForEvent('download'), declencheur.click()]);
  return { nom: dl.suggestedFilename(), octets: fs.readFileSync(await dl.path()) };
}
const contient = (octets, s) => octets.includes(Buffer.from(s, 'latin1'));
// Couleur (RGBA) des pixels donnés, une fois l'image décodée par le navigateur (orientation EXIF appliquée)
const couleurs = (page, octets, points) => page.evaluate(async ({ o, points }) => {
  const b = await createImageBitmap(new Blob([new Uint8Array(o)]));
  const c = Object.assign(document.createElement('canvas'), { width: b.width, height: b.height }), x = c.getContext('2d');
  x.drawImage(b, 0, 0);
  return { w: b.width, h: b.height, px: points.map(([u, v]) => [...x.getImageData(u, v, 1, 1).data]) };
}, { o: [...octets], points });
const rouge = p => p[0] > 180 && p[2] < 80, bleu = p => p[2] > 180 && p[0] < 80;

test('JPEG : liste blanche, rien d\'autre ne reste, données d\'image intactes, orientation seule réécrite, GPS relevé', async ({ page }) => {
  await ouvrirApp(page);
  const r = await page.evaluate(async () => {
    const f = await Fab.jpegAvecMeta('p.jpg');
    const n = MPDS.imgMeta.nettoyer(new Uint8Array(await f.arrayBuffer()));
    return { sortie: [...n.octets], attendu: [...f.attendu], retires: n.retires, orientation: n.orientation, gps: n.gps };
  });
  const sortie = Buffer.from(r.sortie);
  for (const s of SECRETS_JPEG) expect(contient(sortie, s), s).toBe(false);
  expect(contient(sortie, 'icc-garde')).toBe(true);
  expect(r.sortie).toEqual(r.attendu);   // octet pour octet : segments retirés, EXIF réduit à l'orientation
  expect(r.retires).toEqual(['EXIF', 'XMP', 'MPF (images multiples)', 'JUMBF / C2PA (provenance)', 'IPTC', 'commentaire',
    'données cachées après la fin de l\'image (vidéo, profondeur, autres images)']);
  expect([r.orientation, r.gps]).toEqual([6, true]);
});

test('PNG : blocs critiques et de couleur gardés, texte, EXIF, date, bloc privé et suite après IEND retirés', async ({ page }) => {
  await ouvrirApp(page);
  const r = await page.evaluate(async () => {
    const f = await Fab.pngAvecMeta('p.png');
    const n = MPDS.imgMeta.nettoyer(new Uint8Array(await f.arrayBuffer()));
    return { sortie: [...n.octets], attendu: [...f.attendu], retires: n.retires };
  });
  for (const s of SECRETS_PNG) expect(contient(Buffer.from(r.sortie), s), s).toBe(false);
  expect(r.sortie).toEqual(r.attendu);
  expect(r.retires).toEqual(['texte (auteur, logiciel, commentaire…)', 'EXIF', 'date de modification', 'bloc prVt',
    'données cachées après la fin de l\'image (vidéo, profondeur, autres images)']);
});

test('structure inattendue : refus, jamais de fichier tronqué ; formats reconnus aux premiers octets', async ({ page }) => {
  await ouvrirApp(page);
  const r = await page.evaluate(async () => {
    const essai = o => { try { MPDS.imgMeta.nettoyer(o); return 'accepté'; } catch (e) { return e.name + ' : ' + e.message; } };
    const jpeg = new Uint8Array(await (await Fab.jpegAvecMeta('p.jpg')).arrayBuffer());
    const png = new Uint8Array(await (await Fab.pngAvecMeta('p.png')).arrayBuffer());
    const sos = jpeg.findIndex((x, i) => x === 0xFF && jpeg[i + 1] === 0xDA);
    const inconnu = new Uint8Array([...jpeg.subarray(0, 2), ...Fab.segmentJpeg(0xF7, 'x'), ...jpeg.subarray(2)]);
    const critique = new Uint8Array([...png.subarray(0, 33), ...Fab.blocPng('ABCD', 'x'), ...png.subarray(33)]);
    const ftyp = marques => new Uint8Array([0, 0, 0, 8 + 4 * marques.length, ...'ftyp'.split('').map(c => c.charCodeAt(0)),
      ...marques.flatMap(m => m.split('').map(c => c.charCodeAt(0)))]);
    return {
      tronque: essai(jpeg.subarray(0, sos + 30)),
      marqueur: essai(inconnu),
      critique: essai(critique),
      sansIend: essai(png.subarray(0, png.length - 30)),
      formats: [ftyp(['heic', '\0\0\0\0', 'mif1']), ftyp(['mif1', '\0\0\0\0', 'avif']), ftyp(['isom', '\0\0\0\0', 'mp41']),
        new TextEncoder().encode('GIF89a'), new TextEncoder().encode('bonjour')].map(MPDS.imgMeta.format),
      webp: MPDS.imgMeta.nettoyer(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 ')),
    };
  });
  expect(r.tronque).toBe('Image : Structure JPEG inattendue : image non modifiée.');
  expect(r.marqueur).toBe('Image : Structure JPEG inattendue : image non modifiée.');
  expect(r.critique).toBe('Image : Bloc PNG indispensable inconnu (ABCD) : image non modifiée.');
  expect(r.sansIend).toBe('Image : Structure PNG inattendue : image non modifiée.');
  expect(r.formats).toEqual(['heic', 'avif', null, 'gif', null]);
  expect(r.webp).toBeNull();   // pas de retrait sans perte : l'appelant réencode
});

test('dimensions de sortie : côté le plus long ou pourcentage, jamais agrandies', async ({ page }) => {
  await ouvrirApp(page);
  const r = await page.evaluate(() => {
    const d = MPDS.imgTraitement.dimensions;
    return [d(4000, 3000, { mode: 'cote', valeur: 1920 }), d(3000, 4000, { mode: 'cote', valeur: 1000 }), d(4000, 3000, { mode: 'pourcent', valeur: 50 }),
      d(4000, 3000, { mode: 'cote', valeur: 8000 }), d(4000, 3000, { mode: 'pourcent', valeur: 150 }), d(4000, 3000, { mode: 'origine' }), d(3, 1, { mode: 'pourcent', valeur: 1 })];
  });
  expect(r).toEqual([{ w: 1920, h: 1440 }, { w: 750, h: 1000 }, { w: 2000, h: 1500 }, { w: 4000, h: 3000 }, { w: 4000, h: 3000 }, { w: 4000, h: 3000 }, { w: 1, h: 1 }]);
});

test('interface, sans perte : photo en portrait (orientation 6) toujours droite, fichier téléchargé propre', async ({ page }) => {
  await ouvrirImages(page);
  const reseau = [];   // le traitement ne doit rien envoyer ni rien charger
  page.on('request', r => { if (/^https?:/.test(r.url())) reseau.push(r.url()); });
  await page.evaluate(async () => { const fichiers = await Promise.all([Fab.jpegAvecMeta("photo.jpg")]); for (const f of fichiers) await MPDS.envoyer(f, 'images'); });
  await expect(page.locator('.img-item')).toHaveCount(1);
  await expect(page.locator('.img-meta')).toContainText('20 × 40 px');   // dimensions affichées : orientation 6 appliquée
  await traiter(page);
  await expect(page.locator('.img-retires')).toContainText('Retiré : EXIF (dont la position GPS), XMP, MPF');
  await expect(page.locator('.img-resultat')).toContainText('20 × 40 px');
  await expect(page.locator('.img-avis')).toHaveText('Seule l\'orientation de la photo est gardée, pour qu\'elle reste droite.');
  const { nom, octets } = await telecharger(page, page.getByRole('button', { name: 'Télécharger « photo (sans métadonnées).jpg »' }));
  expect(nom).toBe('photo (sans métadonnées).jpg');
  for (const s of SECRETS_JPEG) expect(contient(octets, s), s).toBe(false);
  const attendu = await page.evaluate(async () => [...(await Fab.jpegAvecMeta('photo.jpg')).attendu].length);
  expect(octets.length).toBe(attendu);
  // Moitié gauche (rouge) de l'image stockée : en haut une fois la photo redressée
  const c = await couleurs(page, octets, [[10, 5], [10, 35]]);
  expect([c.w, c.h]).toEqual([20, 40]);
  expect(rouge(c.px[0]) && bleu(c.px[1])).toBe(true);
  expect(reseau).toEqual([]);
});

test('interface, réencodage : orientation appliquée, réduite, convertie en WebP, sans métadonnées', async ({ page }) => {
  await ouvrirImages(page);
  await page.evaluate(async () => { const fichiers = await Promise.all([Fab.jpegAvecMeta("grande.jpg", { w: 400, h: 200 })]); for (const f of fichiers) await MPDS.envoyer(f, 'images'); });
  await page.getByLabel('Redimensionner, compresser ou convertir').check();
  await page.getByLabel('Taille').selectOption('cote');
  await page.getByLabel('Pixels').fill('100');
  await page.getByLabel('Format').selectOption('webp');
  await traiter(page);
  await expect(page.locator('.img-resultat')).toContainText('50 × 100 px');   // 400 × 200 tournée d'un quart (orientation 6)
  await expect(page.locator('.img-avis')).toContainText('Converti en WebP.');
  const { nom, octets } = await telecharger(page, page.getByRole('button', { name: /^Télécharger « grande/ }));
  expect(nom).toBe('grande (optimisée).webp');
  expect(octets.subarray(8, 12).toString('latin1')).toBe('WEBP');
  for (const s of SECRETS_JPEG) expect(contient(octets, s), s).toBe(false);
  expect(contient(octets, 'Exif')).toBe(false);   // réencodé : aucun EXIF, pas même l'orientation
  // Orientation 6 : la moitié gauche (rouge) de la photo d'origine passe en haut
  const c = await couleurs(page, octets, [[25, 10], [25, 90]]);
  expect(rouge(c.px[0]) && bleu(c.px[1])).toBe(true);
});

test('réencodage plus lourd que l\'original nettoyé : l\'original est gardé, sans ses métadonnées', async ({ page }) => {
  await ouvrirImages(page);
  // Photo animée : la vidéo cachée (200 Ko) rend le fichier brut plus lourd que le réencodage ; la comparaison
  // doit se faire avec l'original SANS ses métadonnées
  await page.evaluate(async () => { const fichiers = await Promise.all([Fab.jpegAvecMeta("droite.jpg", { w: 200, h: 100, orientation: 1, bruit: true, video: 200000 })]); for (const f of fichiers) await MPDS.envoyer(f, 'images'); });
  await page.getByLabel('Redimensionner, compresser ou convertir').check();
  await page.getByRole('slider', { name: 'Qualité' }).fill('100');
  await traiter(page);
  await expect(page.locator('.img-avis')).toContainText('l\'original est gardé, sans ses métadonnées');
  const { nom, octets } = await telecharger(page, page.getByRole('button', { name: /^Télécharger/ }));
  expect(nom).toBe('droite (sans métadonnées).jpg');
  for (const s of [...SECRETS_JPEG, 'Exif']) expect(contient(octets, s), s).toBe(false);   // orientation 1 : aucun EXIF
});

test('lot : .zip aux noms dédoublonnés ; réglages modifiés : résultats retirés ; champ masqué non bloquant', async ({ page }) => {
  await ouvrirImages(page);
  await page.evaluate(async () => { const fichiers = await Promise.all([Fab.jpegAvecMeta("a.jpg"), Fab.pngAvecMeta("a.png"), Fab.jpegAvecMeta("A.jpg")]); for (const f of fichiers) await MPDS.envoyer(f, 'images'); });
  await traiter(page);
  await expect(page.locator('.img-resultat')).toHaveCount(3);
  const { nom, octets } = await telecharger(page, page.getByRole('button', { name: 'Tout télécharger (.zip)' }));
  expect(nom).toBe('images traitées.zip');
  const noms = await page.evaluate(async o => Object.keys((await JSZip.loadAsync(new Uint8Array(o))).files), [...octets]);
  expect(noms).toEqual(['a (sans métadonnées).jpg', 'a (sans métadonnées).png', 'A (sans métadonnées) (2).jpg']);

  // Un réglage change : les résultats ne correspondent plus, ils disparaissent
  await page.getByLabel('Redimensionner, compresser ou convertir').check();
  await expect(page.locator('.img-resultat')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Tout télécharger (.zip)' })).toBeHidden();
  // Valeur vidée puis retour au retrait seul : le champ masqué ne bloque pas le traitement
  await page.getByLabel('Taille').selectOption('cote');
  await page.getByLabel('Pixels').fill('');
  await page.getByLabel('Retirer les métadonnées seulement').check();
  await expect(page.getByLabel('Pixels')).toBeHidden();
  await traiter(page);
  await expect(page.locator('.img-resultat')).toHaveCount(3);
  // Retirer une image, puis tout retirer
  await page.getByRole('button', { name: 'Retirer « A.jpg »', exact: true }).click();
  await expect(page.locator('.img-item')).toHaveCount(2);
  await page.getByRole('button', { name: 'Tout retirer' }).click();
  await expect(page.locator('.img-item')).toHaveCount(0);
  await expect(page.locator('#img-depot')).toBeVisible();
});

test('erreurs : HEIC, fichier qui n\'est pas une image, image abîmée ; les autres images sont traitées', async ({ page }) => {
  await ouvrirImages(page);
  await page.evaluate(async () => {
    const heic = new Uint8Array([0, 0, 0, 20, ...new TextEncoder().encode('ftypheic\0\0\0\0mif1')]);
    const jpeg = new Uint8Array(await (await Fab.jpegAvecMeta('x.jpg')).arrayBuffer());
    const fichiers = [new File([heic], 'iphone.HEIC'), Fab.texte('notes.txt', 'bonjour'), new File([jpeg.subarray(0, 400)], 'abimee.jpg'), await Fab.pngAvecMeta('bonne.png')];
    for (const f of fichiers) await MPDS.envoyer(f, 'images');
  });
  await traiter(page);
  await expect(page.locator('#img-etat')).toContainText('1 image traitée, 3 en échec');
  await expect(page.locator('.img-erreur')).toHaveText([
    /^Format HEIC \(iPhone\)/,
    'Ce fichier n\'est pas une image reconnue (JPEG, PNG, WebP, GIF, BMP, AVIF).',
    /^Image illisible par ce navigateur/,
  ]);
  await expect(page.locator('.img-resultat')).toHaveCount(1);
});

test('passerelle : « Lire le texte » envoie l\'image traitée au module Convertir', async ({ page }) => {
  await ouvrirImages(page);
  await page.evaluate(async () => { const fichiers = await Promise.all([Fab.pngAvecMeta("scan.png")]); for (const f of fichiers) await MPDS.envoyer(f, 'images'); });
  await traiter(page);
  await page.getByRole('button', { name: /^Lire le texte de « scan/ }).click();
  await expect(page).toHaveURL(/#\/convertir$/);
  await expect(page.locator('.journal-nom')).toHaveText(['scan (sans métadonnées).png']);
});
