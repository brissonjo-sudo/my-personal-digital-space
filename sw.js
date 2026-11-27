/* Service worker — fonctionnement 100 % hors-ligne après la première visite.
 *
 * MISE À JOUR :
 *  - Modifier index.html, commun/ ou modules/ : rien à faire. Les navigations sont servies en
 *    « réseau d'abord » ; la nouvelle version s'affiche au rechargement suivant.
 *  - Changer la version d'une bibliothèque CDN : mettre à jour l'URL dans
 *    index.html ET dans PRECACHE ci-dessous, PUIS incrémenter VERSION. L'ancien
 *    cache est purgé à l'activation ; les nouvelles libs sont prises au rechargement.
 */
'use strict';

const VERSION = 'mpds-v8';                    // ← nom du cache ; bump si libs CDN changent
const PREFIXE = 'mpds-';                      // seuls les caches de ce préfixe nous appartiennent
const CDN = 'https://cdnjs.cloudflare.com/ajax/libs';
// SheetJS n'est plus publié sur cdnjs depuis 0.18.5 (version vulnérable)
const SHEETJS = 'https://cdn.sheetjs.com/xlsx-0.20.3/package';

// Coquille de l'application + 7 URLs CDN épinglées (6 libs + worker PDF.js).
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icone.svg',
  './commun/style.css',
  './commun/coeur.js',
  './commun/icones.js',
  './commun/polices/source-serif-4-latin-600-normal.woff2',
  './commun/polices/source-sans-3-latin-400-normal.woff2',
  './commun/polices/source-sans-3-latin-600-normal.woff2',
  './commun/pdfjs.js',
  './modules/convertir/convertir.css',
  './modules/convertir/partage.js',
  './modules/convertir/convertir.js',
  './modules/pdf/pdf.css',
  './modules/pdf/pages.js',
  './modules/pdf/export.js',
  './modules/pdf/coordonnees.js',
  './modules/pdf/texte.js',
  './modules/pdf/miniatures.js',
  './modules/pdf/actions.js',
  './modules/pdf/annotations.js',
  './modules/pdf/calque.js',
  './modules/pdf/detourage.js',
  './modules/pdf/coffre.js',
  './modules/pdf/signature.js',
  './modules/pdf/tampons.js',
  './modules/pdf/outils.js',
  './modules/pdf/formulaire.js',
  './modules/pdf/formulaire-export.js',
  './modules/pdf/gabarit.js',
  './modules/pdf/molette.js',
  './modules/pdf/visionneuse.js',
  `${CDN}/mammoth/1.6.0/mammoth.browser.min.js`,
  `${CDN}/turndown/7.1.2/turndown.min.js`,
  `${CDN}/pdf.js/3.11.174/pdf.min.js`,
  `${CDN}/pdf.js/3.11.174/pdf.worker.min.js`,
  `${SHEETJS}/dist/xlsx.full.min.js`,
  `${CDN}/PapaParse/5.4.1/papaparse.min.js`,
  `${CDN}/jszip/3.10.1/jszip.min.js`,
];
// pdf-lib : précachée car « Enregistrer » est l'action centrale du module PDF (hors ligne dès la 1re
// visite), mais à part : jsDelivr bloqué (proxy) ne doit pas faire échouer tout le précache
const PRECACHE_OPTIONNEL = ['https://cdn.jsdelivr.net/npm/@cantoo/pdf-lib@2.11.1/dist/pdf-lib.min.js'];

const LOCAUX = new Set(PRECACHE.filter(u => /^\.\/.+\.(js|css|woff2)$/.test(u)).map(u => new URL(u, self.location).href));

// OCR (et pdf-lib, déjà précachée : filet de sécurité) : mis en cache à la volée (voir le gestionnaire
// fetch) au premier usage, pas au préchargement
const NPM = 'https://cdn.jsdelivr.net/npm';
const OCR_PREFIXES = [`${NPM}/tesseract.js@`, `${NPM}/tesseract.js-core@`, `${NPM}/@tesseract.js-data/`, `${NPM}/@cantoo/pdf-lib@`];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // mode:'cors' pour les URLs CDN : cdnjs envoie Access-Control-Allow-Origin:*,
    // donc addAll valide les statuts (échoue proprement sur 404) et la réponse
    // n'est pas opaque — les <script crossorigin> et importScripts la réutilisent.
    await cache.addAll(PRECACHE.map(u =>
      new Request(u, { mode: u.startsWith('http') ? 'cors' : 'same-origin' })
    ));
    await Promise.all(PRECACHE_OPTIONNEL.map(u => cache.add(new Request(u, { mode: 'cors' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const noms = await caches.keys();
    // L'ancien outil (convert-to-markdown) partage l'origine github.io : ne jamais
    // toucher à ses caches, seulement aux anciennes versions des nôtres.
    await Promise.all(noms.filter(n => n.startsWith(PREFIXE) && n !== VERSION).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

// Réseau d'abord, revalidé auprès du serveur : un fetch ordinaire passe par le cache HTTP
// du navigateur (GitHub Pages : max-age=600), et une mise à jour restait invisible jusqu'à
// 10 minutes après le déploiement malgré le rechargement.
const frais = req => fetch(req, { cache: 'no-cache' });

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // Navigations : réseau d'abord (index.html à jour), repli cache hors-ligne.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const reseau = await frais(req);
        // Seule la vraie page est conservée : une 404 ou une autre page visitée
        // remplacerait sinon l'application hors-ligne.
        if (reseau.ok && /\/(index\.html)?$/.test(new URL(req.url).pathname)) {
          (await caches.open(VERSION)).put('./index.html', reseau.clone());
        }
        return reseau;
      } catch {
        return (await caches.match('./index.html')) || Response.error();
      }
    })());
    return;
  }

  // Fichiers locaux de l'application (scripts, styles) : réseau d'abord comme les
  // pages, sinon une modification resterait invisible jusqu'au prochain changement
  // de VERSION ; repli sur le cache hors-ligne.
  if (LOCAUX.has(req.url)) {
    event.respondWith((async () => {
      try {
        const reseau = await frais(req);
        if (reseau.ok) (await caches.open(VERSION)).put(req, reseau.clone());
        return reseau;
      } catch {
        return (await caches.match(req)) || Response.error();
      }
    })());
    return;
  }

  // Tout le reste (libs épinglées, icône, manifeste) : cache d'abord, repli réseau.
  event.respondWith((async () => {
    const enCache = await caches.match(req);
    if (enCache) return enCache;
    const reponse = await fetch(req);
    // Fichiers de l'OCR (~5 Mo) et pdf-lib (versions épinglées) : téléchargés au premier
    // usage seulement, puis conservés pour un usage hors-ligne.
    if (OCR_PREFIXES.some(p => req.url.startsWith(p)) && (reponse.ok || reponse.type === 'opaque')) {
      const cache = await caches.open(VERSION);
      await cache.put(req, reponse.clone());
    }
    return reponse;
  })());
});
