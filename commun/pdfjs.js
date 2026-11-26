// Commun aux modules : chargement vérifié (SRI) de scripts hors balise <script>, et
// ouverture de PDF avec PDF.js (global pdfjsLib, chargé par index.html). Publie
// MPDS.scriptVerifie et MPDS.pdfjs. Script classique (file://), chargé après coeur.js.
(() => {
  'use strict';
  const URL_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  // Une ligne par fichier : format lu par tests/verifier-cdn.js (CI) et tests/serveur.js.
  const INTEGRITE = {
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js': 'sha384-SnzOobpRMLXZ52iJvZm/C0fYw0OQemTXzTjIsdsfMcrCtCEe9qgzxTd3RSklO5x2',
  };

  // Télécharge un script en vérifiant son empreinte (table `integrites`) et renvoie une
  // URL blob: à exécuter (importScripts, Worker). Un fichier modifié sur le CDN, ou sans
  // empreinte connue, est refusé : rien ne s'exécute sans vérification.
  // Fonction AUTONOME : le convertisseur l'injecte telle quelle (toString) dans son worker.
  async function scriptVerifie(url, integrites) {
    const integrity = integrites[url];
    if (!integrity) throw new Error('aucune empreinte connue pour ' + url);
    const rep = await fetch(url, { integrity, mode: 'cors', credentials: 'omit' });
    if (!rep.ok) throw new Error(`${url} : erreur HTTP ${rep.status}`);
    return URL.createObjectURL(new Blob([await rep.blob()], { type: 'text/javascript' }));
  }

  // Worker de PDF.js : téléchargé avec vérification d'empreinte puis lancé depuis une
  // URL blob: (PDF.js l'aurait sinon chargé lui-même, sans vérification)
  let workerPret = null;
  function preparer() {
    if (!workerPret) {
      workerPret = scriptVerifie(URL_WORKER, INTEGRITE)
        .then(url => { pdfjsLib.GlobalWorkerOptions.workerSrc = url; })
        .catch(err => { workerPret = null; throw new Error(`composant PDF.js inaccessible ou altéré (${err.message})`); });
    }
    return workerPret;
  }

  // Renvoie la tâche de chargement (loadingTask). isEvalSupported : false — PDF.js sait
  // se passer d'eval, interdit par la CSP.
  async function ouvrir(ab) {
    await preparer();
    return pdfjsLib.getDocument({ data: new Uint8Array(ab), isEvalSupported: false });
  }

  MPDS.scriptVerifie = scriptVerifie;
  MPDS.pdfjs = { INTEGRITE, ouvrir };
})();
