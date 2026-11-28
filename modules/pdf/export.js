// Module PDF — export : reconstruit un PDF neuf à partir du modèle de pages (copie des pages,
// setRotation) et y aplatit les annotations (aplatir). Bibliothèque d'écriture chargée à la demande (≈ 600 Ko), vérifiée par SRI.
// Publie MPDS.pdfExport.
(() => {
  'use strict';
  // Empreinte dans la table INTEGRITE de commun/pdfjs.js
  const URL_LIB = 'https://cdn.jsdelivr.net/npm/@cantoo/pdf-lib@2.11.1/dist/pdf-lib.min.js';

  async function bibliotheque() {
    try { await MPDS.chargerScript(URL_LIB); }
    catch (err) {
      throw new Error('Le composant d\'écriture PDF est inaccessible ou altéré (' + err.message + '). Vérifiez votre connexion, puis réessayez.');
    }
    return PDFLib;
  }

  const hex = h => {   // '#rrggbb' → rgb() ; noir si invalide
    const n = /^#[0-9a-f]{6}$/i.test(h) ? parseInt(h.slice(1), 16) : 0;
    return PDFLib.rgb((n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
  };

  // Aplatit les annotations d'une page (coordonnées en points PDF, voir annotations.js)
  async function aplatir(sortie, c, annots, polices) {
    const { degrees, StandardFonts, LineCapStyle } = PDFLib;
    for (const a of annots) {
      const color = hex(a.couleur);
      if (a.type === 'surlig') {
        c.drawRectangle({ x: a.x, y: a.y, width: a.w, height: a.h, color, opacity: a.opacite, borderWidth: 0 });
      } else if (a.type === 'texte') {
        const nom = StandardFonts[a.police] ? a.police : 'Helvetica';
        if (!polices.has(nom)) polices.set(nom, await sortie.embedFont(StandardFonts[nom]));
        // verifier() : le fork remplace sinon en silence un caractère hors WinAnsi par « ? »
        c.drawText(MPDS.pdfTexte.verifier(a.texte), { x: a.x, y: a.y, size: a.taille, font: polices.get(nom), color, rotate: degrees(a.angle || 0) });
      } else if (a.type === 'signature') {   // PNG transparent : une seule incorporation par image, même posée plusieurs fois
        if (!polices.has(a.png)) polices.set(a.png, await sortie.embedPng(a.png));
        c.drawImage(polices.get(a.png), { x: a.x, y: a.y, width: a.w, height: a.h, rotate: degrees(a.angle || 0) });
      } else if (a.type === 'tampon') {
        await MPDS.pdfTampons.aplatir(PDFLib, sortie, c, a, polices, color);
      } else if (a.type === 'dessin') {
        for (let i = 1; i < a.pts.length; i++) {
          c.drawLine({ start: { x: a.pts[i - 1][0], y: a.pts[i - 1][1] }, end: { x: a.pts[i][0], y: a.pts[i][1] }, thickness: a.epaisseur, color, lineCap: LineCapStyle.Round });
        }
      }
    }
  }

  // copyPages suit toutes les références d'une page : une page retirée reste dans le fichier si un lien
  // (/Dest, /A), un widget (/P, /Parent) ou un article (/B) des pages gardées pointe vers elle.
  // On retire donc des pages gardées (dans la copie lue, jetée ensuite) toute entrée qui atteint une
  // page non gardée ou l'arbre des pages. Les liens vers les pages gardées restent (voir la copie).
  function isoler(lecteur, gardees) {
    const { PDFDict, PDFArray, PDFRef, PDFName, PDFStream } = PDFLib, ctx = lecteur.context;
    const garde = new Set(gardees.map(i => lecteur.getPage(i).ref));
    const TYPE = PDFName.of('Type'), INTERDITS = ['/Page', '/Pages', '/Catalog'];
    // vrai si `v` mène à une page non gardée, à l'arbre des pages ou au catalogue (parcours en
    // profondeur, sans descendre dans les pages gardées : elles sont nettoyées elles aussi)
    const atteint = (v, vus = new Set()) => {
      if (v instanceof PDFRef) {
        if (vus.has(v)) return false;
        vus.add(v);
        const o = ctx.lookup(v), t = o instanceof PDFDict && o.get(TYPE), n = t && t.toString();
        if (INTERDITS.includes(n)) return !(n === '/Page' && garde.has(v));
        return atteint(o, vus);
      }
      if (v instanceof PDFStream) return atteint(v.dict, vus);
      if (v instanceof PDFArray) return v.asArray().some(x => atteint(x, vus));
      if (v instanceof PDFDict) return [...v.entries()].some(([, x]) => atteint(x, vus));
      return false;                              // nombres, noms, chaînes
    };
    const nettoyer = (d, sauf) => { for (const [k, x] of [...d.entries()]) if (!sauf.includes(k.toString()) && atteint(x)) d.delete(k); };
    for (const ref of garde) {
      const page = ctx.lookup(ref), annots = page.lookup(PDFName.of('Annots'));
      if (annots instanceof PDFArray) for (const a of annots.asArray()) {
        const d = ctx.lookup(a);
        if (d instanceof PDFDict) nettoyer(d, ['/Subtype', '/Rect']);
      }
      nettoyer(page, ['/Parent', '/Annots', '/Contents', '/Resources']);   // /Parent : retiré par copyPages lui-même
    }
  }

  // Garde-fou : une page caviardée ne contient QUE son image (ni police, ni texte, ni annotation, ni autre dessin)
  function controlerTrame(c, nom) {
    const { PDFName, PDFDict, PDFArray } = PDFLib, res = c.node.Resources(), contenu = c.node.Contents();
    const xo = res && res.lookup(PDFName.of('XObject'));
    const seulImages = res && res.keys().every(k => String(k) === '/XObject' || (res.lookup(k) instanceof PDFDict && !res.lookup(k).keys().length));
    const images = xo instanceof PDFDict ? xo.keys().map(k => xo.lookup(k)) : [];
    const ops = contenu instanceof PDFArray && contenu.size() === 1 ? c.doc.context.lookup(contenu.get(0)).operators : null;
    const annots = c.node.lookup(PDFName.of('Annots'));   // le fork crée parfois un tableau vide : admis
    const ok = seulImages && images.length === 1 && images[0] && String(images[0].dict.get(PDFName.of('Subtype'))) === '/Image'
      && Array.isArray(ops) && ops.every(o => ['q', 'Q', 'cm', 'Do'].includes(o.name)) && (!annots || (annots instanceof PDFArray && !annots.size()));
    if (!ok) throw new Error(nom + ' (page image) : contenu inattendu, export refusé.');
  }

  // Page caviardée (ou compressée en image) : page NEUVE (même cadre, même rotation affichée) qui ne porte que
  // l'image de la page, zones noircies dans les pixels (trame.js), puis les autres annotations de l'utilisateur.
  // La page d'origine n'est jamais copiée : ni son texte, ni ses polices, ni ses annotations ne voyagent dans le fichier.
  async function pageTrame(sortie, p, polices, avis, nom, reglages) {
    const pj = await p.source.doc.getPage(p.index + 1);
    const { jpeg, view } = await MPDS.pdfTrame.rendre(pj, p.annots.filter(a => a.type === 'caviar'), avis, nom, reglages);
    const [x0, y0, x1, y1] = view, c = sortie.addPage([x1 - x0, y1 - y0]);
    c.setMediaBox(x0, y0, x1 - x0, y1 - y0);   // même repère que la page d'origine : les autres annotations restent en place
    c.drawImage(await sortie.embedJpg(jpeg), { x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
    await sortie.flush();
    controlerTrame(c, nom);
    c.setRotation(PDFLib.degrees((((pj.rotate + p.rotation) % 360) + 360) % 360));
    const v = p.source.valeurs;   // shortcut : valeurs saisies non reportées sur l'image ; à faire si le besoin se présente
    if (v && v.size && (await pj.getAnnotations()).some(a => a.fieldName && v.has(a.fieldName))) {
      avis.push(nom + ' : les valeurs saisies dans le formulaire n\'y figurent pas (la page devient une image). Enregistrez d\'abord le formulaire rempli, rouvrez-le, puis recommencez.');
    }
    await aplatir(sortie, c, p.annots.filter(a => a.type !== 'caviar'), polices);
  }

  // pages : [{ source, index, rotation, annots? }] → Uint8Array d'un nouveau PDF ; avis : reçoit les avertissements.
  // Tout est copié avant le premier await : une modification faite pendant l'export (chargement de
  // pdf-lib…) ne change pas le fichier en cours de construction.
  // avisFichier : avertissements qui ne concernent que le fichier PDF (par défaut avec les autres)
  // termes : termes caviardés par recherche, contrôlés dans le fichier produit (recherche.js)
  // options.trame = { dpi, qualite } : TOUTES les pages deviennent des images (compression.js)
  async function construire(pages, avis = [], avisFichier = avis, termes = [], options = {}) {
    pages = pages.map(p => ({ source: p.source, index: p.index, rotation: p.rotation, annots: structuredClone(p.annots || []) }));
    termes = [...termes];
    const reglages = options.trame && { dpi: options.trame.dpi, qualite: options.trame.qualite, verbe: 'convertie en image' };
    const trame = p => !!reglages || p.annots.some(a => a.type === 'caviar'), caviarde = pages.some(trame);
    const valeurs = new Map(pages.map(p => [p.source, new Map(p.source.valeurs || [])]));
    const { PDFDocument, PDFDict, PDFName, PDFObjectCopier, PDFPage, degrees } = await bibliotheque();
    const polices = new Map();
    const sortie = await PDFDocument.create();
    const copies = new Map();    // page du modèle → page copiée
    const perdus = new Set();    // éléments du document que l'export ne recopie pas
    for (const src of new Set(pages.map(p => p.source))) {
      let lecteur;
      try {
        // password '' : PDF chiffré par un mot de passe propriétaire seulement (cas des Cerfa) ;
        // preserveXFA : sinon le fork supprime le XFA en silence au chargement (remplir() avertit, lui)
        lecteur = await PDFDocument.load(src.octets, { password: '', updateMetadata: false, preserveXFA: true });
      } catch (err) {
        throw new Error('« ' + src.nom + ' » ne peut pas être relu pour l\'export (' + err.message + ').');
      }
      MPDS.pdfFormulaireExport.remplir(lecteur, src, valeurs.get(src), avis, avisFichier);   // formulaire rempli puis aplati
      const miennes = pages.filter(p => p.source === src && !trame(p));   // page caviardée : jamais copiée
      isoler(lecteur, miennes.map(p => p.index));
      const cat = lecteur.catalog;
      if (cat.has(PDFName.of('Outlines'))) perdus.add('les signets');
      if (cat.has(PDFName.of('StructTreeRoot'))) perdus.add("le balisage d'accessibilité");
      const noms = cat.lookup(PDFName.of('Names'));
      if (noms && noms.has && noms.has(PDFName.of('EmbeddedFiles'))) perdus.add('les pièces jointes');
      if (cat.has(PDFName.of('PageLabels'))) perdus.add('la numérotation des pages');
      if (lecteur.getTitle() || lecteur.getAuthor()) perdus.add('les métadonnées (titre, auteur)');
      // Copie par référence avec un seul copieur (ressources partagées) : un lien vers une page gardée
      // pointe ainsi sur SA copie, pas sur un doublon hors de l'arbre des pages (cas de copyPages)
      await lecteur.flush();
      const copieur = PDFObjectCopier.for(lecteur.context, sortie.context);
      for (const p of miennes) {
        const ref = copieur.copy(lecteur.getPage(p.index).ref);
        copies.set(p, PDFPage.of(sortie.context.lookup(ref), ref, sortie));
      }
    }
    for (const [k, p] of pages.entries()) {
      if (trame(p)) { await pageTrame(sortie, p, polices, avis, 'Page ' + (k + 1), reglages); continue; }
      const c = copies.get(p);
      const r = c.getRotation().angle, base = r % 90 ? 0 : r;   // /Rotate invalide : ignoré, comme PDF.js l'affiche
      c.setRotation(degrees((((base + p.rotation) % 360) + 360) % 360));
      if (caviarde) for (const cle of ['Metadata', 'PieceInfo', 'Thumb']) c.node.delete(PDFName.of(cle));   // métadonnées propres à la page
      sortie.addPage(c);
      await aplatir(sortie, c, p.annots || [], polices);
    }
    // Garde-fou de confidentialité : aucune page hors de celles demandées ne doit voyager dans le fichier
    const TYPE = PDFName.of('Type');
    const n = sortie.context.enumerateIndirectObjects().filter(([, o]) => o instanceof PDFDict && String(o.get(TYPE)) === '/Page').length;
    if (n !== pages.length) throw new Error('le fichier contiendrait ' + n + ' pages au lieu de ' + pages.length + ' (référence vers une page retirée).');
    if (perdus.size) { const l = [...perdus]; avisFichier.push('Non conservés dans le fichier exporté : ' + (l.length > 1 ? l.slice(0, -1).join(', ') + ' et ' : '') + l[l.length - 1] + '.'); }
    const octets = await sortie.save();
    // Caviardage : le fichier produit est relu (pages caviardées sans texte ; termes recherchés encore lisibles signalés)
    if (caviarde || termes.length) {
      await MPDS.pdfRecherche.verifier(octets, pages.map(p => ({ trame: trame(p), sansTexte: !p.annots.some(a => a.type === 'texte' || a.type === 'tampon') })), termes, avisFichier);
    }
    return octets;
  }

  // « dossier.pdf » + « modifié » → « dossier (modifié).pdf » (caractères interdits des noms de fichier retirés)
  const nomSortie = (nom, suffixe) => (nom.replace(/\.pdf$/i, '').replace(/[\/:*?"<>|\u0000-\u001f]/g, '_') || 'document') + ' (' + suffixe + ').pdf';

  function telecharger(octets, nom) {
    const url = URL.createObjectURL(new Blob([octets], { type: 'application/pdf' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: nom });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  MPDS.pdfExport = { URL_LIB, bibliotheque, construire, nomSortie, telecharger };
})();
