// Module PDF — gestion des pages : chaque action est vérifiée sur le PDF EXPORTÉ (intercepté au
// téléchargement puis relu avec PDF.js : nombre de pages, ordre, rotation).
'use strict';

const fs = require('fs');
const { test, expect, ouvrirApp } = require('./aide');
const { pdfChiffre, pdfChiffreAes256 } = require('./pdf-chiffre');

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

// Revue PR #2 : copyPages recopiait toute page visée par un lien ou un widget, même supprimée
test('une page supprimée ne reste pas dans le fichier, même visée par un lien ou un champ', async ({ page }) => {
  const P = require('@cantoo/pdf-lib');
  const doc = await P.PDFDocument.create(), ctx = doc.context, f = await doc.embedFont(P.StandardFonts.Helvetica);
  const pp = ['Garde un', 'Garde deux', 'SECRET'].map(t => { const p = doc.addPage([595, 842]); p.drawText(t, { x: 72, y: 700, size: 24, font: f }); return p; });
  const lien = (p, y, cible, action) => p.node.addAnnot(ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [72, y, 200, y + 20],
    ...(action ? { A: { S: 'GoTo', D: [cible.ref, 'Fit'] } } : { Dest: [cible.ref, 'Fit'] }) })));
  lien(pp[0], 640, pp[2]); lien(pp[0], 600, pp[2], true); lien(pp[0], 560, pp[1]);   // sommaire : vers la page retirée et vers une gardée
  // note (hors formulaire) dont /P vise la page retirée : chemin générique, sans aplatissement
  pp[0].node.addAnnot(ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Text', Rect: [400, 700, 420, 720], Contents: P.PDFString.of('note'), P: pp[2].ref })));
  const champ = doc.getForm().createTextField('reference');                         // même champ sur les pages 1 et 3 (/Kids)
  champ.setText('Valeur'); champ.addToPage(pp[0], { x: 72, y: 500, width: 200, height: 20 }); champ.addToPage(pp[2], { x: 72, y: 500, width: 200, height: 20 });
  await page.evaluate(o => MPDS.envoyer(new File([new Uint8Array(o)], 'sommaire.pdf'), 'pdf'), [...await doc.save()]);
  await expect(page.locator('.pdf-mini')).toHaveCount(3);
  await mini(page, 3).click();
  await bouton(page, 'Supprimer').click();
  await expect(page.locator('.pdf-mini')).toHaveCount(2);

  const [dl] = await Promise.all([page.waitForEvent('download'), bouton(page, 'Enregistrer le PDF').click()]);
  const octets = fs.readFileSync(await dl.path());
  const sortie = await P.PDFDocument.load(octets);
  const objets = sortie.context.enumerateIndirectObjects().map(([, o]) => o);
  const flux = objets.filter(o => o instanceof P.PDFRawStream).map(o => Buffer.from(P.decodePDFRawStream(o).decode()).toString('latin1')).join('\n');
  expect(flux).not.toMatch(/SECRET|534543524554/i);   // ni en clair ni en hexadécimal (encodage de drawText)
  const TYPE = P.PDFName.of('Type');
  expect(objets.filter(o => o instanceof P.PDFDict && String(o.get(TYPE)) === '/Page')).toHaveLength(2);   // aucun doublon de page
  // le lien vers la page gardée vise bien la page 2 du fichier exporté
  const dest = sortie.getPage(0).node.Annots().asArray().map(r => sortie.context.lookup(r)).map(a => a.lookup(P.PDFName.of('Dest'))).filter(Boolean);
  expect(dest).toHaveLength(1);
  expect(dest[0].get(0)).toBe(sortie.getPage(1).ref);
  expect(textes({ pages: await lire(page, octets) }).join(' ')).toContain('Valeur');   // valeur du champ aplatie
});

// Vrai pour chaque page où pdf-lib a dessiné (aplatissement) : il enveloppe alors /Contents dans un tableau (q … Q + ajout)
const dessinees = async o => { const P = require('@cantoo/pdf-lib'), d = await P.PDFDocument.load(o);
  return d.getPages().map(p => p.node.Contents() instanceof P.PDFArray); };
