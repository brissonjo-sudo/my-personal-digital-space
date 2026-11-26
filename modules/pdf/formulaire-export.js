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
  // Radio sans état correspondant : l'option de pdf-lib (/Opt), désignée par indice ou par texte
  const option = (champ, v) => { const o = champ.getOptions(); return o.includes(v) ? v : (o[Number(v)] ?? v); };
  // Cases et radios : la valeur saisie est le nom d'état « coché » d'un widget (PDF.js : exportValue,
  // buttonValue), 'Off' pour rien. On pose /V et l'état de chaque widget directement : check() et
  // select() ne savent viser que le premier widget, ou passent par /Opt.
  function etat(champ, v) {
    const { PDFName, PDFCheckBox } = PDFLib, af = champ.acroField, off = PDFName.of('Off');
    const on = v && v !== 'Off' ? af.getWidgets().map(w => w.getOnValue()).find(n => n && n.decodeText() === v) : off;
    if (!on) {   // aucun widget n'a cet état (case sans apparence : PDF.js invente « Yes ») : API de pdf-lib, comme avant
      if (champ instanceof PDFCheckBox) champ.check(); else champ.select(option(champ, v));
      return;
    }
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
    if (!valeurs.size) {   // sans saisie, un formulaire mal formé ne doit pas empêcher l'export du document
      try { if (aplatir(lecteur.getForm())) avis.push('Le formulaire de « ' + src.nom + ' » est figé dans le fichier exporté : ses champs n\'y sont plus modifiables.'); }
      catch (err) { avis.push('Le formulaire de « ' + src.nom + ' » n\'a pas pu être figé (' + (err.message || err) + ') : ses champs sont copiés tels quels.'); }
      return;
    }
    const form = lecteur.getForm();
    if (form.hasXFA()) {    // formulaire XFA hybride : la partie XFA ne serait plus cohérente avec les valeurs
      form.deleteXFA();
      avis.push('« ' + src.nom + ' » contient aussi un formulaire XFA : seule sa partie classique est remplie, la partie XFA est abandonnée.');
    }
    for (const [nom, v] of valeurs) {
      try { appliquer(form, nom, v); }
      catch (err) { throw new Error('Champ « ' + nom + ' » de « ' + src.nom + ' » : ' + (err.message || err)); }
    }
    try { aplatir(form); }
    catch (err) { throw new Error('Le formulaire de « ' + src.nom + ' » ne peut pas être aplati (' + (err.message || err) + ').'); }
  }
  // Vrai si le formulaire avait des champs (aplatis)
  const aplatir = form => { if (!form.getFields().length) return false; form.flatten(); return true; };

  MPDS.pdfFormulaireExport = { remplir };
})();
