// Module PDF — visionneuse : une page à la fois, pagination, zoom, clavier ; affiche le modèle de
// pages (pages.js) avec ses miniatures (miniatures.js) et ses actions (actions.js).
// Dépend de commun/coeur.js (MPDS) et commun/pdfjs.js (MPDS.pdfjs). Rien n'est stocké.
(() => {
  'use strict';
  const ID = 'pdf';
  const NIVEAUX = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];
  const ZOOM_MIN = NIVEAUX[0], ZOOM_MAX = NIVEAUX[NIVEAUX.length - 1];
  const MARGE = 32;            // marge horizontale de la scène (2 × 1rem, voir pdf.css)

  const MARKUP = `
<div class="pdf-module" data-etat="vide">
  <div class="pdf-barre">
    <button type="button" class="pdf-btn pdf-btn-primaire" id="pdf-ouvrir">Ouvrir un PDF</button>
    <input type="file" id="pdf-fichier" accept=".pdf,application/pdf" hidden>
    <span class="pdf-nom" id="pdf-nom"></span>
    <span class="pdf-nb" id="pdf-nb"></span>
    <div class="pdf-outils" id="pdf-outils" hidden>
      <button type="button" class="pdf-btn" id="pdf-prec" aria-label="Page précédente">‹</button>
      <input type="number" class="pdf-num" id="pdf-num" min="1" value="1" aria-label="Numéro de page">
      <span id="pdf-total">/ 1</span>
      <button type="button" class="pdf-btn" id="pdf-suiv" aria-label="Page suivante">›</button>
      <span class="pdf-sep" aria-hidden="true"></span>
      <button type="button" class="pdf-btn" id="pdf-moins" aria-label="Zoom arrière">−</button>
      <output id="pdf-zoom" aria-label="Niveau de zoom">100 %</output>
      <button type="button" class="pdf-btn" id="pdf-plus" aria-label="Zoom avant">+</button>
      <button type="button" class="pdf-btn" id="pdf-largeur">Ajuster à la largeur</button>
    </div>
  </div>
  <div class="pdf-barre pdf-barre-pages" id="pdf-barre-pages" role="toolbar" aria-label="Actions sur les pages"></div>
  <div class="pdf-barre pdf-barre-annot" id="pdf-barre-annot" role="toolbar" aria-label="Annotations"></div>
  <div class="pdf-etat" id="pdf-etat" role="status" aria-live="polite"></div>
  <button type="button" class="pdf-vide" id="pdf-vide">
    <span class="pdf-vide-titre">Ouvrir un PDF</span>
    <span>Cliquez ici ou glissez un fichier PDF sur cette page. Il reste sur votre appareil.</span>
  </button>
  <div class="pdf-corps">
    <nav class="pdf-miniatures" id="pdf-miniatures" aria-label="Pages du document"></nav>
    <div class="pdf-scene" id="pdf-scene" tabindex="0" aria-label="Page du document"></div>
  </div>
</div>`;

  let racine = null, module = null, q = null;   // section du module, son conteneur, éléments par nom
  const modele = MPDS.pdfPages.creer();          // pages affichées : [{ source, index, rotation }]
  let miniatures = null, actions = null, annot = null;   // annot : annotations (outils.js)
  let page = 1, courante = null, zoom = 1, ajuste = true;   // page : position (1-based) ; courante : sa page du modèle
  let tacheRendu = null, jetonRendu = 0, jetonOuverture = 0, tailleScene = 0;

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
      const dpr = window.devicePixelRatio || 1;
      const vue = p.getViewport({ scale: zoom * dpr, rotation });
      const cv = document.createElement('canvas');
      cv.id = 'pdf-canvas';
      cv.width = Math.floor(vue.width); cv.height = Math.floor(vue.height);
      cv.style.width = Math.floor(vue.width / dpr) + 'px'; cv.style.height = Math.floor(vue.height / dpr) + 'px';
      const tache = p.render({ canvasContext: cv.getContext('2d'), viewport: vue });
      tacheRendu = tache;
      await tache.promise;
      if (mon !== jetonRendu) return;
      tacheRendu = null;
      q.scene.replaceChildren(annot.poser(cv, entree, { view: p.view, rotation }, base));   // canvas + calque d'annotations
      tailleScene = q.scene.clientWidth;
    } catch (err) {
      if (err && err.name === 'RenderingCancelledException') return;
      if (mon === jetonRendu) message('Cette page ne peut pas être affichée (' + ((err && err.message) || err) + ').', true);
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
    annot.vider(); miniatures.fermer(); q.scene.replaceChildren();
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
    return { nom: fichier.name, doc: await (await MPDS.pdfjs.ouvrir(ab.slice(0))).promise, octets: ab };
  }
  const messageErreur = err => message(err.name === 'Refus' ? err.message : erreurPdfjs(err), true);

  async function ouvrir(fichier) {
    if (!fichier || typeof fichier.arrayBuffer !== 'function') return;
    const mon = ++jetonOuverture;
    etat(modele.liste.length ? 'pret' : 'chargement');
    message('Chargement de « ' + fichier.name + ' »…');
    let source;
    try { source = await lire(fichier); }
    catch (err) {
      if (mon !== jetonOuverture) return;
      etat(modele.liste.length ? 'pret' : 'vide');      // le document déjà ouvert reste affiché
      messageErreur(err);
      return;
    }
    if (mon !== jetonOuverture || (modele.modifie && !confirm('Des modifications ne sont pas enregistrées. Ouvrir « ' + fichier.name + ' » et les perdre ?'))) {
      source.doc.destroy().catch(() => {});
      if (mon === jetonOuverture) { etat('pret'); message(''); }
      return;
    }
    fermerDocument();                    // détruit l'ancien document
    modele.ouvrir(source);
    page = 1; courante = modele.liste[0]; zoom = 1; ajuste = true;
    q.nom.textContent = fichier.name;
    q.outils.hidden = false;
    etat('pret');
    message('');
    rafraichir();
    await afficher();
  }

  // Fusion : les pages d'un autre PDF sont ajoutées à la fin
  async function ajouter(fichier) {
    if (!fichier || !modele.liste.length) return;
    const mon = jetonOuverture;
    message('Ajout de « ' + fichier.name + ' »…');
    try {
      const source = await lire(fichier);
      if (mon !== jetonOuverture) { source.doc.destroy().catch(() => {}); return; }   // autre document ouvert entre-temps
      modele.ajouter(source);
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
    } else if (e.key === 'ArrowRight' || e.key === 'PageDown') allerA(page + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') allerA(page - 1);
    else if (e.key === 'Home') allerA(1);
    else if (e.key === 'End') allerA(modele.liste.length);
    else fait = false;
    if (fait) e.preventDefault();
  }

  function monter(section) {
    racine = section;
    racine.innerHTML = MARKUP;    // gabarit statique : aucune donnée de fichier
    module = racine.querySelector('.pdf-module');
    q = {};
    for (const n of ['ouvrir', 'fichier', 'nom', 'nb', 'outils', 'prec', 'num', 'total', 'suiv', 'moins', 'zoom', 'plus', 'largeur', 'etat', 'vide', 'miniatures', 'scene', 'barre-pages', 'barre-annot']) {
      q[n] = racine.querySelector('#pdf-' + n);
    }
    miniatures = MPDS.pdfMiniatures.creer({
      modele, conteneur: q.miniatures,
      aller: allerA,
      deplacer: (p, vers) => { modele.deplacer(p, vers); rafraichir(); },
      surSelection: () => actions.maj(),
    });
    actions = MPDS.pdfActions.creer({
      modele, barre: q['barre-pages'], courante: () => page, nom: () => q.nom.textContent,
      rafraichir, message, ajouter,
    });
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
      ouvrir(fichiers[0]).then(() => {
        if (fichiers.length > 1) message('Un seul document à la fois : seul « ' + fichiers[0].name + ' » est ouvert.');
      });
    });

    document.addEventListener('keydown', surTouche);
    // « Ajuster à la largeur » suit le redimensionnement de la scène
    new ResizeObserver(() => {
      const l = q.scene.clientWidth;
      if (modele.liste.length && ajuste && l > MARGE + 50 && Math.abs(l - tailleScene) >= 2) afficher();
    }).observe(q.scene);
  }

  function demonter() {
    document.removeEventListener('keydown', surTouche);
    jetonOuverture++;
    if (q) { annot.detruire(); fermerDocument(); }
  }

  MPDS.enregistrer({ id: ID, titre: 'PDF', icone: '📑', monter, demonter, surFichier: ouvrir });
})();
