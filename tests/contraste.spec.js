// Contrastes WCAG des jetons de commun/style.css, calculés sur les valeurs réellement appliquées,
// en thème clair et en thème sombre : 4,5:1 pour le texte, 3:1 pour les bordures de contrôles et le focus.
'use strict';

const { test, expect, ouvrirApp } = require('./aide');

const TEXTE = [   // [encre, fond]
  ['text', 'bg'], ['text', 'surface'], ['text', 'stage'], ['text', 'fond-2'], ['text', 'accent-fond'],
  ['muted', 'bg'], ['muted', 'surface'], ['muted', 'stage'], ['muted', 'fond-2'], ['muted', 'accent-fond'],
  ['accent-ink', 'accent'], ['accent-ink', 'accent-h'], ['accent-fort', 'accent-fond'], ['accent-fort', 'surface'],
  ['lien', 'surface'], ['lien', 'stage'], ['lien', 'accent-fond'],
  ['ok', 'surface'], ['warn', 'surface'], ['warn', 'bg'], ['err', 'surface'], ['err', 'note-fond'],
  ['note-texte', 'note-fond'], ['rail-ink', 'rail'], ['rail-faible', 'rail'], ['rail-actif-ink', 'rail-actif'],
  ['page-texte', 'champ-fond'], ['champ-off-texte', 'champ-off'],
];
const NON_TEXTE = [  // [trait, fond]
  ['bord-ctrl', 'bg'], ['bord-ctrl', 'surface'], ['bord-ctrl', 'stage'], ['focus', 'bg'], ['focus', 'surface'], ['focus', 'stage'],
  ['accent-fort', 'accent-fond'], ['rail-focus', 'rail'], ['rail-focus', 'rail-actif'], ['page-accent', 'page'], ['page-accent', 'champ-fond'],
];

for (const schema of ['light', 'dark']) {
  test(`contrastes des jetons, thème ${schema}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: schema });
    await ouvrirApp(page);
    const rgb = await page.evaluate(noms => {
      const sonde = document.createElement('i');
      document.body.append(sonde);
      const sortie = {};
      for (const n of noms) { sonde.style.color = `var(--${n})`; sortie[n] = getComputedStyle(sonde).color.match(/[\d.]+/g).map(Number); }
      sonde.remove();
      return sortie;
    }, [...new Set([...TEXTE, ...NON_TEXTE].flat())]);
    const lum = ([r, g, b]) => [r, g, b].map(v => (v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
      .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
    const ratio = (a, b) => { const [x, y] = [lum(rgb[a]), lum(rgb[b])].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    for (const [a, b] of TEXTE) expect(ratio(a, b), `texte ${a} sur ${b}`).toBeGreaterThanOrEqual(4.5);
    for (const [a, b] of NON_TEXTE) expect(ratio(a, b), `trait ${a} sur ${b}`).toBeGreaterThanOrEqual(3);
  });
}
