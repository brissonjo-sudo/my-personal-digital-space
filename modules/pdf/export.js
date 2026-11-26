// Module PDF — export : reconstruit un PDF neuf à partir du modèle de pages (copyPages,
// setRotation). Bibliothèque d'écriture chargée à la demande (≈ 600 Ko), vérifiée par SRI.
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

  // pages : [{ source, index, rotation }] → Uint8Array d'un nouveau PDF
  async function construire(pages) {
    const { PDFDocument, degrees } = await bibliotheque();
    const sortie = await PDFDocument.create();
    const copies = new Map();    // page du modèle → page copiée
    for (const src of new Set(pages.map(p => p.source))) {
      let lecteur;
      try {
        // password '' : PDF chiffré par un mot de passe propriétaire seulement (cas des Cerfa)
        lecteur = await PDFDocument.load(src.octets, { password: '', updateMetadata: false });
      } catch (err) {
        throw new Error('« ' + src.nom + ' » ne peut pas être relu pour l\'export (' + err.message + ').');
      }
      const miennes = pages.filter(p => p.source === src);
      const pgs = await sortie.copyPages(lecteur, miennes.map(p => p.index));   // un seul appel : ressources partagées
      miennes.forEach((p, i) => copies.set(p, pgs[i]));
    }
    for (const p of pages) {
      const c = copies.get(p);
      c.setRotation(degrees((((c.getRotation().angle + p.rotation) % 360) + 360) % 360));
      sortie.addPage(c);
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
