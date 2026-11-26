// Module PDF — gabarit HTML statique (aucune donnée de fichier) : en-tête (document, navigation, actions),
// bande d'outils, bandeau de formulaire, état vide, panneau « Pages » et scène. Les boutons d'outils et
// d'actions de page sont ajoutés par outils.js et actions.js dans #pdf-barre-annot, #pdf-barre-pages et
// #pdf-barre-doc. Publie MPDS.pdfGabarit() → texte HTML.
(() => {
  'use strict';
  const i = (nom, t) => MPDS.icones.svg(nom, t);

  MPDS.pdfGabarit = () => `
<div class="pdf-module" data-etat="vide">
  <header class="pdf-entete">
    <div class="pdf-doc">
      <h1 class="pdf-titre-vide">PDF</h1>
      <span class="pdf-nom" id="pdf-nom"></span>
      <span class="pdf-meta"><span class="pdf-nb" id="pdf-nb"></span><span id="pdf-modif" class="pdf-modif" role="status"></span></span>
    </div>
    <div class="pdf-outils" id="pdf-outils" hidden>
      <button type="button" class="pdf-btn pdf-btn-icone" id="pdf-prec" aria-label="Page précédente">${i('precedent')}</button>
      <input type="number" class="pdf-num" id="pdf-num" min="1" value="1" aria-label="Numéro de page">
      <span id="pdf-total">/ 1</span>
      <button type="button" class="pdf-btn pdf-btn-icone" id="pdf-suiv" aria-label="Page suivante">${i('suivant')}</button>
      <span class="pdf-sep" aria-hidden="true"></span>
      <button type="button" class="pdf-btn pdf-btn-icone" id="pdf-moins" aria-label="Zoom arrière">${i('zoom-moins')}</button>
      <output id="pdf-zoom" aria-label="Niveau de zoom">100 %</output>
      <button type="button" class="pdf-btn pdf-btn-icone" id="pdf-plus" aria-label="Zoom avant">${i('zoom-plus')}</button>
      <button type="button" class="pdf-btn" id="pdf-largeur">${i('largeur')} Ajuster à la largeur</button>
    </div>
    <div class="pdf-entete-actions" id="pdf-barre-doc">
      <button type="button" class="pdf-btn" id="pdf-ouvrir">${i('ouvrir')} Ouvrir un PDF</button>
      <input type="file" id="pdf-fichier" accept=".pdf,application/pdf" hidden>
    </div>
  </header>
  <div class="pdf-barre-annot" id="pdf-barre-annot" role="toolbar" aria-label="Annotations"></div>
  <div class="pdf-bandeau" id="pdf-bandeau-form" role="status" hidden></div>
  <div class="pdf-etat" id="pdf-etat" role="status" aria-live="polite"></div>
  <div class="pdf-corps">
    <aside class="pdf-pages" aria-label="Pages">
      <div class="pdf-pages-tete">
        <h2>Pages</h2>
        <div class="pdf-pages-actions" id="pdf-barre-pages" role="toolbar" aria-label="Actions sur les pages"></div>
      </div>
      <nav class="pdf-miniatures" id="pdf-miniatures" aria-label="Pages du document"></nav>
    </aside>
    <button type="button" class="pdf-vide" id="pdf-vide">
      ${i('pdf', 40)}
      <span class="pdf-vide-titre">Ouvrir un PDF</span>
      <span>Cliquez ici ou glissez un fichier PDF sur cette page. Il reste sur votre appareil.</span>
    </button>
    <div class="pdf-scene" id="pdf-scene" tabindex="0" aria-label="Page du document"></div>
  </div>
</div>`;
})();
