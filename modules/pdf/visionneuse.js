// Module PDF — visionneuse : une page à la fois, pagination, zoom, clavier ; affiche le modèle de
// pages (pages.js) avec ses miniatures (miniatures.js) et ses actions (actions.js).
// Dépend de commun/coeur.js (MPDS) et commun/pdfjs.js (MPDS.pdfjs). Rien n'est stocké.
(() => {
  'use strict';
  const ID = 'pdf';
  const NIVEAUX = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];
  const ZOOM_MIN = NIVEAUX[0], ZOOM_MAX = NIVEAUX[NIVEAUX.length - 1];
  const MARGE = 32;            // marge horizontale de la scène (2 × 1rem, voir pdf.css)
  const MAX_PIXELS = 16777216; // plafond de pixels d'un canvas de rendu (valeur de PDF.js, maxCanvasPixels)


  let racine = null, module = null, q = null;   // section du module, son conteneur, éléments par nom
  const modele = MPDS.pdfPages.creer();          // pages affichées : [{ source, index, rotation }]
  let miniatures = null, actions = null, annot = null, formulaire = null;   // annot : annotations (outils.js)
  let page = 1, courante = null, zoom = 1, ajuste = true;   // page : position (1-based) ; courante : sa page du modèle
  let tacheRendu = null, jetonRendu = 0, jetonOuverture = 0, tailleScene = 0, erreurRendu = false;

  const bornes = (v, min, max) => Math.min(max, Math.max(min, v));
  const SAISIE = /^(INPUT|TEXTAREA|SELECT)$/;
  const etat = e => { module.dataset.etat = e; };

  function message(texte, erreur) {
    q.etat.textContent = texte || '';
    q.etat.classList.toggle('pdf-erreur', !!erreur);
    q.etat.setAttribute('role', erreur ? 'alert' : 'status');
  }

  function majBarre() {
    const n = modele.liste.length;
    q.num.max = String(n);
    q.num.value = String(page);
    q.total.textContent = '/ ' + n;
    q.prec.disabled = page <= 1;
    q.suiv.disabled = page >= n;
    q.zoom.textContent = Math.round(zoom * 100) + ' %';
    q.moins.disabled = zoom <= ZOOM_MIN + 1e-9;
    q.plus.disabled = zoom >= ZOOM_MAX - 1e-9;
    q.largeur.setAttribute('aria-pressed', String(ajuste));
    miniatures.marquer(page);
    actions.maj();
    if (annot) annot.maj();   // Annuler/Rétablir : une page supprimée emporte ses commandes
  }

  function annulerRendu() {
    if (tacheRendu) { try { tacheRendu.cancel(); } catch { /* déjà terminé */ } tacheRendu = null; }
  }

  // Dessine la page courante dans un NOUVEAU canvas, mis en place une fois prêt
  // (pas de clignotement, et jamais deux rendus sur le même canvas).
  async function afficher() {
    const entree = modele.liste[page - 1];
    if (!entree) return;
    const mon = ++jetonRendu;
    annulerRendu();
    majBarre();
    try {
      const p = await entree.source.doc.getPage(entree.index + 1);
      if (mon !== jetonRendu) return;
      const rotation = (p.rotate + entree.rotation) % 360;   // pivotement de l'utilisateur ajouté à celui de la page
      const base = p.getViewport({ scale: 1, rotation });
      if (ajuste && q.scene.clientWidth > MARGE + 50) zoom = bornes((q.scene.clientWidth - MARGE) / base.width, ZOOM_MIN, ZOOM_MAX);
      majBarre();
      // Définition du rendu plafonnée (limite des canvas, Safari surtout) ; la taille affichée ne change pas
      const dpr = window.devicePixelRatio || 1, echelle = Math.min(zoom * dpr, Math.sqrt(MAX_PIXELS / (base.width * base.height)));
      const vue = p.getViewport({ scale: echelle, rotation });
      const cv = document.createElement('canvas');
      cv.id = 'pdf-canvas';
      cv.width = Math.floor(vue.width); cv.height = Math.floor(vue.height);
      cv.style.width = Math.floor(base.width * zoom) + 'px'; cv.style.height = Math.floor(base.height * zoom) + 'px';
      const tache = p.render({ canvasContext: cv.getContext('2d'), viewport: vue });
      tacheRendu = tache;
      await tache.promise;
      if (mon !== jetonRendu) return;
      tacheRendu = null;
      const feuille = annot.poser(cv, entree, { view: p.view, rotation }, base);   // canvas + calque d'annotations
      q.scene.replaceChildren(feuille);
      formulaire.poser(feuille, entree, p, base);   // couche de saisie du formulaire (asynchrone)
      tailleScene = q.scene.clientWidth;
      if (erreurRendu) { erreurRendu = false; message(''); }   // l'alerte d'une page illisible ne survit pas à la suivante
    } catch (err) {
      if (err && err.name === 'RenderingCancelledException') return;
      if (mon !== jetonRendu) return;
      q.scene.replaceChildren();   // pas l'ancienne page sous le nouveau numéro
      erreurRendu = true;
      message('Cette page ne peut pas être affichée (' + ((err && err.message) || err) + ').', true);
    }
  }

  function allerA(n) {
    if (!modele.liste.length) return;
    const v = Math.round(parseFloat(n));
    const cible = Number.isFinite(v) ? bornes(v, 1, modele.liste.length) : page;   // saisie invalide : on garde la page
    if (cible === page && q.scene.firstChild) { majBarre(); return; }
    page = cible; courante = modele.liste[page - 1];
    afficher();
  }

  function changerZoom(sens) {
    if (!modele.liste.length) return;
    const suivant = sens > 0 ? NIVEAUX.find(v => v > zoom + 1e-6) : [...NIVEAUX].reverse().find(v => v < zoom - 1e-6);
    if (!suivant) return;
    zoom = suivant; ajuste = false;
    afficher();
  }

  // Ctrl + molette sur le document (et pincement du pavé tactile, qui arrive en ctrlKey) : zoom du PDF,
  // pas de la page. Un cran ≈ 100 px ; les petits pas du pincement sont cumulés jusqu'à 50.
  let cumul = 0;
  function surMolette(e) {
    if (!e.ctrlKey || !modele.liste.length) return;
    e.preventDefault();
    cumul += e.deltaY * (e.deltaMode ? 40 : 1);   // deltaMode 1 (lignes, Firefox) ramené en pixels
    if (Math.abs(cumul) < 50) return;
    changerZoom(cumul < 0 ? 1 : -1);
    cumul = 0;
  }

  // Aligne tout l'affichage sur le modèle après une action ; la page courante est suivie
  // (même page, nouvelle position) ou, si elle a disparu, la position est bornée.
  function rafraichir({ rendre } = {}) {
    const i = modele.liste.indexOf(courante);
    page = i >= 0 ? i + 1 : bornes(page, 1, modele.liste.length);
    courante = modele.liste[page - 1];
    miniatures.rafraichir();
    const n = modele.liste.length;
    q.nb.textContent = n === 1 ? '1 page' : n + ' pages';
    majBarre();
    if (rendre) afficher();
  }

  function fermerDocument() {
    jetonRendu++;
    annulerRendu();
    annot.vider(); formulaire.vider(); miniatures.fermer(); q.scene.replaceChildren();
    modele.vider();      // détruit les documents PDF.js
    courante = null;
  }

  // ---- Ouverture ----
  const erreurPdfjs = err => {
    const n = err && err.name;
    if (n === 'PasswordException') return 'Ce PDF est protégé par mot de passe : non pris en charge pour l\'instant.';
    if (n === 'InvalidPDFException' || n === 'FormatError') return 'Ce PDF est corrompu ou illisible.';
    return 'Impossible d\'ouvrir ce PDF (' + ((err && err.message) || err) + ').';
  };
  const refus = (code, texte) => Object.assign(new Error(texte), { name: code });

  // Lit un fichier : vérifie qu'il s'agit d'un PDF, l'ouvre avec PDF.js (copie des octets : PDF.js
  // peut céder son tampon à son worker) et renvoie une source du modèle de pages.
  async function lire(fichier) {
    const ab = await fichier.arrayBuffer();
    if (!ab.byteLength) throw refus('Refus', 'Ce fichier est vide.');
    if (!new TextDecoder('latin1').decode(ab.slice(0, 1024)).includes('%PDF-')) {
      throw refus('Refus', '« ' + fichier.name + ' » n\'est pas un PDF.');
    }
    const tache = await MPDS.pdfjs.ouvrir(ab.slice(0));
    try { return { nom: fichier.name, doc: await tache.promise, octets: ab }; }
    catch (err) { tache.destroy().catch(() => {}); throw err; }   // sinon le worker PDF.js de la tâche reste en vie
  }
  const messageErreur = err => message(err.name === 'Refus' ? err.message : erreurPdfjs(err), true);

  async function ouvrir(fichier) {
    if (!fichier || typeof fichier.arrayBuffer !== 'function') return false;
    const mon = ++jetonOuverture;
    etat(modele.liste.length ? 'pret' : 'chargement');
    message('Chargement de « ' + fichier.name + ' »…');
    let source;
    try { source = await lire(fichier); }
    catch (err) {
      if (mon !== jetonOuverture) return;
      etat(modele.liste.length ? 'pret' : 'vide');      // le document déjà ouvert reste affiché
      messageErreur(err);
      return false;
    }
    if (mon !== jetonOuverture || (modele.modifie && !confirm('Des modifications ne sont pas enregistrées. Ouvrir « ' + fichier.name + ' » et les perdre ?'))) {
      source.doc.destroy().catch(() => {});
      if (mon === jetonOuverture) { etat('pret'); message(''); }
      return false;
    }
    fermerDocument();                    // détruit l'ancien document
    modele.ouvrir(source); formulaire.detecter(source);
    page = 1; courante = modele.liste[0]; zoom = 1; ajuste = true;
    q.nom.textContent = fichier.name;
    q.outils.hidden = false;
    const invite = document.activeElement === q.vide;
    etat('pret');
    if (invite) q.scene.focus();          // l'invite disparaît : le focus passe à la page plutôt qu'au document
    message('');
    rafraichir();
    await afficher();
    return true;
  }

  // Fusion : les pages d'un autre PDF sont ajoutées à la fin
  async function ajouter(fichier) {
    if (!fichier || !modele.liste.length) return;
    const mon = jetonOuverture;
    message('Ajout de « ' + fichier.name + ' »…');
    try {
      const source = await lire(fichier);
      if (mon !== jetonOuverture) { source.doc.destroy().catch(() => {}); return; }   // autre document ouvert entre-temps
      modele.ajouter(source); formulaire.detecter(source);
      const n = source.doc.numPages;
      message(n + (n === 1 ? ' page ajoutée' : ' pages ajoutées') + ' depuis « ' + fichier.name + ' ».');
      rafraichir();
    } catch (err) { messageErreur(err); }
  }

  // ---- Clavier : seulement si le module est affiché et hors champ de saisie ----
  function surTouche(e) {
    if (MPDS.actif() !== ID || !modele.liste.length || e.altKey || e.metaKey) return;
    const c = e.target;
    if (c && (SAISIE.test(c.tagName) || c.isContentEditable)) return;
    let fait = true;
    if (e.ctrlKey) {
      if (e.key === '+' || e.key === '=') changerZoom(1);
      else if (e.key === '-' || e.key === '_') changerZoom(-1);
      else fait = false;
    } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && c === q.scene && q.scene.scrollWidth > q.scene.clientWidth) {
      fait = false;   // page plus large que la scène (zoom) : ←/→ la font défiler (WCAG 2.1.1) ; PageUp/PageDown changent de page
    } else if (e.key === 'ArrowRight' || e.key === 'PageDown') allerA(page + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') allerA(page - 1);
    else if (e.key === 'Home') allerA(1);
    else if (e.key === 'End') allerA(modele.liste.length);
    else fait = false;
    if (fait) e.preventDefault();
  }

  function monter(section) {
    racine = section;
    racine.innerHTML = MPDS.pdfGabarit();    // gabarit statique (gabarit.js) : aucune donnée de fichier
    module = racine.querySelector('.pdf-module');
    q = {};
    for (const n of ['ouvrir', 'fichier', 'nom', 'nb', 'outils', 'prec', 'num', 'total', 'suiv', 'moins', 'zoom', 'plus', 'largeur', 'etat', 'vide', 'miniatures', 'scene', 'barre-pages', 'barre-doc', 'barre-annot', 'bandeau-form', 'modif']) {
      q[n] = racine.querySelector('#pdf-' + n);
    }
    miniatures = MPDS.pdfMiniatures.creer({
      modele, conteneur: q.miniatures,
      aller: allerA,
      deplacer: (p, vers) => { modele.deplacer(p, vers); rafraichir(); },
      surSelection: () => actions.maj(),
    });
    actions = MPDS.pdfActions.creer({
      modele, barre: q['barre-pages'], barreDoc: q['barre-doc'], modif: q.modif, courante: () => page, nom: () => q.nom.textContent,
      rafraichir, message, ajouter,
    });
    formulaire = MPDS.pdfFormulaire.creer({ modele, bandeau: q['bandeau-form'], message, majBarre, rafraichir });
    annot = MPDS.pdfOutils.creer({ modele, barre: q['barre-annot'], aller: allerA, majBarre, message });
    actions.maj();
    const choisir = () => q.fichier.click();
    q.ouvrir.addEventListener('click', choisir);
    q.vide.addEventListener('click', choisir);
    q.fichier.addEventListener('change', () => { const f = q.fichier.files[0]; q.fichier.value = ''; ouvrir(f); });
    q.prec.addEventListener('click', () => allerA(page - 1));
    q.suiv.addEventListener('click', () => allerA(page + 1));
    q.num.addEventListener('change', () => allerA(q.num.value));
    q.moins.addEventListener('click', () => changerZoom(-1));
    q.plus.addEventListener('click', () => changerZoom(1));
    q.largeur.addEventListener('click', () => { ajuste = true; afficher(); });
    q.scene.addEventListener('wheel', surMolette, { passive: false });   // passive: false, sinon preventDefault ignoré

    // Glisser-déposer sur tout le module (compteur : pas de clignotement sur les enfants)
    let survols = 0;
    const fichiersGlisses = e => e.dataTransfer.types.includes('Files');   // pas les miniatures qu'on réordonne
    module.addEventListener('dragenter', e => { if (!fichiersGlisses(e)) return; e.preventDefault(); survols++; module.classList.add('pdf-survol'); });
    module.addEventListener('dragleave', e => { if (fichiersGlisses(e) && --survols <= 0) { survols = 0; module.classList.remove('pdf-survol'); } });
    module.addEventListener('dragover', e => e.preventDefault());
    module.addEventListener('drop', e => {
      e.preventDefault(); survols = 0; module.classList.remove('pdf-survol');
      const fichiers = e.dataTransfer.files;
      if (!fichiers.length) return;
      ouvrir(fichiers[0]).then(ok => {
        if (ok && fichiers.length > 1) message('Un seul document à la fois : seul « ' + fichiers[0].name + ' » est ouvert.');
      });
    });

    document.addEventListener('keydown', surTouche);
    window.addEventListener('beforeunload', avantDepart);
    // « Ajuster à la largeur » suit le redimensionnement de la scène
    new ResizeObserver(() => {
      const l = q.scene.clientWidth;
      if (modele.liste.length && ajuste && l > MARGE + 50 && Math.abs(l - tailleScene) >= 2) afficher();
    }).observe(q.scene);
  }

  // Fermer l'onglet ou recharger avec des modifications non enregistrées : le navigateur demande confirmation
  function avantDepart(e) {
    if (modele.liste.length && modele.modifie) { e.preventDefault(); e.returnValue = ''; }
  }

  function demonter() {
    document.removeEventListener('keydown', surTouche);
    window.removeEventListener('beforeunload', avantDepart);
    jetonOuverture++;
    if (q) { annot.detruire(); fermerDocument(); }
  }

  MPDS.enregistrer({ id: ID, titre: 'PDF', icone: 'pdf', monter, demonter, surFichier: ouvrir });
})();
