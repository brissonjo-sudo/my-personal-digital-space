// Passerelle PDF → Markdown : le document tel qu'affiché dans le module PDF (pages modifiées
// comprises) est remis en mémoire au module Convertir, sous son nom d'origine.
'use strict';

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
