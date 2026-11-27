// Module PDF — signature : fenêtre modale (dessiner, ou importer une image dont le fond est retiré).
// Valider produit { url (PNG en data URL), w, h (pixels) } rogné aux pixels visibles. La signature de la
// session reste dans cette variable (elle disparaît au rechargement) ; elle n'est enregistrée sur
// l'appareil que si l'utilisateur le demande, chiffrée par sa phrase secrète (coffre.js).
// Publie MPDS.pdfSignature.{ ouvrir(surValide), courante() }.
(() => {
  'use strict';
  const MAX_OCTETS = 10 * 1024 * 1024, MAX_COTE = 1200, MAX_PIXELS = 40e6;
  const ENCRES = [['Noir', '#000000'], ['Bleu foncé', '#0b2a6f']];
  let session = null, ouverte = false;

  const el = (nom, props, ...enfants) => {
    const e = Object.assign(document.createElement(nom), props);
    e.append(...enfants);
    return e;
  };
  const bouton = (texte, classe, clic) => {
    const b = el('button', { type: 'button', className: 'pdf-btn ' + (classe || ''), textContent: texte });
    b.addEventListener('click', clic);
    return b;
  };
  const canvasDe = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });

  function ouvrir(surValide) {
    if (ouverte) return;
    ouverte = true;
    const avant = document.activeElement;
    let onglet = 'dessin', source = null, trace = false;

    const msg = el('p', { className: 'pdf-modale-msg', role: 'alert' });
    const dire = t => { msg.textContent = t; };
    const fond = el('div', { className: 'pdf-modale-fond' });
    const dlg = el('div', { className: 'pdf-modale', role: 'dialog', tabIndex: -1 });   // focalisable : un clic sur le canvas y ramène le focus
    dlg.setAttribute('aria-modal', 'true'); dlg.setAttribute('aria-labelledby', 'pdf-modale-titre');
    // Filet : une touche frappée hors de la fenêtre (focus perdu) n'atteint jamais le document derrière
    const garde = e => {
      if (dlg.contains(e.target)) return;
      e.stopImmediatePropagation(); e.preventDefault();
      if (e.key === 'Escape') fermer(); else dlg.focus();
    };
    let fermee = false;
    const fermer = () => { fermee = true; ouverte = false; document.removeEventListener('keydown', garde, true); fond.remove(); if (avant && avant.focus) avant.focus(); };
    const finir = sig => { if (fermee) return; session = sig; fermer(); surValide(sig); };   // fermée pendant le chiffrement : rien n'est posé

    // ---- Onglet Dessiner ----
    const cv = el('canvas', { className: 'pdf-sig-canvas', width: 640, height: 220 });
    cv.setAttribute('aria-label', 'Zone de dessin de la signature (souris ou stylet)');
    const g = cv.getContext('2d');
    Object.assign(g, { lineWidth: 4, lineCap: 'round', lineJoin: 'round', strokeStyle: ENCRES[0][1] });
    const pos = e => { const b = cv.getBoundingClientRect(); return [(e.clientX - b.left) * cv.width / b.width, (e.clientY - b.top) * cv.height / b.height]; };
    // doigt : pointeur qui trace ; un second (paume) est ignoré, sauf un stylet arrivé après un contact au
    // doigt : il l'emporte et le trait de la paume est effacé (image d'avant son appui)
    let dernier = null, doigt = null, genre = '', image0 = null;
    cv.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      if (dernier) { if (e.pointerType !== 'pen' || genre !== 'touch') return; g.putImageData(image0, 0, 0); }
      else image0 = g.getImageData(0, 0, cv.width, cv.height);
      doigt = e.pointerId; genre = e.pointerType;
      cv.setPointerCapture(e.pointerId);
      dernier = pos(e); trace = true; dire('');
      g.beginPath(); g.moveTo(...dernier); g.lineTo(dernier[0] + 0.1, dernier[1]); g.stroke();   // un simple clic laisse un point
    });
    cv.addEventListener('pointermove', e => {
      if (!dernier || e.pointerId !== doigt) return;
      const p = pos(e);
      g.beginPath(); g.moveTo(...dernier); g.lineTo(...p); g.stroke();
      dernier = p;
    });
    for (const t of ['pointerup', 'pointercancel']) cv.addEventListener(t, e => { if (e.pointerId === doigt) dernier = null; });
    const encres = el('div', { className: 'pdf-sig-encres', role: 'radiogroup' });
    encres.setAttribute('aria-label', 'Encre');
    ENCRES.forEach(([nom, c], i) => {
      const r = el('input', { type: 'radio', name: 'pdf-sig-encre', checked: i === 0 });
      r.addEventListener('change', () => {   // recolore le tracé existant (le fond reste transparent)
        g.strokeStyle = c;
        g.globalCompositeOperation = 'source-in'; g.fillStyle = c; g.fillRect(0, 0, cv.width, cv.height);
        g.globalCompositeOperation = 'source-over';
      });
      encres.append(el('label', {}, r, ' ' + nom));
    });
    const effacer = () => { g.clearRect(0, 0, cv.width, cv.height); trace = false; };
    const panDessin = el('div', { role: 'tabpanel' }, cv, el('div', { className: 'pdf-modale-ligne' }, bouton('Effacer', '', effacer), encres));

    // ---- Onglet Importer ----
    const fichier = el('input', { type: 'file', accept: 'image/png,image/jpeg', id: 'pdf-sig-fichier' });
    const tol = el('input', { type: 'range', min: 0, max: 100, step: 1, value: 40, id: 'pdf-sig-tolerance' });
    const apercu = el('canvas', { className: 'pdf-sig-apercu', width: 1, height: 1, id: 'pdf-sig-apercu' });
    apercu.setAttribute('aria-label', 'Aperçu de la signature sans fond');
    const majApercu = () => { if (source) apercu.getContext('2d').putImageData(MPDS.pdfDetourage.retirerFond(source, Number(tol.value)), 0, 0); };
    tol.addEventListener('input', majApercu);
    let jetonImport = 0;   // un import plus récent l'emporte sur un décodage lent encore en cours
    fichier.addEventListener('change', async () => {
      const f = fichier.files[0], mon = ++jetonImport;
      source = null; dire('');
      if (!f) return;
      try {
        if (f.size > MAX_OCTETS) throw new Error('Fichier trop volumineux (' + (f.size / 1048576).toFixed(1).replace('.', ',') + ' Mo) : 10 Mo maximum.');
        const o = new Uint8Array(await f.arrayBuffer()), type = MPDS.pdfDetourage.typeReel(o);
        if (!type) throw new Error('Ce fichier n\'est pas une image PNG ou JPEG valide.');
        const dim = MPDS.pdfDetourage.dimensions(o, type);
        if (!dim || !dim[0] || !dim[1] || dim[0] * dim[1] > MAX_PIXELS) throw new Error('Dimensions de l\'image illisibles ou démesurées.');
        const bmp = await createImageBitmap(new Blob([o], { type: 'image/' + type })), k = Math.min(1, MAX_COTE / Math.max(bmp.width, bmp.height));
        if (mon !== jetonImport) { bmp.close(); return; }
        apercu.width = Math.max(1, Math.round(bmp.width * k)); apercu.height = Math.max(1, Math.round(bmp.height * k));
        const gc = apercu.getContext('2d', { willReadFrequently: true });
        gc.drawImage(bmp, 0, 0, apercu.width, apercu.height);
        bmp.close();
        source = gc.getImageData(0, 0, apercu.width, apercu.height);
        majApercu();
      } catch (err) { if (mon === jetonImport) dire(err.message || 'Image illisible.'); }
    });
    const panImport = el('div', { role: 'tabpanel', hidden: true },
      el('label', {}, 'Image de la signature (PNG ou JPG, 10 Mo maximum) ', fichier),
      el('label', { className: 'pdf-modale-ligne' }, 'Tolérance (fond clair retiré) ', tol),
      el('div', { className: 'pdf-damier' }, apercu));

    // ---- Onglets, pied, validation ----
    const onglets = el('div', { role: 'tablist' });
    const tabs = {};
    for (const [id, nom, pan] of [['dessin', 'Dessiner', panDessin], ['import', 'Importer une image', panImport]]) {
      const t = bouton(nom, 'pdf-onglet', () => choisir(id));
      t.setAttribute('role', 'tab');
      tabs[id] = { t, pan }; onglets.append(t);
    }
    function choisir(id) {
      onglet = id; dire('');
      for (const k in tabs) { tabs[k].t.setAttribute('aria-selected', String(k === id)); tabs[k].t.tabIndex = k === id ? 0 : -1; tabs[k].pan.hidden = k !== id; }
    }
    async function valider() {
      let c = null;
      if (onglet === 'dessin') c = trace ? MPDS.pdfDetourage.rogner(cv) : null;
      else if (source) {
        const tmp = canvasDe(source.width, source.height);
        tmp.getContext('2d').putImageData(MPDS.pdfDetourage.retirerFond(source, Number(tol.value)), 0, 0);
        c = MPDS.pdfDetourage.rogner(tmp);
      }
      if (!c) { dire(onglet === 'dessin' ? 'Dessinez d\'abord votre signature.' : source ? 'Aucun trait visible : réduisez la tolérance.' : 'Choisissez d\'abord une image.'); return; }
      const sig = { url: c.toDataURL('image/png'), w: c.width, h: c.height };
      if (garder && garder.checked) {
        if (phrase1.value !== phrase2.value) { dire('Les deux phrases secrètes ne correspondent pas.'); return; }
        if (!await chiffrer(() => MPDS.pdfCoffre.enregistrer(sig, phrase1.value))) return;   // échec : rien n'est posé
      }
      finir(sig);
    }
    // Calcul de clé (PBKDF2) : de l'ordre d'une seconde ; un second clic pendant ce temps est ignoré
    let occupe = false;
    async function chiffrer(action) {
      if (occupe) return false;
      occupe = true; dire('Chiffrement en cours…');
      try { const r = await action(); dire(''); return r || true; }
      catch (err) { dire(err.name === 'Coffre' ? err.message : 'Erreur de chiffrement (' + err.message + ').'); return false; }
      finally { occupe = false; }
    }

    // ---- Signature enregistrée sur cet appareil (coffre.js) ----
    const coffre = MPDS.pdfCoffre, champ = (id, autocomplete) => el('input', { type: 'password', id, autocomplete, spellcheck: false });
    let garder = null, phrase1 = null, phrase2 = null, blocCoffre = null;
    if (coffre.disponible()) {
      phrase1 = champ('pdf-sig-phrase', 'new-password'); phrase2 = champ('pdf-sig-phrase2', 'new-password');
      garder = el('input', { type: 'checkbox', id: 'pdf-sig-garder' });
      const champs = el('div', { className: 'pdf-modale-ligne', hidden: true },
        el('label', {}, 'Phrase secrète (' + coffre.PHRASE_MIN + ' caractères au moins) ', phrase1), el('label', {}, 'Confirmer la phrase ', phrase2));
      garder.addEventListener('change', () => { champs.hidden = !garder.checked; if (garder.checked) phrase1.focus(); });
      blocCoffre = el('div', {}, el('label', { className: 'pdf-modale-ligne' }, garder,
        ' Enregistrer sur cet appareil, chiffrée par une phrase secrète' + (coffre.existe() ? ' (remplace la signature enregistrée)' : '')), champs);
    }
    dlg.append(el('h2', { id: 'pdf-modale-titre', textContent: 'Signature' }));
    if (session) {
      const img = el('img', { src: session.url, alt: 'Signature créée pendant cette session', className: 'pdf-damier pdf-sig-session' });
      dlg.append(el('div', { className: 'pdf-modale-ligne' }, img, bouton('Réutiliser cette signature', '', () => finir(session))));
    }
    if (coffre.existe()) {
      const phrase = champ('pdf-sig-phrase-ouvrir', 'current-password');
      const deverrouiller = async () => { const sig = await chiffrer(() => coffre.ouvrir(phrase.value)); if (sig) finir(sig); };
      phrase.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); deverrouiller(); } });
      const ligne = el('div', { className: 'pdf-modale-ligne' }, el('label', {}, 'Signature enregistrée sur cet appareil, phrase secrète ', phrase),
        bouton('Utiliser la signature enregistrée', '', deverrouiller),
        bouton('Oublier la signature enregistrée', '', () => {
          if (!confirm('Supprimer la signature enregistrée sur cet appareil ? Elle ne pourra pas être récupérée.')) return;
          coffre.oublier(); ligne.remove(); dire('Signature enregistrée supprimée de cet appareil.');
        }));
      dlg.append(ligne);
    }
    dlg.append(onglets, panDessin, panImport);
    if (blocCoffre) dlg.append(blocCoffre);
    dlg.append(msg, el('div', { className: 'pdf-modale-ligne' }, bouton('Annuler', '', fermer), bouton('Valider', 'pdf-btn-primaire', valider)));
    choisir('dessin');

    // Clavier : Échap ferme, Tab reste dans la fenêtre, flèches entre onglets ; rien ne remonte aux raccourcis du module
    dlg.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); fermer(); return; }
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && e.target.getAttribute('role') === 'tab') {
        const ids = Object.keys(tabs), i = (ids.indexOf(onglet) + (e.key === 'ArrowRight' ? 1 : ids.length - 1)) % ids.length;
        choisir(ids[i]); tabs[ids[i]].t.focus(); e.preventDefault();
      }
      if (e.key !== 'Tab') return;
      const f = [...dlg.querySelectorAll('button, input')].filter(x => !x.disabled && x.offsetParent !== null && x.tabIndex >= 0);
      const i = f.indexOf(document.activeElement);
      if (!f.length) return;
      if (e.shiftKey && i <= 0) { f[f.length - 1].focus(); e.preventDefault(); }
      else if (!e.shiftKey && (i === f.length - 1 || i < 0)) { f[0].focus(); e.preventDefault(); }
    });
    fond.addEventListener('pointerdown', e => { if (e.target === fond) e.preventDefault(); });   // un clic à côté garde le focus dans la fenêtre
    fond.append(dlg);
    document.body.append(fond);
    document.addEventListener('keydown', garde, true);
    tabs.dessin.t.focus();
  }

  MPDS.pdfSignature = { ouvrir, courante: () => session };
})();
