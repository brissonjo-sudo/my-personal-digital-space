// Module PDF — barre d'actions sur les pages : pivoter, supprimer, monter/descendre, ajouter un PDF,
// extraire la sélection, enregistrer. Dépend de pages.js (modèle) et export.js. Publie
// MPDS.pdfActions.creer(ctx).
//   ctx = { modele, barre, courante(), nom(), rafraichir({ rendre }), message(texte, erreur), ajouter(fichier) }
(() => {
  'use strict';
  const BOUTONS = [   // [clé, libellé, pictogramme décoratif, classe]
    ['gauche', 'Pivoter à gauche', '↺'], ['droite', 'Pivoter à droite', '↻'],
    ['monter', 'Monter la page', '▲'], ['descendre', 'Descendre la page', '▼'],
    ['supprimer', 'Supprimer', '🗑'], ['ajouter', 'Ajouter un PDF', '＋'],
    ['extraire', 'Extraire la sélection', ''], ['markdown', 'Convertir en Markdown', '📝'],
    ['enregistrer', 'Enregistrer le PDF', '', 'pdf-btn-primaire'],
  ];

  function creer(ctx) {
    const { modele, barre } = ctx;
    const b = {};
    let occupe = false;
    for (const [cle, libelle, picto, classe] of BOUTONS) {
      const el = document.createElement('button');
      el.type = 'button'; el.className = 'pdf-btn ' + (classe || ''); el.id = 'pdf-act-' + cle;
      if (picto) { const s = document.createElement('span'); s.setAttribute('aria-hidden', 'true'); s.textContent = picto + ' '; el.append(s); }
      el.append(libelle);
      b[cle] = el; barre.append(el);
    }
    const modif = document.createElement('span');
    modif.id = 'pdf-modif'; modif.className = 'pdf-modif'; modif.setAttribute('role', 'status');
    const fichier = document.createElement('input');
    fichier.type = 'file'; fichier.id = 'pdf-ajout'; fichier.accept = '.pdf,application/pdf'; fichier.hidden = true;
    barre.append(modif, fichier);

    function maj() {
      const n = modele.liste.length, ouvert = n > 0, cur = ctx.courante();
      const toutes = ouvert && modele.cibles(cur).length >= n;
      for (const k of ['gauche', 'droite', 'ajouter', 'markdown', 'enregistrer']) b[k].disabled = !ouvert || occupe;
      b.supprimer.disabled = !ouvert || occupe || toutes;
      b.supprimer.title = toutes ? 'Impossible de supprimer toutes les pages du document' : '';
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
        const avis = [];
        livrer(await MPDS.pdfExport.construire(pages, avis), nom);
        ctx.message('« ' + nom + ' » ' + (suffixe ? 'enregistré.' : 'envoyé au module Convertir.') + avis.map(a => ' ' + a).join(''));
        return true;
      } catch (err) {
        ctx.message('L\'export a échoué : ' + (err.message || err), true);
        return false;
      } finally { occupe = false; maj(); }
    }
    b.enregistrer.addEventListener('click', async () => { if (await exporter(modele.liste.slice(), 'modifié')) { modele.enregistre(); maj(); } });
    b.extraire.addEventListener('click', () => exporter(modele.liste.filter(p => modele.selection.has(p)), 'extrait'));
    // Passerelle : le document tel qu'affiché (pages, annotations, formulaire) part au convertisseur,
    // en mémoire, sous le nom d'origine (le .md portera ce nom)
    b.markdown.addEventListener('click', () => exporter(modele.liste.slice(), '',
      (octets, nom) => MPDS.envoyer(new File([octets], nom, { type: 'application/pdf' }), 'convertir')));

    return { maj };
  }

  MPDS.pdfActions = { creer };
})();
