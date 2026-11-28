// Module PDF — recherche pour le caviardage : occurrences d'un terme dans le texte d'une page (PDF.js
// getTextContent) et dans ses annotations (commentaires, valeurs de champs, liens), sans tenir compte de
// la casse, des accents ni des espaces : un nom coupé entre deux morceaux de texte ou sur deux lignes est
// trouvé. Zones en points PDF, avec une marge (la largeur de chaque caractère n'est qu'estimée).
// Contrôle aussi le fichier exporté (verifier). Publie MPDS.pdfRecherche.{ normaliser, chercherPage, verifier }.
(() => {
  'use strict';
  const normaliser = s => String(s).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/gu, '');

  // Largeur relative d'un caractère dans la famille de la police du texte (PDF.js : sans-serif, serif,
  // monospace…), pour placer la zone dans le morceau de texte
  let mesure = null;
  const largeurs = new Map();
  function largeur(c, famille) {
    const cle = famille + '\u0000' + c;
    if (!largeurs.has(cle)) {
      if (!mesure) mesure = document.createElement('canvas').getContext('2d');
      mesure.font = '100px ' + famille;
      largeurs.set(cle, mesure.measureText(c).width || 50);
    }
    return largeurs.get(cle);
  }
  const FAMILLES = /^(serif|sans-serif|monospace)$/;   // familles génériques seulement : pas de nom de police venu du fichier

  // Textes portés par une annotation PDF.js : commentaire, titre, valeur de champ, options, adresse de lien
  const textesAnnot = a => [a.contentsObj && a.contentsObj.str, a.titleObj && a.titleObj.str, a.fieldValue, a.url, a.unsafeUrl,
    a.alternativeText, ...(Array.isArray(a.textContent) ? a.textContent : []), ...(a.options || []).flatMap(o => [o.displayValue, o.exportValue])]
    .flat().filter(v => typeof v === 'string' && v);

  const boite = pts => {
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  };
  // Caractères j0..j1 d'un morceau de texte : rectangle le long de la ligne de base (texte tourné compris)
  function zoneTexte(it, j0, j1, famille) {
    const cs = [...it.str], ws = cs.map(c => largeur(c, famille)), somme = l => l.reduce((s, w) => s + w, 0), tot = somme(ws) || 1;
    const [a, b, c, d, e, f] = it.transform, lu = Math.hypot(a, b) || 1, ux = a / lu, uy = b / lu;
    const h = it.height || Math.hypot(c, d) || lu, L = it.width || 0.5 * lu * cs.length, m = 0.25 * h;
    const s0 = L * somme(ws.slice(0, j0)) / tot - m, s1 = L * somme(ws.slice(0, j1 + 1)) / tot + m, t0 = -0.3 * h, t1 = 1.05 * h;
    return boite([[s0, t0], [s1, t0], [s0, t1], [s1, t1]].map(([s, t]) => [e + ux * s - uy * t, f + uy * s + ux * t]));
  }
  const zoneRect = r => boite([[r[0] - 1, r[1] - 1], [r[2] + 1, r[3] + 1]]);

  // Une occurrence répartie sur plusieurs morceaux de la même ligne (PDF.js coupe souvent aux espaces) :
  // zones soudées en une seule barre, sans interstice. Deux zones se soudent si elles se recouvrent pour
  // moitié dans un sens et sont à moins d'une demi-épaisseur l'une de l'autre dans l'autre (texte tourné compris).
  function souder(zones) {
    const recouvre = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0);
    const voisines = (a, b) => [[a.x, a.w, a.y, a.h, b.x, b.w, b.y, b.h], [a.y, a.h, a.x, a.w, b.y, b.h, b.x, b.w]].some(([p, pl, q, ql, P, PL, Q, QL]) =>
      recouvre(q, q + ql, Q, Q + QL) >= 0.5 * Math.min(ql, QL) && recouvre(p, p + pl, P, P + PL) >= -0.5 * Math.min(ql, QL));
    const r = [];
    for (const z of zones) {
      const v = r.find(x => voisines(x, z));
      if (!v) { r.push({ ...z }); continue; }
      const b = boite([[v.x, v.y], [v.x + v.w, v.y + v.h], [z.x, z.y], [z.x + z.w, z.y + z.h]]);
      Object.assign(v, b);
    }
    return r;
  }

  // cible : terme déjà normalisé → { zones, n (occurrences), sansTexte (aucune couche de texte : scan) }
  async function chercherPage(p, cible) {
    const tc = await p.getTextContent(), items = tc.items.filter(it => typeof it.str === 'string');
    const famille = it => { const f = (tc.styles[it.fontName] || {}).fontFamily; return FAMILLES.test(f) ? f : 'sans-serif'; };
    let texte = '';
    const carte = [];   // position dans le texte normalisé → [morceau, caractère]
    items.forEach((it, i) => [...it.str].forEach((c, j) => { for (const n of normaliser(c)) { texte += n; carte.push([i, j]); } }));
    const zones = [];
    let n = 0;
    for (let k = cible ? texte.indexOf(cible) : -1; k >= 0; k = texte.indexOf(cible, k + cible.length)) {
      n++;
      const parMorceau = new Map();
      for (let q = k; q < k + cible.length; q++) {
        const [i, j] = carte[q], z = parMorceau.get(i);
        parMorceau.set(i, z ? [Math.min(z[0], j), Math.max(z[1], j)] : [j, j]);
      }
      zones.push(...souder([...parMorceau].map(([i, [j0, j1]]) => zoneTexte(items[i], j0, j1, famille(items[i])))));
    }
    for (const a of await p.getAnnotations()) {
      if (cible && a.rect && textesAnnot(a).some(t => normaliser(t).includes(cible))) { n++; zones.push(zoneRect(a.rect)); }
    }
    return { zones, n, sansTexte: !texte };
  }

  // Fichier exporté relu par PDF.js. pages : [{ trame, sansTexte }] dans l'ordre du fichier.
  // Page caviardée sans annotation de texte de l'utilisateur : aucun texte ne doit y rester (sinon : refus).
  // Termes recherchés encore lisibles sur les autres pages (zone retirée exprès) : signalés dans avis.
  async function verifier(octets, pages, termes, avis) {
    const doc = await (await MPDS.pdfjs.ouvrir(octets.slice().buffer)).promise;
    try {
      const restes = new Map();
      for (const [k, info] of pages.entries()) {
        const p = await doc.getPage(k + 1);
        const texte = normaliser((await p.getTextContent()).items.map(i => i.str || '').join(''));
        if (info.trame) {
          if (info.sansTexte && texte) throw new Error('page ' + (k + 1) + ' caviardée : du texte y est encore lisible.');
          continue;
        }
        const annots = (await p.getAnnotations()).flatMap(textesAnnot).map(normaliser).join('\n');
        for (const t of termes) if (texte.includes(normaliser(t)) || annots.includes(normaliser(t))) restes.set(t, [...(restes.get(t) || []), k + 1]);
      }
      for (const [t, l] of restes) avis.push('« ' + t + ' » ' + LISIBLE + ', page' + (l.length > 1 ? 's ' : ' ') + l.join(', ') + '.');
    } finally { doc.destroy(); }
  }

  const LISIBLE = 'reste lisible en clair';   // repère de l'avis, affiché comme une erreur (actions.js)
  MPDS.pdfRecherche = { normaliser, chercherPage, verifier, LISIBLE };
})();
