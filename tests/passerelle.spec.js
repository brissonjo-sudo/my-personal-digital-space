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
