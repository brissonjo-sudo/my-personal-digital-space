// Module PDF — trame : une page rendue en image (PDF.js), avec les zones caviardées peintes en noir DANS
// les pixels. Sert au caviardage (export.js) : la page exportée ne garde ni texte, ni police, ni
// annotation d'origine, seulement cette image. Rendu dans le repère de la page sans rotation : un pixel
// (u, v) correspond au point PDF (x0 + u / s, y1 − v / s), view = [x0, y0, x1, y1].
// Sert aussi à la compression (pages en image) : o = { dpi, qualite, verbe } remplace les valeurs du caviardage.
// Publie MPDS.pdfTrame.rendre(pagePdfjs, zones, avis, nomPage, o) → { jpeg (Uint8Array), view }.
(() => {
  'use strict';
  const DPI = 200, DPI_MIN = 72, MAX_PIXELS = 40e6, QUALITE = 0.92;

  // zones : [{ x, y, w, h }] en points PDF (coin bas-gauche)
  async function rendre(p, zones, avis, nomPage, o = {}) {
    const voulu = o.dpi || DPI, verbe = o.verbe || 'caviardée';
    const view = p.view, lp = view[2] - view[0], hp = view[3] - view[1];
    // Grande page : résolution baissée pour rester sous la limite du canvas (sinon page blanche en silence)
    let dpi = Math.min(voulu, 72 * Math.sqrt(MAX_PIXELS / (lp * hp)));
    if (dpi < Math.min(DPI_MIN, voulu)) throw new Error(nomPage + ' : page trop grande pour être ' + verbe + ' (' + Math.round(lp) + ' × ' + Math.round(hp) + ' points).');
    if (dpi < voulu) avis.push(nomPage + ' : grande page, ' + verbe + ' à ' + Math.floor(dpi) + ' ppp au lieu de ' + voulu + '.');
    const s = dpi / 72, vue = p.getViewport({ scale: s, rotation: 0 });
    const cv = Object.assign(document.createElement('canvas'), { width: Math.ceil(vue.width), height: Math.ceil(vue.height) });
    const g = cv.getContext('2d', { alpha: false });
    try {
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, cv.width, cv.height);
      await p.render({ canvasContext: g, viewport: vue }).promise;
      g.fillStyle = '#000000';
      for (const z of zones) {   // arrondi vers l'extérieur : aucun pixel de bord laissé à moitié lisible
        const u0 = Math.floor((z.x - view[0]) * s), v0 = Math.floor((view[3] - (z.y + z.h)) * s);
        g.fillRect(u0, v0, Math.ceil((z.x + z.w - view[0]) * s) - u0, Math.ceil((view[3] - z.y) * s) - v0);
      }
      const blob = await new Promise(ok => cv.toBlob(ok, 'image/jpeg', o.qualite || QUALITE));
      if (!blob) throw new Error(nomPage + ' : rendu de la page impossible (mémoire du navigateur).');
      return { jpeg: new Uint8Array(await blob.arrayBuffer()), view };
    } finally { cv.width = cv.height = 0; }   // libère la mémoire du canvas
  }

  MPDS.pdfTrame = { rendre, DPI };
})();
