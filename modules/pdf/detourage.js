// Module PDF — image de signature : contrôle du type réel du fichier (octets), retrait du fond par
// seuil de luminosité, rognage aux pixels visibles. Fonctions sans DOM (sauf rogner : canvas).
// Publie MPDS.pdfDetourage.
(() => {
  'use strict';
  const PNG = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
  const RAMPE = 40;   // largeur (en luminosité) de la zone de transition : bords adoucis

  // 'png' | 'jpeg' | null, d'après la signature d'octets (pas l'extension ni le type annoncé)
  function typeReel(o) {
    if (o.length > 24 && PNG.every((v, i) => o[i] === v)) return 'png';
    if (o.length > 4 && o[0] === 0xFF && o[1] === 0xD8 && o[2] === 0xFF) return 'jpeg';
    return null;
  }

  // [largeur, hauteur] lues dans l'en-tête, avant tout décodage (refus des images démesurées) ; null si illisible
  function dimensions(o, type) {
    if (type === 'png') return [new DataView(o.buffer, o.byteOffset).getUint32(16), new DataView(o.buffer, o.byteOffset).getUint32(20)];
    for (let i = 2; i + 9 < o.length;) {
      if (o[i] !== 0xFF) { i++; continue; }
      const m = o[i + 1];
      if (m === 0xFF) { i++; continue; }
      if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) return [(o[i + 7] << 8) | o[i + 8], (o[i + 5] << 8) | o[i + 6]];
      i += (m === 0xD8 || m === 0x01 || (m >= 0xD0 && m <= 0xD7)) ? 2 : 2 + ((o[i + 2] << 8) | o[i + 3]);
    }
    return null;
  }

  // Copie de `src` (ImageData) dont les pixels clairs sont rendus transparents.
  // tolerance 0–100 : seuil de luminosité = 255 − 1,5 × tolérance ; au-dessus : transparent,
  // sur RAMPE niveaux en dessous : transparence progressive, en dessous : conservé.
  function retirerFond(src, tolerance) {
    const seuil = 255 - 1.5 * tolerance, d = new Uint8ClampedArray(src.data);
    for (let i = 0; i < d.length; i += 4) {
      const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      d[i + 3] *= Math.min(1, Math.max(0, (seuil - lum) / RAMPE));
    }
    return new ImageData(d, src.width, src.height);
  }

  // Canvas rogné aux pixels non transparents (marge de 2 px) ; null si rien de visible
  function rogner(cv) {
    const { width: W, height: H } = cv, d = cv.getContext('2d').getImageData(0, 0, W, H).data;
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (d[(y * W + x) * 4 + 3] > 16) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (x1 < 0) return null;
    x0 = Math.max(0, x0 - 2); y0 = Math.max(0, y0 - 2); x1 = Math.min(W - 1, x1 + 2); y1 = Math.min(H - 1, y1 + 2);
    const s = Object.assign(document.createElement('canvas'), { width: x1 - x0 + 1, height: y1 - y0 + 1 });
    s.getContext('2d').drawImage(cv, -x0, -y0);
    return s;
  }

  MPDS.pdfDetourage = { typeReel, dimensions, retirerFond, rogner };
})();
