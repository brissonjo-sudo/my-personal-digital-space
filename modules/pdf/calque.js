// Module PDF — calque d'annotations : un SVG posé sur le canvas de la page affichée, dans le repère
// du viewport à l'échelle 1 (viewBox) : le zoom ne le touche pas. Dessine les annotations du modèle
// (converties depuis les points PDF), gère les gestes (pointeur) de chaque outil et la saisie du
// texte. Éléments créés avec createElementNS / textContent : aucune donnée en innerHTML.
// Publie MPDS.pdfCalque.creer(ctx).
//   ctx = { annotations, r (réglages : outil, couleur, police, taille, epaisseur, opacite), message(texte, erreur) }
(() => {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const FAMILLES = { Helvetica: 'Helvetica, Arial, sans-serif', TimesRoman: '"Times New Roman", Times, serif', Courier: '"Courier New", Courier, monospace' };
  const el = (nom, attrs, parent) => {
    const e = document.createElementNS(NS, nom);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.append(e);
    return e;
  };
  const REDIM = ['signature', 'tampon'];   // objets posés en un clic, déplaçables et redimensionnables (proportions conservées)
  const geom = a => (a.pts ? { pts: a.pts } : REDIM.includes(a.type) ? { x: a.x, y: a.y, w: a.w, h: a.h, ...(a.taille && { taille: a.taille }) } : { x: a.x, y: a.y });
  const decaler = (g, dx, dy) => (g.pts ? { pts: g.pts.map(([x, y]) => [x + dx, y + dy]) } : { ...g, x: g.x + dx, y: g.y + dy });
  const trace = { fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };

  function creer(ctx) {
    const r = ctx.r;
    let feuille = null, svg = null, entree = null, info = null;   // page du modèle affichée, { view, rotation }
    let selection = null, geste = null, editeur = null;
    const vp = (x, y) => MPDS.pdfCoord.versPdf(info, x, y);        // affichage → PDF
    const ve = (X, Y) => MPDS.pdfCoord.dePdf(info, X, Y);          // PDF → affichage
    const pt = e => {
      const b = svg.getBoundingClientRect(), v = svg.viewBox.baseVal;
      return { x: (e.clientX - b.left) * v.width / b.width, y: (e.clientY - b.top) * v.height / b.height, k: b.width / v.width };
    };

    function formeDe(a, poignee) {
      const g = el('g', { class: 'pdf-annot', 'data-id': a.id, 'data-type': a.type });
      if (a.type === 'surlig') {
        const p = ve(a.x, a.y), q = ve(a.x + a.w, a.y + a.h);
        el('rect', { x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), width: Math.abs(q.x - p.x), height: Math.abs(q.y - p.y), fill: a.couleur, 'fill-opacity': a.opacite }, g);
      } else if (a.type === 'texte') {
        const p = ve(a.x, a.y);   // rotation nette = rotation affichée − angle de lecture : 0 tant que la page n'est pas repivotée
        const t = el('text', { x: p.x, y: p.y, 'font-size': a.taille, 'font-family': FAMILLES[a.police] || FAMILLES.Helvetica, fill: a.couleur, transform: `rotate(${info.rotation - a.angle} ${p.x} ${p.y})`, style: 'white-space: pre' }, g);
        t.textContent = a.texte;
      } else if (REDIM.includes(a.type)) {   // repère local : origine au coin bas-gauche, tourné comme le texte
        const p = ve(a.x, a.y);
        const l = el('g', { transform: `translate(${p.x} ${p.y}) rotate(${info.rotation - a.angle})` }, g);
        el('rect', { x: 0, y: -a.h, width: a.w, height: a.h, fill: '#000', 'fill-opacity': 0 }, l);   // zone de saisie (pixels transparents compris)
        if (a.type === 'signature') el('image', { href: a.png, x: 0, y: -a.h, width: a.w, height: a.h, preserveAspectRatio: 'none' }, l);
        else MPDS.pdfTampons.dessiner(a, l, el);
        if (poignee) {   // coin haut-droit ; taille constante à l'écran quel que soit le zoom
          const k = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width || 1, c = 5 / k;
          el('rect', { class: 'pdf-poignee', x: a.w - c, y: -a.h - c, width: 2 * c, height: 2 * c, transform: `rotate(${-(a.incl || 0)} ${a.w / 2} ${-a.h / 2})` }, l);
        }
      } else {
        const points = a.pts.map(([x, y]) => { const p = ve(x, y); return p.x + ',' + p.y; }).join(' ');
        el('polyline', { ...trace, points, stroke: 'transparent', 'stroke-width': Math.max(a.epaisseur, 12) }, g);   // zone de saisie élargie
        el('polyline', { ...trace, points, stroke: a.couleur, 'stroke-width': a.epaisseur }, g);
      }
      return g;
    }

    function redessiner() {
      if (!svg) return;
      svg.replaceChildren();
      svg.dataset.outil = r.outil;
      if (selection && !entree.annots.includes(selection)) selection = null;
      for (const a of entree.annots) {
        const g = formeDe(a, false);
        svg.append(g);
        if (a === selection) {
          const b = g.getBBox();
          if (REDIM.includes(a.type)) { g.remove(); svg.append(formeDe(a, true)); }
          el('rect', { x: b.x - 3, y: b.y - 3, width: b.width + 6, height: b.height + 6, class: 'pdf-contour' }, svg);
        }
      }
    }

    // ---- Saisie du texte : zone posée sur la page, Entrée/perte du focus valide, Échap annule ----
    function fermerEditeur() {
      const ed = editeur;
      editeur = null;
      if (ed) ed.input.remove();
    }

    function validerEditeur() {
      const ed = editeur;
      if (!ed) return;
      if (!ed.input.value.trim()) { fermerEditeur(); return; }
      let texte;
      try { texte = MPDS.pdfTexte.verifier(ed.input.value); }
      catch (err) {   // refus : message clair, la zone reste ouverte
        ctx.message(err.message, true);
        ed.refuse = true;   // un message d'erreur est affiché : à effacer une fois le texte accepté
        ed.input.setAttribute('aria-invalid', 'true');
        setTimeout(() => { if (editeur === ed) ed.input.focus(); }, 0);
        return;
      }
      const p = vp(ed.p.x, ed.p.y);
      fermerEditeur();
      if (ed.refuse) ctx.message('');
      ctx.annotations.ajouter(entree, { type: 'texte', x: p.x, y: p.y, texte, police: ed.police, taille: ed.taille, couleur: ed.couleur, angle: ((info.rotation % 360) + 360) % 360 });
    }

    function ouvrirEditeur(p) {
      const input = document.createElement('input');
      input.type = 'text'; input.className = 'pdf-saisie';
      input.setAttribute('aria-label', 'Texte à placer sur la page');
      input.style.left = p.x * p.k + 'px';
      input.style.top = (p.y - r.taille * 0.95) * p.k + 'px';
      input.style.fontSize = r.taille * p.k + 'px';
      input.style.fontFamily = FAMILLES[r.police];
      input.style.color = r.couleur;
      const ed = editeur = { input, p, police: r.police, taille: r.taille, couleur: r.couleur, refuse: false };
      input.addEventListener('input', () => input.removeAttribute('aria-invalid'));
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); validerEditeur(); }
        else if (e.key === 'Escape') { e.preventDefault(); fermerEditeur(); }
      });
      input.addEventListener('blur', () => { if (editeur === ed) validerEditeur(); });
      feuille.append(input);
      input.focus();
    }

    // ---- Gestes ----
    function debut(e) {
      if (e.button !== 0 || editeur) return;   // saisie ouverte : sa perte de focus valide
      if (geste) {   // 2e pointeur : ignoré (paume), sauf un stylet arrivé après un contact au doigt (la paume posée d'abord)
        if (e.pointerType !== 'pen' || geste.stylet) return;
        abandonner();
      }
      const p = pt(e), o = r.outil, g = e.target.closest('[data-id]');
      const a = g ? entree.annots.find(x => x.id === +g.dataset.id) : null;
      if (o === 'sel' && selection && e.target.classList.contains('pdf-poignee')) {   // poignée d'angle : agrandir / réduire
        const b = e.target.getBoundingClientRect(), h = pt({ clientX: b.left + b.width / 2, clientY: b.top + b.height / 2 });
        const c = ve(selection.x, selection.y);
        geste = { type: 'redim', id: e.pointerId, stylet: e.pointerType === 'pen', a: selection, depart: p, avant: geom(selection), c, d0: Math.hypot(h.x - c.x, h.y - c.y) || 1, bouge: false };
        svg.setPointerCapture(e.pointerId);
        return;
      }
      if (o === 'gomme') { if (a) ctx.annotations.supprimer(entree, a); return; }
      if (o === 'sel') {
        selection = a || null;
        redessiner();
        geste = a ? { type: 'dep', a, depart: p, avant: geom(a), bouge: false } : null;
      } else geste = { type: o, depart: p, fin: p, pts: [p] };
      if (geste) { Object.assign(geste, { id: e.pointerId, stylet: e.pointerType === 'pen' }); svg.setPointerCapture(e.pointerId); }
    }

    // Le geste appartient au pointeur qui l'a commencé : les mouvements, le lever ou l'annulation d'un
    // autre pointeur (paume posée pendant le tracé) n'y touchent pas
    const autre = e => !geste || (e && e.pointerId !== undefined && e.pointerId !== geste.id);

    function bouge(e) {
      if (autre(e)) return;
      const p = pt(e), d = geste.depart;
      // Déplacer ou redimensionner : rien sous 2 px d'écran (un clic qui tremble n'est pas un déplacement)
      if ((geste.type === 'dep' || geste.type === 'redim') && !geste.bouge && Math.hypot(p.x - d.x, p.y - d.y) * p.k <= 2) return;
      if (geste.type === 'redim') {   // facteur = distance du pointeur au coin fixe / distance initiale de la poignée
        const av = geste.avant, k = Math.min(1500 / av.w, Math.max(8 / av.w, Math.hypot(p.x - geste.c.x, p.y - geste.c.y) / geste.d0));
        Object.assign(geste.a, { w: av.w * k, h: av.h * k, ...(av.taille && { taille: av.taille * k }) });
        geste.bouge = true;
        redessiner();
      } else if (geste.type === 'dep') {
        const a0 = vp(d.x, d.y), a1 = vp(p.x, p.y);
        Object.assign(geste.a, decaler(geste.avant, a1.x - a0.x, a1.y - a0.y));
        geste.bouge = true;
        redessiner();
      } else if (geste.type === 'surlig') {
        geste.fin = p;
        if (!geste.el) geste.el = el('rect', { class: 'pdf-apercu', fill: r.couleur, 'fill-opacity': r.opacite / 100 }, svg);
        for (const [k, v] of Object.entries({ x: Math.min(d.x, p.x), y: Math.min(d.y, p.y), width: Math.abs(p.x - d.x), height: Math.abs(p.y - d.y) })) geste.el.setAttribute(k, v);
      } else if (geste.type === 'dessin') {
        const l = geste.pts[geste.pts.length - 1];
        if (Math.hypot(p.x - l.x, p.y - l.y) < 1) return;   // points trop proches : inutiles
        geste.pts.push(p);
        if (!geste.el) geste.el = el('polyline', { ...trace, class: 'pdf-apercu', stroke: r.couleur, 'stroke-width': r.epaisseur }, svg);
        geste.el.setAttribute('points', geste.pts.map(q => q.x + ',' + q.y).join(' '));
      }
    }

    // Pose un objet (signature, tampon) centré sur le point cliqué ; ctx.objet() le fabrique (ou renvoie null en signalant l'erreur)
    function poser1(p) {
      const o = ctx.objet(r.outil);
      if (!o) return;
      const c = vp(p.x - o.w / 2, p.y + o.h / 2);
      ctx.annotations.ajouter(entree, { ...o, x: c.x, y: c.y, angle: ((info.rotation % 360) + 360) % 360 });
    }

    function fin(e) {
      if (autre(e)) return;
      const g = geste;
      geste = null;
      if (g.el) g.el.remove();
      if (g.type === 'dep' || g.type === 'redim') { if (g.bouge) ctx.annotations.deplacer(entree, g.a, g.avant, geom(g.a)); }
      else if (REDIM.includes(g.type)) poser1(g.depart);
      else if (g.type === 'texte') ouvrirEditeur(g.depart);   // à la fin du clic : le focus donné à l'appui serait repris
      else if (g.type === 'surlig') {
        const a = vp(g.depart.x, g.depart.y), b = vp(g.fin.x, g.fin.y), w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
        if (w > 2 && h > 2) ctx.annotations.ajouter(entree, { type: 'surlig', x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w, h, couleur: r.couleur, opacite: r.opacite / 100 });
      } else if (g.type === 'dessin' && g.pts.length > 1) {
        ctx.annotations.ajouter(entree, { type: 'dessin', pts: g.pts.map(q => { const v = vp(q.x, q.y); return [v.x, v.y]; }), couleur: r.couleur, epaisseur: r.epaisseur });
      }
    }

    // Geste interrompu (pointercancel, capture perdue, page remplacée) : un déplacement ou un
    // redimensionnement en cours est défait, rien n'est enregistré
    function abandonner(e) {
      if (autre(e)) return;
      const g = geste;
      geste = null;
      if (g.el) g.el.remove();
      if ((g.type === 'dep' || g.type === 'redim') && g.bouge) { Object.assign(g.a, g.avant); redessiner(); }
    }

    // Pose le calque sur le canvas qui vient d'être rendu ; renvoie l'élément à insérer dans la scène.
    // base : viewport à l'échelle 1 ; inf : { view, rotation } de la page affichée.
    function poser(cv, ent, inf, base) {
      validerEditeur(); fermerEditeur();   // texte en cours : posé sur la page qu'on quitte (fermé s'il est refusé)
      abandonner(); selection = null;
      entree = ent; info = inf;
      feuille = document.createElement('div');
      feuille.className = 'pdf-feuille';
      svg = el('svg', { class: 'pdf-calque', viewBox: `0 0 ${base.width} ${base.height}`, role: 'group', 'aria-label': 'Annotations de la page' });
      svg.style.width = cv.style.width; svg.style.height = cv.style.height;
      svg.addEventListener('pointerdown', debut);
      svg.addEventListener('pointermove', bouge);
      svg.addEventListener('pointerup', fin);
      svg.addEventListener('pointercancel', abandonner);
      svg.addEventListener('lostpointercapture', abandonner);   // après pointerup, le geste est déjà clos : sans effet
      feuille.append(cv, svg);
      redessiner();
      return feuille;
    }

    function supprimerSelection() {
      if (!selection || !entree) return false;
      const a = selection;
      selection = null;
      ctx.annotations.supprimer(entree, a);
      return true;
    }

    function fermer() { fermerEditeur(); geste = null; selection = null; svg = null; entree = null; }

    return { poser, redessiner, supprimerSelection, fermer, entree: () => entree, enGeste: () => !!geste };
  }

  MPDS.pdfCalque = { creer };
})();
