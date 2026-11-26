// Module PDF — export des formulaires : applique les valeurs saisies (copie de source.valeurs) à la source relue
// avec pdf-lib, puis aplatit le formulaire (form.flatten) AVANT copyPages : les valeurs sont figées dans
// la page, comme les annotations. Les textes passent par MPDS.pdfTexte.verifier (le fork remplace sinon
// en silence un caractère hors WinAnsi par « ? »). Publie MPDS.pdfFormulaireExport.remplir.
(() => {
  'use strict';

  // PDF.js donne la valeur d'export d'une option de liste, pdf-lib la désigne par son texte affiché
  const affiche = (champ, v) => {
    const o = champ.acroField.getOptions().find(x => x.value.decodeText() === v);
    return MPDS.pdfTexte.verifier(o ? (o.display || o.value).decodeText() : v);
  };
  // Cases et radios : la valeur saisie est le nom d'état « coché » d'un widget (PDF.js : exportValue,
  // buttonValue), 'Off' pour rien. On pose /V et l'état de chaque widget directement : check() et
  // select() ne savent viser que le premier widget, ou passent par /Opt.
  function etat(champ, v) {
    const { PDFName } = PDFLib, af = champ.acroField, off = PDFName.of('Off');
    const on = v && v !== 'Off' ? af.getWidgets().map(w => w.getOnValue()).find(n => n && n.decodeText() === v) : off;
    if (!on) throw new Error('valeur « ' + v + ' » absente du champ');
    af.dict.set(PDFName.of('V'), on);
    for (const w of af.getWidgets()) w.setAppearanceState(w.getOnValue() === on ? on : off);
  }

  function appliquer(form, nom, v) {
    const { PDFTextField, PDFCheckBox, PDFRadioGroup, PDFDropdown, PDFOptionList } = PDFLib;
    const champ = form.getField(nom);       // NoSuchFieldError si le champ n'existe plus dans le fichier
    if (champ instanceof PDFTextField) champ.setText(v === '' ? undefined : MPDS.pdfTexte.verifier(v));
    else if (champ instanceof PDFCheckBox || champ instanceof PDFRadioGroup) etat(champ, v);
    else if (champ instanceof PDFDropdown || champ instanceof PDFOptionList) { if (v.length) champ.select(champ instanceof PDFDropdown ? affiche(champ, v[0]) : v.map(x => affiche(champ, x))); else champ.clear(); }
    else throw new Error('type de champ non pris en charge');
  }

  // lecteur : PDFDocument de la source ; valeurs : Map nom → valeur saisie ; avis : avertissements.
  // Tout formulaire est aplati, même sans saisie : sinon ses widgets seraient copiés sans AcroForm
  // (orphelins, encore modifiables dans certains lecteurs) et les valeurs déjà présentes perdues au texte.
  function remplir(lecteur, src, valeurs, avis) {
    const { PDFName } = PDFLib;
    if (!lecteur.catalog.has(PDFName.of('AcroForm'))) return;
    const form = lecteur.getForm();
    if (!form.getFields().length) return;
    if (form.hasXFA()) {    // formulaire XFA hybride : la partie XFA ne serait plus cohérente avec les valeurs
      form.deleteXFA();
      if (valeurs.size) avis.push('« ' + src.nom + ' » contient aussi un formulaire XFA : seule sa partie classique est remplie, la partie XFA est abandonnée.');
    }
    for (const [nom, v] of valeurs) {
      try { appliquer(form, nom, v); }
      catch (err) { throw new Error('Champ « ' + nom + ' » de « ' + src.nom + ' » : ' + (err.message || err)); }
    }
    try { form.flatten(); }
    catch (err) { throw new Error('Le formulaire de « ' + src.nom + ' » ne peut pas être aplati (' + (err.message || err) + ').'); }
  }

  MPDS.pdfFormulaireExport = { remplir };
})();
