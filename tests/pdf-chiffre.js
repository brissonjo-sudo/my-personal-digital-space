// Fabrique (Node) de PDF chiffrés « mot de passe propriétaire seulement » : le mot de passe
// utilisateur est vide, comme dans les Cerfa. Algorithmes du standard PDF (RC4 40/128 bits,
// AES-128), écrits ici pour ne dépendre d'aucune bibliothèque d'écriture ; AES-256 par le fork pdf-lib.
'use strict';

const crypto = require('crypto');

const PAD = Buffer.from('28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A', 'hex');
const md5 = (...b) => crypto.createHash('md5').update(Buffer.concat(b)).digest();
const rc4 = (cle, donnees) => {
  const s = [...Array(256).keys()];
  for (let i = 0, j = 0; i < 256; i++) { j = (j + s[i] + cle[i % cle.length]) & 255; [s[i], s[j]] = [s[j], s[i]]; }
  let i = 0, j = 0;
  return Buffer.from([...donnees].map(o => { i = (i + 1) & 255; j = (j + s[i]) & 255; [s[i], s[j]] = [s[j], s[i]]; return o ^ s[(s[i] + s[j]) & 255]; }));
};
const MODES = {   // longueur de clé (octets), révision R, version V
  rc4_40: { n: 5, R: 2, V: 1 }, rc4_128: { n: 16, R: 3, V: 2 }, aes_128: { n: 16, R: 4, V: 4 },
};

// textes : un texte par page (Helvetica 24 pt à (72, 700)). Renvoie un Buffer.
function pdfChiffre(textes, mode = 'rc4_40') {
  const { n, R, V } = MODES[mode];
  // mot de passe propriétaire : « proprio »
  let cleO = md5(Buffer.concat([Buffer.from('proprio'), PAD]).subarray(0, 32));
  if (R >= 3) for (let i = 0; i < 50; i++) cleO = md5(cleO);
  cleO = cleO.subarray(0, n);
  let O = rc4(cleO, PAD);
  if (R >= 3) for (let i = 1; i <= 19; i++) O = rc4(Buffer.from(cleO.map(o => o ^ i)), O);
  const P = Buffer.from('FCFFFFFF', 'hex'), ID = Buffer.alloc(16, 9);
  let cle = md5(PAD, O, P, ID);
  if (R >= 3) for (let i = 0; i < 50; i++) cle = md5(cle.subarray(0, n));
  cle = cle.subarray(0, n);
  let U;
  if (R === 2) U = rc4(cle, PAD);
  else {
    U = rc4(cle, md5(PAD, ID));
    for (let i = 1; i <= 19; i++) U = rc4(Buffer.from(cle.map(o => o ^ i)), U);
    U = Buffer.concat([U, Buffer.alloc(16)]);
  }
  const chiffrer = (num, donnees) => {
    const base = [cle, Buffer.from([num & 255, (num >> 8) & 255, (num >> 16) & 255, 0, 0])];
    if (V === 4) base.push(Buffer.from('sAlT'));
    const k = md5(...base).subarray(0, Math.min(n + 5, 16));
    if (V !== 4) return rc4(k, donnees);
    const iv = Buffer.alloc(16, 5), c = crypto.createCipheriv('aes-128-cbc', k, iv);
    return Buffer.concat([iv, c.update(donnees), c.final()]);
  };

  const objets = [];   // objets[i] : Buffer du corps de l'objet i+1
  const nb = textes.length;
  objets.push(Buffer.from('<</Type/Catalog/Pages 2 0 R>>'));
  objets.push(Buffer.from(`<</Type/Pages/Kids[${textes.map((_, i) => `${5 + 2 * i} 0 R`).join(' ')}]/Count ${nb}>>`));
  objets.push(Buffer.from('<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>'));
  const dico = V === 4 ? '/CF<</StdCF<</CFM/AESV2/AuthEvent/DocOpen/Length 16>>>>/StmF/StdCF/StrF/StdCF' : '';
  objets.push(Buffer.from(`<</Filter/Standard/V ${V}/R ${R}/Length ${n * 8}${dico}/O<${O.toString('hex')}>/U<${U.toString('hex')}>/P -4>>`));
  textes.forEach((t, i) => {
    const num = 5 + 2 * i, flux = chiffrer(num + 1, Buffer.from(`BT /F1 24 Tf 72 700 Td (${t}) Tj ET`));
    objets.push(Buffer.from(`<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents ${num + 1} 0 R/Resources<</Font<</F1 3 0 R>>>>>>`));
    objets.push(Buffer.concat([Buffer.from(`<</Length ${flux.length}>>\nstream\n`), flux, Buffer.from('\nendstream')]));
  });
  let sortie = Buffer.from('%PDF-1.6\n');
  const pos = objets.map((o, i) => {
    const p = sortie.length;
    sortie = Buffer.concat([sortie, Buffer.from(`${i + 1} 0 obj\n`), o, Buffer.from('\nendobj\n')]);
    return p;
  });
  const xref = sortie.length;
  const fin = `xref\n0 ${objets.length + 1}\n0000000000 65535 f \n${pos.map(p => String(p).padStart(10, '0') + ' 00000 n \n').join('')}` +
    `trailer\n<</Size ${objets.length + 1}/Root 1 0 R/Encrypt 4 0 R/ID[<${ID.toString('hex')}><${ID.toString('hex')}>]>>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.concat([sortie, Buffer.from(fin)]);
}

// AES-256 (V5 R6, AESV3), flux d'objets, chaînes chiffrées (/T, /V d'un champ) : comme un Cerfa
// récent. Écrit par le chiffrement du fork pdf-lib (vérifié : aucun texte en clair dans le fichier).
async function pdfChiffreAes256(texte, champ, valeur) {
  const { PDFDocument, StandardFonts } = require('@cantoo/pdf-lib');
  const doc = await PDFDocument.create();
  const p = doc.addPage([595, 842]);
  p.drawText(texte, { x: 72, y: 700, size: 24, font: await doc.embedFont(StandardFonts.Helvetica) });
  const f = doc.getForm().createTextField(champ);
  f.setText(valeur);
  f.addToPage(p, { x: 72, y: 600, width: 250, height: 24 });
  doc.encrypt({ userPassword: '', ownerPassword: 'proprio', permissions: { modifying: false } });
  return Buffer.from(await doc.save({ useObjectStreams: true }));
}

module.exports = { pdfChiffre, pdfChiffreAes256, MODES };
