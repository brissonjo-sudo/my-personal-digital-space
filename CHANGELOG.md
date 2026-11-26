# Changelog

## [Non publié]

### Ajouté
- 2026-11-26 — Module PDF, étape 2 : visionneuse (une page à la fois, miniatures, pagination, zoom 25–400 % et ajustement à la largeur, clavier, glisser-déposer, erreurs claires dont PDF protégé par mot de passe). Chargement vérifié (SRI) du worker PDF.js et `scriptVerifie` remontés dans `commun/pdfjs.js` (utilisés aussi par le convertisseur et son worker, comportement inchangé). Cache du service worker : `mpds-v2`.
- 2026-11-25 — Restructuration en coquille + modules (commun/, modules/convertir/), sans changement de comportement du convertisseur : routeur par hash, passerelle MPDS.envoyer, cache SW préfixé mpds-, clés localStorage mpds-, worker construit depuis codePartage().
- 2026-11-25 — Import de `convert-to-markdown` (commit d864317) comme base
  du projet, sans modification fonctionnelle.
- 2026-11-25 — `CLAUDE.md` et ce journal des changements.
