// Module PDF — formulaires AcroForm : détection (PDF.js seul, pdf-lib n'est pas chargé pour l'affichage),
// modèle des valeurs et couche de saisie (vrais contrôles HTML posés sur la page affichée).
// Valeurs : `source.valeurs` (Map nom complet du champ → valeur), donc par (source, champ) : elles suivent
// la page quand on la déplace, la pivote ou fusionne un autre PDF ; le même champ sur deux pages les partage.
//   texte : string · case et radio : string (nom d'état « coché » du widget choisi, 'Off' : aucun) · liste : [valeurs choisies]
// Cases de même nom (« Oui » / « Non » qui s'excluent, courant sur les Cerfa) : un seul état pour le champ.
// Seules les valeurs saisies sont stockées ; l'export (formulaire-export.js) ne touche pas aux autres champs.
// Noms et options viennent du fichier : textContent / value / setAttribute uniquement, jamais innerHTML.
// Publie MPDS.pdfFormulaire.creer(ctx).
//   ctx = { modele, bandeau (élément), message(texte, erreur), majBarre(), rafraichir({ rendre }) }
(() => {
  'use strict';

  // Genre d'un widget PDF.js (null : non pris en charge — signature, bouton poussoir…)
  const genre = a => a.fieldType === 'Tx' ? 'texte'
    : a.fieldType === 'Btn' ? (a.checkBox ? 'case' : a.radioButton ? 'radio' : null)
    : a.fieldType === 'Ch' ? 'liste' : null;
  const utile = a => a.subtype === 'Widget' && !a.hidden && genre(a);
  const el = (nom, classe, parent) => { const e = document.createElement(nom); e.className = classe; if (parent) parent.append(e); return e; };

  // Valeur affichée quand rien n'a été saisi : celle du fichier
  const initiale = (a, g) => g === 'case' ? (a.fieldValue || 'Off') : g === 'liste' ? (a.fieldValue || []) : (a.fieldValue || '');
  // Nom d'état d'un bouton, lisible : un indice (groupe avec /Opt, cas de pdf-lib) devient « option N »
  const libelleEtat = v => /^\d+$/.test(v || '') ? 'option ' + (Number(v) + 1) : (v || '');
  const pluriel = (n, mot) => n + ' ' + mot + (n > 1 ? 's' : '');

  function creer(ctx) {
    const { modele, bandeau } = ctx;
    const infos = new Map();    // source → { n (champs remplissables), sig (signatures), pur (XFA sans AcroForm) }
    let jeton = 0;

    // ---- Bandeau : détection, avertissements, réinitialisation ----
    const texte = el('span', 'pdf-bandeau-texte', bandeau);
    texte.id = 'pdf-form-texte';
    const reinit = el('button', 'pdf-btn', bandeau);
    reinit.type = 'button'; reinit.id = 'pdf-form-reinit'; reinit.textContent = 'Réinitialiser le formulaire';

    function majBandeau() {
      const vues = [...new Set(modele.liste.map(p => p.source))].map(s => infos.get(s)).filter(Boolean);
      const somme = cle => vues.reduce((t, i) => t + i[cle], 0);
      const n = somme('n'), sig = somme('sig'), pur = vues.some(i => i.pur);
      const phrases = [];
      if (n) phrases.push('Ce PDF contient un formulaire (' + pluriel(n, 'champ') + ').');
      if (pur) phrases.push('Ce PDF contient un formulaire XFA : non pris en charge. Le document reste visible et annotable.');
      if (sig) phrases.push(pluriel(sig, 'champ') + ' de signature numérique : non pris en charge.');
      texte.textContent = phrases.join(' ');
      bandeau.hidden = !phrases.length;
      reinit.hidden = !n;
    }

    // Parcourt les pages d'une source (annotations Widget) et lit son état XFA/AcroForm dans les métadonnées :
    // `isPureXfa` de PDF.js ne vaut que si enableXfa est activé (ce que l'application ne fait pas).
    async function detecter(source) {
      try {
        const noms = new Set();
        let sig = 0;
        for (let i = 1; i <= source.doc.numPages; i++) {
          for (const a of await (await source.doc.getPage(i)).getAnnotations()) {
            if (a.subtype !== 'Widget') continue;
            if (a.fieldType === 'Sig') sig++; else if (utile(a)) noms.add(a.fieldName);
          }
        }
        const { info } = await source.doc.getMetadata();
        if (!modele.sources.includes(source)) return;     // document fermé entre-temps
        infos.set(source, { n: noms.size, sig, pur: !!info.IsXFAPresent && !info.IsAcroFormPresent });
        majBandeau();
      } catch { /* formulaire illisible : le document reste utilisable sans saisie */ }
    }

    reinit.addEventListener('click', () => {
      if (!confirm('Effacer toutes les valeurs saisies dans le formulaire ?')) return;
      for (const s of modele.sources) if (s.valeurs) s.valeurs.clear();
      modele.marquerModifie();
      ctx.rafraichir({ rendre: true });
    });

    // ---- Couche de saisie ----
    function enregistrer(source, nom, valeur, groupe, origine) {
      (source.valeurs || (source.valeurs = new Map())).set(nom, valeur);
      for (const c of groupe.get(nom) || []) {                      // même champ posé plusieurs fois sur la page
        if (c === origine || c.type === 'radio') continue;           // (les radios se groupent par leur nom)
        if (c.type === 'checkbox') c.checked = valeur === c.dataset.etat;
        else if (c.tagName === 'SELECT') for (const o of c.options) o.selected = valeur.includes(o.value);
        else c.value = valeur;
      }
      modele.marquerModifie();
      ctx.majBarre();
    }

    function controle(a, g, valeur, k, h) {
      let c;
      if (g === 'texte') {
        c = document.createElement(a.multiLine ? 'textarea' : 'input');
        if (!a.multiLine) c.type = 'text';
        if (a.maxLen > 0) c.maxLength = a.maxLen;
        c.readOnly = a.readOnly;
        c.value = valeur;
        c.style.fontSize = (a.multiLine ? 11 * k : Math.min(h * 0.65, 12 * k)) + 'px';
      } else if (g === 'liste') {
        c = document.createElement('select');
        c.multiple = a.multiSelect; if (!a.combo) c.size = 2;
        if (!a.multiSelect && a.combo) c.add(new Option('', ''));   // liste vide tant que rien n'est choisi
        for (const o of a.options) c.add(new Option(o.displayValue, o.exportValue));
        for (const o of c.options) o.selected = valeur.includes(o.value);
        c.disabled = a.readOnly;
        c.style.fontSize = Math.min(h * 0.65, 12 * k) + 'px';
      } else {
        c = document.createElement('input');
        c.type = g === 'case' ? 'checkbox' : 'radio';
        c.checked = valeur === (g === 'case' ? a.exportValue : a.buttonValue);
        if (g === 'case') c.dataset.etat = a.exportValue;
        c.disabled = a.readOnly;
        c.style.fontSize = h * 0.85 + 'px';   // taille de la coche
      }
      return c;
    }

    // Ordre de lecture par rangées : un champ qui recouvre la rangée courante sur plus de la moitié de la
    // plus petite hauteur la rejoint (champs de hauteurs différentes sur une même ligne) ; rangées de haut
    // en bas, champs de gauche à droite dans chaque rangée
    function ordreLecture(cs) {
      const rangees = [];
      for (const c of [...cs].sort((a, b) => a.y - b.y)) {
        const r = rangees[rangees.length - 1];
        if (r && Math.min(r.bas, c.y + c.h) - c.y > Math.min(r.hmin, c.h) / 2) { r.cs.push(c); r.bas = Math.max(r.bas, c.y + c.h); r.hmin = Math.min(r.hmin, c.h); }
        else rangees.push({ cs: [c], bas: c.y + c.h, hmin: c.h });
      }
      return rangees.flatMap(r => r.cs.sort((a, b) => a.x - b.x));
    }

    // Pose la couche sur la page qui vient d'être affichée ; p : page PDF.js, base : viewport à l'échelle 1
    async function poser(feuille, entree, p, base) {
      const mon = ++jeton, source = entree.source;
      majBandeau();
      const widgets = (await p.getAnnotations()).filter(utile);
      if (mon !== jeton || !feuille.isConnected || !widgets.length) return;
      const info = MPDS.pdfCoord.infoPage(p, entree.rotation);
      const k = parseFloat(feuille.firstChild.style.width) / base.width;   // pixels CSS par point du viewport
      const couche = el('div', 'pdf-formulaire', feuille), groupe = new Map();
      couche.style.width = feuille.firstChild.style.width; couche.style.height = feuille.firstChild.style.height;
      const posees = widgets.map(a => {
        const [x0, y0, x1, y1] = a.rect, d = MPDS.pdfCoord.dePdf(info, x0, y0), f = MPDS.pdfCoord.dePdf(info, x1, y1);
        return { a, g: genre(a), x: Math.min(d.x, f.x), y: Math.min(d.y, f.y), w: Math.abs(f.x - d.x), h: Math.abs(f.y - d.y) };
      }).filter(c => c.w > 0 && c.h > 0);
      posees.splice(0, posees.length, ...ordreLecture(posees));   // ordre de tabulation
      const homonymes = new Map();   // nombre de cases par nom
      for (const { a, g } of posees) if (g === 'case') homonymes.set(a.fieldName, (homonymes.get(a.fieldName) || 0) + 1);
      for (const { a, g, x, y, w, h } of posees) {
        const nom = a.fieldName, valeur = source.valeurs && source.valeurs.has(nom) ? source.valeurs.get(nom) : initiale(a, g);
        const c = controle(a, g, valeur, k, h * k);
        c.classList.add('pdf-champ', 'pdf-champ-' + g);
        // boutons d'un même groupe : libellé distinct (lecteurs d'écran), suffixé de la valeur du bouton
        const etatBouton = libelleEtat(g === 'radio' ? a.buttonValue : g === 'case' && homonymes.get(nom) > 1 ? a.exportValue : '');
        c.setAttribute('aria-label', (a.alternativeText || nom) + (etatBouton ? ' : ' + etatBouton : ''));
        if (g === 'radio') c.name = 'pdf-' + nom;
        Object.assign(c.style, { left: x * k + 'px', top: y * k + 'px', width: w * k + 'px', height: h * k + 'px' });
        const lire = { texte: () => c.value, case: () => (c.checked ? a.exportValue : 'Off'), radio: () => a.buttonValue, liste: () => [...c.selectedOptions].map(o => o.value).filter(Boolean) }[g];
        c.addEventListener(g === 'texte' ? 'input' : 'change', () => {
          const v = lire();
          if (g === 'texte') {   // refus immédiat des caractères hors WinAnsi : le nom du champ est cité
            try { MPDS.pdfTexte.verifier(v); if (c.hasAttribute('aria-invalid')) { c.removeAttribute('aria-invalid'); ctx.message(''); } }
            catch (err) { c.setAttribute('aria-invalid', 'true'); ctx.message('Champ « ' + nom + ' » : ' + err.message, true); }
          }
          enregistrer(source, nom, v, groupe, c);
        });
        (groupe.get(nom) || groupe.set(nom, []).get(nom)).push(c);
        couche.append(c);
      }
    }

    return { detecter, poser, vider() { jeton++; infos.clear(); majBandeau(); } };
  }

  MPDS.pdfFormulaire = { creer };
})();
