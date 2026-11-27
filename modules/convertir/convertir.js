'use strict';
// Module Convertir : documents → Markdown, 100 % local. Dépend de commun/coeur.js
// (MPDS) et de partage.js (codePartage), chargés avant ce fichier.

// =====================================================================
// SECTION 1 : CONFIG
// =====================================================================
// Empreintes (SRI) des scripts chargés hors balise <script> : worker PDF.js (table
// commune, commun/pdfjs.js), bibliothèques du worker de conversion, moteur OCR. Rien ne
// s'exécute sans correspondre à son empreinte (voir scriptVerifie). Une ligne par
// fichier : format lu par tests/verifier-cdn.js (CI) et tests/serveur.js.
const INTEGRITE = {
  ...MPDS.pdfjs.INTEGRITE,
  'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js': 'sha384-EnyY0/GSHQGSxSgMwaIPzSESbqoOLSexfnSMN2AP+39Ckmn92stwABZynq1JyzdT',
  'https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/papaparse.min.js': 'sha384-D/t0ZMqQW31H3az8ktEiNb39wyKnS82iFY52QPACM+IjKW3jDUhyIgh2PApRqJZs',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js': 'sha384-+mbV2IY1Zk/X1p/nWllGySJSUN8uMs+gUAN10Or95UBH0fpj6GfKgPmgC5EXieXG',
  'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js': 'sha384-2BQ3U3OdKOb0Uczxqr41I9UvZkzr4V9Hv8uSzMMZAlmhsFClvdZX5wi5fDCzG+tM',
  'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/worker.min.js': 'sha384-iUyp1FxLBc4DYaSwxT1/G6elMdSh3vvQffNSmMiySoXDpk2XfS9ZcM4RjPSiqiw3',
  'https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0/tesseract-core-simd-lstm.wasm.js': 'sha384-1PHRxr8cs/w6IDh6HZYHEHS+Li9cfjahWYKnioD1xvjs7wZD20qpwhD2+ZvhDmHU',
  'https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0/tesseract-core-lstm.wasm.js': 'sha384-ljppwjVnA7rpAU/v9enQiR6pXDStaEAYw9I+7ddiEynJcmDNnjHCmcvizBeO3cSA',
};
const SEUIL_ALERTE_TAILLE = 50 * 1024 * 1024; // 50 Mo
const SEUIL_PDF_SCAN = 20;                     // moins de 20 caractères avec une image = scan probable
const PDF_VIDE = 'Ce PDF ne contient ni texte extractible ni image : pages vides, ou texte converti en tracés (illisible ici).';
// Page couverte par une image (≥ 90 %) : scan même avec un peu de texte par-dessus (tampon, mention)
const SEUIL_SCAN_COUVERT = 200, COUVERTURE_SCAN = 0.9;
const CONVERSIONS_MAX_PARALLELES = 4;          // fichiers convertis simultanément

// Messages pour les formats refusés
const FORMATS_REFUSES = {
  '.doc': 'Format Word ancien (.doc) non pris en charge. Ouvrez dans Word et enregistrez en .docx, puis recommencez.',
  '.ppt': 'Format PowerPoint ancien (.ppt) non pris en charge. Ouvrez dans PowerPoint et enregistrez en .pptx, puis recommencez.',
  '.rtf': 'Format RTF non pris en charge. Ouvrez dans Word et enregistrez en .docx, puis recommencez.',
};

// Registre des convertisseurs (construit après chargement des bibliothèques)
let CONVERTISSEURS = {};

// Résultats en mémoire [{ nom, nomMd, md, images }]
let resultats = [];

// =====================================================================
// SECTION 2 : UTILITAIRES (fil principal uniquement)
// Les helpers purs partagés avec le worker (extOf, baseName, ecapperCellule,
// construireTableMd, detecterEtDecoder, desescaperXml) sont dans #code-partage.
// =====================================================================
function lireCommeArrayBuffer(fichier) {
  // API moderne, sans passer par les événements FileReader
  if (typeof fichier.arrayBuffer === 'function') {
    return fichier.arrayBuffer().catch(() => { throw new Error('Impossible de lire le fichier.'); });
  }
  // Repli pour les navigateurs anciens
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e => resolve(e.target.result);
    reader.onerror = () => reject(new Error('Impossible de lire le fichier.'));
    reader.readAsArrayBuffer(fichier);
  });
}

// Noms de sortie uniques pour la session, réservés au dépôt du fichier : deux
// « rapport.* » donnent rapport.md et rapport_2.md, chacun avec son propre dossier
// d'images. Comparaison sans casse (Windows et macOS ne distinguent pas Rapport
// de rapport à l'extraction du ZIP). Réinitialisés par « Vider ».
const nomsSortie     = new Set();
const dossiersImages = new Set();

function reserverUnique(ensemble, base) {
  let candidat = base, n = 2;
  while (ensemble.has(candidat.toLowerCase())) candidat = `${base}_${n++}`;
  ensemble.add(candidat.toLowerCase());
  return candidat;
}

