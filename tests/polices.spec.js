// Polices auto-hébergées : elles se chargent depuis l'application et aucune requête ne part vers un domaine de polices.
'use strict';

const { test, expect, ouvrirApp } = require('./aide');

test('Source Serif 4 et Source Sans 3 se chargent localement, sans domaine externe', async ({ page }) => {
  const externes = [];
  page.on('request', r => { if (/fonts\.(googleapis|gstatic)\.com|fontsource|typekit/.test(r.url())) externes.push(r.url()); });
  await ouvrirApp(page);
  const r = await page.evaluate(async () => {
    await Promise.all(['600 16px "Source Serif 4"', '400 16px "Source Sans 3"', '600 16px "Source Sans 3"'].map(f => document.fonts.load(f)));
    await document.fonts.ready;
    return ['600 16px "Source Serif 4"', '400 16px "Source Sans 3"', '600 16px "Source Sans 3"'].map(f => document.fonts.check(f));
  });
  expect(r).toEqual([true, true, true]);
  const titre = await page.evaluate(() => getComputedStyle(document.querySelector('.app > header h1')).fontFamily);
  expect(titre).toContain('Source Serif 4');
  expect(externes).toEqual([]);
});
