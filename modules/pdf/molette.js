// Module PDF — molette sur la page affichée. Ctrl + molette zoome le PDF, pas la page du navigateur ;
// la molette seule défile dans la page, puis passe à la page voisine une fois le bord atteint.
// Dépend de commun/coeur.js (MPDS). Utilisé par visionneuse.js.
(() => {
  'use strict';
  const SEUIL = 50;    // px cumulés : un cran de souris ≈ 100, le pavé tactile envoie de petits pas
  const CALME = 200;   // ms sans molette après un changement de page : l'inertie du pavé n'en tourne pas d'autres
  const pixels = e => e.deltaY * (e.deltaMode ? 40 : 1);   // deltaMode 1 (lignes, Firefox) ramené en pixels

  // zoomer(sens) : +1 / -1 ; page() : position (1-based) ; total() : 0 sans document ;
  // aller(n, arrivee) : arrivee 'haut' ou 'bas', position de défilement sur la nouvelle page
  function brancher(scene, { zoomer, page, total, aller }) {
    let zoom = 0, defil = 0, verrou = -Infinity;   // cumuls ; instant du dernier événement du geste en cours
    scene.addEventListener('wheel', e => {
      if (!total()) return;
      if (e.ctrlKey) {   // pincement du pavé tactile compris : il arrive en ctrlKey
        e.preventDefault();
        zoom += pixels(e);
        if (Math.abs(zoom) < SEUIL) return;
        zoomer(zoom < 0 ? 1 : -1);
        zoom = 0;
        return;
      }
      if (e.shiftKey || !e.deltaY || Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.target.tagName === 'TEXTAREA') return;
      if (e.timeStamp - verrou < CALME) { verrou = e.timeStamp; e.preventDefault(); return; }   // même geste : absorbé
      const bas = e.deltaY > 0, cible = page() + (bas ? 1 : -1);
      const auBord = bas ? scene.scrollTop + scene.clientHeight >= scene.scrollHeight - 1 : scene.scrollTop <= 0;
      if (!auBord || cible < 1 || cible > total()) { defil = 0; return; }   // défilement natif
      e.preventDefault();
      if (Math.sign(defil) !== Math.sign(e.deltaY)) defil = 0;
      defil += pixels(e);
      if (Math.abs(defil) < SEUIL) return;
      defil = 0; verrou = e.timeStamp;
      aller(cible, bas ? 'haut' : 'bas');
    }, { passive: false });   // passive: false, sinon preventDefault est ignoré
  }

  MPDS.pdfMolette = { brancher };
})();