function reserverSortie(nom) {
  const base = reserverUnique(nomsSortie, baseName(nom));
  // Dossier d'images sans espaces ni caractères qui casseraient un lien Markdown
  const slug = base.replace(/[\s()[\]<>#%?"'`\\]+/g, '-').replace(/^-+|-+$/g, '') || 'document';
  const dossier = reserverUnique(dossiersImages, slug);
  return { base, dossier, nomMd: base + '.md', dossierImages: 'images/' + dossier };
}

function libererSortie(sortie) {
  nomsSortie.delete(sortie.base.toLowerCase());
  dossiersImages.delete(sortie.dossier.toLowerCase());
}

// contenu : texte (Markdown) ou Blob déjà construit (archive ZIP)
function telechargerBlob(contenu, nom) {
  const blob = contenu instanceof Blob ? contenu : new Blob([contenu], { type: 'text/markdown;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: nom });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 30000); // 30s : suffisant même pour fichiers lourds
}

// =====================================================================
// SECTION 3 : CONVERTISSEURS (fil principal)
// convTableur / convCsv / convPptx (purs) sont dans #code-partage ; ils
// tournent dans le worker et servent aussi de repli ici via CONVERTISSEURS.
// =====================================================================

// Instance TurndownService partagée (les règles sont statiques, l'instance est
// réutilisable : inutile de la reconstruire à chaque fichier)
let turndownPartage = null;
function creerTurndown() {
  if (turndownPartage) return turndownPartage;
  // emDelimiter '*' : même italique que pour les autres formats (et « _ » colle mal dans un mot)
  const td = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced', emDelimiter: '*' });

  // Tableaux : reconstruits depuis le DOM (voir grilleTableau). Le contenu déjà
  // converti des lignes et cellules est ignoré, d'où une sortie vide pour elles.
  // Titre sur plusieurs lignes (<br>, fréquent dans les EPUB et titres Word) : un
  // titre Markdown tient sur une ligne, sinon la suite devient un simple paragraphe
  td.addRule('titre', {
    filter: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
    replacement: (contenu, n) => {
      const t = contenu.replace(/\s+/g, ' ').trim();
      return t ? `\n\n${'#'.repeat(Number(n.nodeName[1]))} ${t}\n\n` : '';
    },
  });

  td.addRule('tableInterne', { filter: ['thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption'], replacement: () => '' });
  td.addRule('table', {
    filter: 'table',
    replacement: (_, table) => {
      const grille = grilleTableau(table, cellule => texteCelluleHtml(td, cellule));
      if (!grille.length) return '';
      const legende = table.caption && table.caption.textContent.trim();
      return '\n\n' + (legende ? `**${td.escape(legende)}**\n\n` : '') + construireTableMd(grille) + '\n\n';
    },
  });

  turndownPartage = td;
  return td;
}

// Contenu Markdown d'une cellule, sur une ligne. Raccourci pour le cas courant
// (texte seul, éventuellement dans des <p>) : éviter un appel complet à Turndown
// par cellule, coûteux sur les grands tableaux.
function texteCelluleHtml(td, cellule) {
  const brut = cellule.querySelector(':scope *:not(p)') === null;
  const md = brut
    ? [...cellule.querySelectorAll(':scope > p')].map(p => p.textContent).join(' ') || cellule.textContent
    : td.turndown(cellule.innerHTML);
  return (brut ? td.escape(md) : md).replace(/\s*\n+\s*/g, ' ').trim();
}

// Grille réelle d'un tableau HTML : une cellule fusionnée (colspan / rowspan)
// occupe toutes ses places, sa valeur dans la première et des cases vides
// ailleurs. Sans cela, une première ligne fusionnée (« Budget 2026 » sur deux
// colonnes) déclarait un tableau d'une colonne, et le Markdown ignorait
// silencieusement les colonnes suivantes à l'affichage.
function grilleTableau(table, texte) {
  const grille = [];
  [...table.rows].forEach((tr, r) => {
    grille[r] = grille[r] || [];
    let c = 0;
    for (const cellule of tr.cells) {
      while (grille[r][c] !== undefined) c++;   // places prises par un rowspan au-dessus
      const largeur = Math.min(Math.max(cellule.colSpan || 1, 1), 100);
      const hauteur = Math.min(Math.max(cellule.rowSpan || 1, 1), 1000);
      const valeur  = texte(cellule);
      for (let dr = 0; dr < hauteur; dr++) {
        const ligne = grille[r + dr] = grille[r + dr] || [];
        for (let dc = 0; dc < largeur; dc++) ligne[c + dc] = dr === 0 && dc === 0 ? valeur : '';
      }
      c += largeur;
    }
  });
  // Un rowspan qui déborde du tableau ne doit pas créer de lignes fantômes
  grille.length = Math.min(grille.length, table.rows.length);
  return grille.map(l => Array.from({ length: l.length }, (_, i) => l[i] ?? ''));
}

// Retire les cibles exécutables (voir lienDangereux) : un lien garde son texte,
// une image son texte alternatif.
function neutraliserLiens(doc) {
  for (const el of doc.querySelectorAll('[href], [src]')) {
    for (const attr of ['href', 'src']) if (lienDangereux(el.getAttribute(attr))) el.removeAttribute(attr);
  }
}

// .docx → Markdown (mammoth + Turndown). Les images sont extraites en fichiers
// (ctx.dossierImages) au lieu d'être recopiées en base64 dans le Markdown, ce
// qui le rendait illisible et pouvait le faire peser plusieurs Mo.
async function convDocx(ab, nom, ctx) {
  const images = [];
  const res = await mammoth.convertToHtml({ arrayBuffer: ab }, {
    convertImage: mammoth.images.imgElement(image => {
      // Place réservée dès l'appel : la numérotation suit l'ordre du document
      const entree = { chemin: `${ctx.dossierImages}/image${images.length + 1}.${extensionImage(image.contentType)}`,
                       type: image.contentType, data: null };
      images.push(entree);
      return image.readAsArrayBuffer().then(data => { entree.data = data; return { src: entree.chemin }; });
    }),
  });
  return { md: notesWordEnMarkdown(res.value, creerTurndown()), images };
}

// Notes de bas de page et de fin : mammoth produit des liens internes ([1] vers
// #footnote-…, ↑ en retour) qui ne mènent nulle part en Markdown. On en fait des
// notes Markdown natives ([^1] … [^1]: texte), comme pour les fichiers .odt.
function notesWordEnMarkdown(html, td) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  neutraliserLiens(doc);
  const numeros = new Map();   // id de la note → numéro d'affichage
  for (const a of doc.querySelectorAll('a[href^="#footnote-"], a[href^="#endnote-"]')) {
    const id = a.getAttribute('href').slice(1);
    if (/-ref-/.test(id)) continue;   // lien de retour ↑, traité avec la note
    if (!numeros.has(id)) numeros.set(id, numeros.size + 1);
    // Marqueur hors de portée de l'échappement de Turndown, remplacé ensuite
    (a.closest('sup') || a).replaceWith(`\uE000${numeros.get(id)}\uE001`);
  }
  const notes = [];
  for (const [id, n] of numeros) {
    const li = doc.getElementById(id);
    if (!li) continue;
    li.querySelectorAll('a[href*="-ref-"]').forEach(a => a.remove());
    notes.push(`[^${n}]: ${td.turndown(li.innerHTML).replace(/\s*\n+\s*/g, ' ').trim()}`);
    const liste = li.parentElement;
    li.remove();
    if (liste && liste.tagName === 'OL' && !liste.children.length) liste.remove();
  }
  const md = td.turndown(doc.body.innerHTML).replace(/\uE000(\d+)\uE001/g, '[^$1]');
  return notes.length ? md + '\n\n' + notes.join('\n') : md;
}

// ---- PDF : reconstruction de la structure ----
// PDF.js ne fournit que des fragments de texte positionnés. On reconstruit les
// lignes, puis les paragraphes, titres et listes à partir de la géométrie.

// Taille arrondie au demi-point, pour regrouper les tailles quasi identiques
const taillePdf = t => Math.round(t * 2) / 2;

// Fragments → lignes { texte, y, x, fin, taille }, de haut en bas
function lignesPdf(items) {
  const frags = items
    .filter(it => it.str && it.str.trim())
    .map(it => {
      const taille = Math.hypot(it.transform[2], it.transform[3]) || it.height || 0;
      return { t: it.str, x: it.transform[4], y: it.transform[5], fin: it.transform[4] + (it.width || 0), taille };
    })
    .sort((a, b) => b.y - a.y || a.x - b.x);

  // Même ligne si l'écart vertical est faible devant la taille de police
  // (garde les exposants comme « 1er » sur leur ligne)
  const groupes = [];
  for (const f of frags) {
    const g = groupes[groupes.length - 1];
    if (g && Math.abs(g.y - f.y) <= Math.max(2, 0.4 * Math.max(g.taille, f.taille))) {
      g.frags.push(f);
      if (f.taille > g.taille) { g.taille = f.taille; g.y = f.y; }
    } else {
      groupes.push({ y: f.y, taille: f.taille, frags: [f] });
    }
  }

  return groupes.map(g => {
    g.frags.sort((a, b) => a.x - b.x);
    // Espace seulement si un vrai blanc sépare deux fragments : un mot découpé
    // en plusieurs fragments n'est plus coupé en deux.
    let texte = '';
    let finPrec = null;
    for (const f of g.frags) {
      if (finPrec !== null && f.x - finPrec > 0.15 * f.taille && !/\s$/.test(texte) && !/^\s/.test(f.t)) texte += ' ';
      texte += f.t;
      finPrec = f.fin;
    }
    return { texte: texte.replace(/\s+/g, ' ').trim(), y: g.y, x: g.frags[0].x,
             fin: g.frags[g.frags.length - 1].fin, taille: g.taille };
  }).filter(l => l.texte);
}

// Retire les en-têtes et pieds de page répétés (dont les numéros de page) :
// lignes situées dans les 10 % du haut ou du bas, identiques chiffres mis à
// part, présentes sur au moins 60 % des pages (et 3 pages minimum).
function retirerEntetesPieds(pages) {
  if (pages.length < 3) return;
  const enMarge = (l, p) => l.y > p.haut - 0.1 * p.hauteur || l.y < p.bas + 0.1 * p.hauteur;
  const cle = l => l.texte.replace(/\d+/g, '#');
  const compte = new Map();
  for (const p of pages) {
    for (const k of new Set(p.lignes.filter(l => enMarge(l, p)).map(cle))) compte.set(k, (compte.get(k) || 0) + 1);
  }
  const seuil = Math.max(3, Math.ceil(pages.length * 0.6));
  for (const p of pages) p.lignes = p.lignes.filter(l => !(enMarge(l, p) && compte.get(cle(l)) >= seuil));
}

// Taille du corps de texte : celle qui porte le plus de caractères
function tailleCorps(pages) {
  const poids = new Map();
  for (const p of pages) for (const l of p.lignes) poids.set(taillePdf(l.taille), (poids.get(taillePdf(l.taille)) || 0) + l.texte.length);
  const plusLourde = [...poids].sort((a, b) => b[1] - a[1])[0];
  return plusLourde ? plusLourde[0] : 12;
}

const estTitrePdf = (l, corps) => l.taille >= corps * 1.15 && l.texte.length <= 120 && /\p{L}/u.test(l.texte);

// Niveau Markdown de chaque taille de titre : la plus grande → ##, puis ###, puis ####
function niveauxTitres(pages, corps) {
  const tailles = new Set();
  for (const p of pages) for (const l of p.lignes) if (estTitrePdf(l, corps)) tailles.add(taillePdf(l.taille));
  return new Map([...tailles].sort((a, b) => b - a).map((t, i) => [t, Math.min(2 + i, 4)]));
}

const PUCE_PDF   = /^(?:[•◦▪▫●○■□➢➤►]\s*|[-–*]\s+)/;   //  : puce Symbol/Wingdings
const NUMERO_PDF = /^\d{1,3}[.)]\s/;                              // 1. ou 2)
const LETTRE_PDF = /^[a-z][)]\s/i;                                // a) : nouveau paragraphe

// Fin de ligne avec césure (« trans- / port ») : on garde le trait d'union et on
// colle, ce qui reste juste pour les mots composés (porte-monnaie).
const joindrePdf = (a, b) => /\p{L}-$/u.test(a) && /^\p{Ll}/u.test(b) ? a + b : a + ' ' + b;

// Lignes d'une page → blocs Markdown (titres, paragraphes, listes)
// Interligne habituel du document, sur toutes les pages (une page de deux lignes
// n'en dit rien à elle seule). Premier quartile des écarts entre lignes
// consécutives, et non la médiane : dans un document court, les blancs entre
// paragraphes peuvent être aussi nombreux que les interlignes ordinaires.
function interligneDocument(pages, corps) {
  const ecarts = [];
  for (const p of pages) {
    for (let i = 1; i < p.lignes.length; i++) {
      const e = p.lignes[i - 1].y - p.lignes[i].y;
      if (e > corps * 0.5) ecarts.push(e);
    }
  }
  ecarts.sort((a, b) => a - b);
  return ecarts.length ? ecarts[Math.floor(ecarts.length / 4)] : corps * 1.2;
}

function blocsPage(p, corps, niveaux, interligne) {
  const lignes = p.lignes;
  // Bord droit du texte : une ligne qui s'arrête nettement avant est un retour
  // à la ligne voulu (adresse, signature), conservé tel quel.
  const bordDroit = lignes.reduce((m, l) => Math.max(m, l.fin), 0);
  const bordGauche = lignes.reduce((m, l) => Math.min(m, l.x), Infinity);
  const ligneCourte = l => l.fin < bordDroit - 0.3 * (bordDroit - bordGauche);

  const blocs = [];
  let bloc = null;   // { type: 'titre'|'para'|'liste', texte|items, derniere, niveau, xItem }
  const fermer = () => {
    if (!bloc) return;
    if (bloc.type === 'titre') blocs.push('#'.repeat(bloc.niveau) + ' ' + bloc.texte);
    else if (bloc.type === 'liste') blocs.push(bloc.items.join('\n'));
    else blocs.push(bloc.texte);
    bloc = null;
  };

  for (const l of lignes) {
    const prec   = bloc && bloc.derniere;
    const ecart  = prec ? prec.y - l.y : 0;
    // Rupture : grand blanc, changement de taille, retour vers le haut (nouvelle
    // colonne) ou changement de bloc détecté par l'OCR
    const rupture = !prec || ecart > interligne * 1.5 || Math.abs(l.taille - prec.taille) > corps * 0.15 ||
      ecart < -corps * 0.5 || l.bloc !== prec.bloc;
    const niveau = estTitrePdf(l, corps) && niveaux.get(taillePdf(l.taille));

    if (niveau) {
      // Titre sur plusieurs lignes : même niveau, lignes rapprochées
      if (bloc && bloc.type === 'titre' && bloc.niveau === niveau && ecart <= l.taille * 1.6) {
        bloc.texte += ' ' + l.texte;
      } else {
        fermer();
        bloc = { type: 'titre', niveau, texte: l.texte };
      }
    } else if (PUCE_PDF.test(l.texte) || NUMERO_PDF.test(l.texte)) {
      const puce  = l.texte.match(PUCE_PDF);
      const item  = puce ? '- ' + l.texte.slice(puce[0].length) : l.texte;
      const genre = puce ? 'puces' : 'numeros';
      // Changement de type de liste : nouveau bloc, sinon Markdown rattacherait
      // « 2. … » à l'élément à puce précédent
      if (bloc && bloc.type === 'liste' && bloc.genre === genre && ecart <= interligne * 2.5) bloc.items.push(item);
      else { fermer(); bloc = { type: 'liste', genre, items: [item] }; }
      bloc.xItem = l.x;
    } else if (bloc && bloc.type === 'liste' && !rupture && l.x > bloc.xItem + 2) {
      // Suite d'un élément de liste (ligne en retrait)
      const i = bloc.items.length - 1;
      bloc.items[i] = joindrePdf(bloc.items[i], l.texte);
    } else if (bloc && bloc.type === 'para' && !rupture && !LETTRE_PDF.test(l.texte)) {
      bloc.texte = ligneCourte(prec) && !/-$/.test(bloc.texte) ? bloc.texte + '\n' + l.texte : joindrePdf(bloc.texte, l.texte);
    } else {
      fermer();
      bloc = { type: 'para', texte: l.texte };
    }
    bloc.derniere = l;
  }
  fermer();
  return blocs;
}

// Pages ({ lignes, haut, bas, hauteur }) → blocs Markdown : en-têtes et pieds
// répétés retirés, titres déduits des tailles, repères de page discrets (hors
// plan du document) pour pouvoir citer une page. Partagé par les PDF texte et l'OCR.
function blocsPages(pages) {
  retirerEntetesPieds(pages);
  const corps   = tailleCorps(pages);
  const niveaux = niveauxTitres(pages, corps);
  const interligne = interligneDocument(pages, corps);
  const blocs = [];
  pages.forEach((p, i) => {
    if (pages.length > 1) blocs.push(i === 0 ? '*Page 1*' : `---\n\n*Page ${i + 1}*`);
    blocs.push(...blocsPage(p, corps, niveaux, interligne));
  });
  return blocs;
}

// Chargement vérifié (SRI) d'un script : fonction commune (commun/pdfjs.js)
const scriptVerifie = url => MPDS.scriptVerifie(url, INTEGRITE);

// PDF.js : worker vérifié (SRI) et ouverture, communs (commun/pdfjs.js)
const ouvrirPdf = ab => MPDS.pdfjs.ouvrir(ab);

// Opérations PDF.js qui dessinent une image
const OPS_IMAGE = ['paintImageXObject', 'paintInlineImageXObject', 'paintImageMaskXObject', 'paintJpegXObject',
                   'paintImageXObjectRepeat', 'paintInlineImageXObjectGroup'];

// Aire couverte par les images (en points²) : une image est dessinée dans le carré unité, son aire
// est donc |déterminant| de la matrice courante (produit des déterminants : l'ordre n'importe pas).
// shortcut: aire approchée (chevauchements additionnés, image répétée comptée une fois), suffit pour un scan pleine page
function aireImages({ fnArray, argsArray }, images) {
  const O = pdfjsLib.OPS, det = m => m ? m[0] * m[3] - m[1] * m[2] : 1;
  const pile = [];
  let d = 1, aire = 0;
  fnArray.forEach((f, i) => {
    if (f === O.save) pile.push(d);
    else if (f === O.restore) d = pile.length ? pile.pop() : 1;
    else if (f === O.transform) d *= det(argsArray[i]);
    else if (f === O.paintFormXObjectBegin) { pile.push(d); d *= det(argsArray[i][0]); }
    else if (f === O.paintFormXObjectEnd) d = pile.length ? pile.pop() : 1;
    else if (images.has(f)) aire += Math.abs(d);
  });
  return aire;
}

// Page PDF → { gauche, bas, haut, hauteur, lignes, scannee } dans le repère du PDF.
// Scannée : presque pas de texte mais une image (une page blanche n'en a pas), ou une image sur
// toute la page avec peu de texte (tampon ou mention posés sur un scan).
async function lirePagePdf(page) {
  const [x0, y0, x1, y1] = page.view;   // boîte de la page : [x0, y0, x1, y1]
  const p = { gauche: x0, bas: Math.min(y0, y1), haut: Math.max(y0, y1), hauteur: Math.abs(y1 - y0),
              lignes: lignesPdf((await page.getTextContent()).items) };
  const car = p.lignes.reduce((n, l) => n + l.texte.length, 0);
  p.scannee = false;
  if (car < SEUIL_SCAN_COUVERT) {
    const images = new Set(OPS_IMAGE.map(n => pdfjsLib.OPS[n]).filter(v => v !== undefined));
    const ops = await page.getOperatorList();
    // Texte invisible (Tr 3 ou 7) : scan déjà « cherchable », sa couche OCR est gardée
    const invisible = ops.fnArray.some((f, i) => f === pdfjsLib.OPS.setTextRenderingMode && (ops.argsArray[i][0] & 3) === 3);
    p.scannee = car < SEUIL_PDF_SCAN ? ops.fnArray.some(f => images.has(f))
      : !invisible && aireImages(ops, images) >= COUVERTURE_SCAN * Math.abs((x1 - x0) * (y1 - y0));
  }
  return p;
}

const libellePages = numeros => (numeros.length > 1 ? 'Pages ' : 'Page ') + numeros.join(', ');

// .pdf → Markdown (PDF.js)
async function convPdf(ab, nom) {
  const loadingTask = await ouvrirPdf(ab);
  const pdf  = await loadingTask.promise;

  try {
    // Extraire toutes les pages en parallèle (le worker PDF.js pipeline les
    // requêtes) plutôt qu'en attendant chaque page l'une après l'autre.
    const pages = await Promise.all(Array.from({ length: pdf.numPages }, (_, i) => pdf.getPage(i + 1).then(lirePagePdf)));

    // Détecter un PDF scanné : presque pas de texte, et une image sur au moins une page. Sans image, un
    // PDF très court (« Vu le 12/03 ») est converti tel quel ; sans texte ni image, rien à reconnaître.
    const totalChars = pages.reduce((n, p) => n + p.lignes.reduce((m, l) => m + l.texte.length, 0), 0);
    if (totalChars < SEUIL_PDF_SCAN && pages.some(p => p.scannee)) {
      return `# ${baseName(nom)}\n\n> ⚠️ Ce PDF semble être un scan (image) : aucun texte n'a pu être extrait. Utilisez « Reconnaître le texte (OCR) » dans le journal de conversion.\n`;
    }
    if (!totalChars) return `# ${baseName(nom)}\n\n> ⚠️ ${PDF_VIDE}\n`;

    // Pages scannées au milieu d'un PDF texte (annexe signée, courrier numérisé)
    const scannees = pages.flatMap((p, i) => p.scannee ? [i + 1] : []);
    const note = scannees.length
      ? [`> ⚠️ ${libellePages(scannees)} : image presque sans texte (scan probable). Utilisez « Reconnaître le texte (OCR) » dans le journal de conversion.`]
      : [];
    return [`# ${baseName(nom)}`, ...note, ...blocsPages(pages)].join('\n\n') + '\n';
  } finally {
    // Libérer le document côté worker : sans cela, chaque PDF converti
    // reste en mémoire jusqu'à la fermeture de l'onglet.
    loadingTask.destroy();
  }
}

// ---- OCR des PDF scannés (Tesseract.js, à la demande) ----
// Reconnaissance faite sur l'appareil (WebAssembly) : le document ne sort pas.
// Environ 5 Mo téléchargés au premier usage seulement (moteur, données
// françaises), puis conservés par le navigateur et le service worker.
const OCR = {
  script:  'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js',
  worker:  'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/worker.min.js',
  coreSimd: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0/tesseract-core-simd-lstm.wasm.js',
  core:     'https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0/tesseract-core-lstm.wasm.js',
  // Données de langue : ce ne sont pas du code (pas d'empreinte), CSP oblige
  // elles ne peuvent venir que de ce CDN
  langues:  'https://cdn.jsdelivr.net/npm/@tesseract.js-data/fra@1.0.0/4.0.0_best_int',
};
// Moteur SIMD (plus rapide) si disponible : même test que wasm-feature-detect,
// utilisé par Tesseract pour ce choix quand il charge lui-même son moteur
const SIMD_WASM = (() => {
  try { return WebAssembly.validate(new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,10,1,8,0,65,0,253,15,253,98,11])); }
  catch { return false; }
})();
const OCR_LARGEUR_MAX = 3000;   // pixels : ~300 ppp pour un A4, mémoire maîtrisée

