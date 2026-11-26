// Passerelle PDF → Markdown : le document tel qu'affiché dans le module PDF (pages modifiées
// comprises) est remis en mémoire au module Convertir, sous son nom d'origine.
'use strict';

const P = require('@cantoo/pdf-lib');
const { test, expect, ouvrirApp } = require('./aide');

test.beforeEach(async ({ page }) => { await ouvrirApp(page); });

const bouton = page => page.getByRole('button', { name: 'Convertir en Markdown', exact: true });

test('désactivé tant qu\'aucun PDF n\'est ouvert', async ({ page }) => {
  await page.evaluate(() => { location.hash = '#/pdf'; });
  await expect(bouton(page)).toBeDisabled();
});

test('le PDF modifié part au convertisseur, sans téléchargement', async ({ page }) => {
  let telechargements = 0;
  page.on('download', () => telechargements++);
  await page.evaluate(() => MPDS.envoyer(Fab.pdf('Arrêté voirie.pdf', [
    [{ t: 'Article premier stationnement', x: 72, y: 700 }],
    [{ t: 'Page retiree avant conversion', x: 72, y: 700 }],
  ]), 'pdf'));
  await expect(page.locator('.pdf-mini')).toHaveCount(2);
  await page.locator('.pdf-mini[data-page="2"]').click();
  await page.getByRole('button', { name: 'Supprimer', exact: true }).click();
  await expect(page.locator('.pdf-mini')).toHaveCount(1);

  await bouton(page).click();
  await page.waitForFunction(() => MPDS.actif() === 'convertir' && __resume().journal.length === 1 && __resume().journal[0].statut !== 'en-cours');
  const r = await page.evaluate(() => __resume());
  expect(r.journal[0]).toMatchObject({ nom: 'Arrêté voirie.pdf', statut: 'ok' });
  expect(r.resultats[0].md).toContain('Article premier stationnement');
  expect(r.resultats[0].md).not.toContain('Page retiree');
  expect(telechargements).toBe(0);

  // Le document reste ouvert dans le module PDF
  await page.evaluate(() => { location.hash = '#/pdf'; });
  await expect(page.locator('.pdf-mini')).toHaveCount(1);
});

// Revue PR #6 : le convertisseur choisit d'après l'extension ; un PDF sans « .pdf » doit quand même y passer
test('un PDF nommé sans extension part au convertisseur PDF', async ({ page }) => {
  await page.evaluate(() => MPDS.envoyer(new File([Fab.pdf('x.pdf', [[{ t: 'Courrier scanne numero un', x: 72, y: 700 }]])], 'Scan_0001'), 'pdf'));
  await expect(page.locator('#pdf-canvas')).toBeVisible();
  await bouton(page).click();
  await page.waitForFunction(() => MPDS.actif() === 'convertir' && __resume().journal.length === 1 && __resume().journal[0].statut !== 'en-cours');
  const r = await page.evaluate(() => __resume());
  expect(r.journal[0]).toMatchObject({ nom: 'Scan_0001.pdf', statut: 'ok' });
  expect(r.resultats[0].md).toContain('Courrier scanne numero un');
});

// Revue PR #6 n° 2 : le texte d'un tampon posé sur un scan ne doit pas faire passer la page pour une page texte
test('scan tamponné : la page reste un scan et l\'OCR est proposé', async ({ page }) => {
  test.setTimeout(180_000);   // OCR réel
  await page.evaluate(async () => MPDS.envoyer(await Fab.pdfScanne('courrier.pdf', [['Courrier de la voirie']]), 'pdf'));
  await expect(page.locator('#pdf-canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Tampon (P)', exact: true }).click();
  await page.locator('#pdf-tampon').selectOption({ label: 'Comptabilisé le' });
  await page.locator('#pdf-date').fill('26/11/2026');
  const s = page.locator('.pdf-calque');
  await s.click({ position: { x: 300, y: 300 } });
  await expect(page.locator('.pdf-calque [data-type="tampon"]')).toHaveCount(1);

  await bouton(page).click();
  await page.waitForFunction(() => MPDS.actif() === 'convertir' && __resume().journal.length === 1 && __resume().journal[0].statut !== 'en-cours');
  const r = await page.evaluate(() => __resume());
  expect(r.resultats[0].md).toContain('COMPTABILISÉ LE 26/11/2026');   // texte du tampon gardé
  expect(r.journal[0].statut).toBe('warn');
  await page.locator('.journal-actions-item button', { hasText: 'OCR' }).click();
  await expect(page.locator('.journal-item').last()).toHaveClass(/ok/, { timeout: 100_000 });
  expect(await page.evaluate(() => resultats[resultats.length - 1].md)).toContain('Courrier de la voirie');   // lu par l'OCR
});

// Revue PR #6 n° 3 : les avertissements sur le contenu suivent le fichier dans le journal de Convertir ;
// ceux qui ne concernent que le fichier PDF (formulaire figé, métadonnées) restent dans le module PDF
test("avertissements sur le contenu (XFA abandonné) visibles dans le journal de Convertir", async ({ page }) => {
  const doc = await P.PDFDocument.create(), p = doc.addPage([595, 842]);
  doc.preserveXFA = true; doc.setTitle('Titre du dossier');
  p.drawText('Demande de permis', { x: 72, y: 760, size: 18 });
  const form = doc.getForm(), f = form.createTextField('nom'); f.addToPage(p, { x: 72, y: 700, width: 200, height: 20 });
  form.acroForm.dict.set(P.PDFName.of('XFA'), doc.context.obj([P.PDFString.of('template'), doc.context.register(doc.context.stream('<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/"/>'))]));
  const octets = Buffer.from(await doc.save());
  await page.evaluate(o => MPDS.envoyer(new File([new Uint8Array(o)], 'permis.pdf'), 'pdf'), [...octets]);
  await expect(page.locator('#pdf-canvas')).toBeVisible();
  await page.getByLabel('nom', { exact: true }).fill('Dupont');
  await bouton(page).click();
  await page.waitForFunction(() => MPDS.actif() === 'convertir' && __resume().journal.length === 1 && __resume().journal[0].statut !== 'en-cours');
  const r = await page.evaluate(() => __resume());
  expect(r.journal[0].statut).toBe('ok');
  expect(r.journal[0].msg).toContain('Converti → permis.md');
  expect(r.journal[0].msg).toContain('la partie XFA est abandonnée');
  expect(r.journal[0].msg).not.toContain('Non conservés');   // métadonnées : ne concerne que le fichier PDF
  expect(r.resultats[0].md).toContain('Dupont');
  await page.evaluate(() => { location.hash = '#/pdf'; });   // le message complet reste dans le module PDF
  await expect(page.locator('#pdf-etat')).toContainText('Non conservés');
});