test('une modification faite pendant l\'export n\'est pas perdue : l\'indicateur reste allumé', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1500 });
  await ouvrirDoc(page, 'lent.pdf', 2);
  let liberer;
  const bloque = new Promise(r => { liberer = r; });
  await page.route('**/pdf-lib.min.js', async r => { await bloque; await r.continue(); });   // premier export : bibliothèque lente
  const telechargement = page.waitForEvent('download');
  await bouton(page, 'Enregistrer le PDF').click();
  await expect(page.locator('#pdf-etat')).toContainText('Préparation');
  await page.keyboard.press('h');                                           // surligneur sur la page affichée
  const c = await page.locator('#pdf-canvas').boundingBox();
  await page.mouse.move(c.x + 50, c.y + 50); await page.mouse.down(); await page.mouse.move(c.x + 200, c.y + 90, { steps: 5 }); await page.mouse.up();
  await expect(page.locator('.pdf-calque [data-type="surlig"]')).toHaveCount(1);
  await mini(page, 2).dragTo(mini(page, 1));                                // réordonné pendant l'export
  liberer();
  const octets = fs.readFileSync(await (await telechargement).path());
  expect(textes({ pages: await lire(page, octets) })).toEqual(['Page 1', 'Page 2']);   // état au moment du clic
  expect(await dessinees(octets)).toEqual([false, false]);                  // le surlignage n'y est pas non plus
  await expect(page.locator('#pdf-modif')).toHaveText('● Modifications non enregistrées');
  const [dl] = await Promise.all([page.waitForEvent('download'), bouton(page, 'Enregistrer le PDF').click()]);
  const apres = fs.readFileSync(await dl.path());
  expect(textes({ pages: await lire(page, apres) })).toEqual(['Page 2', 'Page 1']);   // le travail fait pendant l'export est bien là
  expect(await dessinees(apres)).toEqual([false, true]);
  await expect(page.locator('#pdf-modif')).toHaveText('');
});

// Revue PR #2 n° 8 : Cerfa récent, AES-256 (R6), flux d'objets et chaînes de champ chiffrées
test('PDF chiffré AES-256 (propriétaire seul) : champ lu, modifié, exporté', async ({ page }) => {
  const octets = await pdfChiffreAes256('Texte chiffre AES', 'dossier.numero', 'Valeur chiffree 42');
  expect(octets.toString('latin1')).not.toContain('Valeur chiffree');   // vraiment chiffré
  await page.evaluate(o => MPDS.envoyer(new File([new Uint8Array(o)], 'cerfa-aes.pdf'), 'pdf'), [...octets]);
  await expect(page.locator('#pdf-canvas')).toBeVisible();
  const champ = page.getByLabel('dossier.numero', { exact: true });
  await expect(champ).toHaveValue('Valeur chiffree 42');
  await champ.fill('Modifiee 43');
  await bouton(page, 'Pivoter à droite').click();
  const r = await exporter(page, 'Enregistrer le PDF');
  expect(rotations(r)).toEqual([90]);
  expect(r.pages[0].texte).toContain('Texte chiffre AES');
  expect(r.pages[0].texte).toContain('Modifiee 43');
});

// Revue PR #2 n° 5 : pivoter pendant le premier rendu de la miniature
test('miniature pivotée pendant son premier rendu : redessinée à la bonne rotation', async ({ page }) => {
  await page.evaluate(() => {   // le premier rendu de miniature (petit canvas) attend un feu vert
    const feu = new Promise(r => { window.__vert = r; });
    let retenu = false;
    const ombre = (o, nom, v) => Object.defineProperty(o, nom, { value: v });
    const ouvrir = MPDS.pdfjs.ouvrir;
    MPDS.pdfjs.ouvrir = async (...a) => {
      const t = await ouvrir(...a), p0 = t.promise;
      ombre(t, 'promise', p0.then(d => {
        const getPage = d.getPage.bind(d);
        d.getPage = n => getPage(n).then(pg => {
          const render = pg.render.bind(pg);
          pg.render = args => {
            const tache = render(args);
            if (!retenu && args.canvasContext.canvas.width < 400) { retenu = window.__retenu = true; const pr = tache.promise; ombre(tache, 'promise', feu.then(() => pr)); }
            return tache;
          };
          return pg;
        });
        return d;
      }));
      return t;
    };
  });
  await ouvrirDoc(page, 'm.pdf', 1);
  await page.waitForFunction(() => window.__retenu);
  await bouton(page, 'Pivoter à droite').click();
  await page.evaluate(() => window.__vert());
  await page.waitForFunction(() => { const c = document.querySelector('.pdf-mini canvas'); return c && c.width > c.height; }, null, { timeout: 5000 });
});
