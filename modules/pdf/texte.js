// Module PDF — texte dessiné avec les polices standard de PDF (Helvetica…) : elles ne gèrent
// que l'encodage WinAnsi (Windows-1252). Ce module vérifie le texte AVANT le dessin pour
// donner une erreur claire plutôt qu'un échec obscur de la bibliothèque. Publie MPDS.pdfTexte.
(() => {
  'use strict';
  // 0x80–0x9F de Windows-1252 (le reste : U+0020–U+007E et U+00A0–U+00FF, identiques à Latin-1)
  const SPECIAUX = new Set([...'€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'].map(c => c.codePointAt(0)));
  const ESPACES = /[\u2000-\u200A\u202F\u205F\u3000]/g;   // espaces fines et insécables typographiques → espace

  const accepte = cp => (cp >= 0x20 && cp <= 0x7E) || (cp >= 0xA0 && cp <= 0xFF) || SPECIAUX.has(cp) || cp === 10 || cp === 13 || cp === 9;
  const decrire = c => `${c} (U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')})`;

  // Forme composée (é en un caractère) et espaces typographiques ramenés à l'espace
  const normaliser = texte => String(texte).normalize('NFC').replace(ESPACES, ' ');

  // Caractères distincts non pris en charge, dans l'ordre d'apparition
  const refuses = texte => [...new Set([...normaliser(texte)].filter(c => !accepte(c.codePointAt(0))))];

  // Renvoie le texte normalisé, ou lève une erreur en français nommant les caractères refusés
  function verifier(texte) {
    const mauvais = refuses(texte);
    if (mauvais.length) {
      throw new Error((mauvais.length === 1 ? 'Caractère non pris en charge : ' : 'Caractères non pris en charge : ') +
        mauvais.map(decrire).join(', ') + '. Les polices standard acceptent les lettres accentuées du français, « » et € (pas les flèches, symboles ni émojis).');
    }
    return normaliser(texte);
  }

  // Variante tolérante : retire les caractères refusés
  const filtrer = texte => ({ texte: [...normaliser(texte)].filter(c => accepte(c.codePointAt(0))).join(''), retires: refuses(texte) });

  MPDS.pdfTexte = { verifier, filtrer, refuses, normaliser };
})();
