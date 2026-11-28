// Fabriques de fichiers de test — code exécuté DANS LA PAGE (injecté par
// page.addInitScript). Génère de vrais .pdf / .docx / .pptx / .xlsx en mémoire,
// pour ne pas versionner de fichiers binaires. Les libs (JSZip, XLSX) sont
// utilisées à l'appel, une fois la page chargée.
(() => {
  'use strict';

  // PNG 1×1 valide
  const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const b64VersOctets = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const xml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // ---------------------------------------------------------------- Texte
  // encodage : 'utf-8' (défaut), 'utf-8-bom' ou 'windows-1252'
  function texte(nom, contenu, encodage = 'utf-8') {
    let octets;
    if (encodage === 'windows-1252') {
      octets = Uint8Array.from(contenu, c => { const n = c.charCodeAt(0); if (n > 255) throw new Error('hors latin-1 : ' + c); return n; });
    } else {
      octets = new TextEncoder().encode(contenu);
      if (encodage === 'utf-8-bom') octets = new Uint8Array([0xEF, 0xBB, 0xBF, ...octets]);
    }
    return new File([octets], nom);
  }

  // ---------------------------------------------------------------- PDF
  // pages : [[{ t, x, y, taille = 12, gras = false }, ...], ...] (A4, origine en bas à gauche)
  const WIN_ANSI = { '€': 0x80, '…': 0x85, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, 'œ': 0x9C };
  function pdf(nom, pages) {
    const echapper = s => s.replace(/[\\()]/g, m => '\\' + m)
      .replace(/./g, c => WIN_ANSI[c] !== undefined ? String.fromCharCode(WIN_ANSI[c]) : c);
    const objets = [];            // objets[i] = contenu de l'objet i+1
    const ajouter = contenu => { objets.push(contenu); return objets.length; };

    const catalogue = ajouter(null);
    const arbre     = ajouter(null);
    const police    = ajouter('<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>');
    const policeG   = ajouter('<</Type/Font/Subtype/Type1/BaseFont/Helvetica-Bold/Encoding/WinAnsiEncoding>>');
    const enfants = pages.map(items => {
      const flux = items.map(it =>
        `BT /${it.gras ? 'F2' : 'F1'} ${it.taille || 12} Tf ${it.x} ${it.y} Td (${echapper(it.t)}) Tj ET`).join('\n');
      const contenu = ajouter(`<</Length ${flux.length}>>\nstream\n${flux}\nendstream`);
      return ajouter(`<</Type/Page/Parent ${arbre} 0 R/MediaBox[0 0 595 842]/Contents ${contenu} 0 R` +
        `/Resources<</Font<</F1 ${police} 0 R/F2 ${policeG} 0 R>>>>>>`);
    });
    objets[catalogue - 1] = `<</Type/Catalog/Pages ${arbre} 0 R>>`;
    objets[arbre - 1] = `<</Type/Pages/Kids[${enfants.map(n => n + ' 0 R').join(' ')}]/Count ${enfants.length}>>`;
    return serialiserPdf(nom, objets, catalogue);
  }

  // Objets PDF (chaînes où 1 caractère = 1 octet) → fichier avec table xref exacte
  function serialiserPdf(nom, objets, catalogue) {
    let sortie = '%PDF-1.4\n';
    const positions = objets.map((o, i) => { const p = sortie.length; sortie += `${i + 1} 0 obj\n${o}\nendobj\n`; return p; });
    const xref = sortie.length;
    sortie += `xref\n0 ${objets.length + 1}\n0000000000 65535 f \n` +
      positions.map(p => String(p).padStart(10, '0') + ' 00000 n \n').join('') +
      `trailer\n<</Size ${objets.length + 1}/Root ${catalogue} 0 R>>\nstartxref\n${xref}\n%%EOF`;
    return new File([Uint8Array.from(sortie, c => c.charCodeAt(0) & 0xFF)], nom);
  }

  // PDF « scanné » : chaque page n'est qu'une image JPEG de son texte (A4 à
  // 150 ppp), sans aucun texte extractible — comme une numérisation.
  // pages : [['ligne 1', 'ligne 2', …], …] ; une ligne '' laisse un blanc
  // Page A4 à 150 ppp portant les lignes de texte (noir sur blanc)
  function canvasTexte(lignes) {
    const c = Object.assign(document.createElement('canvas'), { width: 1240, height: 1754 });
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#000'; g.font = '44px sans-serif'; g.textBaseline = 'top';
    lignes.forEach((t, i) => g.fillText(t, 120, 160 + i * 80));
    return c;
  }

  // Photo d'un document (.png, .jpg…) portant les lignes de texte
  async function imageTexte(nom, lignes, type = 'image/png') {
    return new File([await new Promise(r => canvasTexte(lignes).toBlob(r, type))], nom, { type });
  }

  async function pdfScanne(nom, pages) {
    const objets = [];
    const ajouter = contenu => { objets.push(contenu); return objets.length; };
    const catalogue = ajouter(null);
    const arbre     = ajouter(null);
    const enfants = [];
    let police = null;
    for (const lignes of pages) {
      if (lignes.texte) {   // { texte: [{ t, x, y }] } : page texte, comme Fab.pdf (PDF mixte)
        police = police || ajouter('<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>');
        const flux = lignes.texte.map(it => `BT /F1 ${it.taille || 12} Tf ${it.x} ${it.y} Td (${it.t}) Tj ET`).join('\n');
        const contenu = ajouter(`<</Length ${flux.length}>>\nstream\n${flux}\nendstream`);
        enfants.push(ajouter(`<</Type/Page/Parent ${arbre} 0 R/MediaBox[0 0 595 842]/Contents ${contenu} 0 R` +
          `/Resources<</Font<</F1 ${police} 0 R>>>>>>`));
        continue;
      }
      // { image: lignes, cm, mention: [{ t, x, y, invisible }], forme } : image placée par `cm` (page entière par
      // défaut), texte posé dessus, image enveloppée dans un XObject de formulaire
      const opt = Array.isArray(lignes) ? { image: lignes } : lignes;
      const c = canvasTexte(opt.image);
      const jpeg = new Uint8Array(await (await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92))).arrayBuffer());
      let octets = '';
      for (const o of jpeg) octets += String.fromCharCode(o);
      const image = ajouter(`<</Type/XObject/Subtype/Image/Width ${c.width}/Height ${c.height}/ColorSpace/DeviceRGB` +
        `/BitsPerComponent 8/Filter/DCTDecode/Length ${jpeg.length}>>\nstream\n${octets}\nendstream`);
      const dessin = `q ${opt.cm || '595 0 0 842 0 0'} cm /Im1 Do Q`;
      let xobjet = `/Im1 ${image} 0 R`, flux = dessin;
      if (opt.forme) {
        const f = ajouter(`<</Type/XObject/Subtype/Form/BBox[0 0 595 842]/Resources<</XObject<</Im1 ${image} 0 R>>>>/Length ${dessin.length}>>\nstream\n${dessin}\nendstream`);
        xobjet = `/Fm1 ${f} 0 R`; flux = 'q /Fm1 Do Q';
      }
      if (opt.mention) {
        police = police || ajouter('<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>');
        flux += '\n' + opt.mention.map(it => `BT ${it.invisible ? '3 Tr ' : ''}/F1 12 Tf ${it.x} ${it.y} Td (${it.t}) Tj ET`).join('\n');
      }
      const contenu = ajouter(`<</Length ${flux.length}>>\nstream\n${flux}\nendstream`);
      enfants.push(ajouter(`<</Type/Page/Parent ${arbre} 0 R/MediaBox[0 0 595 842]/Contents ${contenu} 0 R` +
        `/Resources<</XObject<<${xobjet}>>${police ? `/Font<</F1 ${police} 0 R>>` : ''}>>>>`));
    }
    objets[catalogue - 1] = `<</Type/Catalog/Pages ${arbre} 0 R>>`;
    objets[arbre - 1] = `<</Type/Pages/Kids[${enfants.map(n => n + ' 0 R').join(' ')}]/Count ${enfants.length}>>`;
    return serialiserPdf(nom, objets, catalogue);
  }

  // ---------------------------------------------------------------- XLSX
  async function classeur(nom, wb, bookType = 'xlsx') {
    return new File([XLSX.write(wb, { type: 'array', bookType })], nom);
  }

  // ---------------------------------------------------------------- DOCX
  const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
  const docxPara = (t, style) =>
    `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${xml(t)}</w:t></w:r></w:p>`;
  const docxImage = (rId, descr = '') =>
    `<w:p><w:r><w:drawing><wp:inline><wp:extent cx="952500" cy="952500"/><wp:docPr id="1" name="Image" descr="${xml(descr)}"/>` +
    `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>` +
    `<pic:nvPicPr><pic:cNvPr id="1" name="img"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${rId}"/></pic:blipFill><pic:spPr/></pic:pic></a:graphicData></a:graphic>` +
    `</wp:inline></w:drawing></w:r></w:p>`;
  // corps : XML des paragraphes ; images : { rId: base64Png }
  async function docx(nom, corps, images = {}) {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>');
    zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    zip.file('word/styles.xml', '<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style></w:styles>');
    let rels = '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>';
    Object.entries(images).forEach(([rId, b64], i) => {
      zip.file(`word/media/image${i + 1}.png`, b64VersOctets(b64));
      rels += `<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${i + 1}.png"/>`;
    });
    zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`);
    zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document ${W_NS}><w:body>${corps}</w:body></w:document>`);
    return new File([await zip.generateAsync({ type: 'arraybuffer' })], nom);
  }

  // ---------------------------------------------------------------- PPTX
  const P_NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const paraPptx = p => typeof p === 'string'
    ? `<a:p><a:r><a:t>${xml(p)}</a:t></a:r></a:p>`
    : `<a:p><a:pPr lvl="${p.lvl || 0}"/><a:r><a:t>${xml(p.t)}</a:t></a:r></a:p>`;
  const forme = (ph, paras) =>
    `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Forme"/><p:cNvSpPr/><p:nvPr>${ph}</p:nvPr></p:nvSpPr><p:spPr/>` +
    `<p:txBody><a:bodyPr/>${paras.map(paraPptx).join('')}</p:txBody></p:sp>`;
  const pptxTitre  = t => forme('<p:ph type="title"/>', [t]);
  const pptxCorps  = paras => forme('<p:ph idx="1"/>', paras);
  const pptxZone   = paras => forme('', paras);            // zone de texte libre (sans espace réservé)
  const pptxTableau = lignes =>
    `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="Tableau"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm/>` +
    `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblGrid/>` +
    lignes.map(l => `<a:tr h="0">${l.map(c => `<a:tc><a:txBody><a:bodyPr/>${paraPptx(c)}</a:txBody></a:tc>`).join('')}</a:tr>`).join('') +
    `</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
  const pptxImage = (rId, descr = '') =>
    `<p:pic><p:nvPicPr><p:cNvPr id="5" name="Image" descr="${xml(descr)}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>` +
    `<p:blipFill><a:blip r:embed="${rId}"/></p:blipFill><p:spPr/></p:pic>`;

  // diapos : [{ formes: [xml], images: { rId: base64 }, notes: 'texte', masquee: bool }]
  // ordre  : indices des diapos dans l'ordre de présentation (défaut : ordre du tableau)
  async function pptx(nom, diapos, { ordre } = {}) {
    const zip = new JSZip();
    let numImage = 0;
    zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/></Types>');
    const ids = (ordre || diapos.map((_, i) => i))
      .map((i, k) => `<p:sldId id="${256 + k}" r:id="rIdS${i + 1}"/>`).join('');
    zip.file('ppt/presentation.xml', `<?xml version="1.0" encoding="UTF-8"?><p:presentation ${P_NS}><p:sldIdLst>${ids}</p:sldIdLst></p:presentation>`);
    zip.file('ppt/_rels/presentation.xml.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      diapos.map((_, i) => `<Relationship Id="rIdS${i + 1}" Type="${REL}/slide" Target="slides/slide${i + 1}.xml"/>`).join('') + '</Relationships>');

    diapos.forEach((d, i) => {
      const n = i + 1;
      zip.file(`ppt/slides/slide${n}.xml`, `<?xml version="1.0" encoding="UTF-8"?><p:sld ${P_NS}${d.masquee ? ' show="0"' : ''}>` +
        `<p:cSld><p:spTree>${(d.formes || []).join('')}</p:spTree></p:cSld></p:sld>`);
      let rels = '';
      Object.entries(d.images || {}).forEach(([rId, b64]) => {
        numImage++;
        zip.file(`ppt/media/image${numImage}.png`, b64VersOctets(b64));
        rels += `<Relationship Id="${rId}" Type="${REL}/image" Target="../media/image${numImage}.png"/>`;
      });
      if (d.notes) {
        zip.file(`ppt/notesSlides/notesSlide${n}.xml`, `<?xml version="1.0" encoding="UTF-8"?><p:notes ${P_NS}><p:cSld><p:spTree>` +
          forme('<p:ph type="sldImg"/>', []) + forme('<p:ph type="body" idx="1"/>', d.notes.split('\n')) +
          forme('<p:ph type="sldNum" idx="5"/>', [String(n)]) + `</p:spTree></p:cSld></p:notes>`);
        rels += `<Relationship Id="rIdN" Type="${REL}/notesSlide" Target="../notesSlides/notesSlide${n}.xml"/>`;
      }
      if (rels) {
        zip.file(`ppt/slides/_rels/slide${n}.xml.rels`, `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`);
      }
    });
    return new File([await zip.generateAsync({ type: 'arraybuffer' })], nom);
  }

  // ---------------------------------------------------------------- OpenDocument
  const ODF_NS = ['office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"', 'style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"',
    'text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"', 'table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"',
    'draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"', 'fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"',
    'xlink="http://www.w3.org/1999/xlink"', 'svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"',
    'presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0"'].map(n => 'xmlns:' + n).join(' ');

  // corps : XML placé dans office:text (odt) ou office:presentation (odp)
  // styles : styles automatiques ; images : { 'Pictures/x.png': base64 }
  async function odf(nom, type, corps, { styles = '', images = {} } = {}) {
    const zip = new JSZip();
    zip.file('mimetype', `application/vnd.oasis.opendocument.${type}`);
    const conteneur = type === 'text' ? 'office:text' : 'office:presentation';
    zip.file('content.xml', `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${ODF_NS} office:version="1.3">` +
      `<office:automatic-styles>${styles}</office:automatic-styles><office:body><${conteneur}>${corps}</${conteneur}>` +
      `</office:body></office:document-content>`);
    for (const [chemin, b64] of Object.entries(images)) zip.file(chemin, b64VersOctets(b64));
    return new File([await zip.generateAsync({ type: 'arraybuffer' })], nom);
  }
  const odt = (nom, corps, options) => odf(nom, 'text', corps, options);
  const odp = (nom, corps, options) => odf(nom, 'presentation', corps, options);

  // ---------------------------------------------------------------- Photos avec métadonnées (module Images)
  const octetsDe = s => typeof s === 'string' ? Uint8Array.from(s, c => c.charCodeAt(0)) : s;
  const coller = (...m) => { const r = new Uint8Array(m.reduce((n, x) => n + x.length, 0)); let p = 0; for (const x of m) { r.set(x, p); p += x.length; } return r; };
  const segmentJpeg = (m, d) => { d = octetsDe(d); return coller([0xFF, m, (d.length + 2) >> 8, (d.length + 2) & 255], d); };
  // EXIF (TIFF gros-boutiste) : Orientation dans IFD0, puis un répertoire GPS (latitude « N »)
  const exifJpeg = orientation => coller(octetsDe('Exif\0\0'), [
    0x4D, 0x4D, 0, 42, 0, 0, 0, 8, 0, 2,
    0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0,
    0x88, 0x25, 0, 4, 0, 0, 0, 1, 0, 0, 0, 38,
    0, 0, 0, 0,
    0, 1, 0, 1, 0, 2, 0, 0, 0, 2, 0x4E, 0, 0, 0, 0, 0, 0, 0]);
  // Moitié gauche rouge, moitié droite bleue : l'orientation appliquée se voit aux pixels
  // bruit : grain aléatoire, comme une vraie photo (le réencodage en qualité maximale pèse alors plus lourd)
  async function photoCanvas(w, h, type, bruit) {
    const c = Object.assign(document.createElement('canvas'), { width: w, height: h }), x = c.getContext('2d');
    x.fillStyle = '#e00000'; x.fillRect(0, 0, w / 2, h);
    x.fillStyle = '#0000e0'; x.fillRect(w / 2, 0, w / 2, h);
    if (bruit) for (let k = 0; k < w * h / 4; k++) { x.fillStyle = `rgb(${Math.random() * 255},${Math.random() * 255},${Math.random() * 255})`; x.fillRect(Math.random() * w, Math.random() * h, 1, 1); }
    return new Uint8Array(await (await new Promise(r => c.toBlob(r, type, 0.9))).arrayBuffer());
  }
  // JPEG du navigateur + segments à retirer (EXIF avec GPS, XMP, MPF, C2PA, IPTC, commentaire, données
  // après la fin) + un profil ICC à garder. file.attendu : les octets qu'un retrait correct doit produire.
  // video : taille de la « vidéo » cachée après la fin (photo animée), en octets en plus du marqueur
  async function jpegAvecMeta(nom, { w = 40, h = 20, orientation = 6, bruit = false, video = 0 } = {}) {
    const base = await photoCanvas(w, h, 'image/jpeg', bruit);
    const apresApp0 = base[3] === 0xE0 ? 4 + ((base[4] << 8) | base[5]) : 2;
    const icc = segmentJpeg(0xE2, 'ICC_PROFILE\0\x01\x01icc-garde');
    const fichier = coller(base.subarray(0, apresApp0),
      segmentJpeg(0xE1, exifJpeg(orientation)),
      segmentJpeg(0xE1, 'http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>Ville-Secrete</x:xmpmeta>'),
      icc,
      segmentJpeg(0xE2, 'MPF\0mpf-secret'),
      segmentJpeg(0xEB, 'JP\0\0c2pa-secret'),
      segmentJpeg(0xED, 'Photoshop 3.0\0iptc-secret'),
      segmentJpeg(0xFE, 'commentaire-secret'),
      base.subarray(apresApp0),
      octetsDe('video-secrete'), new Uint8Array(video));
    // Orientation ≠ 1 : seul un EXIF minimal (l'orientation) doit rester, juste après JFIF
    const orient = orientation === 1 ? [] : segmentJpeg(0xE1, coller(octetsDe('Exif\0\0'),
      [0x4D, 0x4D, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, 0, 0, 0, 0]));
    const attendu = coller(base.subarray(0, apresApp0), orient, icc, base.subarray(apresApp0));
    return Object.assign(new File([fichier], nom, { type: 'image/jpeg' }), { attendu });
  }
  const CRC = Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xEDB88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
  const crc32 = o => { let c = 0xFFFFFFFF; for (const x of o) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const blocPng = (type, d) => {
    d = octetsDe(d);
    const td = coller(octetsDe(type), d), n = d.length, c = crc32(td);
    return coller([n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255], td, [c >>> 24, (c >> 16) & 255, (c >> 8) & 255, c & 255]);
  };
  // PNG du navigateur + tEXt, eXIf, tIME, un bloc privé et des données après IEND ; gAMA à garder
  async function pngAvecMeta(nom, { w = 40, h = 20 } = {}) {
    const base = await photoCanvas(w, h, 'image/png');
    const gama = blocPng('gAMA', [0, 0, 0xB1, 0x8F]);
    const fichier = coller(base.subarray(0, 33), gama, blocPng('tEXt', 'Author\0png-secret'), blocPng('eXIf', 'MM\0*exif-secret'),
      blocPng('tIME', [7, 234, 11, 28, 12, 0, 0]), blocPng('prVt', 'prive-secret'), base.subarray(33), octetsDe('apres-secret'));
    const attendu = coller(base.subarray(0, 33), gama, base.subarray(33));
    return Object.assign(new File([fichier], nom, { type: 'image/png' }), { attendu });
  }

  window.Fab = {
    PNG_B64, texte, pdf, pdfScanne, imageTexte, classeur, jpegAvecMeta, pngAvecMeta, blocPng, segmentJpeg,
    docx, docxPara, docxImage,
    pptx, pptxTitre, pptxCorps, pptxZone, pptxTableau, pptxImage,
    odt, odp,
  };

  // Résumé de l'état de l'application après conversion (journal + résultats).
  window.__resume = () => ({
    journal: [...document.querySelectorAll('.journal-item')].map(li => ({
      nom: li.querySelector('.journal-nom').textContent,
      statut: li.className.replace('journal-item', '').trim(),
      msg: li.querySelector('.journal-msg').textContent,
    })),
    resultats: resultats.map(r => ({
      nom: r.nom, nomMd: r.nomMd, md: r.md,
      images: (r.images || []).map(i => ({ chemin: i.chemin, octets: i.data.byteLength ?? i.data.size })),
    })),
    stats: { ...statsTravailleur },
  });
})();
