// Module PDF — barre d'actions sur les pages : pivoter, supprimer, monter/descendre, ajouter un PDF,
// extraire la sélection, enregistrer. Dépend de pages.js (modèle) et export.js. Publie
// MPDS.pdfActions.creer(ctx).
//   ctx = { modele, barre (panneau Pages), barreDoc (en-tête), modif (élément d'état), courante(), nom(), rafraichir({ rendre }), message(texte, erreur), ajouter(fichier) }
(() => {
  'use strict';
  // [clé, libellé (= nom accessible), icône, zone : 'pages' (panneau, icône seule) ou 'doc' (en-tête, avec libellé), classe]
  const BOUTONS = [
    ['gauche', 'Pivoter à gauche', 'pivoter-gauche', 'pages'], ['droite', 'Pivoter à droite', 'pivoter-droite', 'pages'],
    ['monter', 'Monter la page', 'monter', 'pages'], ['descendre', 'Descendre la page', 'descendre', 'pages'],
    ['supprimer', 'Supprimer', 'supprimer', 'pages'], ['ajouter', 'Ajouter un PDF', 'ajouter', 'pages'],
    ['extraire', 'Extraire la sélection', 'extraire', 'pages'],
    ['markdown', 'Convertir en Markdown', 'markdown', 'doc'],
    ['enregistrer', 'Enregistrer le PDF', 'enregistrer', 'doc', 'pdf-btn-primaire'],
  ];

  function creer(ctx) {
    const { modele, barre, barreDoc, modif } = ctx;
    const b = {};
    let occupe = false;
    for (const [cle, libelle, icone, zone, classe] of BOUTONS) {
      const el = document.createElement('button');
      el.type = 'button'; el.className = 'pdf-btn ' + (classe || ''); el.id = 'pdf-act-' + cle;
      el.append(MPDS.icones.creer(icone));
      if (zone === 'pages') { el.classList.add('pdf-btn-icone'); el.setAttribute('aria-label', libelle); el.title = libelle; }
      else el.append(' ' + libelle);
      b[cle] = el; (zone === 'pages' ? barre : barreDoc).append(el);
    }
    const fichier = document.createElement('input');
    fichier.type = 'file'; fichier.id = 'pdf-ajout'; fichier.accept = '.pdf,application/pdf'; fichier.hidden = true;
    barre.append(fichier);

    function maj() {
      const n = modele.liste.length, ouvert = n > 0, cur = ctx.courante();
      const toutes = ouvert && modele.cibles(cur).length >= n;
      for (const k of ['gauche', 'droite', 'ajouter', 'markdown', 'enregistrer']) b[k].disabled = !ouvert || occupe;
      b.supprimer.disabled = !ouvert || occupe || toutes;
      b.supprimer.title = toutes ? 'Impossible de supprimer toutes les pages du document' : 'Supprimer';
      b.monter.disabled = !ouvert || occupe || cur <= 1;
      b.descendre.disabled = !ouvert || occupe || cur >= n;
      b.extraire.disabled = occupe || modele.selection.size === 0;
      modif.textContent = ouvert && modele.modifie ? '● Modifications non enregistrées' : '';
    }

    // Les actions de page visent la sélection, sinon la page courante
    const agir = f => () => {
      try { f(); } catch (err) { ctx.message(err.message, true); }
      ctx.rafraichir({ rendre: true });
    };
    b.gauche.addEventListener('click', agir(() => modele.pivoter(modele.cibles(ctx.courante()), -90)));
    b.droite.addEventListener('click', agir(() => modele.pivoter(modele.cibles(ctx.courante()), 90)));
    b.supprimer.addEventListener('click', agir(() => modele.supprimer(modele.cibles(ctx.courante()))));
    const deplacer = sens => () => { const c = ctx.courante(); modele.deplacer(modele.liste[c - 1], c - 1 + sens); ctx.rafraichir({}); };
    b.monter.addEventListener('click', deplacer(-1));
    b.descendre.addEventListener('click', deplacer(1));
    b.ajouter.addEventListener('click', () => fichier.click());
    fichier.addEventListener('change', () => { const f = fichier.files[0]; fichier.value = ''; ctx.ajouter(f); });

    // Construit le PDF des pages données et le livre (téléchargement par défaut) ; erreurs
    // (bibliothèque, export) affichées
    async function exporter(pages, suffixe, livrer = MPDS.pdfExport.telecharger) {
      occupe = true; maj();
      ctx.message('Préparation du PDF…');
      try {
        const nom = suffixe ? MPDS.pdfExport.nomSortie(ctx.nom(), suffixe) : ctx.nom();
        const avis = [], avisFichier = [];   // sur le contenu (suivent le fichier) ; sur le fichier PDF seulement
        livrer(await MPDS.pdfExport.construire(pages, avis, avisFichier, modele.termes), nom, avis);
        ctx.message('« ' + nom + ' » ' + (suffixe ? 'enregistré.' : 'envoyé au module Convertir.') + [...avis, ...avisFichier].map(a => ' ' + a).join(''));
        return true;
      } catch (err) {
        ctx.message('L\'export a échoué : ' + (err.message || err), true);
        return false;
      } finally { occupe = false; maj(); }
    }
    b.enregistrer.addEventListener('click', async () => {
      const v = modele.version;   // une modification faite pendant l'export laisse l'indicateur allumé
      const caviarde = modele.liste.some(p => p.annots.some(a => a.type === 'caviar'));
      if (await exporter(modele.liste.slice(), caviarde ? 'caviardé' : 'modifié')) { modele.enregistre(v); maj(); }
    });
    b.extraire.addEventListener('click', () => exporter(modele.liste.filter(p => modele.selection.has(p)), 'extrait'));
    // Passerelle : le document tel qu'affiché (pages, annotations, formulaire) part au convertisseur,
    // en mémoire, sous le nom d'origine (le .md portera ce nom)
    b.markdown.addEventListener('click', () => exporter(modele.liste.slice(), '',
      // le convertisseur choisit d'après l'extension : un PDF nommé « Scan_0001 » ou « x.txt » doit finir en .pdf
      // les avis sur le contenu (XFA abandonné, champ non figé) suivent le fichier : le module PDF est masqué à l'envoi
      (octets, nom, avis) => MPDS.envoyer(new File([octets], nom.replace(/\.pdf$/i, '') + '.pdf', { type: 'application/pdf' }), 'convertir', { avis })));

    return { maj };
  }

  MPDS.pdfActions = { creer };
})();
