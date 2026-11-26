// Module PDF — conversion de coordonnées : point de l'affichage → point PDF. Fonction pure,
// prévue pour les annotations (étape 4). Publie MPDS.pdfCoord.
(() => {
  'use strict';

  // pageInfo : { view: [x0, y0, x1, y1], rotation }
  //   view     = page.view de PDF.js (CropBox ∩ MediaBox, en points PDF, éventuellement décalée)
  //   rotation = rotation APPLIQUÉE à l'affichage (/Rotate de la page + pivotement éventuel), 0/90/180/270
  // (x, y) : point du viewport PDF.js à l'échelle 1 (origine en haut à gauche, y vers le bas).
  // Renvoie { x, y } dans l'espace utilisateur PDF (origine en bas à gauche de la MediaBox) :
  // celui où dessinent drawText / drawRectangle, quelle que soit la rotation.
  function versPdf(pageInfo, x, y) {
    const [x0, y0, x1, y1] = pageInfo.view;
    switch ((((pageInfo.rotation || 0) % 360) + 360) % 360) {
      case 0:   return { x: x0 + x, y: y1 - y };
      case 90:  return { x: x0 + y, y: y0 + x };
      case 180: return { x: x1 - x, y: y0 + y };
      case 270: return { x: x1 - y, y: y1 - x };
      default:  throw new Error('rotation non multiple de 90 : ' + pageInfo.rotation);
    }
  }

  // Raccourci pour une page PDF.js, avec un pivotement supplémentaire éventuel
  const infoPage = (page, pivot = 0) => ({ view: page.view, rotation: page.rotate + pivot });

  MPDS.pdfCoord = { versPdf, infoPage };
})();
