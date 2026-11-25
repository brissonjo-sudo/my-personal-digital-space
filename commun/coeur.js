'use strict';
// Cœur de MPDS : registre de modules, routeur par hash (#/<id>) et passerelle
// de fichiers entre modules. Script classique (compatible file://), chargé avant
// les modules. Un module s'enregistre avec :
//   { id, titre, icone, monter(el), demonter(el), surFichier(fichier) }
// monter() est appelé UNE fois, au premier affichage ; passer à un autre module
// masque simplement le conteneur (l'état du module est conservé).
const MPDS = (() => {
  const ID_DEFAUT = 'convertir';
  const modules = new Map();           // id → { def, el }
  const montages = new Map();          // id → nombre de montages (observable par les tests)
  let actif = null;
  let demarre = false;

  const contenu = () => document.getElementById('mpds-contenu');
  const rail = () => document.getElementById('rail-liste');

  function enregistrer(def) {
    if (!def || !/^[a-z][a-z0-9-]*$/.test(def.id) || typeof def.monter !== 'function') {
      throw new Error('Module invalide');
    }
    if (modules.has(def.id)) throw new Error('Module déjà enregistré : ' + def.id);
    modules.set(def.id, { def, el: null });
    if (demarre) ajouterAuRail(def);   // enregistrement tardif, après demarrer()
  }

  function ajouterAuRail(def) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.className = 'rail-lien';
    a.href = '#/' + def.id;
    a.dataset.module = def.id;
    const icone = document.createElement('span');
    icone.className = 'rail-icone';
    icone.setAttribute('aria-hidden', 'true');
    icone.textContent = def.icone || '';
    a.append(icone, document.createTextNode(def.titre || def.id));
    li.append(a);
    rail().append(li);
  }

  function activer(id) {
    if (actif === id) return;
    const m = modules.get(id);
    if (actif) modules.get(actif).el.hidden = true;
    if (!m.el) {
      m.el = document.createElement('section');
      m.el.dataset.module = id;
      contenu().append(m.el);
    }
    m.el.hidden = false;
    actif = id;
    for (const a of rail().querySelectorAll('.rail-lien')) {
      if (a.dataset.module === id) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    }
    if (!montages.has(id)) {
      montages.set(id, 1);
      m.def.monter(m.el);
    }
  }

  // Route inconnue ou absente → module par défaut (hash normalisé)
  function router() {
    const m = /^#\/([a-z0-9-]+)$/.exec(location.hash);
    const id = m && modules.has(m[1]) ? m[1] : ID_DEFAUT;
    if (location.hash !== '#/' + id) location.replace('#/' + id);
    activer(id);
  }

  // Remet un fichier à un module (en mémoire, rien n'est stocké) et l'affiche.
  function envoyer(fichier, idModule) {
    const m = modules.get(idModule);
    if (!m || typeof m.def.surFichier !== 'function') throw new Error('Module inconnu ou sans réception de fichier : ' + idModule);
    activer(idModule);
    if (location.hash !== '#/' + idModule) location.hash = '#/' + idModule;
    return m.def.surFichier(fichier);
  }

  // Service worker : hors-ligne + installation PWA. Uniquement en http(s) :
  // inutile et non supporté sous file://.
  function enregistrerServiceWorker() {
    if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
    navigator.serviceWorker.register('./sw.js')
      .then(() => navigator.serviceWorker.ready)
      .then(() => console.info('Application disponible hors-ligne.'))
      .catch(err => console.warn('Service worker non enregistré :', err.message || err));
  }

  function demarrer() {
    demarre = true;
    for (const { def } of modules.values()) ajouterAuRail(def);
    window.addEventListener('hashchange', router);
    router();
    enregistrerServiceWorker();
  }

  document.addEventListener('DOMContentLoaded', demarrer);

  return { enregistrer, envoyer, actif: () => actif, montages };
})();