let tesseractPromise = null;
function chargerTesseract() {
  if (window.Tesseract) return Promise.resolve();
  if (!tesseractPromise) {
    tesseractPromise = new Promise((resolve, reject) => {
      const s = Object.assign(document.createElement('script'), { src: OCR.script, integrity: INTEGRITE[OCR.script], crossOrigin: 'anonymous' });
      s.onload  = () => window.Tesseract ? resolve() : reject(new Error('moteur de reconnaissance invalide'));
      s.onerror = () => {
        tesseractPromise = null;   // nouvel essai possible au prochain clic
        s.remove();
        reject(new Error('téléchargement du moteur impossible ou fichier altéré (connexion internet requise la première fois)'));
      };
      document.head.appendChild(s);
    });
  }
  return tesseractPromise;
}

// Lignes reconnues → même structure que les lignes d'un PDF texte
// ({ texte, y, x, fin, taille }) : l'OCR profite de la même reconstruction
// (paragraphes, titres, listes, en-têtes répétés) que les PDF, plus fiable que la
// segmentation en paragraphes de Tesseract. Ordre de lecture de Tesseract conservé
// (colonnes) ; ses blocs servent de séparations franches. Repère image (y vers le
// bas) → repère PDF (y vers le haut) : y = −ligne de base. Taille : hauteur de
// rangée (police), indépendante des jambages présents dans la ligne.
// Lignes sous OCR_CONFIANCE_MIN : texte lu dans une capture d'écran (charabia),
// retirées. Mesuré sur un guide de 42 pages : aucun paragraphe sous ce seuil, au
// plus 36 % du texte d'une page. Si les lignes douteuses portent plus de la moitié
// du texte, c'est un scan dégradé : tout est gardé. `retirees` : lignes ôtées.
const OCR_CONFIANCE_MIN = 50;
// Confiance moyenne d'un document sous laquelle son texte est probablement inexploitable (copie trop
// dégradée) : mesuré 94-95 % sur des scans lisibles, 16 % sur du charabia
const OCR_CONFIANCE_DOC = 60;
function lignesOcr(data) {
  const lignes = (data.blocks || []).flatMap((b, bloc) => (b.paragraphs || []).flatMap(p => p.lines || []).map(l => ({
    texte: l.text.replace(/\s+/g, ' ').trim(),
    x: l.bbox.x0,
    fin: l.bbox.x1,
    y: -(l.baseline ? (l.baseline.y0 + l.baseline.y1) / 2 : l.bbox.y1),
    taille: (l.rowAttributes && l.rowAttributes.rowHeight) || (l.bbox.y1 - l.bbox.y0),
    bloc,
    douteuse: l.confidence < OCR_CONFIANCE_MIN,
  }))).filter(l => l.texte);
  const car = ls => ls.reduce((n, l) => n + l.texte.length, 0);
  const gardees = car(lignes.filter(l => l.douteuse)) * 2 > car(lignes) ? lignes : lignes.filter(l => !l.douteuse);
  gardees.retirees = lignes.length - gardees.length;
  return gardees;
}

