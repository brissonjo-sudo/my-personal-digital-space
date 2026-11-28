// Module Images — métadonnées : reconnaît le format d'après les premiers octets et retire, SANS
// réencoder, tout ce qui n'est pas nécessaire à l'affichage d'un JPEG ou d'un PNG (liste blanche) :
// EXIF (position GPS, appareil, dates), XMP, IPTC, commentaires, images ou vidéo cachées après la fin.
// Seule l'orientation EXIF est conservée (EXIF minimal réécrit), pour qu'une photo reste droite.
// Structure inattendue : refus (erreur name 'Image'), jamais de fichier tronqué en silence.
// Publie MPDS.imgMeta.{ format(octets), nettoyer(octets, format) }.
(() => {
  'use strict';
  const echec = texte => Object.assign(new Error(texte), { name: 'Image' });
  const ascii = (o, debut, n) => String.fromCharCode(...o.subarray(debut, debut + n));
  const commence = (o, s) => o.length >= s.length && ascii(o, 0, s.length) === s;
  const assembler = morceaux => {
    const r = new Uint8Array(morceaux.reduce((n, m) => n + m.length, 0));
    let p = 0;
    for (const m of morceaux) { r.set(m, p); p += m.length; }
    return r;
  };
  const APRES_FIN = 'données cachées après la fin de l\'image (vidéo, profondeur, autres images)';

  function format(o) {
    if (o[0] === 0xFF && o[1] === 0xD8 && o[2] === 0xFF) return 'jpeg';
    if (commence(o, '\x89PNG\r\n\x1a\n')) return 'png';
    if (commence(o, 'GIF8')) return 'gif';
    if (commence(o, 'BM')) return 'bmp';
    if (commence(o, 'RIFF') && ascii(o, 8, 4) === 'WEBP') return 'webp';
    if (ascii(o, 4, 4) === 'ftyp') {   // conteneur ISO (HEIF) : marque principale puis marques compatibles
      const taille = Math.min(o.length, ((o[0] << 24) | (o[1] << 16) | (o[2] << 8) | o[3]) >>> 0);
      const marques = [ascii(o, 8, 4)];
      for (let p = 16; p + 4 <= taille; p += 4) marques.push(ascii(o, p, 4));
      if (marques.some(m => m === 'avif' || m === 'avis')) return 'avif';
      if (marques.some(m => /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(m))) return 'heic';
    }
    return null;
  }

  // ---- JPEG ----
  // Segments gardés : tables et trames (C0-CF : SOF, DHT, DAC), DQT, DNL, DRI, DHP, EXP, balayages ;
  // parmi les APPn, seulement JFIF (APP0), profil de couleur ICC (APP2) et Adobe (APP14, couleurs CMJN).
  const technique = m => (m >= 0xC0 && m <= 0xCF) || (m >= 0xDB && m <= 0xDF);
  const appGarde = (m, d) => (m === 0xE0 && commence(d, 'JFIF\0')) || (m === 0xE2 && commence(d, 'ICC_PROFILE\0'))
    || (m === 0xEE && commence(d, 'Adobe'));
  function nomSegment(m, d) {
    if (m === 0xFE) return 'commentaire';
    if (m === 0xE1) return commence(d, 'Exif\0') ? 'EXIF' : commence(d, 'http://ns.adobe.com/') ? 'XMP' : 'APP1';
    if (m === 0xED) return 'IPTC';
    if (m === 0xE2 && commence(d, 'MPF\0')) return 'MPF (images multiples)';
    if (m === 0xEB) return 'JUMBF / C2PA (provenance)';
    if (m === 0xE0 && commence(d, 'JFXX')) return 'miniature JFXX';
    return 'APP' + (m - 0xE0);
  }

  // EXIF : orientation (0x0112) et présence d'une position GPS (0x8825) dans le premier répertoire
  function lireExif(d, info) {
    const t = d.subarray(6);   // après « Exif\0\0 » : en-tête TIFF
    if (t.length < 8) return;
    const le = t[0] === 0x49 && t[1] === 0x49;
    if (!le && !(t[0] === 0x4D && t[1] === 0x4D)) return;
    const u16 = i => le ? t[i] | (t[i + 1] << 8) : (t[i] << 8) | t[i + 1];
    const u32 = i => (le ? t[i] | (t[i + 1] << 8) | (t[i + 2] << 16) | (t[i + 3] << 24) : (t[i] << 24) | (t[i + 1] << 16) | (t[i + 2] << 8) | t[i + 3]) >>> 0;
    const ifd = u32(4);
    if (ifd + 2 > t.length) return;
    for (let k = 0, n = u16(ifd); k < n; k++) {
      const e = ifd + 2 + 12 * k;
      if (e + 12 > t.length) break;
      const tag = u16(e);
      if (tag === 0x0112) { const v = u16(e + 8); if (v >= 1 && v <= 8) info.orientation = v; }
      if (tag === 0x8825) info.gps = true;
    }
  }

  function jpeg(o) {
    const garde = [o.subarray(0, 2)], retires = new Set(), info = { orientation: 1, gps: false };
    const illisible = () => echec('Structure JPEG inattendue : image non modifiée.');
    let p = 2;
    for (;;) {
      if (p + 1 >= o.length || o[p] !== 0xFF) throw illisible();
      while (o[p + 1] === 0xFF && p + 2 < o.length) p++;   // octets de remplissage entre segments
      const m = o[p + 1];
      if (m === 0xD9) {   // fin de l'image : tout ce qui suit est retiré
        garde.push(o.subarray(p, p + 2));
        if (p + 2 < o.length) retires.add(APRES_FIN);
        break;
      }
      if (p + 4 > o.length) throw illisible();
      const fin = p + 2 + ((o[p + 2] << 8) | o[p + 3]);
      if (fin < p + 4 || fin > o.length) throw illisible();
      const d = o.subarray(p + 4, fin);
      if (m === 0xDA) {   // balayage : données compressées jusqu'au prochain marqueur (ni FF00, ni RSTn)
        let q = fin;
        while (q + 1 < o.length && !(o[q] === 0xFF && o[q + 1] !== 0x00 && o[q + 1] !== 0xFF && (o[q + 1] < 0xD0 || o[q + 1] > 0xD7))) q++;
        if (q + 1 >= o.length) throw illisible();   // fichier tronqué
        garde.push(o.subarray(p, q));
        p = q;
        continue;
      }
      if (technique(m) || appGarde(m, d)) garde.push(o.subarray(p, fin));
      else if ((m >= 0xE0 && m <= 0xEF) || m === 0xFE) {
        if (m === 0xE1 && commence(d, 'Exif\0')) lireExif(d, info);
        retires.add(nomSegment(m, d));
      } else throw illisible();
      p = fin;
    }
    // Photo tournée par son EXIF (portrait de téléphone) : un EXIF minimal ne gardant QUE l'orientation est
    // réécrit, après JFIF s'il existe, pour que la photo reste droite sans réencodage
    if (info.orientation !== 1) garde.splice(garde[1] && garde[1][1] === 0xE0 ? 2 : 1, 0, exifOrientation(info.orientation));
    return { octets: assembler(garde), type: 'image/jpeg', retires: [...retires], ...info };
  }
  // APP1 « Exif » : en-tête TIFF gros-boutiste, un seul répertoire, une seule entrée (0x0112, SHORT)
  const exifOrientation = v => new Uint8Array([0xFF, 0xE1, 0, 34, 0x45, 0x78, 0x69, 0x66, 0, 0,
    0x4D, 0x4D, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, v, 0, 0, 0, 0, 0, 0]);

  // ---- PNG ----
  // Blocs gardés : critiques, couleur et rendu (transparence, gamma, profil, HDR, résolution), animation APNG
  const GARDES = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'sBIT', 'bKGD', 'pHYs',
    'cICP', 'mDCv', 'cLLi', 'acTL', 'fcTL', 'fdAT']);
  const NOMS_PNG = { tEXt: 'texte (auteur, logiciel, commentaire…)', zTXt: 'texte (auteur, logiciel, commentaire…)',
    iTXt: 'texte ou XMP', eXIf: 'EXIF', tIME: 'date de modification' };

  function png(o) {
    const garde = [o.subarray(0, 8)], retires = new Set();
    const illisible = () => echec('Structure PNG inattendue : image non modifiée.');
    let p = 8, premier = true;
    for (;;) {
      if (p + 12 > o.length) throw illisible();   // pas de bloc IEND : fichier tronqué
      const n = ((o[p] << 24) | (o[p + 1] << 16) | (o[p + 2] << 8) | o[p + 3]) >>> 0, type = ascii(o, p + 4, 4);
      const fin = p + 12 + n;
      if (!/^[A-Za-z]{4}$/.test(type) || fin > o.length || (premier && type !== 'IHDR')) throw illisible();
      premier = false;
      if (GARDES.has(type)) garde.push(o.subarray(p, fin));
      else if (o[p + 4] & 0x20) retires.add(NOMS_PNG[type] || 'bloc ' + type);   // bloc auxiliaire (minuscule)
      else throw echec('Bloc PNG indispensable inconnu (' + type + ') : image non modifiée.');
      p = fin;
      if (type === 'IEND') { if (p < o.length) retires.add(APRES_FIN); break; }
    }
    return { octets: assembler(garde), type: 'image/png', retires: [...retires], orientation: 1, gps: false };
  }

  // null : format sans retrait sans perte (WebP, GIF, BMP, AVIF) → réencodage par l'appelant
  const nettoyer = (o, f = format(o)) => f === 'jpeg' ? jpeg(o) : f === 'png' ? png(o) : null;

  MPDS.imgMeta = { format, nettoyer };
})();
