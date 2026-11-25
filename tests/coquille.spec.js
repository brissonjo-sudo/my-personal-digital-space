// Coquille MPDS : routeur par hash, montage unique des modules, passerelle de fichiers.
'use strict';

const { test, expect, ouvrirApp } = require('./aide');

test('route par défaut : Convertir, monté, seule entrée du rail', async ({ page }) => {
  await ouvrirApp(page);
  expect(await page.evaluate(() => location.hash)).toBe('#/convertir');
  await expect(page.locator('section[data-module="convertir"]')).toBeVisible();
  await expect(page.locator('#zone-depot')).toBeVisible();
  await expect(page.locator('.rail-lien')).toHaveCount(1);
  await expect(page.locator('.rail-lien')).toHaveAttribute('aria-current', 'page');
  await expect(page).toHaveTitle('My Personal Digital Space');
});

test('route inconnue : retour à Convertir', async ({ page }) => {
  await page.goto('index.html#/nexiste-pas');
  await page.waitForFunction(() => document.getElementById('zone-depot'));
  expect(await page.evaluate(() => location.hash)).toBe('#/convertir');
  await expect(page.locator('#zone-depot')).toBeVisible();
});

test('le module n\'est monté qu\'une fois, même après des changements de route', async ({ page }) => {
  await ouvrirApp(page);
  await page.evaluate(() => traiterFichiers([Fab.texte('a.txt', 'x')]));
  await expect(page.locator('.journal-item')).toHaveClass(/ok/);
  for (const hash of ['#/inconnu', '#/convertir', '#/autre']) {
    await page.evaluate(h => { location.hash = h; }, hash);
    await page.waitForFunction(() => location.hash === '#/convertir');
  }
  expect(await page.evaluate(() => MPDS.montages.get('convertir'))).toBe(1);
  await expect(page.locator('#zone-depot')).toHaveCount(1);
  await expect(page.locator('.journal-item')).toHaveCount(1);   // journal conservé
});

test('MPDS.envoyer remet un fichier au module', async ({ page }) => {
  await ouvrirApp(page);
  const r = await page.evaluate(async () => {
    await MPDS.envoyer(Fab.texte('envoye.csv', 'a,b\n1,2\n'), 'convertir');
    return __resume();
  });
  expect(r.journal.map(j => `${j.nom}:${j.statut}`)).toEqual(['envoye.csv:ok']);
  expect(r.resultats[0].md).toContain('| 1 | 2 |');
  const erreur = await page.evaluate(() => { try { MPDS.envoyer(Fab.texte('x.txt', 'x'), 'pdf'); } catch (e) { return e.message; } });
  expect(erreur).toMatch(/Module inconnu/);
});
