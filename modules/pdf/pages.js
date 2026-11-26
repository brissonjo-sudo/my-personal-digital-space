// Module PDF — modèle des pages affichées. Aucune écriture de PDF ici : la liste décrit ce que
// l'on voit, et l'export (export.js) reconstruit un PDF neuf à partir d'elle.
//   source : { nom, doc (document PDF.js), octets (ArrayBuffer d'origine) }
//   page   : { source, index (0-based dans sa source), rotation (pivotement ajouté, 0/90/180/270),
//              annots (annotations figées à l'export, en points PDF : voir annotations.js) }
// Publie MPDS.pdfPages.creer().
(() => {
  'use strict';

  function creer() {
    const liste = [], sources = [], selection = new Set();   // selection : pages cochées (par identité)
    let modifie = false, version = 0;   // version : incrémentée à chaque modification
    const toucher = () => { modifie = true; version++; };

    const normaliser = r => ((r % 360) + 360) % 360;
    const vider = () => {
      for (const s of sources) s.doc.destroy().catch(() => {});
      sources.length = 0; liste.length = 0; selection.clear(); modifie = false;
    };
    const ajouter = source => {
      sources.push(source);
      for (let i = 0; i < source.doc.numPages; i++) liste.push({ source, index: i, rotation: 0, annots: [] });
      toucher();
    };

    return {
      liste, sources, selection,
      get modifie() { return modifie; },
      get version() { return version; },
      // Export réussi de l'état `v` : l'indicateur ne s'éteint que si rien n'a changé depuis
      enregistre(v) { if (v === version) modifie = false; },
      marquerModifie: toucher,
      vider,
      // Nouveau document principal : remplace tout (les anciens documents PDF.js sont détruits)
      ouvrir(source) { vider(); ajouter(source); modifie = false; },
      ajouter,
      // Pages visées par une action : la sélection si elle existe, sinon la page courante (1-based)
      cibles: courante => selection.size ? liste.filter(p => selection.has(p)) : liste.slice(courante - 1, courante),
      pivoter(pages, delta) { for (const p of pages) p.rotation = normaliser(p.rotation + delta); if (pages.length) toucher(); },
      supprimer(pages) {
        const retirees = new Set(pages);
        if (!retirees.size) return;
        if (liste.every(p => retirees.has(p))) throw new Error('Impossible de supprimer la dernière page du document.');
        for (let i = liste.length - 1; i >= 0; i--) if (retirees.has(liste[i])) { selection.delete(liste[i]); liste.splice(i, 1); }
        toucher();
      },
      // Place la page à la position `vers` (0-based, bornée)
      deplacer(page, vers) {
        const de = liste.indexOf(page), a = Math.min(liste.length - 1, Math.max(0, vers));
        if (de < 0 || de === a) return;
        liste.splice(de, 1); liste.splice(a, 0, page);
        toucher();
      },
      cocher(page, oui) { if (oui) selection.add(page); else selection.delete(page); },
    };
  }

  MPDS.pdfPages = { creer };
})();
