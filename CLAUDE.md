# CLAUDE.md — My Personal Digital Space (MPDS, nom provisoire)

## Mémoire externe

Ce projet utilise le vault Obsidian local comme mémoire de fond :
`C:\Users\Krn\Documents\ClaudeMemory\02-Projects\my-personal-digital-space\`

Avant toute tâche non triviale, lire dans cet ordre :
1. `overview.md` : comprendre le projet
2. `architecture.md` : composants et flux
3. `decisions.md` : ADR (ne pas les contredire sans raison)
4. `journal.md` : où on en est resté

Les conventions globales sont dans
`C:\Users\Krn\Documents\ClaudeMemory\01-Global\` (chargées via
`~/.claude/CLAUDE.md`).

## Mises à jour

Après une session significative, mettre à jour :
- `journal.md` (entrée datée)
- `decisions.md` si décision d'architecture
- `architecture.md` si la structure a changé
- `CHANGELOG.md` du dépôt

## Spécifique au projet

- **Nature** : PWA statique multi-module, 100 % locale. Aucun serveur,
  aucun build. Base : `brissonjo-sudo/convert-to-markdown` au commit d864317.
- **Modules V1** : Convertir (Markdown) ; PDF (annoter, signer, tamponner,
  pages, formulaires).
- **Stack** : JavaScript vanilla, scripts classiques (`<script src>`),
  bibliothèques par CDN épinglées avec SRI.
- Commandes :
  - Lancer : `python -m http.server 8000` puis http://localhost:8000
  - Tester : `npm ci --omit=optional`, `npx playwright install chromium`, `npm test`
- Branche par défaut : `main`

## Règles

- **Doit fonctionner en `file://`** (dossier dézippé), en ligne et en PWA
  hors ligne. Pas d'ES modules, pas de `fetch` de fichiers locaux.
- **Rien n'est stocké** hors session, sauf préférences d'interface
  (`localStorage`, clés préfixées `mpds-`).
- **Cache du service worker préfixé `mpds-`** : ne jamais supprimer un cache
  d'un autre préfixe (même origine que l'ancien outil sur github.io).
- Ajouter une bibliothèque :
  - chargée au démarrage : balise + SRI dans `index.html`, `PRECACHE` dans
    `sw.js` (+ `VERSION`), version exacte dans `package.json` ;
  - chargée à la demande (ex. pdf-lib) : ligne dans la table `INTEGRITE` de
    `commun/pdfjs.js`, `MPDS.chargerScript(url)`, cache à la volée dans
    `sw.js`, version exacte dans `package.json`.
  - `tests/serveur.js` et `tests/verifier-cdn.js` lisent ces sources ; lancer
    `node tests/verifier-cdn.js` (réseau) pour l'empreinte réelle.
- Texte dessiné dans un PDF : passer par `MPDS.pdfTexte.verifier` (le fork
  pdf-lib remplace en silence les caractères hors WinAnsi par « ? »).

## À éviter

- Casser la CSP ou le SRI pour « faire marcher » une bibliothèque.
- `innerHTML` avec des données issues d'un fichier.
- Toucher au dépôt `convert-to-markdown` depuis ce projet sans accord.