// Photos dont le texte s'obtient par OCR, comme un PDF scanné
const EXTENSIONS_IMAGE_OCR = new Set(['.png', '.jpg', '.jpeg', '.webp']);

// PDF : chaque page scannée rendue en image (PDF.js), les pages texte gardant
// leur texte ; photo : une seule page. Puis lecture par Tesseract.
async function ocrDocument(fichier, nom, progression) {
  progression('OCR : chargement du moteur de reconnaissance…');
  await chargerTesseract();
  const estImage = EXTENSIONS_IMAGE_OCR.has(extOf(nom));
  const loadingTask = estImage ? null : await ouvrirPdf(await lireCommeArrayBuffer(fichier));
  let worker = null;
  const blobs = [];
  try {
    const pdf = loadingTask && await loadingTask.promise;
    const nbPages = pdf ? pdf.numPages : 1;
    blobs.push(...await Promise.all([scriptVerifie(OCR.worker), scriptVerifie(SIMD_WASM ? OCR.coreSimd : OCR.core)]));
    worker = await Tesseract.createWorker('fra', 1, {
      workerPath: blobs[0],
      workerBlobURL: false,
      // « #.wasm.js » : Tesseract n'emploie tel quel qu'un chemin finissant par
      // « js » (sinon il le prend pour un dossier) ; le fragment est ignoré au chargement
      corePath: blobs[1] + '#.wasm.js',
      langPath: OCR.langues,
    });
    const pages = [], confiances = [], numerosOcr = [];
    let retirees = 0;
    const canvas = document.createElement('canvas');
    for (let i = 1; i <= nbPages; i++) {
      const page = pdf && await pdf.getPage(i);
      const p = page && await lirePagePdf(page);
      if (p && !p.scannee) { pages.push(p); page.cleanup(); continue; }
      progression(`OCR : page ${i} / ${nbPages}…`);
      // Photo : createImageBitmap applique l'orientation EXIF (photo de téléphone)
      const image = page ? null : await createImageBitmap(fichier).catch(() => { throw new Error('image illisible'); });
      const largeur = page ? page.getViewport({ scale: 1 }).width : image.width;
      const echelle = Math.min(page ? 300 / 72 : 1, OCR_LARGEUR_MAX / largeur);
      const vue = page && page.getViewport({ scale: echelle });
      canvas.width = Math.ceil(page ? vue.width : image.width * echelle);
      canvas.height = Math.ceil(page ? vue.height : image.height * echelle);
      const ctx2d = canvas.getContext('2d');
      ctx2d.fillStyle = '#fff';   // fond blanc : une image transparente serait lue sur du noir
      ctx2d.fillRect(0, 0, canvas.width, canvas.height);
      if (page) await page.render({ canvasContext: ctx2d, viewport: vue }).promise;
      else { ctx2d.drawImage(image, 0, 0, canvas.width, canvas.height); image.close(); }
      const { data } = await worker.recognize(canvas, {}, { blocks: true });
      const lignes = lignesOcr(data);
      retirees += lignes.retirees;
      if (p) {
        // Pixels → repère du PDF, celui des pages texte voisines (tailles et
        // positions comparables pour titres, paragraphes, en-têtes répétés).
        // shortcut: pages tournées (/Rotate) non redressées, à traiter si un cas réel se présente
        for (const l of lignes) {
          l.x = p.gauche + l.x / echelle; l.fin = p.gauche + l.fin / echelle;
          l.y = p.haut + l.y / echelle;   l.taille /= echelle;
        }
        pages.push({ ...p, lignes });
      } else {
        pages.push({ lignes, haut: 0, bas: -canvas.height, hauteur: canvas.height });
      }
      numerosOcr.push(i);
      confiances.push(data.confidence);
      if (page) page.cleanup();
    }
    canvas.width = canvas.height = 0;   // libérer la mémoire de l'image
    if (!confiances.length) throw new Error('aucune page scannée à reconnaître');

    const confiance = Math.round(confiances.reduce((s, c) => s + c, 0) / confiances.length);
    const portee = numerosOcr.length === nbPages ? 'Texte obtenu' : `${libellePages(numerosOcr)} : texte obtenu`;
    const blocs = [`# ${baseName(nom)}`,
      `> ${portee} par reconnaissance optique (OCR), confiance moyenne ${confiance} % : ` +
        (confiance < OCR_CONFIANCE_DOC ? '⚠️ texte probablement inexploitable (copie trop dégradée) ; renumérisez le document si possible (300 ppp, page à plat).'
          : 'à relire, des erreurs sont possibles.') +
        (retirees ? ` ${retirees} ligne${retirees > 1 ? 's' : ''} illisible${retirees > 1 ? 's' : ''} (captures d'écran) retirée${retirees > 1 ? 's' : ''}.` : '')];
    return { md: [...blocs, ...blocsPages(pages)].join('\n\n') + '\n', confiance };
  } finally {
    if (worker) await worker.terminate();
    blobs.forEach(u => URL.revokeObjectURL(u));
    if (loadingTask) loadingTask.destroy();
  }
}

// Icônes SVG (commun/icones.js) à la place des pictogrammes : bouton = icône + libellé ; pastille d'état du journal
// à partir du pictogramme que les appelants donnent (✅ ⚠️ ❌ ⏳).
const avecIcone = (bouton, icone, texte) => bouton.replaceChildren(MPDS.icones.creer(icone, 16), ' ' + texte);
const ICONES_STATUT = { '✅': 'ok', '⚠️': 'attention', '❌': 'erreur', '⏳': 'attente' };
const iconeStatut = (el, pictogramme) => el.replaceChildren(MPDS.icones.creer(ICONES_STATUT[pictogramme] || 'ok', 18));

// Un OCR à la fois : chaque moteur occupe plusieurs centaines de Mo de mémoire
let fileOcr = Promise.resolve();

function lancerOcr(li, resultat, bouton) {
  const msg   = li.querySelector('.journal-msg');
  const icone = li.querySelector('.journal-icone');
  bouton.disabled = true;
  li.className = 'journal-item en-cours';
  iconeStatut(icone, '⏳');
  msg.textContent = 'OCR : en attente…';
  fileOcr = fileOcr.then(async () => {
    try {
      const { md, confiance } = await ocrDocument(resultat.fichier, resultat.nom, t => { msg.textContent = t; });
      resultat.md = md;
      delete resultat.fichier;
      const faible = confiance < OCR_CONFIANCE_DOC;
      li.className = 'journal-item ' + (faible ? 'warn' : 'ok');
      iconeStatut(icone, faible ? '⚠️' : '✅');
      msg.textContent = faible
        ? `Texte reconnu par OCR → ${resultat.nomMd}, mais confiance très faible (${confiance} %) : copie probablement trop dégradée, renumérisez-la si possible.`
        : `Texte reconnu par OCR → ${resultat.nomMd} (à relire)`;
      bouton.remove();
    } catch (err) {
      li.className = 'journal-item warn';
      iconeStatut(icone, '⚠️');
      msg.textContent = `OCR impossible : ${err.message}`;
      bouton.disabled = false;
    }
  });
  return fileOcr;
}

// Photo : son texte ne s'obtient que par OCR, lancé à la demande depuis le
// journal (environ 5 Mo à télécharger la première fois)
const convImage = async (ab, nom) =>
  `# ${baseName(nom)}\n\n> ⚠️ Image : utilisez « Reconnaître le texte (OCR) » dans le journal de conversion.\n`;

// .txt → Markdown
async function convTxt(ab, nom) {
  const texte = detecterEtDecoder(ab);
  return `# ${baseName(nom)}\n\n${texte.trim()}\n`;
}

// .html / .htm → Markdown (Turndown)
async function convHtml(ab, nom, ctx) {
  const texte = detecterEtDecoder(ab);
  const doc   = new DOMParser().parseFromString(texte, 'text/html');
  // Retirer le code non visible : son contenu textuel polluerait le Markdown
  doc.querySelectorAll('script, style, noscript').forEach(el => el.remove());

  // Images intégrées (src="data:…") : extraites en fichiers, comme pour Word.
  // Les images désignées par une URL sont laissées telles quelles.
  const images = [];
  for (const img of doc.querySelectorAll('img[src^="data:"]')) {
    try {
      const rep  = await fetch(img.getAttribute('src'));
      const type = rep.headers.get('content-type') || '';
      const chemin = `${ctx.dossierImages}/image${images.length + 1}.${extensionImage(type)}`;
      images.push({ chemin, type, data: await rep.arrayBuffer() });
      img.setAttribute('src', chemin);
    } catch {
      img.remove();   // data: illisible → on l'omet plutôt que de recopier un bloc base64
    }
  }
  neutraliserLiens(doc);
  return { md: creerTurndown().turndown(doc.body.innerHTML), images };
}

// ---- Courriels .eml (format MIME : en-têtes, parties, pièces jointes) ----
// Le message est manipulé en chaîne « binaire » (1 caractère = 1 octet) : les
// parties 8 bits gardent leurs octets jusqu'au décodage dans leur propre jeu de caractères.
function enBinaire(octets) {
  let s = '';
  for (let i = 0; i < octets.length; i += 0x8000) s += String.fromCharCode.apply(null, octets.subarray(i, i + 0x8000));
  return s;
}
const enOctets = s => Uint8Array.from(s, c => c.charCodeAt(0) & 0xFF);
const octetsQp = s => s.replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));

function decoderTexte(octets, charset) {
  try { return new TextDecoder(charset || 'utf-8').decode(octets); }
  catch { return detecterEtDecoder(octets.buffer); }   // jeu de caractères inconnu
}

// Valeur d'en-tête : octets bruts (UTF-8 ou Windows-1252), puis mots encodés
// « =?charset?B|Q?…?= » ; deux mots encodés voisins se recollent sans espace.
function decoderEntete(v) {
  return detecterEtDecoder(enOctets(v || '').buffer)
    .replace(/\?=\s+=\?/g, '?==?')
    .replace(/=\?([^?]+)\?([BQ])\?([^?]*)\?=/gi, (m, charset, enc, t) => {
      try { return decoderTexte(enOctets(enc.toUpperCase() === 'B' ? atob(t) : octetsQp(t.replace(/_/g, ' '))), charset); }
      catch { return m; }
    });
}

