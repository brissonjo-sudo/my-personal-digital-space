// Module PDF — visionneuse : une page à la fois, miniatures, pagination, zoom, clavier.
// Dépend de commun/coeur.js (MPDS) et commun/pdfjs.js (MPDS.pdfjs). Rien n'est stocké.
(() => {
  'use strict';
  const ID = 'pdf';
  const NIVEAUX = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];
  const ZOOM_MIN = NIVEAUX[0], ZOOM_MAX = NIVEAUX[NIVEAUX.length - 1];
  const MARGE = 32;            // marge horizontale de la scène (2 × 1rem, voir pdf.css)
  const LARGEUR_MINI = 120;    // largeur CSS des miniatures

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
  let doc = null, page = 1, zoom = 1, ajuste = true;
  let tacheRendu = null, jetonRendu = 0, jetonOuverture = 0, observateur = null, tailleScene = 0;

  const bornes = (v, min, max) => Math.min(max, Math.max(min, v));
  const SAISIE = /^(INPUT|TEXTAREA|SELECT)$/;
  const etat = e => { module.dataset.etat = e; };

  function message(texte, erreur) {
    q.etat.textContent = texte || '';
    q.etat.classList.toggle('pdf-erreur', !!erreur);
    q.etat.setAttribute('role', erreur ? 'alert' : 'status');
  }

  function majBarre() {
    const n = doc ? doc.numPages : 0;
    q.num.max = String(n);
    q.num.value = String(page);
    q.total.textContent = '/ ' + n;
    q.prec.disabled = page <= 1;
    q.suiv.disabled = page >= n;
    q.zoom.textContent = Math.round(zoom * 100) + ' %';
    q.moins.disabled = zoom <= ZOOM_MIN + 1e-9;
    q.plus.disabled = zoom >= ZOOM_MAX - 1e-9;
    q.largeur.setAttribute('aria-pressed', String(ajuste));
    for (const b of q.miniatures.children) {
      if (+b.dataset.page === page) { b.setAttribute('aria-current', 'page'); b.scrollIntoView({ block: 'nearest' }); }
      else b.removeAttribute('aria-current');
    }
  }

  function annulerRendu() {
    if (tacheRendu) { try { tacheRendu.cancel(); } catch { /* déjà terminé */ } tacheRendu = null; }
  }

  // Dessine la page courante dans un NOUVEAU canvas, mis en place une fois prêt
  // (pas de clignotement, et jamais deux rendus sur le même canvas).
  async function afficher() {
    const d = doc;
    if (!d) return;
    const mon = ++jetonRendu;
    annulerRendu();
    majBarre();
    try {
      const p = await d.getPage(page);
      if (d !== doc || mon !== jetonRendu) return;
      const base = p.getViewport({ scale: 1 });
      if (ajuste && q.scene.clientWidth > MARGE + 50) zoom = bornes((q.scene.clientWidth - MARGE) / base.width, ZOOM_MIN, ZOOM_MAX);
      majBarre();
      const dpr = window.devicePixelRatio || 1;
      const vue = p.getViewport({ scale: zoom * dpr });
      const cv = document.createElement('canvas');
      cv.id = 'pdf-canvas';
      cv.width = Math.floor(vue.width); cv.height = Math.floor(vue.height);
      cv.style.width = Math.floor(vue.width / dpr) + 'px'; cv.style.height = Math.floor(vue.height / dpr) + 'px';
      const tache = p.render({ canvasContext: cv.getContext('2d'), viewport: vue });
      tacheRendu = tache;
      await tache.promise;
      if (mon !== jetonRendu) return;
      tacheRendu = null;
      q.scene.replaceChildren(cv);
      tailleScene = q.scene.clientWidth;
    } catch (err) {
      if (err && err.name === 'RenderingCancelledException') return;
      if (d === doc && mon === jetonRendu) message('Cette page ne peut pas être affichée (' + ((err && err.message) || err) + ').', true);
    }
  }

  function allerA(n) {
    if (!doc) return;
    const v = Math.round(parseFloat(n));
    const cible = Number.isFinite(v) ? bornes(v, 1, doc.numPages) : page;   // saisie invalide : on garde la page
    if (cible === page && q.scene.firstChild) { majBarre(); return; }
    page = cible;
    afficher();
  }

  function changerZoom(sens) {
    if (!doc) return;
    const suivant = sens > 0 ? NIVEAUX.find(v => v > zoom + 1e-6) : [...NIVEAUX].reverse().find(v => v < zoom - 1e-6);
    if (!suivant) return;
    zoom = suivant; ajuste = false;
    afficher();
  }

  // ---- Miniatures : rendu paresseux (IntersectionObserver) ----
  function dessinerMiniature(btn) {
    const d = doc;
    d.getPage(+btn.dataset.page).then(p => {
      if (d !== doc) return null;
      const dpr = window.devicePixelRatio || 1;
      const vue = p.getViewport({ scale: LARGEUR_MINI / p.getViewport({ scale: 1 }).width * dpr });
      const cv = btn.querySelector('canvas');
      cv.width = Math.floor(vue.width); cv.height = Math.floor(vue.height);
      return p.render({ canvasContext: cv.getContext('2d'), viewport: vue }).promise;
    }).catch(() => { /* document fermé entre-temps */ });
  }

  async function construireMiniatures() {
    const d = doc;
    const base = (await d.getPage(1)).getViewport({ scale: 1 });
    if (d !== doc) return;
    const haut = Math.round(LARGEUR_MINI * base.height / base.width);
    observateur = new IntersectionObserver(entrees => {
      for (const e of entrees) if (e.isIntersecting) { observateur.unobserve(e.target); dessinerMiniature(e.target); }
    }, { root: q.miniatures, rootMargin: '200px 0px' });
    const boutons = [];
    for (let n = 1; n <= d.numPages; n++) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'pdf-mini'; b.dataset.page = String(n);
      b.setAttribute('aria-label', 'Page ' + n);
      const cv = document.createElement('canvas');
      cv.width = LARGEUR_MINI; cv.height = haut;
      const num = document.createElement('span');
      num.textContent = String(n);
      b.append(cv, num);
      b.addEventListener('click', () => allerA(n));
      boutons.push(b);
    }
    q.miniatures.replaceChildren(...boutons);
    majBarre();
    boutons.forEach(b => observateur.observe(b));
  }

  function fermerDocument() {
    jetonRendu++;
    annulerRendu();
    if (observateur) { observateur.disconnect(); observateur = null; }
    q.miniatures.replaceChildren(); q.scene.replaceChildren();
    if (doc) { const d = doc; doc = null; d.destroy().catch(() => {}); }
  }

  // ---- Ouverture ----
  const erreurPdfjs = err => {
    const n = err && err.name;
    if (n === 'PasswordException') return 'Ce PDF est protégé par mot de passe : non pris en charge pour l\'instant.';
    if (n === 'InvalidPDFException' || n === 'FormatError') return 'Ce PDF est corrompu ou illisible.';
    return 'Impossible d\'ouvrir ce PDF (' + ((err && err.message) || err) + ').';
  };
  const refus = (code, texte) => Object.assign(new Error(texte), { name: code });

  async function ouvrir(fichier) {
    if (!fichier || typeof fichier.arrayBuffer !== 'function') return;
    const mon = ++jetonOuverture;
    etat(doc ? 'pret' : 'chargement');
    message('Chargement de « ' + fichier.name + ' »…');
    let nouveau = null;
    try {
      const ab = await fichier.arrayBuffer();
      if (!ab.byteLength) throw refus('Refus', 'Ce fichier est vide.');
      if (!new TextDecoder('latin1').decode(ab.slice(0, 1024)).includes('%PDF-')) {
        throw refus('Refus', '« ' + fichier.name + ' » n\'est pas un PDF.');
      }
      nouveau = await (await MPDS.pdfjs.ouvrir(ab)).promise;
    } catch (err) {
      if (mon !== jetonOuverture) return;
      etat(doc ? 'pret' : 'vide');      // le document déjà ouvert reste affiché
      message(err.name === 'Refus' ? err.message : erreurPdfjs(err), true);
      return;
    }
    if (mon !== jetonOuverture) { nouveau.destroy().catch(() => {}); return; }
    fermerDocument();                    // détruit l'ancien document
    doc = nouveau; page = 1; zoom = 1; ajuste = true;
    q.nom.textContent = fichier.name;
    q.nb.textContent = doc.numPages === 1 ? '1 page' : doc.numPages + ' pages';
    q.outils.hidden = false;
    etat('pret');
    message('');
    await afficher();
    construireMiniatures().catch(() => {});
  }

  // ---- Clavier : seulement si le module est affiché et hors champ de saisie ----
  function surTouche(e) {
    if (MPDS.actif() !== ID || !doc || e.altKey || e.metaKey) return;
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
    else if (e.key === 'End') allerA(doc.numPages);
    else fait = false;
    if (fait) e.preventDefault();
  }

  function monter(section) {
    racine = section;
    racine.innerHTML = MARKUP;    // gabarit statique : aucune donnée de fichier
    module = racine.querySelector('.pdf-module');
    q = {};
    for (const n of ['ouvrir', 'fichier', 'nom', 'nb', 'outils', 'prec', 'num', 'total', 'suiv', 'moins', 'zoom', 'plus', 'largeur', 'etat', 'vide', 'miniatures', 'scene']) {
      q[n] = racine.querySelector('#pdf-' + n);
    }
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
    module.addEventListener('dragenter', e => { e.preventDefault(); survols++; module.classList.add('pdf-survol'); });
    module.addEventListener('dragleave', () => { if (--survols <= 0) { survols = 0; module.classList.remove('pdf-survol'); } });
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
      if (doc && ajuste && l > MARGE + 50 && Math.abs(l - tailleScene) >= 2) afficher();
    }).observe(q.scene);
  }

  function demonter() {
    document.removeEventListener('keydown', surTouche);
    jetonOuverture++;
    if (q) fermerDocument();
  }

  MPDS.enregistrer({ id: ID, titre: 'PDF', icone: '📑', monter, demonter, surFichier: ouvrir });
})();
