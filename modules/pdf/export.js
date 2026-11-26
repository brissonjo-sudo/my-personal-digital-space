// Module PDF — export : reconstruit un PDF neuf à partir du modèle de pages (copyPages,
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

  // pages : [{ source, index, rotation, annots? }] → Uint8Array d'un nouveau PDF ; avis : reçoit les avertissements
  async function construire(pages, avis = []) {
    const { PDFDocument, degrees } = await bibliotheque();
    const polices = new Map();
    const sortie = await PDFDocument.create();
    const copies = new Map();    // page du modèle → page copiée
    for (const src of new Set(pages.map(p => p.source))) {
      let lecteur;
      try {
        // password '' : PDF chiffré par un mot de passe propriétaire seulement (cas des Cerfa) ;
        // preserveXFA : sinon le fork supprime le XFA en silence au chargement (remplir() avertit, lui)
        lecteur = await PDFDocument.load(src.octets, { password: '', updateMetadata: false, preserveXFA: true });
      } catch (err) {
        throw new Error('« ' + src.nom + ' » ne peut pas être relu pour l\'export (' + err.message + ').');
      }
      if (src.valeurs && src.valeurs.size) MPDS.pdfFormulaireExport.remplir(lecteur, src, avis);   // valeurs du formulaire, aplaties
      const miennes = pages.filter(p => p.source === src);
      const pgs = await sortie.copyPages(lecteur, miennes.map(p => p.index));   // un seul appel : ressources partagées
      miennes.forEach((p, i) => copies.set(p, pgs[i]));
    }
    for (const p of pages) {
      const c = copies.get(p);
      c.setRotation(degrees((((c.getRotation().angle + p.rotation) % 360) + 360) % 360));
      sortie.addPage(c);
      await aplatir(sortie, c, p.annots || [], polices);
    }
    return sortie.save();
  }

  // « dossier.pdf » + « modifié » → « dossier (modifié).pdf » (caractères interdits des noms de fichier retirés)
  const nomSortie = (nom, suffixe) => (nom.replace(/\.pdf$/i, '').replace(/[\/:*?"<>|\u0000-\u001f]/g, '_') || 'document') + ' (' + suffixe + ').pdf';

  function telecharger(octets, nom) {
    const url = URL.createObjectURL(new Blob([octets], { type: 'application/pdf' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: nom });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  MPDS.pdfExport = { URL_LIB, construire, nomSortie, telecharger };
})();