// Paramètre d'un en-tête (boundary, charset, filename, name), forme RFC 2231
// « filename*=UTF-8''pi%C3%A8ce.pdf » comprise.
// shortcut: noms découpés en morceaux (filename*0*=, *1*=) non recollés, à ajouter si un vrai courriel en contient
function parametreMime(valeur, nom) {
  const v = valeur || '';
  const etendu = v.match(new RegExp(`;\\s*${nom}\\*=\\s*"?([^']*)'[^']*'([^;"\\s]+)`, 'i'));
  if (etendu) return decoderTexte(enOctets(octetsQp(etendu[2].replace(/%/g, '='))), etendu[1]);
  const m = v.match(new RegExp(`;\\s*${nom}=\\s*(?:"([^"]*)"|([^;\\s]+))`, 'i'));
  return m ? decoderEntete(m[1] ?? m[2]).trim() : '';
}

// En-têtes (noms en minuscules, lignes repliées recollées) et corps d'une partie
function analyserMime(brut) {
  const sep = brut.match(/^\r?\n|\r?\n\r?\n/);
  const tete = sep ? brut.slice(0, sep.index) : brut;
  const entetes = {};
  for (const ligne of tete.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const m = ligne.match(/^([\w-]+):\s*(.*)$/);
    if (m && !(m[1].toLowerCase() in entetes)) entetes[m[1].toLowerCase()] = m[2];
  }
  return { entetes, corps: sep ? brut.slice(sep.index + sep[0].length) : '' };
}

function decoderCorps(corps, encodage) {
  switch ((encodage || '').trim().toLowerCase()) {
    case 'base64': {
      const b = corps.replace(/[^A-Za-z0-9+/]/g, '');   // retours à la ligne, remplissage
      try { return enOctets(atob(b + '='.repeat((4 - b.length % 4) % 4))); }
      catch { return enOctets(corps); }
    }
    case 'quoted-printable': return enOctets(octetsQp(corps.replace(/=\r?\n/g, '')));
    default: return enOctets(corps);
  }
}

// Parties finales du message (les multipart sont parcourus), dans l'ordre
function partiesMime(brut, acc = [], profondeur = 0) {
  const { entetes, corps } = analyserMime(brut);
  const type = (entetes['content-type'] || 'text/plain').split(';')[0].trim().toLowerCase();
  const limite = parametreMime(entetes['content-type'], 'boundary');
  if (type.startsWith('multipart/') && limite && profondeur < 20) {
    for (const morceau of corps.split('--' + limite).slice(1)) {   // [0] : préambule
      if (morceau.startsWith('--')) break;                          // fin du multipart
      partiesMime(morceau.replace(/^\r?\n/, '').replace(/\r?\n$/, ''), acc, profondeur + 1);
    }
  } else {
    acc.push({ type, entetes, octets: decoderCorps(corps, entetes['content-transfer-encoding']) });
  }
  return acc;
}

// Fichiers extraits : « image », ou « fichier » s'il y a des pièces jointes (courriel)
const motFichiers = fichiers => fichiers.some(f => f.chemin.startsWith('pieces-jointes/')) ? 'fichier' : 'image';

// Chemin de fichier → cible de lien Markdown (espaces, accents, parenthèses encodés)
const lienFichier = chemin => encodeURI(chemin).replace(/[()]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());

