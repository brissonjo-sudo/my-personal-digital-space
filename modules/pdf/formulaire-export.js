// Module PDF — export des formulaires : applique les valeurs saisies (source.valeurs) à la source relue
// avec pdf-lib, puis aplatit le formulaire (form.flatten) AVANT copyPages : les valeurs sont figées dans
// la page, comme les annotations. Les textes passent par MPDS.pdfTexte.verifier (le fork remplace sinon
// en silence un caractère hors WinAnsi par « ? »). Publie MPDS.pdfFormulaireExport.remplir.
(() => {
  'use strict';

  // PDF.js donne la valeur d'export d'une option de liste, pdf-lib la désigne par son texte affiché
  const affiche = (champ, v) => {
    const o = champ.acroField.getOptions().find(x => x.value.decodeText() === v);
    return o ? (o.display || o.value).decodeText() : v;
  };
  // Radio : PDF.js donne le nom de l'état « coché » du bouton, qui est un indice quand le groupe a un /Opt (pdf-lib : l'option)
  const option = (champ, v) => { const o = champ.getOptions(); return o.includes(v) ? v : (o[Number(v)] ?? v); };

  function appliquer(form, nom, v) {
    const { PDFTextField, PDFCheckBox, PDFRadioGroup, PDFDropdown, PDFOptionList } = PDFLib;
    const champ = form.getField(nom);       // NoSuchFieldError si le champ n'existe plus dans le fichier
    if (champ instanceof PDFTextField) champ.setText(v === '' ? undefined : MPDS.pdfTexte.verifier(v));
    else if (champ instanceof PDFCheckBox) { if (v) champ.check(); else champ.uncheck(); }
    else if (champ instanceof PDFRadioGroup) champ.select(option(champ, v));
    else if (champ instanceof PDFDropdown || champ instanceof PDFOptionList) { if (v.length) champ.select(champ instanceof PDFDropdown ? affiche(champ, v[0]) : v.map(x => affiche(champ, x))); else champ.clear(); }
    else throw new Error('type de champ non pris en charge');
  }

  // lecteur : PDFDocument de la source ; avis : tableau où ajouter les avertissements
  function remplir(lecteur, src, avis) {
    const form = lecteur.getForm();
    if (form.hasXFA()) {    // formulaire XFA hybride : la partie XFA ne serait plus cohérente avec les valeurs
      form.deleteXFA();
      avis.push('« ' + src.nom + ' » contient aussi un formulaire XFA : seule sa partie classique est remplie, la partie XFA est abandonnée.');
    }
    for (const [nom, v] of src.valeurs) {
      try { appliquer(form, nom, v); }
      catch (err) { throw new Error('Champ « ' + nom + ' » de « ' + src.nom + ' » : ' + (err.message || err)); }
    }
    try { form.flatten(); }
    catch (err) { throw new Error('Le formulaire de « ' + src.nom + ' » ne peut pas être aplati (' + (err.message || err) + ').'); }
  }

  MPDS.pdfFormulaireExport = { remplir };
})();
