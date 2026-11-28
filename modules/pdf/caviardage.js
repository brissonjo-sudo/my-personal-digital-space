// Module PDF — caviardage par recherche : bouton « Rechercher et caviarder » dans la bande d'outils et
// panneau sous la barre. Cherche le terme dans tout le document (recherche.js), annonce les pages sans
// texte (scans : non cherchables), puis pose les zones noires en un seul geste, annulable d'un Ctrl+Z.
// Publie MPDS.pdfCaviardage.creer(ctx) ; ctx = { modele, annotations, barre, aller(n), message(texte, erreur) }.
(() => {
  'use strict';
  const el = (nom, props, ...enfants) => {
    const e = Object.assign(document.createElement(nom), props);
    e.append(...enfants);
    return e;
  };
  const pages = l => (l.length > 1 ? 'pages ' : 'page ') + l.join(', ');

  function creer(ctx) {
    const { modele, annotations, barre } = ctx;
    let trouve = null, jeton = 0;   // dernier résultat : { terme, poses: [[entrée de page, zone]] }

    const ouvrir = el('button', { type: 'button', className: 'pdf-btn', id: 'pdf-rechercher', title: 'Rechercher un mot et le caviarder partout' },
      MPDS.icones.creer('rechercher'), ' Rechercher et caviarder');
    barre.append(ouvrir);
    const champ = el('input', { type: 'search', id: 'pdf-cav-terme', autocomplete: 'off', spellcheck: false });
    const poser = el('button', { type: 'button', className: 'pdf-btn pdf-btn-primaire', id: 'pdf-cav-poser', hidden: true });
    const fermerBtn = el('button', { type: 'button', className: 'pdf-btn pdf-btn-icone', title: 'Fermer la recherche' }, MPDS.icones.creer('fermer'));
    fermerBtn.setAttribute('aria-label', 'Fermer la recherche');
    const resultat = el('p', { className: 'pdf-cav-resultat', id: 'pdf-cav-resultat' });
    resultat.setAttribute('role', 'status');
    const panneau = el('form', { className: 'pdf-cav', id: 'pdf-cav', hidden: true },
      el('label', { className: 'pdf-reglage' }, 'Mot ou expression à caviarder ', champ),
      el('button', { type: 'submit', className: 'pdf-btn' }, 'Chercher'), poser, fermerBtn, resultat);
    panneau.setAttribute('role', 'search');
    panneau.setAttribute('aria-label', 'Rechercher et caviarder');
    barre.after(panneau);

    function fermer() {
      jeton++; trouve = null;
      panneau.hidden = true; poser.hidden = true; champ.value = ''; resultat.textContent = '';
    }

    async function chercher() {
      const terme = champ.value.trim(), cible = MPDS.pdfRecherche.normaliser(terme), mon = ++jeton;
      trouve = null; poser.hidden = true;
      if (cible.length < 2) { resultat.textContent = 'Saisissez au moins 2 caractères.'; return; }
      resultat.textContent = 'Recherche en cours…';
      const poses = [], avec = [], sans = [];
      let n = 0;
      try {
        for (const [k, entree] of modele.liste.slice().entries()) {
          const r = await MPDS.pdfRecherche.chercherPage(await entree.source.doc.getPage(entree.index + 1), cible);
          if (mon !== jeton) return;   // nouvelle recherche, panneau fermé ou document changé entre-temps
          if (r.sansTexte) sans.push(k + 1);
          if (r.n) { n += r.n; avec.push(k + 1); for (const z of r.zones) poses.push([entree, { type: 'caviar', ...z }]); }
        }
      } catch (err) {
        if (mon === jeton) resultat.textContent = 'Recherche impossible (' + err.message + ').';
        return;
      }
      trouve = { terme, poses };
      // « 0 occurrence » n'est jamais présenté comme un document propre : les pages sans texte sont nommées
      resultat.textContent = (n ? '« ' + terme + ' » : ' + n + (n > 1 ? ' occurrences, ' : ' occurrence, ') + pages(avec) + '.'
        : 'Aucune occurrence de « ' + terme + ' » dans le texte du document.')
        + (sans.length ? ' Attention, ' + pages(sans) + ' sans texte (image ou scan) : la recherche n\'y voit rien, caviardez à la main.' : '');
      if (n) { poser.textContent = n > 1 ? 'Caviarder les ' + n + ' occurrences' : 'Caviarder l\'occurrence'; poser.hidden = false; }
    }

    ouvrir.addEventListener('click', () => {
      if (!panneau.hidden) { fermer(); return; }
      panneau.hidden = false; champ.focus();
    });
    fermerBtn.addEventListener('click', fermer);
    champ.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); fermer(); ouvrir.focus(); } });
    champ.addEventListener('input', () => { trouve = null; poser.hidden = true; });
    panneau.addEventListener('submit', e => { e.preventDefault(); chercher(); });
    poser.addEventListener('click', () => {
      if (!trouve) return;
      const vivantes = trouve.poses.filter(([entree]) => modele.liste.includes(entree));
      modele.termes.add(trouve.terme);   // contrôlé dans le fichier exporté (recherche.js, verifier)
      annotations.ajouterLot(vivantes);
      trouve = null; poser.hidden = true;
      resultat.textContent = vivantes.length + (vivantes.length > 1 ? ' zones noires posées.' : ' zone noire posée.')
        + ' Vérifiez chaque page : une zone en trop se retire avec l\'outil Sélection puis Suppr, Ctrl+Z retire tout le lot. À l\'enregistrement, chaque page caviardée devient une image.';
    });

    return { fermer };
  }

  MPDS.pdfCaviardage = { creer };
})();