// .eml → Markdown : en-têtes, corps (HTML de préférence, via convHtml), images
// intégrées (cid:) et pièces jointes extraites dans pieces-jointes/<document>/
async function convEml(ab, nom, ctx) {
  const brut = enBinaire(new Uint8Array(ab));
  const { entetes } = analyserMime(brut);
  if (!Object.keys(entetes).length) throw new Error('Courriel vide ou illisible.');

  const dossier = ctx.dossierImages.replace(/^images\//, 'pieces-jointes/');
  const fichiers = [], pris = new Set(), parCid = new Map();
  const unique = n => {
    let c = n, i = 2;
    while (pris.has(c.toLowerCase())) c = n.replace(/(\.[^.]*)?$/, `_${i++}$1`);
    pris.add(c.toLowerCase());
    return c;
  };
  let html = null, texte = null;
  for (const p of partiesMime(brut)) {
    const disposition = p.entetes['content-disposition'] || '';
    const nomFichier = parametreMime(disposition, 'filename') || parametreMime(p.entetes['content-type'], 'name');
    const charset = parametreMime(p.entetes['content-type'], 'charset');
    const estCorps = !/^\s*attachment/i.test(disposition) && !nomFichier;
    if (estCorps && p.type === 'text/html' && html === null) { html = decoderTexte(p.octets, charset); continue; }
    if (estCorps && p.type === 'text/plain' && texte === null) { texte = decoderTexte(p.octets, charset); continue; }
    if (!p.octets.length) continue;
    // Nom sûr : pas de dossier (« ../ » d'une pièce jointe piégée sortirait du
    // dossier à l'extraction du ZIP), ni caractère interdit sous Windows
    const sur = (nomFichier || `piece-jointe-${fichiers.length + 1}.${p.type === 'message/rfc822' ? 'eml' : extensionImage(p.type)}`)
      .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/^\.{1,2}$/, '_');
    const f = { chemin: `${dossier}/${unique(sur)}`, type: p.type, data: p.octets.buffer };
    fichiers.push(f);
    const cid = (p.entetes['content-id'] || '').trim().replace(/^<|>$/g, '');
    if (cid) parCid.set(cid, f);
  }

  let corps = '', imagesHtml = [];
  const cites = new Set();   // images intégrées affichées dans le corps
  if (html !== null) {
    html = html.replace(/(["'])cid:([^"']+)\1/gi, (m, q, id) => {
      const f = parCid.get(id);
      if (!f) return m;
      cites.add(f);
      return q + lienFichier(f.chemin) + q;
    });
    // Images distantes (pixels de suivi) : l'éditeur Markdown les chargerait à
    // l'ouverture de la note et préviendrait l'expéditeur. Texte alternatif gardé.
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('img[src]').forEach(img => {
      if (/^\s*(https?:)?\/\//i.test(img.getAttribute('src'))) img.replaceWith(img.getAttribute('alt') || '');
    });
    const r = await convHtml(new TextEncoder().encode(doc.documentElement.outerHTML).buffer, nom, ctx);
    corps = r.md.trim();
    imagesHtml = r.images;
  } else if (texte !== null) {
    corps = texte.trim();
  }

  const champ = (titre, cle) => entetes[cle] ? [`- **${titre} :** ${echapperMd(decoderEntete(entetes[cle]).trim())}`] : [];
  const objet = decoderEntete(entetes.subject || '').trim();
  const joints = fichiers.filter(f => !cites.has(f));
  const blocs = [`# ${echapperMd(objet || baseName(nom))}`,
    [...champ('De', 'from'), ...champ('À', 'to'), ...champ('Cc', 'cc'), ...champ('Date', 'date')].join('\n'),
    '---', corps || '_(courriel sans texte)_'];
  if (joints.length) {
    blocs.push('## Pièces jointes', joints.map(f => `- [${echapperMd(f.chemin.split('/').pop())}](${lienFichier(f.chemin)})`).join('\n'));
  }
  return { md: blocs.filter(Boolean).join('\n\n') + '\n', images: [...imagesHtml, ...fichiers] };
}

// ---- Livres numériques .epub (archive de pages XHTML) ----
const decoderUri = s => { try { return decodeURIComponent(s); } catch { return s; } };

// .epub → Markdown : chapitres dans l'ordre de lecture (spine du content.opf),
// titres décalés d'un niveau sous celui du livre, images extraites comme pour Word
async function convEpub(ab, nom, ctx) {
  const zip = await JSZip.loadAsync(ab);
  const container = zip.file('META-INF/container.xml');
  const cheminOpf = container && attributXml(((await container.async('text')).match(/<rootfile\b[^>]*>/) || [''])[0], 'full-path');
  const opf = cheminOpf && zip.file(cheminOpf);
  if (!opf) throw new Error('Fichier EPUB invalide (description du livre introuvable).');
  const racine = analyserXml(await opf.async('text'));
  const tous = n => [...tousXml(racine, n), ...tousXml(racine, 'opf:' + n)];   // préfixe opf: des EPUB 2
  const manifeste = new Map(tous('item').map(i => [i.attrs.id, resoudreChemin(cheminOpf, decoderUri(i.attrs.href || ''))]));
  const ordre = tous('itemref').map(r => manifeste.get(r.attrs.idref)).filter(c => c && zip.file(c));
  if (!ordre.length) throw new Error('Aucun chapitre trouvé dans ce fichier EPUB.');

  const td = creerTurndown(), images = [], imageParChemin = new Map(), chapitres = [];
  for (const chemin of ordre) {
    const doc = new DOMParser().parseFromString(await zip.file(chemin).async('text'), 'text/html');
    doc.querySelectorAll('script, style').forEach(e => e.remove());
    // Image dans un SVG (couverture) → <img>, seule forme que Turndown restitue
    for (const im of doc.querySelectorAll('svg image')) {
      const img = doc.createElement('img');
      img.setAttribute('src', im.getAttribute('xlink:href') || im.getAttribute('href') || '');
      im.closest('svg').replaceWith(img);
    }
    for (const img of doc.querySelectorAll('img[src]')) {
      const src = img.getAttribute('src');
      if (/^[a-z][a-z0-9+.-]*:/i.test(src)) continue;   // adresse externe : laissée telle quelle
      const cible = resoudreChemin(chemin, decoderUri(src.split('#')[0]));
      const f = zip.file(cible);
      if (!f) { img.remove(); continue; }
      if (!imageParChemin.has(cible)) {
        const ext = (cible.split('.').pop() || 'bin').toLowerCase();
        const c = `${ctx.dossierImages}/image${images.length + 1}.${ext}`;
        images.push({ chemin: c, type: TYPES_IMAGE[ext] || '', data: await f.async('arraybuffer') });
        imageParChemin.set(cible, c);
      }
      img.setAttribute('src', imageParChemin.get(cible));
    }
    // Liens vers un autre chapitre : sans cible dans le Markdown, on garde le texte
    for (const a of doc.querySelectorAll('a[href]')) {
      if (!/^[a-z][a-z0-9+.-]*:/i.test(a.getAttribute('href'))) a.removeAttribute('href');
    }
    neutraliserLiens(doc);
    const md = td.turndown(doc.body.innerHTML).trim().replace(/^(#{1,5}) /gm, '#$1 ');
    if (md) chapitres.push(md);
  }
  const titre = premierXml(racine, 'dc:title');
  return { md: [`# ${echapperMd((titre && texteXml(titre).trim()) || baseName(nom))}`, ...chapitres].join('\n\n') + '\n', images };
}

// =====================================================================
// SECTION 3bis : WEB WORKER (conversions lourdes hors du fil principal)
// Les gros tableurs / CSV / PPTX bloquaient l'interface pendant le parsing.
// On les délègue à un worker unique ; en cas d'échec d'initialisation, tout
// retombe silencieusement sur les convertisseurs du fil principal.
// =====================================================================

// Extensions routées vers le worker (les autres restent sur le fil principal :
// .docx/.html ont besoin du DOM, .pdf a déjà son propre worker PDF.js).
const EXTENSIONS_TRAVAILLEUR = new Set(['.xlsx', '.xls', '.ods', '.csv', '.tsv', '.pptx', '.odt', '.odp']);

// URLs des libs chargées DANS le worker. Surchargables pour les tests via
// self.__URLS_LIBS_TEST__ (page.route de Playwright n'intercepte pas les
// importScripts d'un worker blob).
const URLS_LIBS_TRAVAILLEUR = self.__URLS_LIBS_TEST__ || {
  xlsx:      'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js',
  papaparse: 'https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/papaparse.min.js',
  jszip:     'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
};

// Corps du worker : importe les libs vérifiées (chacune isolée → disponibilité partielle
// possible), puis répond aux requêtes {id, ext, nom, ab, ctx} par
// {id, ok, md, images} ou {id, ok: false, erreur}.
// La poignée de main {type:'pret', exts} annonce les extensions réellement gérées.
const BOOTSTRAP_TRAVAILLEUR = `
const CONVERTISSEURS_W = {};
const LIBS_W = [
  [URLS.xlsx,      () => { CONVERTISSEURS_W['.xlsx'] = CONVERTISSEURS_W['.xls'] = CONVERTISSEURS_W['.ods'] = convTableur; }],
  [URLS.papaparse, () => { CONVERTISSEURS_W['.csv']  = CONVERTISSEURS_W['.tsv'] = convCsv; }],
  [URLS.jszip,     () => { CONVERTISSEURS_W['.pptx'] = convPptx; CONVERTISSEURS_W['.odt'] = convOdt; CONVERTISSEURS_W['.odp'] = convOdp; }],
];
self.onmessage = async (e) => {
  const { id, ext, nom, ab, ctx } = e.data;
  try {
    const conv = CONVERTISSEURS_W[ext];
    if (!conv) throw new Error('Convertisseur indisponible dans le worker : ' + ext);
    const { md, images } = normaliserResultat(await conv(ab, nom, ctx));
    self.postMessage({ id, ok: true, md, images }, images.map(i => i.data)); // images transférées
  } catch (err) {
    self.postMessage({ id, ok: false, erreur: (err && err.message) || String(err) });
  }
};
// Téléchargements vérifiés (SRI) en parallèle, puis exécution dans l'ordre
(async () => {
  const blobs = await Promise.allSettled(LIBS_W.map(([url]) => scriptVerifie(url)));
  blobs.forEach((b, i) => {
    if (b.status !== 'fulfilled') return;
    try { importScripts(b.value); LIBS_W[i][1](); } catch (e) { /* bibliothèque indisponible */ }
    URL.revokeObjectURL(b.value);
  });
  self.postMessage({ type: 'pret', exts: Object.keys(CONVERTISSEURS_W) });
})();
`;

// Construit le blob du worker : URLs + langue de la page + empreintes + code partagé
// (codePartage(), réutilisé tel quel) + bootstrap.
function creerBlobTravailleur() {
  const partage = '(' + codePartage.toString() + ')();';   // partage.js : même code que le fil principal
  const src = 'const URLS = ' + JSON.stringify(URLS_LIBS_TRAVAILLEUR) + ';\n' +
    'const LANGUE_PAGE = ' + JSON.stringify(navigator.language || '') + ';\n' +
    'const INTEGRITE = ' + JSON.stringify(INTEGRITE) + ';\n' +
    'const scriptVerifie = url => (' + MPDS.scriptVerifie.toString() + ')(url, INTEGRITE);\n' +   // commun/pdfjs.js
    partage + '\n' + BOOTSTRAP_TRAVAILLEUR;
  return URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
}

let travailleur = null;
let travailleurPretPromise = null;
let travailleurMort = false;
let prochainIdReq = 1;
const requetesEnCours = new Map();                     // id → {resolve, reject}
const statsTravailleur = { converties: 0, replis: 0 }; // observable pour les tests

// Marque le worker mort et rejette les requêtes en attente (→ repli fil principal).
function arreterTravailleur() {
  travailleurMort = true;
  if (travailleur) { try { travailleur.terminate(); } catch { /* ignore */ } travailleur = null; }
  for (const req of requetesEnCours.values()) {
    const e = new Error('Worker interrompu'); e.__infra = true;
    req.reject(e);
  }
  requetesEnCours.clear();
}

// Crée le worker paresseusement et résout avec la liste des extensions gérées
// (ou null si l'initialisation échoue). Un seul worker persistant pour toute la session.
function initTravailleur() {
  if (travailleurMort) return Promise.resolve(null);
  if (travailleurPretPromise) return travailleurPretPromise;

  travailleurPretPromise = new Promise((resolve) => {
    let regle = false;
    const finir = v => { if (!regle) { regle = true; resolve(v); } };

    let blobUrl;
    try {
      blobUrl = creerBlobTravailleur();
      travailleur = new Worker(blobUrl);
    } catch (e) {
      console.warn('Worker : création impossible, repli sur le fil principal.', e.message || e);
      travailleurMort = true;
      finir(null);
      return;
    }

    // Poignée de main : si le worker ne se signale pas prêt à temps, on abandonne.
    const minuteur = setTimeout(() => {
      if (!regle) {
        console.warn('Worker : poignée de main expirée, repli sur le fil principal.');
        arreterTravailleur();
        finir(null);
      }
    }, 15000);

    travailleur.onmessage = (e) => {
      const d = e.data;
      if (d && d.type === 'pret') {
        clearTimeout(minuteur);
        if (blobUrl) URL.revokeObjectURL(blobUrl);
        console.info('Worker de conversion prêt :', d.exts.join(', ') || '(aucune lib chargée)');
        finir(d.exts);
        return;
      }
      const req = requetesEnCours.get(d.id);
      if (!req) return;
      requetesEnCours.delete(d.id);
      if (d.ok) req.resolve({ md: d.md, images: d.images || [] });
      else      req.reject(new Error(d.erreur)); // vraie erreur de conversion → journal
    };

    travailleur.onerror = (e) => {
      clearTimeout(minuteur);
      console.warn('Worker : erreur fatale, repli sur le fil principal.', (e && e.message) || '');
      arreterTravailleur();       // rejette les requêtes en cours avec le marqueur __infra
      finir(null);                // sans effet si déjà prêt ; force null si mort avant 'pret'
    };
  });
  return travailleurPretPromise;
}

// Convertit via le worker. Renvoie null si le worker ne prend pas en charge cette
// extension (→ le fil principal prend le relais). Rejette avec err.__infra si le
// worker meurt en cours (→ repli aussi), ou avec une vraie erreur de conversion.
async function convertirViaTravailleur(fichier, ext, nom, ctx) {
  const exts = await initTravailleur();
  if (!exts || travailleurMort || !travailleur || !exts.includes(ext)) {
    statsTravailleur.replis++;
    return null;
  }
  const ab = await lireCommeArrayBuffer(fichier);
  return new Promise((resolve, reject) => {
    const id = prochainIdReq++;
    requetesEnCours.set(id, {
      resolve: r => { statsTravailleur.converties++; resolve(r); },
      reject,
    });
    try {
      travailleur.postMessage({ id, ext, nom, ab, ctx }, [ab]); // transfert, pas de copie
    } catch (e) {
      requetesEnCours.delete(id);
      const err = new Error('Envoi au worker impossible'); err.__infra = true;
      reject(err);
    }
  });
}

// Point d'entrée unique de conversion : worker pour les formats lourds (avec repli
// transparent), fil principal pour le reste. Renvoie toujours { md, images }.
// ctx.dossierImages : dossier (relatif au .md) où ranger les images extraites.
async function convertir(fichier, ext, nom, ctx) {
  if (EXTENSIONS_TRAVAILLEUR.has(ext) && !travailleurMort) {
    try {
      const r = await convertirViaTravailleur(fichier, ext, nom, ctx);
      if (r !== null) return r;
    } catch (err) {
      if (!(err && err.__infra)) throw err; // vraie erreur → remonte au journal
      statsTravailleur.replis++;            // panne worker → repli fil principal
      console.warn('Repli fil principal après panne worker :', err.message);
    }
  }
  const ab = await lireCommeArrayBuffer(fichier);
  return normaliserResultat(await CONVERTISSEURS[ext](ab, nom, ctx));
}

// =====================================================================
// SECTION 4 : ORCHESTRATEUR
// =====================================================================
// avis : avertissements de l'envoyeur (passerelle PDF), ajoutés au message de chaque ligne du journal
async function traiterFichiers(fileList, avis = []) {
  // Pool de conversion : jusqu'à N fichiers en parallèle au lieu d'un par un.
  // Chaque travailleur pioche le fichier suivant dès qu'il a fini le sien,
  // donc les lignes du journal apparaissent dans l'ordre de dépôt.
  const fichiers = Array.from(fileList);
  let prochain = 0;
  const travailleur = async () => {
    while (prochain < fichiers.length) {
      await traiterUnFichier(fichiers[prochain++], avis);
    }
  };
  const nbTravailleurs = Math.min(CONVERSIONS_MAX_PARALLELES, fichiers.length);
  await Promise.all(Array.from({ length: nbTravailleurs }, travailleur));
  mettreAJourBoutonZip();
}

async function traiterUnFichier(fichier, avis = []) {
  const nom    = fichier.name;
  const ext    = extOf(nom);
  const id     = 'item-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);

  // 1. Format refusé ?
  if (FORMATS_REFUSES[ext]) {
    ajouterLigne({ id, icone: '❌', nom, statut: 'err', msg: FORMATS_REFUSES[ext], cliquable: false });
    return;
  }

  // 2. Convertisseur disponible ?
  if (!CONVERTISSEURS[ext]) {
    ajouterLigne({ id, icone: '❌', nom, statut: 'err', msg: `Format non pris en charge : ${ext || '(sans extension)'}`, cliquable: false });
    return;
  }

  // 3. Avertissement taille
  if (fichier.size > SEUIL_ALERTE_TAILLE) {
    ajouterLigne({ id, icone: '⏳', nom, statut: 'en-cours', msg: `⚠️ Fichier volumineux (${(fichier.size / 1024 / 1024).toFixed(0)} Mo), conversion en cours…`, cliquable: false });
  } else {
    ajouterLigne({ id, icone: '⏳', nom, statut: 'en-cours', msg: 'Conversion en cours…', cliquable: false });
  }

  // 4. Conversion (worker pour les formats lourds, fil principal sinon).
  // Nom de sortie réservé avant le premier await : l'ordre de dépôt décide des
  // suffixes _2, _3… même si les conversions parallèles finissent dans le désordre.
  const sortie = reserverSortie(nom);
  try {
    const { md, images } = await convertir(fichier, ext, nom, { dossierImages: sortie.dossierImages });

    // Détecter alerte scan PDF : document entier, ou pages scannées (note de convPdf)
    const estImage = EXTENSIONS_IMAGE_OCR.has(ext);
    const toutScanne = ext === '.pdf' && md.includes('⚠️ Ce PDF semble être un scan');
    const vide     = ext === '.pdf' && md.includes(PDF_VIDE);
    const mixte    = ext === '.pdf' && md.match(/^> ⚠️ (Pages? [\d, ]+) : image presque sans texte/m);
    const estScan  = estImage || toutScanne || !!mixte;
    const resultat = { nom, nomMd: sortie.nomMd, md, images, date: dateLocale() };
    if (estScan) resultat.fichier = fichier;   // conservé pour un éventuel OCR
    resultats.push(resultat);

    const avecImages = images.length ? ` (+ ${images.length} ${motFichiers(images)}${images.length > 1 ? 's' : ''})` : '';
    mettreAJourLigne(id, {
      icone:    estScan || vide ? '⚠️' : '✅',
      statut:   estScan || vide ? 'warn' : 'ok',
      msg:     (estImage ? 'Image : lancez l\'OCR pour reconnaître son texte.'
              : vide ? 'PDF sans texte ni image : rien à convertir.'
              : toutScanne ? 'PDF scanné : aucun texte extractible. Lancez l\'OCR pour reconnaître le texte.'
              : mixte ? `Texte extrait. ${mixte[1]} ${mixte[1].startsWith('Pages') ? 'scannées : lancez l\'OCR pour les reconnaître.' : 'scannée : lancez l\'OCR pour la reconnaître.'}`
              : `Converti → ${sortie.nomMd}${avecImages}`) + avis.map(a => ' ' + a).join(''),
      resultat,
      proposerOcr: estScan,
      cliquable: true,
    });
  } catch (err) {
    libererSortie(sortie);
    mettreAJourLigne(id, { icone: '❌', statut: 'err', msg: `Erreur : ${err.message}`, cliquable: false });
  }
}

// =====================================================================
// SECTION 5 : UI
// =====================================================================
let journalSection, journalListe, btnZip, btnVider, apercuOverlay, apercuTitre, apercuContenu;

// Balisage du module (constante statique : aucune donnée de fichier n'y entre).
const MARKUP_CONVERTIR = `<div class="app">
  <!-- En-tête -->
  <header>
    <h1>Convertir en Markdown</h1>
    <p class="confidentialite">${MPDS.icones.svg('verrou', 16)} Vos fichiers ne quittent jamais votre appareil — conversion 100 % locale</p>
  </header>

  <!-- Bandeau CDN (masqué par défaut) -->
  <div id="bandeau-cdn" class="bandeau-cdn" hidden></div>

  <!-- Zone de dépôt -->
  <div class="zone-depot" id="zone-depot"
       role="button" tabindex="0"
       aria-label="Zone de dépôt — glissez vos fichiers ou appuyez sur Entrée pour ouvrir le sélecteur">
    <input type="file" id="input-fichiers" multiple
           accept=".pdf,.docx,.doc,.odt,.xlsx,.xls,.ods,.csv,.tsv,.pptx,.ppt,.odp,.txt,.html,.htm,.eml,.epub,.png,.jpg,.jpeg,.webp"
           aria-hidden="true" tabindex="-1">
    <div class="zone-depot-icone">${MPDS.icones.svg('deposer', 40)}</div>
    <p class="zone-depot-titre">Glissez vos fichiers ici</p>
    <p class="zone-depot-sub">ou <span>cliquez pour choisir</span>, ou collez un texte (Ctrl+V)</p>
    <span class="formats-badge">PDF · Word · Excel · CSV · PowerPoint · LibreOffice · HTML · TXT · Courriels · EPUB · Images (OCR)</span>
  </div>

  <!-- Hors de la zone de dépôt : un clic ici n'ouvre pas le sélecteur de fichiers -->
  <label class="option">
    <input type="checkbox" id="opt-yaml">
    Ajouter un en-tête Obsidian (titre, fichier source, date)
  </label>

  <!-- Section journal -->
  <section class="journal-section" id="journal-section" hidden>
    <div class="journal-header">
      <h2>Journal de conversion</h2>
      <div class="journal-actions">
        <button class="btn btn-primaire" id="btn-zip" hidden aria-label="Télécharger tous les fichiers convertis en ZIP">
          ${MPDS.icones.svg('telecharger', 16)} Tout télécharger (.zip)
        </button>
        <button class="btn btn-secondaire" id="btn-vider" aria-label="Vider le journal">
          ${MPDS.icones.svg('supprimer', 16)} Vider
        </button>
      </div>
    </div>
    <ul class="journal-liste" id="journal" aria-live="polite" aria-label="Journal de conversion"></ul>
  </section>

</div>

<!-- Overlay aperçu -->
<div class="apercu-overlay" id="apercu-overlay" hidden role="dialog" aria-modal="true" aria-labelledby="apercu-titre">
  <div class="apercu-panel">
    <div class="apercu-header">
      <span class="apercu-titre" id="apercu-titre"></span>
      <div class="apercu-header-actions">
        <button class="btn btn-secondaire btn-petit" id="btn-copier">${MPDS.icones.svg('copier', 16)} Copier</button>
        <button class="btn btn-secondaire btn-petit" id="btn-fermer-apercu">${MPDS.icones.svg('fermer', 16)} Fermer</button>
      </div>
    </div>
    <p class="apercu-note" id="apercu-note" role="status" hidden></p>
    <pre class="apercu-contenu" id="apercu-contenu" tabindex="0"></pre>
  </div>
</div>
`;

// Écouteurs posés sur document : actifs seulement si Convertir est le module affiché,
// et retirés au démontage.
const ecouteursDocument = [];
const convertirActif = () => MPDS.actif() === 'convertir';
function surDocument(type, fn) { document.addEventListener(type, fn); ecouteursDocument.push([type, fn]); }

function initUI(el) {
  el.innerHTML = MARKUP_CONVERTIR;
  journalSection = document.getElementById('journal-section');
  journalListe   = document.getElementById('journal');
  btnZip         = document.getElementById('btn-zip');
  btnVider       = document.getElementById('btn-vider');
  apercuOverlay  = document.getElementById('apercu-overlay');
  apercuTitre    = document.getElementById('apercu-titre');
  apercuContenu  = document.getElementById('apercu-contenu');

  const zone  = document.getElementById('zone-depot');
  const input = document.getElementById('input-fichiers');

  // Drag & drop — compteur pour éviter le clignotement sur les éléments enfants
  let compteurDrag = 0;
  zone.addEventListener('dragenter', e => { e.preventDefault(); compteurDrag++; zone.classList.add('survol'); });
  zone.addEventListener('dragleave', () => { if (--compteurDrag <= 0) { compteurDrag = 0; zone.classList.remove('survol'); } });
  zone.addEventListener('dragover',  e => { e.preventDefault(); });
  zone.addEventListener('drop', e => {
    e.preventDefault();
    compteurDrag = 0;
    zone.classList.remove('survol');
    if (e.dataTransfer.files.length) traiterFichiers(e.dataTransfer.files);
  });

  // Clic clavier (Entrée / Espace)
  zone.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
  });

  // Sélecteur de fichiers
  input.addEventListener('change', () => {
    if (input.files.length) { traiterFichiers(input.files); input.value = ''; }
  });

  // Coller (Ctrl+V) : fichiers copiés, ou texte copié depuis Word, un mail, une page web
  surDocument('paste', e => {
    if (!convertirActif()) return;
    if (e.target.closest && e.target.closest('input:not([type=checkbox]), textarea, [contenteditable]')) return;
    const d = e.clipboardData;
    if (!d) return;
    const html = d.getData('text/html'), texte = d.getData('text/plain');
    // HTML d'abord : Excel et Word joignent une image de la sélection au texte copié
    if (html) traiterFichiers([new File([html], 'presse-papiers.html', { type: 'text/html' })]);
    else if (d.files.length) traiterFichiers(d.files);
    else if (texte.trim()) traiterFichiers([new File([texte], 'presse-papiers.txt', { type: 'text/plain' })]);
    else return;
    e.preventDefault();
  });

  // Bouton ZIP (fonction fléchée : ne pas transmettre l'événement de clic comme liste)
  btnZip.addEventListener('click', () => genererZip());

  // Bouton Vider
  btnVider.addEventListener('click', () => {
    journalListe.innerHTML = '';
    resultats = [];
    nomsSortie.clear();
    dossiersImages.clear();
    journalSection.hidden = true;
    btnZip.hidden = true;
  });

  // Fermer aperçu
  document.getElementById('btn-fermer-apercu').addEventListener('click', fermerApercu);
  apercuOverlay.addEventListener('click', e => { if (e.target === apercuOverlay) fermerApercu(); });
  surDocument('keydown', e => {
    if (!convertirActif()) return;
    if (e.key === 'Escape') { fermerApercu(); return; }
    // Focus trap dans la modale quand elle est ouverte (WCAG 2.4.3)
    if (e.key === 'Tab' && !apercuOverlay.hidden) {
      const focusables = [...apercuOverlay.querySelectorAll('button, [tabindex="0"]')].filter(el => !el.disabled);
      if (!focusables.length) return;
      const premier = focusables[0], dernier = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === premier) { e.preventDefault(); dernier.focus(); }
      else if (!e.shiftKey && document.activeElement === dernier) { e.preventDefault(); premier.focus(); }
    }
  });

  document.getElementById('btn-copier').addEventListener('click', async () => {
    const btn = document.getElementById('btn-copier');
    // Toujours le Markdown complet, même si l'aperçu affiché est tronqué
    const reussi = await copierTexte(apercuMdComplet);
    avecIcone(btn, reussi ? 'ok' : 'attention', reussi ? 'Copié !' : 'Copie impossible');
    setTimeout(() => avecIcone(btn, 'copier', 'Copier'), 2000);
  });

  // Option d'en-tête YAML, mémorisée pour ce navigateur
  const optYaml = document.getElementById('opt-yaml');
  try { optYaml.checked = localStorage.getItem('mpds-opt-yaml') === '1'; } catch { /* stockage indisponible */ }
  optYaml.addEventListener('change', () => {
    try { localStorage.setItem('mpds-opt-yaml', optYaml.checked ? '1' : '0'); } catch { /* stockage indisponible */ }
  });

  verifierBibliotheques();
}

function demonterConvertir(el) {
  for (const [type, fn] of ecouteursDocument.splice(0)) document.removeEventListener(type, fn);
  el.replaceChildren();
}

// ---- Journal helpers ----
function ajouterLigne({ id, icone, nom, statut, msg, cliquable }) {
  journalSection.hidden = false;

  // Construction DOM sécurisée (pas d'innerHTML avec données externes → pas de XSS)
  const li      = document.createElement('li');
  li.className  = `journal-item ${statut}`;
  li.id         = id;

  const spanIcone = document.createElement('span');
  spanIcone.className = 'journal-icone';
  spanIcone.setAttribute('aria-hidden', 'true');
  iconeStatut(spanIcone, icone);

  const divCorps = document.createElement('div');
  divCorps.className = 'journal-corps';

  const spanNom = document.createElement('span');
  spanNom.className = 'journal-nom' + (cliquable ? '' : ' non-cliquable');
  spanNom.title = nom;
  spanNom.textContent = nom;

  const divMsg = document.createElement('div');
  divMsg.className = 'journal-msg';
  divMsg.textContent = msg;

  divCorps.appendChild(spanNom);
  divCorps.appendChild(divMsg);
  li.appendChild(spanIcone);
  li.appendChild(divCorps);
  journalListe.appendChild(li);
}

function mettreAJourLigne(id, { icone, statut, msg, resultat, proposerOcr, cliquable }) {
  const li = document.getElementById(id);
  if (!li) return;

  li.className = `journal-item ${statut}`;
  iconeStatut(li.querySelector('.journal-icone'), icone);
  li.querySelector('.journal-msg').textContent   = msg;

  const nomSpan = li.querySelector('.journal-nom');
  if (cliquable && resultat) {
    nomSpan.classList.remove('non-cliquable');
    const { nomMd, images } = resultat;
    // resultat.md est lu au moment du clic : l'OCR peut le remplacer
    const apercu = () => ouvrirApercu(nomMd, contenuMd(resultat));

    // Boutons d'action sous le message (construction DOM sécurisée)
    const actions = document.createElement('div');
    actions.className = 'journal-actions-item';

    if (proposerOcr) {
      const btnOcr = document.createElement('button');
      btnOcr.className = 'btn btn-primaire btn-petit';
      avecIcone(btnOcr, 'ocr', 'Reconnaître le texte (OCR)');
      btnOcr.title = 'Reconnaissance faite sur votre appareil. Environ 5 Mo à télécharger la première fois, puis disponible hors ligne.';
      btnOcr.addEventListener('click', () => lancerOcr(li, resultat, btnOcr));
      actions.appendChild(btnOcr);
    }

    // Avec des images, le .md seul aurait des liens cassés : on livre une archive
    const btnDl = document.createElement('button');
    btnDl.className = 'btn btn-secondaire btn-petit';
    avecIcone(btnDl, 'telecharger', images.length ? 'Télécharger (.zip)' : 'Télécharger');
    if (images.length) btnDl.title = `${nomMd} et ses ${images.length} ${motFichiers(images)}(s), dans une archive`;
    btnDl.addEventListener('click', () => images.length
      ? genererZip([resultat], baseName(nomMd) + '.zip')
      : telechargerBlob(contenuMd(resultat), nomMd));

    const btnPrev = document.createElement('button');
    btnPrev.className = 'btn btn-secondaire btn-petit';
    avecIcone(btnPrev, 'apercu', 'Aperçu');
    btnPrev.addEventListener('click', apercu);

    actions.appendChild(btnDl);
    actions.appendChild(btnPrev);

    li.querySelector('.journal-corps').appendChild(actions);

    // Clic sur le nom → aperçu
    nomSpan.addEventListener('click', apercu);
  } else {
    nomSpan.classList.add('non-cliquable');
  }
}

function mettreAJourBoutonZip() {
  const nbOk = resultats.length;
  btnZip.hidden = nbOk < 2;
}

// ---- Aperçu ----
// Au-delà, afficher le texte fige la page (≈ 1,5 s pour 3 Mo) : on n'en montre
// que le début. Copier et Télécharger portent toujours sur le fichier complet.
const APERCU_MAX_CARACTERES = 1000000;   // un long roman ; ≈ 50 ms mesurés (100 ms pour 2 millions)
let apercuMdComplet = '';

function ouvrirApercu(nom, md) {
  apercuMdComplet = md;
  apercuTitre.textContent = baseName(nom) + '.md';
  const note = document.getElementById('apercu-note');
  if (md.length > APERCU_MAX_CARACTERES) {
    // Couper en fin de ligne pour ne pas tronquer une ligne de tableau au milieu
    const coupe = md.lastIndexOf('\n', APERCU_MAX_CARACTERES);
    apercuContenu.textContent = md.slice(0, coupe > 0 ? coupe : APERCU_MAX_CARACTERES);
    const fr = n => n.toLocaleString('fr-FR');
    note.textContent = `Aperçu limité au début du fichier (${fr(APERCU_MAX_CARACTERES)} premiers caractères sur ` +
      `${fr(md.length)}). « Copier » et « Télécharger » portent sur le fichier complet.`;
    note.hidden = false;
  } else {
    apercuContenu.textContent = md;
    note.hidden = true;
  }
  apercuOverlay.hidden = false;
  apercuContenu.focus();
}

// Copie dans le presse-papiers. Repli pour les contextes où l'API est refusée
// (file://, navigateur ancien) : zone de texte temporaire hors écran.
async function copierTexte(texte) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try { await navigator.clipboard.writeText(texte); return true; } catch { /* repli ci-dessous */ }
  }
  const zone = Object.assign(document.createElement('textarea'), { value: texte, readOnly: true });
  zone.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0';
  document.body.appendChild(zone);
  zone.select();
  let reussi = false;
  try { reussi = document.execCommand('copy'); } catch { reussi = false; }
  zone.remove();
  apercuContenu.focus();
  return reussi;
}

