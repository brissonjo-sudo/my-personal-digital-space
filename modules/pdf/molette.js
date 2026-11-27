// Module PDF — molette sur la page affichée. Ctrl + molette zoome le PDF, pas la page du navigateur ;
// la molette seule défile dans la page, puis passe à la page voisine une fois le bord atteint.
// Dépend de commun/coeur.js (MPDS). Utilisé par visionneuse.js.
(() => {
  'use strict';
  const SEUIL = 50;    // px cumulés : un cran de souris ≈ 100, le pavé tactile envoie de petits pas
  const CALME = 200;   // ms absorbées après un changement de page (prolongées tant que l'élan décroît)
  const pixels = e => e.deltaY * (e.deltaMode ? 40 : 1);   // deltaMode 1 (lignes, Firefox) ramené en pixels

  // zoomer(sens) : +1 / -1 ; page() : position (1-based) ; total() : 0 sans document ;
  // aller(n, arrivee) : arrivee 'haut' ou 'bas', position de défilement sur la nouvelle page
  function brancher(scene, { zoomer, page, total, aller }) {
    let zoom = 0, defil = 0, verrou = -Infinity, elan = 0;   // cumuls ; début du verrou ; dernier pas absorbé
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
      if (e.timeStamp - verrou < CALME) {   // juste après un changement de page : absorbé
        e.preventDefault();
        // Élan qui décroît : inertie du pavé tactile, absorbée jusqu'au bout. Crans réguliers de la
        // souris : le verrou n'est pas prolongé, la nouvelle page défile ensuite normalement.
        const v = Math.abs(pixels(e));
        if (v < elan) verrou = e.timeStamp;
        elan = v;
        return;
      }
      const bas = e.deltaY > 0, cible = page() + (bas ? 1 : -1);
      const auBord = bas ? scene.scrollTop + scene.clientHeight >= scene.scrollHeight - 1 : scene.scrollTop <= 0;
      if (!auBord || cible < 1 || cible > total()) { defil = 0; return; }   // défilement natif
      e.preventDefault();
      if (Math.sign(defil) !== Math.sign(e.deltaY)) defil = 0;
      defil += pixels(e);
      if (Math.abs(defil) < SEUIL) return;
      defil = 0; verrou = e.timeStamp; elan = Math.abs(pixels(e));
      aller(cible, bas ? 'haut' : 'bas');
    }, { passive: false });   // passive: false, sinon preventDefault est ignoré
  }

  MPDS.pdfMolette = { brancher };
})();
