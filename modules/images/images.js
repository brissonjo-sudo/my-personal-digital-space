// Module Images — interface : dépôt (clic ou glisser), réglages, liste des images et de leurs résultats,
// téléchargement une par une ou en .zip, envoi vers Convertir (lecture du texte par OCR).
// Rien n'est stocké : les images et les résultats restent en mémoire, le temps de la session.
(() => {
  'use strict';
  const ID = 'images', MAX_IMAGES = 100;
  const T = () => MPDS.imgTraitement, i = (nom, t) => MPDS.icones.svg(nom, t);
  const nombre = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
  const poids = n => n < 1024 ? n + ' o' : n < 1048576 ? nombre.format(n / 1024) + ' Ko' : nombre.format(n / 1048576) + ' Mo';
  let module, q, elements = [], occupe = false, jeton = 0;   // elements : { fichier, url, li, dims, resultat }

  const el = (nom, props, ...enfants) => {
    const e = Object.assign(document.createElement(nom), props);
    e.append(...enfants);
    return e;
  };
  function bouton(texte, classe, clic, icone, etiquette) {
    const b = el('button', { type: 'button', className: 'img-btn ' + classe });
    if (icone) b.append(MPDS.icones.creer(icone, 18));
    b.append(texte);
    if (etiquette) b.setAttribute('aria-label', etiquette);
    b.addEventListener('click', clic);
    return b;
  }

  // Gabarit statique : aucune donnée de fichier
  const GABARIT = () => `
<div class="img-module" data-etat="vide">
  <header class="img-entete">
    <h1>Images</h1>
    <p class="img-intro">Redimensionner, compresser, convertir et retirer les métadonnées (position GPS, appareil, dates). Les images restent sur votre appareil.</p>
  </header>
  <button type="button" class="img-depot" id="img-depot">${i('images', 36)}<span class="img-depot-titre">Ajouter des images</span><span>Cliquez ici ou glissez des images : JPEG, PNG, WebP, GIF, BMP, AVIF.</span></button>
  <input type="file" id="img-fichier" accept="image/*,.heic,.heif" multiple hidden>
  <form class="img-reglages" id="img-reglages" hidden>
    <fieldset class="img-modes">
      <legend>Traitement</legend>
      <label class="img-choix"><input type="radio" name="img-mode" value="meta" checked><span>Retirer les métadonnées seulement <span class="img-aide">sans perte de qualité</span></span></label>
      <label class="img-choix"><input type="radio" name="img-mode" value="reencoder"><span>Redimensionner, compresser ou convertir <span class="img-aide">retire aussi les métadonnées</span></span></label>
    </fieldset>
    <div class="img-options" id="img-options" hidden>
      <label class="img-champ">Taille <select id="img-taille">
        <option value="origine">Taille d'origine</option><option value="cote">Côté le plus long (px)</option><option value="pourcent">Pourcentage</option>
      </select></label>
      <label class="img-champ" id="img-valeur-champ" hidden><span id="img-valeur-nom">Pixels</span> <input type="number" id="img-valeur" min="1" max="20000" value="1920" required></label>
      <label class="img-champ">Format <select id="img-format">
        <option value="origine">Identique à l'original</option><option value="jpeg">JPEG</option><option value="webp">WebP</option><option value="png">PNG (sans perte)</option>
      </select></label>
      <label class="img-champ" id="img-qualite-champ">Qualité <input type="range" id="img-qualite" min="10" max="100" step="5" value="80"> <output id="img-qualite-v">80</output></label>
    </div>
    <div class="img-actions">
      <button type="submit" class="img-btn img-btn-primaire" id="img-traiter">Traiter les images</button>
      <button type="button" class="img-btn" id="img-zip" hidden>${i('telecharger', 18)} Tout télécharger (.zip)</button>
      <button type="button" class="img-btn" id="img-ajouter">${i('ajouter', 18)} Ajouter</button>
      <button type="button" class="img-btn" id="img-vider">Tout retirer</button>
    </div>
  </form>
  <div class="img-etat" id="img-etat" role="status" aria-live="polite"></div>
  <ul class="img-liste" id="img-liste" aria-label="Images"></ul>
</div>`;

  const message = t => { q.etat.textContent = t; };
  const reussis = () => elements.filter(e => e.resultat && !e.resultat.erreur);

  function reglages() {
    const mode = q.form.querySelector('input[name="img-mode"]:checked').value;
    return { mode, taille: { mode: q.taille.value, valeur: Number(q.valeur.value) }, format: q.format.value, qualite: Number(q.qualite.value) / 100 };
  }

  function majEtat() {
    module.dataset.etat = elements.length ? 'liste' : 'vide';
    q.form.hidden = !elements.length;
    const r = reglages();
    q.options.hidden = r.mode !== 'reencoder';
    q.valeurChamp.hidden = r.taille.mode === 'origine';
    q.valeur.disabled = q.options.hidden || q.valeurChamp.hidden;   // champ masqué : hors validation du formulaire
    q.qualiteChamp.hidden = r.format === 'png';
    q.qualiteV.value = q.qualite.value;
    q.traiter.disabled = occupe;
    q.traiter.textContent = occupe ? 'Traitement en cours…' : 'Traiter les images';
    q.zip.hidden = reussis().length < 2;
    for (const b of module.querySelectorAll('#img-vider, #img-ajouter, #img-zip, .img-retirer')) b.disabled = occupe;
  }

  function dessiner(e) {
    const f = e.fichier, r = e.resultat;
    const vignette = el('img', { className: 'img-vignette', src: e.url, alt: '', decoding: 'async', loading: 'lazy' });
    vignette.addEventListener('load', () => {
      if (e.dims) return;
      e.dims = vignette.naturalWidth + ' × ' + vignette.naturalHeight + ' px';
      meta.textContent = poids(f.size) + ' · ' + e.dims;
    }, { once: true });
    vignette.addEventListener('error', () => vignette.classList.add('img-sans-apercu'), { once: true });
    const meta = el('span', { className: 'img-meta', textContent: poids(f.size) + (e.dims ? ' · ' + e.dims : '') });
    const infos = el('div', { className: 'img-infos' }, el('span', { className: 'img-nom', textContent: f.name }), meta);
    const actions = el('div', { className: 'img-item-actions' });
    if (r && r.erreur) infos.append(el('span', { className: 'img-erreur', textContent: r.erreur }));
    else if (r) {
      const gain = Math.round((1 - r.blob.size / f.size) * 100);
      infos.append(
        el('span', { className: 'img-resultat', textContent: '→ ' + poids(r.blob.size) + ' · ' + r.w + ' × ' + r.h + ' px' + (gain > 0 ? ' (−' + gain + ' %)' : gain < 0 ? ' (+' + -gain + ' %)' : '') }),
        el('span', { className: 'img-retires', textContent: r.retires.length ? 'Retiré : ' + r.retires.join(', ') + '.' : 'Aucune métadonnée trouvée.' }),
        ...r.avis.map(a => el('span', { className: 'img-avis', textContent: a })));
      actions.append(bouton('Télécharger', 'img-btn-primaire', () => T().telecharger(r.blob, r.nom), 'telecharger', 'Télécharger « ' + r.nom + ' »'));
      if (/\.(jpg|png|webp)$/.test(r.nom)) {
        actions.append(bouton('Lire le texte', '', () => MPDS.envoyer(new File([r.blob], r.nom, { type: r.blob.type }), 'convertir'), 'convertir', 'Lire le texte de « ' + r.nom + ' » (OCR, module Convertir)'));
      }
    }
    actions.append(bouton('', 'img-btn-icone img-retirer', () => retirer(e), 'supprimer', 'Retirer « ' + f.name + ' »'));
    e.li.replaceChildren(vignette, infos, actions);
  }

  function ajouter(fichiers) {
    const liste = [...fichiers], place = MAX_IMAGES - elements.length;
    if (!liste.length || occupe) return;
    for (const f of liste.slice(0, Math.max(0, place))) {
      const e = { fichier: f, url: URL.createObjectURL(f), li: el('li', { className: 'img-item' }), dims: '', resultat: null };
      elements.push(e); dessiner(e); q.liste.append(e.li);
    }
    message(liste.length > place ? 'Au plus ' + MAX_IMAGES + ' images à la fois : ' + (liste.length - Math.max(0, place)) + ' non ajoutée(s).' : '');
    majEtat();
  }

  function retirer(e) {
    if (occupe) return;
    URL.revokeObjectURL(e.url); e.li.remove();
    elements = elements.filter(x => x !== e);
    message(''); majEtat();
  }

  function vider() {
    if (occupe) return;
    for (const e of elements) URL.revokeObjectURL(e.url);
    elements = []; q.liste.replaceChildren(); message(''); majEtat();
  }

  // Réglages modifiés : les résultats affichés ne correspondent plus, ils sont retirés
  function invalider() {
    majEtat();
    if (occupe) return;
    for (const e of elements) if (e.resultat) { e.resultat = null; dessiner(e); }
    majEtat();
  }

  async function traiter() {
    if (occupe || !elements.length) return;
    if (!q.form.reportValidity()) return;
    occupe = true; majEtat();
    const mon = ++jeton, reg = reglages(), lot = elements.slice();
    let ok = 0;
    for (const [k, e] of lot.entries()) {
      message('Traitement de l\'image ' + (k + 1) + ' sur ' + lot.length + '…');
      try { e.resultat = await T().traiter(e.fichier, reg); ok++; }
      catch (err) { e.resultat = { erreur: err.name === 'Image' ? err.message : 'Erreur inattendue (' + err.message + ').' }; }
      if (mon !== jeton) return;   // module démonté entre-temps
      dessiner(e);
    }
    occupe = false;
    const ko = lot.length - ok;
    message(ok + (ok > 1 ? ' images traitées' : ' image traitée') + (ko ? ', ' + ko + ' en échec' : '') + '. Rien n\'a quitté votre appareil.');
    majEtat();
  }

  async function toutTelecharger() {
    const ok = reussis();
    if (occupe || ok.length < 2) return;
    try { T().telecharger(await T().zip(ok.map(e => e.resultat)), 'images traitées.zip'); }
    catch (err) { message('Archive impossible (' + err.message + ').'); }
  }

  function monter(section) {
    section.innerHTML = GABARIT();   // gabarit statique : aucune donnée de fichier
    module = section.querySelector('.img-module');
    const $ = id => section.querySelector('#img-' + id);
    q = { depot: $('depot'), fichier: $('fichier'), form: $('reglages'), options: $('options'), taille: $('taille'), valeur: $('valeur'),
      valeurChamp: $('valeur-champ'), valeurNom: $('valeur-nom'), format: $('format'), qualite: $('qualite'), qualiteChamp: $('qualite-champ'),
      qualiteV: $('qualite-v'), traiter: $('traiter'), zip: $('zip'), etat: $('etat'), liste: $('liste') };
    const choisir = () => q.fichier.click();
    q.depot.addEventListener('click', choisir);
    $('ajouter').addEventListener('click', choisir);
    q.fichier.addEventListener('change', () => { const f = [...q.fichier.files]; q.fichier.value = ''; ajouter(f); });
    $('vider').addEventListener('click', vider);
    q.zip.addEventListener('click', toutTelecharger);
    q.form.addEventListener('submit', e => { e.preventDefault(); traiter(); });
    q.taille.addEventListener('change', () => {
      const pc = q.taille.value === 'pourcent';
      q.valeurNom.textContent = pc ? 'Pourcentage' : 'Pixels';
      Object.assign(q.valeur, pc ? { min: 1, max: 100, value: 50 } : { min: 1, max: 20000, value: 1920 });
    });
    q.form.addEventListener('input', invalider);
    q.form.addEventListener('change', invalider);

    // Glisser-déposer sur tout le module (compteur : pas de clignotement sur les enfants)
    let survols = 0;
    const fichiersGlisses = e => e.dataTransfer.types.includes('Files');
    module.addEventListener('dragenter', e => { if (!fichiersGlisses(e)) return; e.preventDefault(); survols++; module.classList.add('img-survol'); });
    module.addEventListener('dragleave', e => { if (fichiersGlisses(e) && --survols <= 0) { survols = 0; module.classList.remove('img-survol'); } });
    module.addEventListener('dragover', e => e.preventDefault());
    module.addEventListener('drop', e => { e.preventDefault(); survols = 0; module.classList.remove('img-survol'); ajouter(e.dataTransfer.files); });
    majEtat();
  }

  function demonter() {
    jeton++; occupe = false;
    for (const e of elements) URL.revokeObjectURL(e.url);
    elements = [];
  }

  MPDS.enregistrer({ id: ID, titre: 'Images', icone: 'images', monter, demonter, surFichier: f => ajouter([f]) });
})();
