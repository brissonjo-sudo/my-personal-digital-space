// Module PDF — panneau des miniatures : une par page du modèle (rendu paresseux, case à cocher
// de sélection, glisser-déposer pour réordonner). Dépend de commun/pdfjs.js (PDF.js déjà chargé).
// Publie MPDS.pdfMiniatures.creer(ctx).
//   ctx = { modele, conteneur, aller(n), deplacer(page, index), surSelection() }
(() => {
  'use strict';
  const LARGEUR = 120, HAUTEUR = 170;   // largeur CSS d'une miniature ; hauteur provisoire (A4) avant rendu
  const TYPE_GLISSE = 'application/x-mpds-page';

  function creer(ctx) {
    const { modele, conteneur } = ctx;
    const items = new Map();   // page du modèle → { page, el, btn, cv, num, coche, rendu, v, tache }
    let observateur = null, glisse = null;

    // Dessine la miniature dans un NOUVEAU canvas, mis en place une fois prêt (jamais deux rendus
    // sur le même canvas) ; `rendu` mémorise la rotation dessinée pour détecter un pivotement.
    function dessiner(it) {
      const v = ++it.v, rotation = it.page.rotation;
      if (it.tache) { try { it.tache.cancel(); } catch { /* déjà terminée */ } it.tache = null; }
      it.page.source.doc.getPage(it.page.index + 1).then(p => {
        if (v !== it.v) return null;
        const dpr = window.devicePixelRatio || 1, r = (p.rotate + rotation) % 360;
        const vue = p.getViewport({ scale: LARGEUR / p.getViewport({ scale: 1, rotation: r }).width * dpr, rotation: r });
        const cv = document.createElement('canvas');
        cv.width = Math.floor(vue.width); cv.height = Math.floor(vue.height);
        it.tache = p.render({ canvasContext: cv.getContext('2d'), viewport: vue });
        return it.tache.promise.then(() => {
          if (v !== it.v) return;
          it.tache = null; it.rendu = rotation;
          it.cv.replaceWith(cv); it.cv = cv;
        });
      }).catch(() => { /* annulé, ou document fermé entre-temps */ });
    }

    const observer = () => observateur || (observateur = new IntersectionObserver(entrees => {
      for (const e of entrees) if (e.isIntersecting) { observateur.unobserve(e.target); dessiner(items.get(e.target.__page)); }
    }, { root: conteneur, rootMargin: '200px 0px' }));

    function creerItem(page) {
      const el = document.createElement('div');
      el.className = 'pdf-mini-item'; el.draggable = true;
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'pdf-mini';
      const cv = document.createElement('canvas');
      cv.width = LARGEUR; cv.height = HAUTEUR;
      const num = document.createElement('span');
      btn.append(cv, num);
      const coche = document.createElement('input');
      coche.type = 'checkbox'; coche.className = 'pdf-coche';
      el.append(btn, coche);
      const it = { page, el, btn, cv, num, coche, rendu: null, v: 0, tache: null };
      btn.__page = page;
      btn.addEventListener('click', () => ctx.aller(modele.liste.indexOf(page) + 1));
      coche.addEventListener('change', () => { modele.cocher(page, coche.checked); ctx.surSelection(); });
      el.addEventListener('dragstart', e => { glisse = page; e.dataTransfer.setData(TYPE_GLISSE, ''); e.dataTransfer.effectAllowed = 'move'; el.classList.add('pdf-glisse'); });
      el.addEventListener('dragend', () => { glisse = null; el.classList.remove('pdf-glisse'); });
      el.addEventListener('dragover', e => { if (glisse) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } });
      el.addEventListener('drop', e => {
        if (!glisse) return;
        e.preventDefault(); e.stopPropagation();
        const p = glisse; glisse = null;
        ctx.deplacer(p, modele.liste.indexOf(page));
      });
      items.set(page, it);
      observer().observe(btn);
      return it;
    }

    // Aligne le panneau sur le modèle : crée, retire, renumérote, redessine les pages pivotées
    function rafraichir() {
      const presentes = new Set(modele.liste);
      for (const [p, it] of items) if (!presentes.has(p)) { it.v++; if (observateur) observateur.unobserve(it.btn); items.delete(p); }
      conteneur.replaceChildren(...modele.liste.map((p, i) => {
        const it = items.get(p) || creerItem(p);
        it.btn.dataset.page = String(i + 1);
        it.btn.setAttribute('aria-label', 'Page ' + (i + 1));
        it.num.textContent = String(i + 1);
        it.coche.checked = modele.selection.has(p);
        it.coche.setAttribute('aria-label', 'Sélectionner la page ' + (i + 1));
        if (it.rendu !== null && it.rendu !== p.rotation) dessiner(it);
        return it.el;
      }));
    }

    function marquer(n) {
      for (const it of items.values()) {
        if (+it.btn.dataset.page === n) { it.btn.setAttribute('aria-current', 'page'); it.btn.scrollIntoView({ block: 'nearest' }); }
        else it.btn.removeAttribute('aria-current');
      }
    }

    function fermer() {
      if (observateur) { observateur.disconnect(); observateur = null; }
      for (const it of items.values()) it.v++;
      items.clear(); conteneur.replaceChildren();
    }

    return { rafraichir, marquer, fermer };
  }

  MPDS.pdfMiniatures = { creer };
})();