function fermerApercu() {
  apercuOverlay.hidden = true;
}

// ---- En-tête YAML (propriétés Obsidian) ----
// Ajouté à l'export (aperçu, copie, téléchargement, ZIP) et non à la conversion :
// cocher la case s'applique aussi aux fichiers déjà convertis, OCR compris.
const dateLocale = () => { const d = new Date(); return `${d.getFullYear()}-${deuxChiffres(d.getMonth() + 1)}-${deuxChiffres(d.getDate())}`; };

function contenuMd(r) {
  if (!document.getElementById('opt-yaml').checked) return r.md;
  // JSON.stringify : chaîne entre guillemets valide en YAML (« : », « # », guillemets)
  return `---\ntitle: ${JSON.stringify(baseName(r.nomMd))}\nsource: ${JSON.stringify(r.nom)}\ndate: ${r.date}\n---\n\n${r.md}`;
}

// ---- ZIP ----
// Archive des .md (noms déjà uniques, voir reserverSortie) et de leurs images,
// rangées dans images/<document>/ comme les liens du Markdown l'indiquent.
async function genererZip(liste = resultats, nomArchive = 'conversions_markdown.zip') {
  if (!liste.length) return;
  const zip = new JSZip();
  for (const r of liste) {
    zip.file(r.nomMd, contenuMd(r));
    for (const img of r.images || []) zip.file(img.chemin, img.data);
  }
  telechargerBlob(await zip.generateAsync({ type: 'blob' }), nomArchive);
}

