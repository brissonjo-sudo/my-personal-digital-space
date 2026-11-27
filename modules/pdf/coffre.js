// Module PDF — coffre : la signature enregistrée sur cet appareil, chiffrée par une phrase secrète.
// AES-GCM 256 bits, clé dérivée de la phrase par PBKDF2-SHA-256 (sel aléatoire, 600 000 itérations).
// La phrase et la clé ne sont jamais conservées ; seul le chiffré est rangé dans localStorage.
// Origine partagée (brissonjo-sudo.github.io, toutes les pages du compte) : le contenu est chiffré et
// authentifié, et la signature déchiffrée est revalidée avant usage.
// Publie MPDS.pdfCoffre.{ disponible(), existe(), enregistrer(sig, phrase), ouvrir(phrase), oublier() }.
(() => {
  'use strict';
  const CLE = 'mpds-signature', ITERATIONS = 600000, PHRASE_MIN = 10;
  const PNG = 'data:image/png;base64,', MAX_URL = 8 * 1024 * 1024, MAX_COTE = 4000;
  const enc = new TextEncoder(), dec = new TextDecoder();
  const b64 = o => { let s = ''; for (const x of o) s += String.fromCharCode(x); return btoa(s); };
  const octets = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const echec = texte => Object.assign(new Error(texte), { name: 'Coffre' });

  const disponible = () => {
    try { return !!(crypto.subtle && window.localStorage); } catch { return false; }   // stockage bloqué, ou hors contexte sécurisé
  };
  const lire = () => { try { return localStorage.getItem(CLE); } catch { return null; } };
  const existe = () => disponible() && lire() !== null;

  async function cle(phrase, sel, iterations, usage) {
    const base = await crypto.subtle.importKey('raw', enc.encode(phrase), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: sel, iterations }, base,
      { name: 'AES-GCM', length: 256 }, false, [usage]);
  }

  // Signature acceptée seulement si c'est bien celle que produit la fenêtre : PNG en data URL, taille bornée
  function valide(s) {
    const entier = n => Number.isInteger(n) && n > 0 && n <= MAX_COTE;
    return !!s && typeof s.url === 'string' && s.url.startsWith(PNG) && s.url.length <= MAX_URL
      && /^[A-Za-z0-9+/]+=*$/.test(s.url.slice(PNG.length)) && entier(s.w) && entier(s.h);
  }

  async function enregistrer(sig, phrase) {
    if (typeof phrase !== 'string' || [...phrase].length < PHRASE_MIN) throw echec('Phrase secrète trop courte : ' + PHRASE_MIN + ' caractères au moins.');
    if (!valide(sig)) throw echec('Signature invalide.');
    const sel = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const clair = enc.encode(JSON.stringify({ url: sig.url, w: sig.w, h: sig.h }));
    const chiffre = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await cle(phrase, sel, ITERATIONS, 'encrypt'), clair));
    try { localStorage.setItem(CLE, JSON.stringify({ v: 1, iterations: ITERATIONS, sel: b64(sel), iv: b64(iv), donnees: b64(chiffre) })); }
    catch { throw echec('Enregistrement impossible : stockage du navigateur plein ou bloqué.'); }
  }

  async function ouvrir(phrase) {
    let r;
    try { r = JSON.parse(lire()); } catch { r = null; }
    // Itérations bornées : une valeur démesurée glissée dans le stockage bloquerait la page
    if (!r || r.v !== 1 || !Number.isInteger(r.iterations) || r.iterations < 100000 || r.iterations > 5000000) {
      throw echec('Signature enregistrée illisible : oubliez-la puis enregistrez-la de nouveau.');
    }
    let clair;
    try {
      clair = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: octets(r.iv) }, await cle(phrase, octets(r.sel), r.iterations, 'decrypt'), octets(r.donnees));
    } catch { throw echec('Phrase secrète incorrecte.'); }   // AES-GCM : mauvaise clé ou chiffré altéré, même échec
    let sig;
    try { sig = JSON.parse(dec.decode(clair)); } catch { sig = null; }
    if (!valide(sig)) throw echec('Signature enregistrée illisible : oubliez-la puis enregistrez-la de nouveau.');
    return { url: sig.url, w: sig.w, h: sig.h };
  }

  const oublier = () => { try { localStorage.removeItem(CLE); } catch { /* stockage bloqué : rien à effacer */ } };

  MPDS.pdfCoffre = { disponible, existe, enregistrer, ouvrir, oublier, PHRASE_MIN };
})();
