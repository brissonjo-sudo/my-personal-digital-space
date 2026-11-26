'use strict';
// Icônes de MPDS : SVG au trait (24 × 24, currentColor), décoratives (aria-hidden) ; le nom accessible
// vient toujours du bouton ou du lien qui les porte. Aucune bibliothèque. Script classique, chargé après coeur.js.
//   MPDS.icones.creer(nom, taille) → élément <svg> (createElementNS) ; MPDS.icones.svg(nom, taille) → texte
//   pour les gabarits statiques (jamais de données de fichier).
(() => {
  const DOC = 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z';
  const CHEMINS = {
    convertir: [DOC, 'M14 3v5h5M9 13h6M9 17h4'],
    pdf: [DOC, 'M14 3v5h5M9 16l2-2 4 4'],
    images: ['M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M7 10a2 2 0 1 0 4 0 2 2 0 1 0-4 0', 'M21 16l-5-5-9 9'],
    texte: ['M4 7V5h16v2M9 19h6M12 5v14'],
    selection: ['M5 3l14 8-6 2-2 6z'],
    surligneur: ['M9 11l-5 5v4h4l5-5M9 11l6-6 4 4-6 6M9 11l4 4'],
    dessin: ['M16 3l5 5L8 21H3v-5z'],
    gomme: ['M20 20H9L4 15l10-10 7 7-8 8M7 12l7 7'],
    signature: ['M3 17c3-6 5-6 6-2s3 4 5-1 4-3 4 0M3 21h18'],
    tampon: ['M9 3h6l-1 7h4a2 2 0 0 1 2 2v3H4v-3a2 2 0 0 1 2-2h4zM4 19h16'],
    annuler: ['M9 14L4 9l5-5', 'M4 9h11a5 5 0 0 1 0 10h-3'],
    retablir: ['M15 14l5-5-5-5', 'M20 9H9a5 5 0 0 0 0 10h3'],
    'pivoter-gauche': ['M4 4v6h6', 'M4 10a8 8 0 1 1-1 6'],
    'pivoter-droite': ['M20 4v6h-6', 'M20 10a8 8 0 1 0 1 6'],
    monter: ['M12 19V5M5 12l7-7 7 7'],
    descendre: ['M12 5v14M5 12l7 7 7-7'],
    supprimer: ['M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13'],
    ajouter: ['M12 5v14M5 12h14'],
    extraire: [DOC, 'M12 18v-6M9.5 14.5L12 12l2.5 2.5'],
    enregistrer: ['M5 3h11l3 3v15H5z', 'M8 3v5h7V3M8 21v-7h8v7'],
    markdown: ['M3 6h18v12H3z', 'M7 15V9l2.5 3L12 9v6M17 9v6m0 0l-2-2m2 2l2-2'],
    precedent: ['M15 6l-6 6 6 6'],
    suivant: ['M9 6l6 6-6 6'],
    'zoom-moins': ['M5 12h14'],
    'zoom-plus': ['M12 5v14M5 12h14'],
    largeur: ['M3 5v14M21 5v14M7 12h10M10 9l-3 3 3 3M14 9l3 3-3 3'],
    ouvrir: ['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'],
    deposer: ['M12 16V4M7 9l5-5 5 5M4 20h16'],
    telecharger: ['M12 4v12M7 11l5 5 5-5M4 20h16'],
    apercu: ['M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z', 'M9 12a3 3 0 1 0 6 0 3 3 0 1 0-6 0'],
    copier: ['M9 9h10v11H9z', 'M5 15V4h10'],
    fermer: ['M6 6l12 12M18 6L6 18'],
    ocr: ['M4 8V5h3M17 5h3v3M20 16v3h-3M7 19H4v-3M7 12h10'],
    verrou: ['M6 11h12v9H6z', 'M8 11V8a4 4 0 0 1 8 0v3'],
    ok: ['M3 12a9 9 0 1 0 18 0 9 9 0 1 0-18 0', 'M8 12l3 3 5-6'],
    attention: ['M12 3l10 18H2z', 'M12 10v4M12 17.5v.5'],
    erreur: ['M3 12a9 9 0 1 0 18 0 9 9 0 1 0-18 0', 'M9 9l6 6M15 9l-6 6'],
    attente: ['M3 12a9 9 0 1 0 18 0 9 9 0 1 0-18 0', 'M12 7v5l3 2'],
  };
  const NS = 'http://www.w3.org/2000/svg';

  function creer(nom, taille = 18) {
    const svg = document.createElementNS(NS, 'svg');
    for (const [k, v] of Object.entries({
      viewBox: '0 0 24 24', width: taille, height: taille, fill: 'none', stroke: 'currentColor',
      'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: 'icone', focusable: 'false',
    })) svg.setAttribute(k, v);
    for (const d of CHEMINS[nom] || []) {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', d);
      svg.append(p);
    }
    return svg;
  }
  const svg = (nom, taille = 18) => creer(nom, taille).outerHTML;

  MPDS.icones = { creer, svg };
})();
