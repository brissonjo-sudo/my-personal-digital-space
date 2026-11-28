// Module PDF — panneau « Compresser » sous l'en-tête : calcule le poids du document selon deux modes et
// propose d'enregistrer celui qui allège :
//   - sans perte (optimisation.js), seulement si le document affiché est le fichier ouvert tel quel ;
//   - pages en image (export.js, option trame : chaque page devient un JPEG) ; le texte n'est plus sélectionnable.
// Sans gain, rien n'est proposé : jamais le fichier d'origine à la place du document modifié (zones caviardées).
// Publie MPDS.pdfCompression.creer(ctx) ; ctx = { modele, apres (élément suivi du panneau), nom(), message(texte, erreur) }.
(() => {
  'use strict';
  const RESOLUTIONS = [[150, '150 ppp (impression)'], [100, '100 ppp'], [72, '72 ppp (écran)']];
  const QUALITES = [[0.85, 'Haute'], [0.7, 'Moyenne'], [0.5, 'Basse']];
  const el = (nom, props, ...enfants) => {
    const e = Object.assign(document.createElement(nom), props);
    e.append(...enfants);
    return e;
  };
  const virgule = x => x.toFixed(1).replace('.', ',');
  const poids = n => n < 10240 ? virgule(n / 1024) + ' Ko' : n < 1048576 ? Math.round(n / 1024) + ' Ko' : virgule(n / 1048576) + ' Mo';
  const gain = (avant, apres) => { const g = Math.round((1 - apres / avant) * 100); return g < 1 ? 'moins de 1 %' : '−' + g + ' %'; };
  const liste = l => l.map(a => ' ' + a).join('');

  function creer(ctx) {
    const { modele } = ctx;
    let jeton = 0;
    const choix = (id, options, defaut) => {
      const s = el('select', { id });
      for (const [v, t] of options) s.add(new Option(t, v, false, v === defaut));
      return s;
    };
    const dpi = choix('pdf-comp-dpi', RESOLUTIONS, 150), qualite = choix('pdf-comp-qualite', QUALITES, 0.7);
    const calculer = el('button', { type: 'submit', className: 'pdf-btn pdf-btn-primaire', id: 'pdf-comp-calculer' }, 'Calculer');
    const fermerBtn = el('button', { type: 'button', className: 'pdf-btn pdf-btn-icone', title: 'Fermer la compression' }, MPDS.icones.creer('fermer'));
    fermerBtn.setAttribute('aria-label', 'Fermer la compression');
    const etat = el('p', { className: 'pdf-cav-resultat', id: 'pdf-comp-etat' });
    etat.setAttribute('role', 'status');
    const resultats = el('ul', { className: 'pdf-comp-liste', id: 'pdf-comp-liste' });
    const panneau = el('form', { className: 'pdf-cav', id: 'pdf-comp', hidden: true },
      el('label', { className: 'pdf-reglage' }, 'Pages en image : résolution ', dpi),
      el('label', { className: 'pdf-reglage' }, 'Qualité ', qualite), calculer, fermerBtn, etat, resultats);
    panneau.setAttribute('aria-label', 'Compresser le PDF');
    ctx.apres.after(panneau);

    function fermer() {
      jeton++;
      panneau.hidden = true; calculer.disabled = false; etat.textContent = ''; resultats.replaceChildren();
    }

    // Ligne de résultat ; bouton d'enregistrement seulement s'il y a un gain, et tant que le document n'a pas changé
    function ligne(id, texte, octets, version, suffixe, nomBouton) {
      const li = el('li', { id }, texte);
      if (octets) {
        const b = el('button', { type: 'button', className: 'pdf-btn' }, 'Enregistrer');
        b.setAttribute('aria-label', nomBouton);
        b.addEventListener('click', () => {
          if (modele.version !== version) { etat.textContent = 'Le document a changé depuis le calcul : recalculez.'; resultats.replaceChildren(); return; }
          const nom = MPDS.pdfExport.nomSortie(ctx.nom(), suffixe);
          MPDS.pdfExport.telecharger(octets, nom);
          ctx.message('« ' + nom + ' » enregistré.');
        });
        li.append(' ', b);
      }
      resultats.append(li);
    }

    async function lancer() {
      const mon = ++jeton, version = modele.version, pages = modele.liste.slice(), termes = [...modele.termes];
      const reglages = { dpi: Number(dpi.value), qualite: Number(qualite.value) };
      const suffixe = pages.some(p => p.annots.some(a => a.type === 'caviar')) ? 'caviardé, compressé' : 'compressé';
      const tel = MPDS.pdfOptimisation.identique(modele), source = modele.sources[0];
      resultats.replaceChildren(); calculer.disabled = true;
      etat.textContent = 'Calcul en cours…';
      let relu = null;
      try {
        // Référence : le fichier ouvert, ou le document modifié tel que « Enregistrer le PDF » le produit
        // (formulaire rempli et figé, annotations aplaties, pages caviardées déjà en image)
        const avisNormal = [], normal = tel ? null : await MPDS.pdfExport.construire(pages, avisNormal, avisNormal, termes);
        const base = tel ? source.octets.byteLength : normal.length;
        if (mon !== jeton) return;
        etat.textContent = (tel ? 'Fichier d\'origine : ' : 'Document modifié, enregistré normalement : ') + poids(base) + '. Calcul en cours…';
        if (!tel) {
          ligne('pdf-comp-sans-perte', 'Sans perte : indisponible, le document a été modifié. Enregistrez-le, rouvrez le fichier enregistré, puis compressez-le.');
        } else {
          const avis = [], o = await MPDS.pdfOptimisation.optimiser(source, avis);
          if (mon !== jeton) return;
          if (o.length < base) ligne('pdf-comp-sans-perte', 'Sans perte : ' + poids(o.length) + ' (' + gain(base, o.length) + '). Contenu inchangé.' + liste(avis), o, version, suffixe, 'Enregistrer la version sans perte');
          else ligne('pdf-comp-sans-perte', 'Sans perte : aucun gain, le fichier est déjà optimisé.');
        }
        // Pages en image : tirées du fichier ouvert, ou de l'export normal (sinon les valeurs saisies seraient perdues)
        let images = pages;
        if (!tel) {
          relu = await (await MPDS.pdfjs.ouvrir(normal.slice().buffer)).promise;
          const s = { nom: ctx.nom(), doc: relu, octets: normal };
          images = Array.from({ length: relu.numPages }, (_, index) => ({ source: s, index, rotation: 0, annots: [] }));
        }
        const avis = [...avisNormal], o = await MPDS.pdfExport.construire(images, avis, avis, termes, { trame: reglages });
        if (mon !== jeton) return;
        const titre = 'Pages en image (' + reglages.dpi + ' ppp) : ' + poids(o.length);
        if (o.length < base) {
          ligne('pdf-comp-image', titre + ' (' + gain(base, o.length) + '). Le texte ne sera plus sélectionnable ni cherchable.' + liste(avis), o, version, suffixe, 'Enregistrer la version en image');
        } else ligne('pdf-comp-image', titre + ', plus lourd que le document actuel : rien à gagner. Essayez une résolution ou une qualité plus basse.');
        etat.textContent = (tel ? 'Fichier d\'origine : ' : 'Document modifié, enregistré normalement : ') + poids(base) + '.';
      } catch (err) {
        if (mon === jeton) { etat.textContent = 'Compression impossible : ' + (err.message || err); resultats.replaceChildren(); }
      } finally {
        if (relu) relu.destroy();
        if (mon === jeton) calculer.disabled = false;
      }
    }

    panneau.addEventListener('submit', e => { e.preventDefault(); lancer(); });
    fermerBtn.addEventListener('click', fermer);
    for (const s of [dpi, qualite]) s.addEventListener('change', () => { jeton++; calculer.disabled = false; resultats.replaceChildren(); etat.textContent = ''; });
    return {
      fermer,
      basculer() { if (!panneau.hidden) fermer(); else { panneau.hidden = false; calculer.focus(); } },
    };
  }

  MPDS.pdfCompression = { creer };
})();
