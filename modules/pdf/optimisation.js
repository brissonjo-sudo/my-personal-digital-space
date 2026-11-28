// Module PDF — optimisation sans perte : le fichier ouvert est relu par pdf-lib et réécrit à l'identique,
// avec les flux non compressés passés en Flate (zlib : CompressionStream du navigateur) et les objets
// regroupés en flux d'objets. Rien n'est retiré : signets, formulaires, pièces jointes et métadonnées restent.
// Mesure du 2026-11-28 sur 26 PDF réels : 0 à 10 % le plus souvent, 78 % sur un fichier aux flux bruts.
// Publie MPDS.pdfOptimisation.{ identique(modele), optimiser(source, avis) }.
(() => {
  'use strict';

  async function deflate(octets) {
    const flux = new Blob([octets]).stream().pipeThrough(new CompressionStream('deflate'));
    return new Uint8Array(await new Response(flux).arrayBuffer());
  }

  // Le document affiché est-il exactement le fichier ouvert ? Sinon, optimiser ce fichier perdrait les
  // modifications (et rendrait le texte d'une zone caviardée). « modifie » ne suffit pas : il s'éteint à l'enregistrement.
  function identique(modele) {
    const s = modele.sources[0];
    return modele.sources.length === 1 && modele.liste.length === s.doc.numPages && !(s.valeurs && s.valeurs.size)
      && modele.liste.every((p, k) => p.source === s && p.index === k && !p.rotation && !p.annots.length);
  }

  // source : { nom, doc (PDF.js), octets } → Uint8Array ; avis reçoit ce que la réécriture ne conserve pas
  async function optimiser(source, avis) {
    const { PDFDocument, PDFName, PDFRawStream } = await MPDS.pdfExport.bibliotheque();
    let doc;
    try {
      // mêmes options que l'export : Cerfa (mot de passe propriétaire seul), XFA gardé
      doc = await PDFDocument.load(source.octets, { password: '', updateMetadata: false, preserveXFA: true });
    } catch (err) {
      throw new Error('« ' + source.nom + ' » ne peut pas être relu (' + err.message + ').');
    }
    if (typeof CompressionStream === 'function') {
      const n = k => PDFName.of(k);
      for (const [ref, o] of doc.context.enumerateIndirectObjects()) {
        // seulement les flux sans filtre ; XMP laissé en clair (lisible par les outils d'archivage)
        if (!(o instanceof PDFRawStream) || ['Filter', 'DecodeParms', 'F'].some(k => o.dict.has(n(k)))) continue;
        if (String(o.dict.get(n('Type'))) === '/Metadata') continue;
        const z = await deflate(o.contents);
        if (z.length >= o.contents.length) continue;
        o.dict.set(n('Filter'), n('FlateDecode'));
        doc.context.assign(ref, PDFRawStream.of(o.dict, z));   // /Length recalculé à l'écriture
      }
    }
    const info = (await source.doc.getMetadata()).info || {};
    if (info.EncryptFilterName) avis.push('La protection du fichier (mot de passe propriétaire, restrictions d\'usage) n\'est pas conservée.');
    if (info.IsSignaturesPresent) avis.push('Le document porte une signature électronique : elle ne sera plus valide dans le fichier optimisé.');
    const octets = await doc.save({ useObjectStreams: true });
    // Contrôle : le fichier produit se relit, avec les mêmes pages aux mêmes dimensions
    const relu = await (await MPDS.pdfjs.ouvrir(octets.slice().buffer)).promise;
    try {
      if (relu.numPages !== source.doc.numPages) throw new Error('nombre de pages différent');
      for (let i = 1; i <= relu.numPages; i++) {
        const [a, b] = [await relu.getPage(i), await source.doc.getPage(i)];
        if (a.view.join() !== b.view.join() || a.rotate !== b.rotate) throw new Error('page ' + i + ' différente');
      }
    } catch (err) {
      throw new Error('optimisation refusée, le fichier produit ne correspond pas à l\'original (' + err.message + ').');
    } finally { relu.destroy(); }
    return octets;
  }

  MPDS.pdfOptimisation = { identique, optimiser };
})();
