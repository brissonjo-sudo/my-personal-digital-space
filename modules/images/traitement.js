// Module Images — traitement d'une image, entièrement dans le navigateur (Canvas natif, aucune bibliothèque) :
// retrait des métadonnées sans perte (metadonnees.js), ou redimensionnement / compression / conversion
// par réencodage (qui retire aussi toutes les métadonnées). Lot téléchargé en .zip (JSZip, déjà chargé).
// Publie MPDS.imgTraitement.{ dimensions, traiter, zip, telecharger, nomSortie, FORMATS }.
(() => {
  'use strict';
  const MAX_OCTETS = 100 * 1024 * 1024, MAX_PIXELS = 100e6;
  const FORMATS = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
  const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  const NOM_FORMAT = { 'image/jpeg': 'JPEG', 'image/png': 'PNG', 'image/webp': 'WebP' };
  const echec = texte => Object.assign(new Error(texte), { name: 'Image' });

  // Taille de sortie, jamais agrandie. taille : { mode: 'origine' | 'cote' | 'pourcent', valeur }
  function dimensions(w, h, taille) {
    const v = Number(taille && taille.valeur);
    let f = 1;
    if (taille && taille.mode === 'cote' && v > 0) f = Math.min(1, v / Math.max(w, h));
    else if (taille && taille.mode === 'pourcent' && v > 0) f = Math.min(1, v / 100);
    return { w: Math.max(1, Math.round(w * f)), h: Math.max(1, Math.round(h * f)) };
  }

  // Décodage natif, orientation EXIF appliquée : l'image réencodée est droite sans son EXIF
  async function decoder(source) {
    let bmp;
    try { bmp = await createImageBitmap(source, { imageOrientation: 'from-image' }); }
    catch { throw echec('Image illisible par ce navigateur (fichier abîmé ou format non pris en charge).'); }
    if (bmp.width * bmp.height > MAX_PIXELS) {
      bmp.close();
      throw echec('Image trop grande (plus de 100 mégapixels) : le navigateur ne peut pas la traiter sans risque.');
    }
    return bmp;
  }

  async function encoder(bmp, w, h, type, qualite) {
    const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
    const ctx = c.getContext('2d');
    if (type === 'image/jpeg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); }   // JPEG sans transparence : fond blanc, pas noir
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, w, h);
    const blob = await new Promise(ok => c.toBlob(ok, type, qualite));
    c.width = c.height = 0;   // libère la mémoire du canvas tout de suite
    if (!blob) throw echec('Encodage impossible : image trop grande pour ce navigateur.');
    // Format non pris en charge : le navigateur rend du PNG sans le dire
    if (blob.type !== type) throw echec('Ce navigateur ne sait pas produire le format ' + NOM_FORMAT[type] + '. Choisissez un autre format.');
    return blob;
  }

  // « vacances.HEIC » + « sans métadonnées » + 'jpg' → « vacances (sans métadonnées).jpg »
  const nomSortie = (nom, suffixe, ext) =>
    (nom.replace(/\.[^.]*$/, '').replace(/[\/\\:*?"<>|\u0000-\u001f]/g, '_') || 'image') + ' (' + suffixe + ').' + ext;

  // Garde-fou : le fichier produit doit se décoder, aux mêmes dimensions (orientation comprise)
  async function controler(blob, w, h) {
    const bmp = await decoder(blob).catch(() => null);
    const ok = bmp && bmp.width === w && bmp.height === h;
    if (bmp) bmp.close();
    if (!ok) throw echec('Le fichier produit est illisible : image non modifiée.');
  }

  // reglages : { mode: 'meta' | 'reencoder', taille, format: 'origine' | 'jpeg' | 'png' | 'webp', qualite (0-1) }
  // → { blob, nom, w, h, retires: [...], avis: [...] }
  async function traiter(fichier, reglages) {
    if (fichier.size > MAX_OCTETS) throw echec('Fichier trop lourd (plus de 100 Mo).');
    const octets = new Uint8Array(await fichier.arrayBuffer());
    const fmt = MPDS.imgMeta.format(octets);
    if (fmt === 'heic') {
      throw echec('Format HEIC (iPhone) : les navigateurs ne savent pas le lire. Sur l\'iPhone, choisissez Réglages > Appareil photo > Formats > « Le plus compatible », ou partagez la photo en JPEG.');
    }
    if (!fmt) throw echec('Ce fichier n\'est pas une image reconnue (JPEG, PNG, WebP, GIF, BMP, AVIF).');
    const bmp = await decoder(fichier);
    try {
      const avis = [];
      // Retrait sans perte (JPEG, PNG), relu avant d'être proposé ; null pour les autres formats
      const sansPerte = async () => {
        const net = MPDS.imgMeta.nettoyer(octets, fmt);
        if (!net) return null;
        const blob = new Blob([net.octets], { type: net.type });
        await controler(blob, bmp.width, bmp.height);
        return { blob, retires: net.retires.map(r => r === 'EXIF' && net.gps ? 'EXIF (dont la position GPS)' : r),
          avis: net.orientation !== 1 ? ['Seule l\'orientation de la photo est gardée, pour qu\'elle reste droite.'] : [] };
      };
      if (reglages.mode === 'meta') {
        const n = await sansPerte();
        if (n) return { blob: n.blob, nom: nomSortie(fichier.name, 'sans métadonnées', EXT[n.blob.type]), w: bmp.width, h: bmp.height, retires: n.retires, avis: n.avis };
        avis.push('Retrait sans perte impossible pour ce format : image réencodée en PNG, sans aucune métadonnée.');
      }
      const type = reglages.mode === 'meta' ? 'image/png'
        : FORMATS[reglages.format] || FORMATS[fmt] || 'image/png';
      const { w, h } = reglages.mode === 'meta' ? { w: bmp.width, h: bmp.height } : dimensions(bmp.width, bmp.height, reglages.taille);
      let blob = await encoder(bmp, w, h, type, reglages.qualite);
      let suffixe = reglages.mode === 'meta' ? 'sans métadonnées' : 'optimisée', retires = ['toutes les métadonnées (réencodage)'];
      // Même taille, même format, et pourtant plus lourd que l'original nettoyé (comparé SANS ses métadonnées :
      // une vidéo cachée gonflerait l'original) : l'original sans ses métadonnées vaut mieux
      if (w === bmp.width && h === bmp.height && FORMATS[fmt] === type) {
        const n = await sansPerte().catch(() => null);   // structure inattendue : le réencodage reste
        if (n && blob.size >= n.blob.size) {
          ({ blob, retires } = n); suffixe = 'sans métadonnées';
          avis.push('Le réencodage aurait alourdi l\'image : l\'original est gardé, sans ses métadonnées.', ...n.avis);
        } else if (!n && blob.size >= fichier.size) avis.push('Le résultat est plus lourd que l\'original : baissez la qualité ou la taille.');
      }
      if (reglages.mode !== 'meta' && type !== FORMATS[fmt]) avis.push('Converti en ' + NOM_FORMAT[type] + '.');
      if (fmt === 'gif') avis.push('GIF : seule la première image est gardée (pas d\'animation).');
      return { blob, nom: nomSortie(fichier.name, suffixe, EXT[type]), w, h, retires, avis };
    } finally { bmp.close(); }
  }

  // Lot → .zip ; noms en double : « photo (2).jpg »
  async function zip(resultats) {
    const z = new JSZip(), pris = new Set();
    for (const r of resultats) {
      let nom = r.nom;
      for (let k = 2; pris.has(nom.toLowerCase()); k++) nom = r.nom.replace(/(\.[^.]+)$/, ' (' + k + ')$1');
      pris.add(nom.toLowerCase());
      z.file(nom, r.blob);
    }
    return z.generateAsync({ type: 'blob', compression: 'STORE' });   // images déjà compressées
  }

  function telecharger(blob, nom) {
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: nom });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  MPDS.imgTraitement = { dimensions, traiter, zip, telecharger, nomSortie, FORMATS };
})();
