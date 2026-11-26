// Code PARTAGÉ entre le fil principal et le Web Worker de conversion.
// Chargé comme script classique (compatible file://) : tout est enveloppé dans
// codePartage(), exécutée sur le fil principal ET, via codePartage.toString(),
// dans le worker (voir creerBlobTravailleur dans convertir.js). Les noms utilisés
// hors de ce fichier sont publiés sur self (window ou worker) en fin de fonction.
// RÈGLE : uniquement des fonctions PURES ici — aucun accès à document, window,
// DOMParser ou Turndown (indisponibles dans un worker). Les globals XLSX / Papa /
// JSZip / TextDecoder existent dans les deux contextes.
function codePartage() {
'use strict';
const extOf    = nom => (nom.match(/\.[^.]+$/) || [''])[0].toLowerCase();
const baseName = nom => nom.replace(/\.[^.]+$/, '');

function ecapperCellule(s) {
  return String(s ?? '').replace(/\|/g, '\\|').replace(/\n+/g, '<br>').replace(/\r/g, '').trim();
}

function construireTableMd(rows) {
  if (!rows || !rows.length) return '_(vide)_';
  // reduce au lieu de Math.max(...spread) : ce dernier plante au-delà de ~100k lignes
  // (dépassement de la pile d'appels). Crucial pour les gros exports Excel/CSV.
  const nbCols = rows.reduce((m, r) => r.length > m ? r.length : m, 0);
  const pad = r => { const c = [...r]; while (c.length < nbCols) c.push(''); return c; };
  const toRow = r => '| ' + pad(r).map(ecapperCellule).join(' | ') + ' |';
  const sep   = '|' + Array(nbCols).fill(' --- ').join('|') + '|';
  return [toRow(rows[0]), sep, ...rows.slice(1).map(toRow)].join('\n');
}

// Détecte l'encodage d'un ArrayBuffer (BOM UTF-8/UTF-16, sinon fallback Latin-1)
// Crucial pour les exports Excel français (Windows-1252) et les fichiers anciens
function detecterEtDecoder(ab) {
  const bytes = new Uint8Array(ab);
  // BOM UTF-8 : EF BB BF
  if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
    return new TextDecoder('utf-8').decode(ab);
  }
  // BOM UTF-16 LE : FF FE
  if (bytes[0] === 0xFF && bytes[1] === 0xFE) {
    return new TextDecoder('utf-16le').decode(ab);
  }
  // BOM UTF-16 BE : FE FF
  if (bytes[0] === 0xFE && bytes[1] === 0xFF) {
    return new TextDecoder('utf-16be').decode(ab);
  }
  // Tenter UTF-8 strict ; si échec → Latin-1 (windows-1252 compatible)
  try {
    const td = new TextDecoder('utf-8', { fatal: true });
    return td.decode(ab);
  } catch {
    return new TextDecoder('windows-1252').decode(ab);
  }
}

// &amp; en dernier : sinon « &amp;lt; » (le texte littéral « &lt; ») deviendrait « < »
function desescaperXml(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g,         (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g,  '&');
}

// Cible exécutable (javascript:, vbscript:, data:) : le .md peut être ouvert dans
// un éditeur (Obsidian…) où un clic l'exécuterait. Comme le navigateur, on ignore
// espaces et caractères de contrôle dans le schéma (« java\tscript: »).
const lienDangereux = href => /^(javascript|vbscript|data):/i.test(String(href || '').replace(/[\x00-\x20]/g, ''));

// Extension de fichier d'une image d'après son type MIME (image/jpeg → jpg)
function extensionImage(type) {
  const sous = (String(type || '').split(';')[0].split('/')[1] || '').toLowerCase();
  return ({ jpeg: 'jpg', 'svg+xml': 'svg', 'x-emf': 'emf', 'x-wmf': 'wmf', tiff: 'tif' })[sous]
    || sous.replace(/[^a-z0-9]/g, '') || 'bin';
}

// Les convertisseurs renvoient soit du texte, soit { md, images } quand le document
// contient des images (images : [{ chemin, type, data: ArrayBuffer }], chemin relatif
// au fichier .md). Cette fonction ramène les deux cas à la seconde forme.
const normaliserResultat = r => typeof r === 'string' ? { md: r, images: [] } : { md: r.md, images: r.images || [] };

// Conventions d'affichage des nombres et dates : comme Excel suit la langue du
// système, on suit celle du navigateur (1 234,50 € et 15/03/2026 en français).
// Dans le worker, LANGUE_PAGE est fournie par la page (voir creerBlobTravailleur).
const AFFICHAGE_FR = /^fr\b/i.test(
  (typeof LANGUE_PAGE !== 'undefined' ? LANGUE_PAGE : typeof navigator !== 'undefined' && navigator.language) || '');

