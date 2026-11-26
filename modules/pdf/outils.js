// Module PDF — outils d'annotation : barre d'outils (sélection, surligneur, texte, dessin, gomme,
// annuler/rétablir, palette, réglages) et raccourcis clavier. Assemble le modèle (annotations.js)
// et le calque (calque.js). Publie MPDS.pdfOutils.creer(ctx).
//   ctx = { modele, barre, aller(n), majBarre(), message(texte, erreur) }
// Renvoie { poser, maj, vider, detruire } : poser(cv, entree, info, base) donne l'élément à mettre dans la scène.
(() => {
  'use strict';
  // [id, nom, touche, icône, libellé visible] : groupe 1 icônes seules, groupe 2 (signature, tampon) avec libellé
  const OUTILS = [['sel', 'Sélection', 'V', 'selection'], ['surlig', 'Surligneur', 'H', 'surligneur'], ['texte', 'Texte', 'T', 'texte'], ['dessin', 'Dessin', 'D', 'dessin'], ['gomme', 'Gomme', 'E', 'gomme'],
    ['signature', 'Signature', 'S', 'signature', true], ['tampon', 'Tampon', 'P', 'tampon', true]];
  const COULEURS = [['Noir', '#000000'], ['Rouge', '#dc2626'], ['Bleu', '#2563eb'], ['Vert', '#16a34a'], ['Orange', '#f97316'], ['Jaune', '#facc15']];
  const POLICES = [['Helvetica', 'Helvetica'], ['TimesRoman', 'Times'], ['Courier', 'Courier']];
  const PAR_OUTIL = { surlig: '#facc15', texte: '#000000', dessin: '#dc2626' };   // couleur initiale de chaque outil
  const REGLAGES = { surlig: ['opacite'], texte: ['police', 'taille'], dessin: ['epaisseur'], tampon: ['tampon', 'date'] };
  const SIG_LARGEUR = 150;   // largeur de pose par défaut, en points PDF
  const SAISIE = /^(INPUT|TEXTAREA|SELECT)$/;

  function creer(ctx) {
    const { modele, barre } = ctx;
    const r = { outil: 'sel', couleur: PAR_OUTIL.texte, police: 'Helvetica', taille: 18, epaisseur: 3, opacite: 25, tampon: 'recu', date: MPDS.pdfTampons.dateDuJour() };
    const boutons = {}, pastilles = {}, reglages = {}, memoire = { ...PAR_OUTIL };
    let annuler = null, retablir = null;

    const bouton = (id, libelle, icone, titre) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'pdf-btn' + (libelle ? '' : ' pdf-btn-icone'); b.id = 'pdf-' + id;
      b.setAttribute('aria-label', titre); b.title = titre;
      b.append(MPDS.icones.creer(icone), libelle ? ' ' + libelle : '');
      barre.append(b);
      return b;
    };
    const separateur = () => barre.append(Object.assign(document.createElement('span'), { className: 'pdf-sep' }));
    const champ = (id, libelle, input, sortie) => {
      const l = document.createElement('label');
      l.className = 'pdf-reglage'; l.id = 'pdf-reglage-' + id;
      input.id = 'pdf-' + id;
      l.append(libelle + ' ', input);
      if (sortie) l.append(sortie);
      barre.append(l);
      reglages[id] = l;
      return input;
    };

    // Objet à poser au prochain clic : la signature de la session (copie du modèle) ou un tampon ; null si refusé
    function objet(outil) {
      if (outil === 'signature') {
        const sig = MPDS.pdfSignature.courante();
        return sig && { type: 'signature', png: sig.url, w: SIG_LARGEUR, h: SIG_LARGEUR * sig.h / sig.w };
      }
      try { const t = MPDS.pdfTampons.creer(r.tampon, r.date); ctx.message(''); return t; }
      catch (err) { ctx.message(err.message, true); return null; }
    }
    const annotations = MPDS.pdfAnnotations.creer(modele, entree => {
      const i = modele.liste.indexOf(entree);
      if (i >= 0 && entree !== calque.entree()) ctx.aller(i + 1);   // annuler/rétablir sur une autre page : on s'y rend
      else calque.redessiner();
      maj(); ctx.majBarre();
    });
    const calque = MPDS.pdfCalque.creer({ annotations, r, message: ctx.message, objet });

    function maj() {
      annuler.disabled = !annotations.peutAnnuler();
      retablir.disabled = !annotations.peutRetablir();
    }

    // Signature : la fenêtre s'ouvre d'abord ; l'outil ne s'active qu'une fois la signature validée
    function lancer(o) {
      if (o === 'signature') MPDS.pdfSignature.ouvrir(() => choisirOutil('signature'));
      else choisirOutil(o);
    }
    function choisirOutil(o) {
      if (r.outil in memoire) memoire[r.outil] = r.couleur;
      r.outil = o;
      if (o in memoire) r.couleur = memoire[o];
      for (const [id, b] of Object.entries(boutons)) b.setAttribute('aria-pressed', String(id === o));
      for (const [id, p] of Object.entries(pastilles)) p.setAttribute('aria-pressed', String(id === r.couleur));
      for (const [id, l] of Object.entries(reglages)) l.hidden = !(REGLAGES[o] || []).includes(id);
      palette.hidden = !(o in memoire);
      reglages.date.hidden = reglages.date.hidden || !MPDS.pdfTampons.CATALOGUE.find(t => t.id === r.tampon).date;
      calque.redessiner();   // le curseur et la prise des éléments dépendent de l'outil
    }

    // ---- Construction de la barre ----
    OUTILS.forEach(([id, nom, touche, icone, libelle], k) => {
      if (id === 'signature') separateur();
      boutons[id] = bouton('outil-' + id, libelle && nom, icone, `${nom} (${touche})`);
      boutons[id].addEventListener('click', () => lancer(id));
    });
    separateur();
    const palette = document.createElement('span');
    palette.className = 'pdf-palette'; palette.setAttribute('role', 'group'); palette.setAttribute('aria-label', 'Couleur');
    for (const [nom, hex] of COULEURS) {
      const p = document.createElement('button');
      p.type = 'button'; p.className = 'pdf-pastille';
      const disque = document.createElement('span'); disque.style.backgroundColor = hex; p.append(disque);   // disque cerclé : visible sur tout fond
      p.setAttribute('aria-label', 'Couleur : ' + nom); p.title = nom;
      p.addEventListener('click', () => { r.couleur = hex; choisirOutil(r.outil); });
      pastilles[hex] = p; palette.append(p);
    }
    barre.append(palette);
    const police = champ('police', 'Police', document.createElement('select'));
    for (const [cle, nom] of POLICES) police.add(new Option(nom, cle));
    police.addEventListener('change', () => { r.police = police.value; });
    const nombre = (id, libelle, min, max, pas, cle, type) => {
      const i = Object.assign(document.createElement('input'), { type, min, max, step: pas, value: r[cle] });
      const sortie = type === 'range' ? document.createElement('output') : null;
      const lire = () => { r[cle] = Math.min(max, Math.max(min, Number(i.value) || r[cle])); if (sortie) sortie.textContent = r[cle] + (cle === 'opacite' ? ' %' : ''); };
      i.addEventListener('input', lire);
      champ(id, libelle, i, sortie);
      lire();
    };
    nombre('taille', 'Taille', 6, 144, 1, 'taille', 'number');
    nombre('epaisseur', 'Épaisseur', 1, 30, 1, 'epaisseur', 'range');
    nombre('opacite', 'Opacité', 5, 100, 5, 'opacite', 'range');
    const tampon = champ('tampon', 'Tampon', document.createElement('select'));
    for (const t of MPDS.pdfTampons.CATALOGUE) tampon.add(new Option(t.nom, t.id));
    tampon.addEventListener('change', () => { r.tampon = tampon.value; choisirOutil('tampon'); });
    const date = champ('date', 'Date', Object.assign(document.createElement('input'), { type: 'text', maxLength: 10, size: 10, value: r.date }));
    date.addEventListener('input', () => { r.date = date.value; });
    annuler = bouton('annuler', '', 'annuler', 'Annuler (Ctrl+Z)');
    retablir = bouton('retablir', '', 'retablir', 'Rétablir (Ctrl+Y)');
    annuler.classList.add('pdf-ressort');   // Annuler et Rétablir poussés à droite
    annuler.addEventListener('click', () => annotations.annuler());
    retablir.addEventListener('click', () => annotations.retablir());
    choisirOutil('sel'); maj();

    // ---- Clavier : seulement si le module est affiché, un document ouvert, et hors champ de saisie ----
    function surTouche(e) {
      if (MPDS.actif() !== 'pdf' || !modele.liste.length || e.altKey || e.metaKey) return;
      const c = e.target, k = e.key.toLowerCase();
      if (c && (SAISIE.test(c.tagName) || c.isContentEditable)) return;
      if (calque.enGeste()) return;   // pendant un tracé ou un déplacement : annuler ou changer d'outil le corromprait
      const outil = OUTILS.find(o => o[2].toLowerCase() === k);
      if (e.ctrlKey && k === 'z') (e.shiftKey ? annotations.retablir : annotations.annuler)();
      else if (e.ctrlKey && k === 'y') annotations.retablir();
      else if (!e.ctrlKey && !e.shiftKey && outil) lancer(outil[0]);
      else if (!e.ctrlKey && e.key === 'Delete') { if (!calque.supprimerSelection()) return; }
      else return;
      e.preventDefault();
    }
    document.addEventListener('keydown', surTouche);

    return {
      poser: calque.poser,
      maj,
      vider() { calque.fermer(); annotations.vider(); maj(); },
      detruire() { document.removeEventListener('keydown', surTouche); },
    };
  }

  MPDS.pdfOutils = { creer };
})();