// ---- Vérification bibliothèques ----
function verifierBibliotheques() {
  const manquantes = [];
  if (!window.mammoth)         manquantes.push('mammoth → .docx');
  if (!window.TurndownService) manquantes.push('Turndown → .docx/.html');
  if (!window.pdfjsLib)        manquantes.push('PDF.js → .pdf');
  if (!window.XLSX)            manquantes.push('SheetJS → .xlsx/.xls');
  if (!window.Papa)            manquantes.push('PapaParse → .csv/.tsv');
  if (!window.JSZip)           manquantes.push('JSZip → .pptx / .odt / .odp / .zip');

  if (manquantes.length) {
    const b = document.getElementById('bandeau-cdn');
    b.textContent = '⚠️ Connexion internet requise au premier chargement des composants. Formats indisponibles : ' + manquantes.join(', ') + '.';
    b.hidden = false;
  }

  // Construire le registre CONVERTISSEURS selon les libs disponibles
  CONVERTISSEURS = {};
  if (window.mammoth && window.TurndownService) CONVERTISSEURS['.docx'] = convDocx;
  if (window.pdfjsLib) {
    CONVERTISSEURS['.pdf'] = convPdf;
  }
  if (window.XLSX) {
    CONVERTISSEURS['.xlsx'] = convTableur;
    CONVERTISSEURS['.xls']  = convTableur;
    CONVERTISSEURS['.ods']  = convTableur;
  }
  if (window.Papa) {
    CONVERTISSEURS['.csv'] = convCsv;
    CONVERTISSEURS['.tsv'] = convCsv;
  }
  if (window.JSZip) {
    CONVERTISSEURS['.pptx'] = convPptx;
    CONVERTISSEURS['.odt']  = convOdt;
    CONVERTISSEURS['.odp']  = convOdp;
  }
  // Toujours disponibles
  CONVERTISSEURS['.txt'] = convTxt;
  for (const ext of EXTENSIONS_IMAGE_OCR) CONVERTISSEURS[ext] = convImage;
  if (window.TurndownService) {
    CONVERTISSEURS['.html'] = convHtml;
    CONVERTISSEURS['.htm']  = convHtml;
    CONVERTISSEURS['.eml']  = convEml;
    if (window.JSZip) CONVERTISSEURS['.epub'] = convEpub;
  }
}

// ---- Enregistrement dans la coquille (commun/coeur.js) ----
// Monté par le routeur au premier affichage (DOMContentLoaded : bibliothèques CDN chargées).
MPDS.enregistrer({
  id: 'convertir',
  titre: 'Convertir',
  icone: 'convertir',
  monter: initUI,
  demonter: demonterConvertir,
  surFichier: (fichier, options) => traiterFichiers([fichier], (options && options.avis) || []),
});