// Formats de date intégrés d'Excel dont l'affichage dépend de la langue
// (« date courte » n° 14 et 22) : SheetJS les rend à l'américaine (3/15/26).
const FORMATS_DATE_LOCAUX = new Set(['m/d/yy', 'm/d/yy h:mm']);

const deuxChiffres = n => String(n).padStart(2, '0');

// 1,234.50 → 1 234,50 (uniquement dans les suites de chiffres, pas dans le texte du format)
const separateursFr = s => s.replace(/\d[\d,.]*\d|\d/g, n => n.replace(/[,.]/g, c => c === ',' ? ' ' : ','));

function texteDate(cell, format) {
  if (!AFFICHAGE_FR || !(cell.t === 'd' || FORMATS_DATE_LOCAUX.has(format))) {
    return cell.w != null ? cell.w : String(cell.v);
  }
  let j, m, a, h = 0, mi = 0;
  if (cell.t === 'd') {
    const d = cell.v; j = d.getDate(); m = d.getMonth() + 1; a = d.getFullYear(); h = d.getHours(); mi = d.getMinutes();
  } else {
    const p = XLSX.SSF.parse_date_code(cell.v); j = p.d; m = p.m; a = p.y; h = p.H; mi = p.M;
  }
  const date = `${deuxChiffres(j)}/${deuxChiffres(m)}/${a}`;
  return /h/i.test(format) || (cell.t === 'd' && (h || mi)) ? `${date} ${deuxChiffres(h)}:${deuxChiffres(mi)}` : date;
}

// Valeur d'une cellule telle qu'affichée dans le tableur (dates, montants, %),
// et non sa valeur brute (46096 au lieu de 15/03/2026, 0.205 au lieu de 20,5 %).
function texteCellule(cell) {
  if (!cell) return '';
  const format = cell.z || 'General';
  if (cell.t === 'd' || (cell.t === 'n' && XLSX.SSF.is_date(format))) return texteDate(cell, format);
  if (cell.t === 'n') {
    const w = cell.w != null ? cell.w : XLSX.SSF.format(format, cell.v);
    return AFFICHAGE_FR ? separateursFr(w) : w;
  }
  if (cell.w != null) return cell.w;
  return cell.v == null ? '' : String(cell.v);
}

// Retire les lignes et colonnes vides en fin de grille : la plage d'un tableur
// (ou les cellules répétées d'un tableau OpenDocument) déborde souvent du contenu
// réel, étendue par une simple mise en forme.
function rognerGrille(lignes) {
  while (lignes.length && lignes[lignes.length - 1].every(v => v === '')) lignes.pop();
  const largeur = lignes.reduce((m, l) => {
    let i = l.length - 1;
    while (i >= 0 && l[i] === '') i--;
    return Math.max(m, i + 1);
  }, 0);
  return lignes.map(l => l.slice(0, largeur));
}

// Lignes d'une feuille de tableur
function lignesFeuille(ws) {
  if (!ws || !ws['!ref']) return [];
  const plage  = XLSX.utils.decode_range(ws['!ref']);
  // Plage bornée aux cellules présentes : celle déclarée couvre parfois toute la
  // grille (1 048 576 lignes) après une simple mise en forme, et figeait l'onglet.
  let finL = -1, finC = -1;
  for (const cle in ws) {
    if (cle[0] === '!') continue;
    const { r, c } = XLSX.utils.decode_cell(cle);
    if (r > finL) finL = r;
    if (c > finC) finC = c;
  }
  plage.e.r = Math.min(plage.e.r, finL);
  plage.e.c = Math.min(plage.e.c, finC);
  const lignes = [];
  for (let r = plage.s.r; r <= plage.e.r; r++) {
    const ligne = [];
    for (let c = plage.s.c; c <= plage.e.c; c++) ligne.push(texteCellule(ws[XLSX.utils.encode_cell({ r, c })]));
    lignes.push(ligne);
  }
  return rognerGrille(lignes);
}

// .xlsx / .xls / .ods → Markdown (SheetJS)
async function convTableur(ab, nom) {
  // cellNF : conserver le format de chaque cellule (dates, montants, %).
  // cellHTML/cellFormula désactivés : seules les valeurs affichées nous
  // intéressent — moins de travail de parsing et de mémoire sur les gros classeurs.
  const wb    = XLSX.read(ab, { type: 'buffer', cellNF: true, cellHTML: false, cellFormula: false });
  const blocs = [`# ${baseName(nom)}\n`];

  for (const sheetName of wb.SheetNames) {
    const rows = lignesFeuille(wb.Sheets[sheetName]);
    blocs.push(`\n## Feuille : ${sheetName}\n`);
    blocs.push(rows.length ? construireTableMd(rows) : '_(feuille vide)_');
  }
  return blocs.join('\n') + '\n';
}

