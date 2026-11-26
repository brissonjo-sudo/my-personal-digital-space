// Module PDF — tampons : catalogue, modèle, rendu SVG et export vectoriel (cadre + texte Helvetica-Bold).
//   tampon : { type, x, y (coin bas-gauche du cadre non incliné, en points PDF), w, h, taille (corps du texte),
//              texte (capitales), couleur, angle (sens de lecture), incl (inclinaison, degrés anti-horaires, 8 par défaut) }
// Tout est proportionnel à `taille` : redimensionner = multiplier w, h et taille par le même facteur.
// Publie MPDS.pdfTampons.
(() => {
  'use strict';
  const ROUGE = '#dc2626', VERT = '#15803d', BLEU = '#1d4ed8';
  const CATALOGUE = [
    { id: 'recu', nom: 'Reçu le', date: true, couleur: BLEU }, { id: 'compta', nom: 'Comptabilisé le', date: true, couleur: BLEU },
    { id: 'duplicata', nom: 'Duplicata', couleur: BLEU }, { id: 'diffusion', nom: 'Diffusion restreinte', couleur: BLEU },
    { id: 'approuve', nom: 'Approuvé', couleur: VERT }, { id: 'refuse', nom: 'Refusé', couleur: ROUGE },
    { id: 'confidentiel', nom: 'Confidentiel', couleur: ROUGE }, { id: 'brouillon', nom: 'Brouillon', couleur: BLEU },
    { id: 'urgent', nom: 'Urgent', couleur: ROUGE }, { id: 'copie', nom: 'Copie', couleur: BLEU },
  ];
  const POLICE = 'Helvetica, Arial, sans-serif';
  const BASE = 0.39;   // ligne de base au-dessus du bas du cadre, en corps du texte : (1,5 − 0,72 de hauteur de capitale) / 2
  const rad = d => d * Math.PI / 180;
  const tourne = (x, y, d) => [x * Math.cos(rad(d)) - y * Math.sin(rad(d)), x * Math.sin(rad(d)) + y * Math.cos(rad(d))];

  const dateDuJour = () => new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });

  const mesure = (() => {
    const g = document.createElement('canvas').getContext('2d');
    return (t, taille) => { g.font = `bold 100px ${POLICE}`; return g.measureText(t).width * taille / 100; };
  })();

  // Nouveau tampon (sans position) ; lève une erreur en français si la date ou le texte est refusé
  function creer(id, date, taille = 18) {
    const m = CATALOGUE.find(c => c.id === id);
    if (!m) throw new Error('Tampon inconnu.');
    const d = String(date || '').trim();
    if (m.date) {
      const [, j, mo, a] = (/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(d) || []).map(Number);
      if (!a) throw new Error('Date attendue au format JJ/MM/AAAA.');
      const v = new Date(a, mo - 1, j);   // aller-retour : « 31/02 » deviendrait le 3 mars, « 00/00 » l'année 1899
      if (v.getFullYear() !== a || v.getMonth() !== mo - 1 || v.getDate() !== j) throw new Error('Date inexistante : ' + d + ' (JJ/MM/AAAA).');
    }
    const texte = MPDS.pdfTexte.verifier((m.nom + (m.date ? ' ' + d : '')).toLocaleUpperCase('fr-FR'));   // vérifié APRÈS la capitalisation (« µ » → « Μ » grec)
    return { type: 'tampon', texte, couleur: m.couleur, taille, w: mesure(texte, taille) + taille * 1.2, h: taille * 1.5, incl: 8 };
  }

  // Rendu SVG dans `parent`, repère local : origine = coin bas-gauche, y vers le bas (el = fabrique d'éléments SVG)
  function dessiner(a, parent, el) {
    const g = el('g', { transform: `rotate(${-a.incl} ${a.w / 2} ${-a.h / 2})` }, parent);
    el('rect', { x: 0, y: -a.h, width: a.w, height: a.h, rx: a.taille * 0.3, fill: '#000', 'fill-opacity': 0, stroke: a.couleur, 'stroke-width': a.taille / 9 }, g);
    const t = el('text', { x: a.w / 2, y: -a.taille * BASE, 'text-anchor': 'middle', 'font-weight': 'bold', 'font-family': POLICE, 'font-size': a.taille, fill: a.couleur, textLength: a.w - a.taille * 1.2, lengthAdjust: 'spacingAndGlyphs' }, g);
    t.textContent = a.texte;
  }

  // Export : cadre (drawRectangle, sans remplissage) et texte, inclinés autour du centre du cadre
  async function aplatir(PDFLib, sortie, c, a, polices, couleur) {
    const { degrees, StandardFonts } = PDFLib;
    if (!polices.has('Bold')) polices.set('Bold', await sortie.embedFont(StandardFonts.HelveticaBold));
    const police = polices.get('Bold'), phi = (a.angle || 0) + a.incl;
    const [cx, cy] = tourne(a.w / 2, a.h / 2, a.angle || 0), [ox, oy] = tourne(a.w / 2, a.h / 2, phi);
    const x = a.x + cx - ox, y = a.y + cy - oy;   // coin bas-gauche du cadre incliné
    c.drawRectangle({ x, y, width: a.w, height: a.h, rotate: degrees(phi), borderColor: couleur, borderWidth: a.taille / 9 });
    const texte = MPDS.pdfTexte.verifier(a.texte), l1 = police.widthOfTextAtSize(texte, 1);
    const taille = Math.min(a.taille, (a.w - a.taille * 0.6) / l1), [tx, ty] = tourne((a.w - l1 * taille) / 2, a.taille * BASE, phi);
    c.drawText(texte, { x: x + tx, y: y + ty, size: taille, font: police, color: couleur, rotate: degrees(phi) });
  }

  MPDS.pdfTampons = { CATALOGUE, dateDuJour, creer, dessiner, aplatir };
})();