// .csv / .tsv → Markdown (PapaParse)
async function convCsv(ab, nom) {
  const texte  = detecterEtDecoder(ab);
  const sep    = extOf(nom) === '.tsv' ? '\t' : '';
  const result = Papa.parse(texte, { delimiter: sep, skipEmptyLines: true, header: false });
  const rows   = result.data;
  if (!rows.length) return `# ${baseName(nom)}\n\n_(fichier vide)_\n`;
  return `# ${baseName(nom)}\n\n${construireTableMd(rows)}\n`;
}

// ---- PowerPoint (.pptx) ----

// Valeur d'un attribut XML dans une balise ouvrante (ordre des attributs libre)
const attributXml = (balise, nom) => {
  const m = balise.match(new RegExp(`\\s${nom}="([^"]*)"`));
  return m ? desescaperXml(m[1]) : null;
};

// Cible relative d'une relation → chemin dans l'archive (« ../media/a.png »
// depuis ppt/slides/slide1.xml → ppt/media/a.png)
function resoudreChemin(source, cible) {
  if (cible.startsWith('/')) return cible.slice(1);
  const parties = source.split('/').slice(0, -1);
  for (const p of cible.split('/')) {
    if (p === '..') parties.pop();
    else if (p && p !== '.') parties.push(p);
  }
  return parties.join('/');
}

// Relations d'une partie (fichier _rels/<nom>.rels) : rId → { type, cible }
async function relationsPptx(zip, chemin) {
  const i = chemin.lastIndexOf('/');
  const f = zip.file(`${chemin.slice(0, i)}/_rels/${chemin.slice(i + 1)}.rels`);
  const rels = new Map();
  if (!f) return rels;
  for (const [balise] of (await f.async('text')).matchAll(/<Relationship\b[^>]*>/g)) {
    if (attributXml(balise, 'TargetMode') === 'External') continue;
    rels.set(attributXml(balise, 'Id'), {
      type: (attributXml(balise, 'Type') || '').split('/').pop(),
      cible: resoudreChemin(chemin, attributXml(balise, 'Target') || ''),
    });
  }
  return rels;
}

// Ordre réel des diapositives : celui de presentation.xml. Les noms de fichiers
// (slide1.xml, slide2.xml…) gardent l'ordre de création et ne changent pas quand
// on réorganise la présentation.
async function ordreDiapos(zip) {
  const pres = zip.file('ppt/presentation.xml');
  if (pres) {
    const rels = await relationsPptx(zip, 'ppt/presentation.xml');
    const ordre = [...(await pres.async('text')).matchAll(/<p:sldId\b[^>]*>/g)]
      .map(([balise]) => rels.get(attributXml(balise, 'r:id')))
      .filter(r => r && zip.file(r.cible))
      .map(r => r.cible);
    if (ordre.length) return ordre;
  }
  const numero = p => parseInt((p.match(/slide(\d+)\.xml$/i) || [0, 0])[1], 10);
  return Object.keys(zip.files).filter(p => /^ppt\/slides\/slide\d+\.xml$/i.test(p)).sort((a, b) => numero(a) - numero(b));
}

// Texte d'un paragraphe DrawingML (<a:p>) ; les sauts de ligne deviennent des espaces.
// <a:t(\s…)?> et non <a:t…> : ne pas confondre avec <a:tab/>, <a:tbl>, <a:tc>, <a:tr>.
function texteParagraphePptx(p) {
  const runs = p.replace(/<a:br\b[^>]*\/>/g, '<a:t> </a:t>').match(/<a:t(?:\s[^>]*)?>[\s\S]*?<\/a:t>/g) || [];
  return desescaperXml(runs.map(r => r.replace(/<[^>]+>/g, '')).join('')).replace(/\s+/g, ' ').trim();
}

const paragraphesPptx = xml => xml.match(/<a:p[ >][\s\S]*?<\/a:p>/g) || [];

// Espaces réservés sans contenu utile dans un export texte
const ESPACES_IGNORES = new Set(['dt', 'ftr', 'sldNum', 'hdr', 'sldImg']);

// Forme texte (<p:sp>) → { titre } ou { lignes } (puces avec niveaux, ou paragraphes)
function formeTextePptx(sp) {
  const ph = sp.match(/<p:ph\b[^>]*>/);
  const typePh = ph ? (attributXml(ph[0], 'type') || 'body') : null;
  if (typePh && ESPACES_IGNORES.has(typePh)) return null;

  const paras = paragraphesPptx(sp)
    .map(p => ({ xml: p, texte: texteParagraphePptx(p) }))
    .filter(p => p.texte);
  if (!paras.length) return null;
  if (typePh === 'title' || typePh === 'ctrTitle') return { titre: paras.map(p => p.texte).join(' ') };

  // Puces : par défaut dans les zones de contenu (héritées du masque), jamais
  // dans les zones de texte libres sauf puce explicite ; <a:buNone/> les retire.
  const pucesParDefaut = typePh === 'body' || typePh === 'obj';
  const lignes = paras.map(({ xml, texte }) => {
    const pPr  = (xml.match(/<a:pPr\b[^>]*\/?>/) || [''])[0];
    const puce = !/<a:buNone\b/.test(xml) && (pucesParDefaut || /<a:bu(?:Char|AutoNum)\b/.test(xml));
    const niveau = Number(attributXml(pPr, 'lvl') || 0);
    return puce ? '  '.repeat(niveau) + '- ' + texte : texte;
  });
  return { lignes };
}

// Tableau (<a:tbl>) → tableau Markdown ; cellules fusionnées laissées vides
function tableauPptx(xml) {
  const lignes = (xml.match(/<a:tr\b[\s\S]*?<\/a:tr>/g) || []).map(tr =>
    (tr.match(/<a:tc\b[\s\S]*?<\/a:tc>/g) || []).map(tc =>
      /^<a:tc\b[^>]*\b[hv]Merge="(?:1|true)"/.test(tc) ? '' : paragraphesPptx(tc).map(texteParagraphePptx).filter(Boolean).join(' ')));
  return lignes.length ? construireTableMd(lignes) : null;
}

const TYPES_IMAGE = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp',
                      svg: 'image/svg+xml', tif: 'image/tiff', tiff: 'image/tiff', emf: 'image/x-emf', wmf: 'image/x-wmf' };

// .pptx → Markdown (JSZip + parsing XML)
async function convPptx(ab, nom, ctx) {
  const zip = await JSZip.loadAsync(ab);
  const chemins = await ordreDiapos(zip);
  if (!chemins.length) throw new Error('Aucune diapositive trouvée dans ce fichier PPTX.');

  // Décompresser toutes les diapositives (et leurs relations) en parallèle
  const diapos = await Promise.all(chemins.map(async c => ({
    xml: await zip.file(c).async('text'),
    rels: await relationsPptx(zip, c),
  })));

  const images = [];
  const imageParMedia = new Map();   // une image réutilisée n'est extraite qu'une fois
  const blocs = [`# ${baseName(nom)}`];

  for (let i = 0; i < diapos.length; i++) {
    // mc:Fallback répète le contenu de mc:Choice pour les anciennes versions
    const xml = diapos[i].xml.replace(/<mc:Fallback\b[\s\S]*?<\/mc:Fallback>/g, '');
    const { rels } = diapos[i];
    const contenu = [];
    let titre = null;

    // Formes dans l'ordre du document (celles des groupes comprises)
    for (const [forme, genre] of xml.matchAll(/<p:(sp|pic|graphicFrame)\b[\s\S]*?<\/p:\1>/g)) {
      if (genre === 'sp') {
        const r = formeTextePptx(forme);
        if (!r) continue;
        if (r.titre && titre === null) titre = r.titre;
        else if (r.titre) contenu.push(`**${r.titre}**`);
        else contenu.push(r.lignes.join(r.lignes.every(l => /^\s*- /.test(l)) ? '\n' : '\n\n'));
      } else if (genre === 'graphicFrame') {
        const tableau = /<a:tbl\b/.test(forme) && tableauPptx(forme);
        if (tableau) contenu.push(tableau);
      } else {
        const blip = forme.match(/<a:blip\b[^>]*>/);
        const rel  = blip && rels.get(attributXml(blip[0], 'r:embed'));
        const media = rel && zip.file(rel.cible);
        if (!media) continue;
        if (!imageParMedia.has(rel.cible)) {
          const ext = (rel.cible.split('.').pop() || 'bin').toLowerCase();
          const img = { chemin: `${ctx.dossierImages}/image${images.length + 1}.${ext}`, type: TYPES_IMAGE[ext] || '',
                        data: await media.async('arraybuffer') };
          images.push(img);
          imageParMedia.set(rel.cible, img.chemin);
        }
        const descr = attributXml((forme.match(/<p:cNvPr\b[^>]*>/) || [''])[0], 'descr') || '';
        contenu.push(`![${descr.replace(/[[\]]/g, '')}](${imageParMedia.get(rel.cible)})`);
      }
    }

    // Notes de l'orateur (zone « body » de la page de notes)
    const relNotes = [...rels.values()].find(r => r.type === 'notesSlide');
    const fichierNotes = relNotes && zip.file(relNotes.cible);
    if (fichierNotes) {
      const corps = ((await fichierNotes.async('text')).match(/<p:sp\b[\s\S]*?<\/p:sp>/g) || [])
        .filter(sp => /<p:ph\b[^>]*\stype="body"/.test(sp));
      const notes = corps.flatMap(sp => paragraphesPptx(sp).map(texteParagraphePptx)).filter(Boolean);
      if (notes.length) contenu.push('> **Notes de l\'orateur :** ' + notes.join('\n>\n> '));
    }

    const masquee = /<p:sld\b[^>]*\sshow="(?:0|false)"/.test(xml) ? ' *(masquée)*' : '';
    blocs.push(`## Diapositive ${i + 1}${titre ? ' : ' + titre : ''}${masquee}`, ...contenu);
  }

  return { md: blocs.join('\n\n') + '\n', images };
}

// ---- OpenDocument (.odt / .odp, LibreOffice) ----

// Mini-analyseur XML : le worker n'a pas DOMParser. Produit un arbre
// { nom, attrs, enfants } (les textes sont des chaînes), suffisant pour le XML
// bien formé et sans DTD des suites bureautiques.
function analyserXml(xml) {
  const racine = { nom: '', attrs: {}, enfants: [] };
  const pile = [racine];
  const jeton = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<[?!][\s\S]*?>|<(\/?)([\w.:-]+)((?:\s+[\w.:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  for (const m of xml.matchAll(jeton)) {
    const parent = pile[pile.length - 1];
    if (m[1] !== undefined) parent.enfants.push(m[1]);
    else if (m[6] !== undefined) parent.enfants.push(desescaperXml(m[6]));
    else if (m[3] !== undefined) {
      if (m[2]) { if (pile.length > 1) pile.pop(); continue; }
      const attrs = {};
      for (const a of m[4].matchAll(/([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = desescaperXml(a[2] ?? a[3]);
      const noeud = { nom: m[3], attrs, enfants: [] };
      parent.enfants.push(noeud);
      if (!m[5]) pile.push(noeud);
    }
  }
  return racine;
}

const enfantsXml = (n, nom) => n.enfants.filter(e => typeof e !== 'string' && (!nom || e.nom === nom));
const texteXml   = n => typeof n === 'string' ? n : n.enfants.map(texteXml).join('');

function premierXml(n, nom) {
  for (const e of n.enfants) {
    if (typeof e === 'string') continue;
    if (e.nom === nom) return e;
    const r = premierXml(e, nom);
    if (r) return r;
  }
  return null;
}

function tousXml(n, nom, acc = []) {
  for (const e of n.enfants) {
    if (typeof e === 'string') continue;
    if (e.nom === nom) acc.push(e);
    tousXml(e, nom, acc);
  }
  return acc;
}

// Caractères qui seraient pris pour de la mise en forme Markdown : mêmes règles
// que Turndown (utilisé pour Word et HTML), pour un rendu homogène.
const ECHAPPEMENTS_MD = [[/\\/g, '\\\\'], [/\*/g, '\\*'], [/^-/g, '\\-'], [/^\+ /g, '\\+ '], [/^(=+)/g, '\\$1'],
  [/^(#{1,6}) /g, '\\$1 '], [/`/g, '\\`'], [/^~~~/g, '\\~~~'], [/\[/g, '\\['], [/\]/g, '\\]'], [/^>/g, '\\>'],
  [/_/g, '\\_'], [/^(\d+)\. /g, '$1\\. ']];
const echapperMd = s => ECHAPPEMENTS_MD.reduce((t, [re, r]) => t.replace(re, r), s);

// Styles utiles d'un document OpenDocument : gras / italique des styles de
// texte, listes numérotées, pages masquées (présentations).
function stylesOdf(racines) {
  const texte = new Map(), listes = new Map(), pagesMasquees = new Set(), parents = new Map();
  for (const racine of racines) {
    for (const s of tousXml(racine, 'style:style')) {
      const nom = s.attrs['style:name'];
      const tp  = enfantsXml(s, 'style:text-properties')[0];
      const pp  = enfantsXml(s, 'style:drawing-page-properties')[0];
      const st  = {};
      if (tp && tp.attrs['fo:font-weight']) st.gras = /^(bold|[6-9]00)$/.test(tp.attrs['fo:font-weight']);
      if (tp && tp.attrs['fo:font-style'])  st.italique = /^(italic|oblique)$/.test(tp.attrs['fo:font-style']);
      // Styles nommés de LibreOffice (« Strong Emphasis », « Emphasis »)
      if (st.gras === undefined && /Strong/.test(nom)) st.gras = true;
      if (st.italique === undefined && /^Emphasis$/.test(nom)) st.italique = true;
      texte.set(nom, st);
      if (s.attrs['style:parent-style-name']) parents.set(nom, s.attrs['style:parent-style-name']);
      if (pp && pp.attrs['presentation:visibility'] === 'hidden') pagesMasquees.add(nom);
    }
    for (const l of tousXml(racine, 'text:list-style')) {
      const niveaux = [];
      for (const n of enfantsXml(l)) niveaux[Number(n.attrs['text:level'] || 1)] = n.nom === 'text:list-level-style-number';
      listes.set(l.attrs['style:name'], niveaux);
    }
  }
  // Héritage : un style sans gras/italique explicite prend ceux de son parent
  const resoudre = (nom, vus = new Set()) => {
    const st = texte.get(nom) || {};
    const p = parents.get(nom);
    if (!p || vus.has(nom)) return st;
    vus.add(nom);
    const sp = resoudre(p, vus);
    return { gras: st.gras ?? sp.gras, italique: st.italique ?? sp.italique };
  };
  const styles = new Map([...texte.keys()].map(n => [n, resoudre(n)]));
  return { styles, listes, pagesMasquees };
}

// Ouvre un fichier OpenDocument : arbre de content.xml, styles, images préchargées
async function ouvrirOdf(ab, ctx) {
  const zip = await JSZip.loadAsync(ab);
  const fContenu = zip.file('content.xml');
  if (!fContenu) throw new Error('Fichier OpenDocument invalide (content.xml absent).');
  const racine = analyserXml(await fContenu.async('text'));
  const fStyles = zip.file('styles.xml');
  const racineStyles = fStyles ? analyserXml(await fStyles.async('text')) : null;

  const c = { ...stylesOdf([racineStyles, racine].filter(Boolean)), notes: [], images: [], imageParChemin: new Map(),
              donneesImages: new Map(), dossierImages: ctx.dossierImages };
  const chemins = new Set(tousXml(racine, 'draw:image').map(i => i.attrs['xlink:href']).filter(h => h && !/^[a-z]+:/i.test(h)));
  for (const h of chemins) {
    const f = zip.file(h.replace(/^\.\//, ''));
    if (f) c.donneesImages.set(h, await f.async('arraybuffer'));
  }
  return { racine, c };
}

function imageOdf(cadre, c) {
  // Aperçu d'un objet incorporé (graphique, formule) : pas une vraie image
  if (premierXml(cadre, 'draw:object') || premierXml(cadre, 'draw:object-ole')) return '';
  const img = premierXml(cadre, 'draw:image');
  if (!img) return '';
  const href  = img.attrs['xlink:href'] || '';
  const titre = premierXml(cadre, 'svg:title') || premierXml(cadre, 'svg:desc');
  const alt   = (titre ? texteXml(titre) : '').replace(/[[\]\s]+/g, ' ').trim();
  if (/^[a-z]+:/i.test(href)) return lienDangereux(href) ? '' : `![${alt}](${href})`;
  const data = c.donneesImages.get(href);
  if (!data) return '';
  if (!c.imageParChemin.has(href)) {
    const ext = (href.split('.').pop() || 'bin').toLowerCase();
    const chemin = `${c.dossierImages}/image${c.images.length + 1}.${ext}`;
    c.images.push({ chemin, type: TYPES_IMAGE[ext] || '', data });
    c.imageParChemin.set(href, chemin);
  }
  return `![${alt}](${c.imageParChemin.get(href)})`;
}

// Entoure de ** ou * sans englober les espaces de bord (« **mot** » et non « ** mot** »)
function encadrerMd(t, { gras, italique } = {}) {
  const marque = gras && italique ? '***' : gras ? '**' : italique ? '*' : '';
  const m = t.match(/^(\s*)([\s\S]*?)(\s*)$/);
  return marque && m[2] ? m[1] + marque + m[2] + marque + m[3] : t;
}

// Contenu en ligne d'un paragraphe OpenDocument → Markdown
function enLigneOdf(n, c) {
  return n.enfants.map(e => {
    if (typeof e === 'string') return echapperMd(e.replace(/\s+/g, ' '));
    switch (e.nom) {
      case 'text:s':          return ' '.repeat(Math.min(Number(e.attrs['text:c'] || 1), 100));
      case 'text:tab':        return ' ';
      case 'text:line-break': return '\n';
      case 'text:span':       return encadrerMd(enLigneOdf(e, c), c.styles.get(e.attrs['text:style-name']));
      case 'text:a': {
        const t = enLigneOdf(e, c), href = e.attrs['xlink:href'];
        return href && t.trim() && !lienDangereux(href) ? `[${t}](${href.replace(/[\s()]/g, encodeURIComponent)})` : t;
      }
      case 'text:note': {   // note de bas de page → note Markdown [^n]
        const corps = premierXml(e, 'text:note-body');
        c.notes.push(corps ? blocsOdf(corps, c).join(' ').replace(/\s*\n\s*/g, ' ') : '');
        return `[^${c.notes.length}]`;
      }
      case 'draw:frame': {
        const boite = enfantsXml(e, 'draw:text-box')[0];
        return boite ? blocsOdf(boite, c).join(' ') : imageOdf(e, c);
      }
      // Commentaires, repères, changements suivis : pas du texte du document
      case 'office:annotation': case 'office:annotation-end': case 'text:bookmark': case 'text:bookmark-start':
      case 'text:bookmark-end': case 'text:soft-page-break': case 'text:change-start': case 'text:change-end':
        return '';
      default: return enLigneOdf(e, c);   // champs (date, numéro de page…), text:sequence, etc.
    }
  }).join('');
}

// Liste OpenDocument → lignes Markdown (puces ou numéros, niveaux imbriqués)
function listeOdf(liste, c, niveau = 1, retrait = '', styleHerite) {
  const style = liste.attrs['text:style-name'] || styleHerite;
  const ordonnee = (c.listes.get(style) || [])[niveau] === true;
  const lignes = [];
  let numero = 0;
  for (const item of enfantsXml(liste)) {
    if (item.nom !== 'text:list-item' && item.nom !== 'text:list-header') continue;
    const marque = item.nom === 'text:list-header' ? '' : ordonnee ? `${++numero}. ` : '- ';
    let premier = true;
    for (const e of enfantsXml(item)) {
      if (e.nom === 'text:list') {
        lignes.push(listeOdf(e, c, niveau + 1, retrait + ' '.repeat(Math.max(marque.length, 2)), style));
      } else if (e.nom === 'text:p' || e.nom === 'text:h') {
        const t = enLigneOdf(e, c).replace(/\s*\n\s*/g, ' ').trim();
        if (!t) continue;
        lignes.push(retrait + (premier ? marque : ' '.repeat(marque.length)) + t);
        premier = false;
      }
    }
  }
  return lignes.filter(Boolean).join('\n');
}

// Tableau OpenDocument → tableau Markdown. Les cellules fusionnées sont suivies de
// cellules « couvertes » : la grille est déjà alignée, aucune colonne ne se perd.
function tableauOdf(table, c) {
  const lignes = [];
  const parcourir = n => {
    for (const e of enfantsXml(n)) {
      if (e.nom === 'table:table-row') {
        const ligne = [];
        for (const cell of enfantsXml(e)) {
          if (cell.nom !== 'table:table-cell' && cell.nom !== 'table:covered-table-cell') continue;
          const v = cell.nom === 'table:covered-table-cell' ? '' : blocsOdf(cell, c).join('\n');
          const rep = Math.min(Number(cell.attrs['table:number-columns-repeated'] || 1), 1000);
          for (let k = 0; k < rep; k++) ligne.push(v);
        }
        const rep = Math.min(Number(e.attrs['table:number-rows-repeated'] || 1), 1000);
        for (let k = 0; k < rep; k++) lignes.push(ligne);
      } else if (/^table:table-(header-rows|rows|row-group)$/.test(e.nom)) {
        parcourir(e);
      }
    }
  };
  parcourir(table);
  const grille = rognerGrille(lignes);
  return grille.length ? construireTableMd(grille) : '';
}

// Blocs (titres, paragraphes, listes, tableaux) d'un conteneur OpenDocument
function blocsOdf(n, c) {
  const blocs = [];
  let listePrec = null;   // type de la liste qui vient d'être ajoutée (null si autre bloc)
  for (const e of enfantsXml(n)) {
    if (e.nom === 'text:list') {
      // LibreOffice découpe souvent une même liste en plusieurs <text:list>
      // consécutives (un niveau d'imbrication par liste) : on les recolle.
      const l = listeOdf(e, c);
      const ordonnee = (c.listes.get(e.attrs['text:style-name']) || [])[1] === true;
      if (l && listePrec === ordonnee) blocs[blocs.length - 1] += '\n' + l;
      else if (l) blocs.push(l);
      if (l) listePrec = ordonnee;
      continue;
    }
    const avant = blocs.length;
    switch (e.nom) {
      case 'text:h': {
        const t = enLigneOdf(e, c).replace(/\s*\n\s*/g, ' ').trim();
        if (t) blocs.push('#'.repeat(Math.min(Math.max(Number(e.attrs['text:outline-level'] || 1), 1), 6)) + ' ' + t);
        break;
      }
      case 'text:p': {
        const t = enLigneOdf(e, c).trim();
        if (t) blocs.push(t);
        break;
      }
      case 'table:table': { const t = tableauOdf(e, c); if (t) blocs.push(t); break; }
      // Tables des matières et index (redondants), suivi des modifications (texte supprimé)
      case 'text:table-of-content': case 'text:alphabetical-index': case 'text:illustration-index':
      case 'text:table-index': case 'text:object-index': case 'text:user-index': case 'text:bibliography':
      case 'text:tracked-changes': case 'office:forms': case 'text:sequence-decls': case 'text:variable-decls':
        break;
      default: blocs.push(...blocsOdf(e, c));   // sections, zones de texte…
    }
    if (blocs.length !== avant) listePrec = null;
  }
  return blocs;
}

// .odt (LibreOffice Writer) → Markdown
async function convOdt(ab, nom, ctx) {
  const { racine, c } = await ouvrirOdf(ab, ctx);
  const corps = premierXml(racine, 'office:text');
  if (!corps) throw new Error('Aucun texte trouvé dans ce fichier ODT.');
  const blocs = blocsOdf(corps, c);
  if (c.notes.length) blocs.push(c.notes.map((t, i) => `[^${i + 1}]: ${t}`).join('\n'));
  return { md: (blocs.join('\n\n') || '_(document vide)_') + '\n', images: c.images };
}

// .odp (LibreOffice Impress) → Markdown
async function convOdp(ab, nom, ctx) {
  const { racine, c } = await ouvrirOdf(ab, ctx);
  const pres = premierXml(racine, 'office:presentation');
  const pages = pres ? enfantsXml(pres, 'draw:page') : [];
  if (!pages.length) throw new Error('Aucune diapositive trouvée dans ce fichier ODP.');
  const IGNOREES = new Set(['page-number', 'footer', 'date-time', 'header']);
  const blocs = [`# ${baseName(nom)}`];

  pages.forEach((page, i) => {
    let titre = null;
    const contenu = [];
    // Formes dans l'ordre du document, groupes compris
    const formes = n => enfantsXml(n).flatMap(e => e.nom === 'draw:g' ? formes(e) : e.nom === 'presentation:notes' ? [] : [e]);
    for (const forme of formes(page)) {
      const classe = forme.attrs['presentation:class'];
      if (IGNOREES.has(classe)) continue;
      const boite = enfantsXml(forme, 'draw:text-box')[0];
      if (classe === 'title') {
        const t = texteXml(forme).replace(/\s+/g, ' ').trim();
        if (t && titre === null) { titre = t; continue; }
      }
      const table = premierXml(forme, 'table:table');
      if (table) { const t = tableauOdf(table, c); if (t) contenu.push(t); }
      else if (boite) contenu.push(...blocsOdf(boite, c));
      else if (forme.nom === 'draw:frame') { const img = imageOdf(forme, c); if (img) contenu.push(img); }
      else contenu.push(...blocsOdf(forme, c));   // formes dessinées contenant du texte
    }

    const notesPage = enfantsXml(page, 'presentation:notes')[0];
    const notes = notesPage
      ? tousXml(notesPage, 'draw:frame').filter(f => f.attrs['presentation:class'] === 'notes').flatMap(f => blocsOdf(f, c))
      : [];
    if (notes.length) contenu.push('> **Notes de l\'orateur :** ' + notes.join('\n>\n> '));

    const masquee = c.pagesMasquees.has(page.attrs['draw:style-name']) ? ' *(masquée)*' : '';
    blocs.push(`## Diapositive ${i + 1}${titre ? ' : ' + titre : ''}${masquee}`, ...contenu);
  });

  return { md: blocs.join('\n\n') + '\n', images: c.images };
}

Object.assign(self, { extOf, baseName, ecapperCellule, construireTableMd, detecterEtDecoder, desescaperXml, lienDangereux, extensionImage, normaliserResultat, AFFICHAGE_FR, FORMATS_DATE_LOCAUX, deuxChiffres, separateursFr, texteDate, texteCellule, rognerGrille, lignesFeuille, convTableur, convCsv, attributXml, resoudreChemin, relationsPptx, ordreDiapos, texteParagraphePptx, paragraphesPptx, ESPACES_IGNORES, formeTextePptx, tableauPptx, TYPES_IMAGE, convPptx, analyserXml, enfantsXml, texteXml, premierXml, tousXml, ECHAPPEMENTS_MD, echapperMd, stylesOdf, ouvrirOdf, imageOdf, encadrerMd, enLigneOdf, listeOdf, tableauOdf, blocsOdf, convOdt, convOdp });
}
codePartage();
