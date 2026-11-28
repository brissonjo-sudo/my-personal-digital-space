# My Personal Digital Space

[![Tests](https://github.com/brissonjo-sudo/my-personal-digital-space/actions/workflows/tests.yml/badge.svg)](https://github.com/brissonjo-sudo/my-personal-digital-space/actions/workflows/tests.yml)

Une boîte à outils numérique personnelle — **100 % locale, sans installation, sans serveur.** Vos fichiers ne quittent jamais votre appareil.

> 🚧 **En développement.** « My Personal Digital Space » (MPDS) est le nom définitif. Issu de [convert-to-markdown](https://github.com/brissonjo-sudo/convert-to-markdown), qui reste disponible tel quel.

| Module | État |
| --- | --- |
| 📝 **Convertir** : documents bureautiques → Markdown | ✅ disponible |
| 📑 **PDF** : visionneuse (pages, miniatures, zoom) | ✅ disponible |
| 📑 **PDF** : gérer les pages (pivoter, supprimer, réordonner, fusionner, extraire, enregistrer) | ✅ disponible |
| 📑 **PDF** : annoter (surligneur, texte, dessin, gomme, annuler/rétablir), figé dans la page à l'export | ✅ disponible |
| 📑 **PDF** : signer (dessin ou image au fond retiré ; enregistrable sur l'appareil, chiffrée par une phrase secrète) et tamponner (10 tampons), figés dans la page à l'export | ✅ disponible |
| 📑 **PDF** : caviarder (zones tracées à la main ou posées par recherche d'un mot ; la page caviardée devient une image : le texte masqué n'existe plus dans le fichier) | ✅ disponible |
| 📑 **PDF** : remplir les formulaires (AcroForm : texte, cases, boutons radio, listes), aplatis à l'export ; PDF chiffrés sans mot de passe d'ouverture pris en charge (testé sur fichiers générés, pas encore sur de vrais Cerfa) | ✅ disponible |
| 📑 → 📝 **Passerelle** : « Convertir en Markdown » envoie le PDF tel qu'affiché (pages, annotations, formulaire) au module Convertir, en mémoire | ✅ disponible |
| 🖼️ **Images** : retirer les métadonnées sans perte (position GPS, appareil, dates, vidéo cachée), redimensionner, compresser, convertir (JPEG, PNG, WebP), par lot en `.zip` ; « Lire le texte » envoie l'image au module Convertir (OCR) | ✅ disponible |

---

## 📝 Module Convertir

### ✨ Comment l'utiliser

1. **Ouvrez** l'application et choisissez **Convertir** dans la barre latérale
2. **Ajoutez** vos documents : glissez-les dans la zone de dépôt, cliquez pour les choisir, ou **collez** (Ctrl+V) un texte copié depuis Word, un mail ou une page web
3. *(Facultatif)* **Cochez** « En-tête Obsidian » si vous rangez vos notes dans Obsidian
4. **Récupérez** vos `.md` — un par un, ou tous en `.zip`

PDF scanné ou photo de document : cliquez sur **« Reconnaître le texte (OCR) »** dans le journal de conversion.

---

## 🖼️ Module Images

1. **Choisissez** Images dans la barre latérale, puis **ajoutez** vos images (clic ou glisser-déposer, jusqu'à 100 à la fois).
2. **Choisissez** le traitement :
   - **Retirer les métadonnées seulement** : l'image n'est pas réencodée, sa qualité ne change pas. JPEG et PNG : seul ce qui sert à l'affichage est gardé (liste blanche : tables de l'image, profil de couleur) ; tout le reste est retiré, y compris la vidéo ou les images cachées après la fin du fichier (« photos animées », profondeur). Autres formats : réencodés en PNG.
   - **Redimensionner, compresser ou convertir** : côté le plus long ou pourcentage (jamais agrandie), format JPEG, WebP ou PNG, qualité réglable. Le réencodage retire aussi toutes les métadonnées et redresse la photo selon son orientation. Résultat plus lourd que l'original à taille et format égaux : l'original est gardé, sans ses métadonnées.
3. **Traitez**, puis **téléchargez** chaque image, ou tout en `.zip`.

Photo tournée par son EXIF (portrait pris au téléphone) : en retrait sans perte, un EXIF minimal ne contenant **que l'orientation** est réécrit, pour qu'elle reste droite ; rien d'autre ne subsiste (ni position, ni appareil, ni date). Les photos HEIC (iPhone) ne sont pas lisibles par les navigateurs : un message explique comment obtenir du JPEG.

---

## ⬛ Caviarder un PDF

1. Ouvrez le PDF dans le module **PDF**.
2. **Caviarder (R)** : tracez des rectangles noirs sur ce qui doit disparaître. Ou **Rechercher et caviarder** : saisissez un nom, une adresse, un numéro ; la recherche ignore majuscules, accents et espaces, trouve un mot coupé en fin de ligne, et regarde aussi les commentaires, les champs de formulaire et les adresses des liens. Vérifiez chaque page : une zone en trop se retire (Sélection puis Suppr), Ctrl+Z retire tout le lot.
3. **Enregistrez** : le fichier s'appelle « … (caviardé).pdf ».

Ce qui est garanti : chaque page qui porte une zone noire est **reconstruite en image** (200 ppp), zones noircies dans les pixels. Le texte, les polices, les liens et les annotations d'origine de cette page **ne sont plus dans le fichier** : copier-coller ou chercher ne retrouve rien. Le fichier exporté est relu avant d'être proposé ; s'il restait du texte sur une page caviardée, l'export serait refusé. Les métadonnées du document (titre, auteur…) ne sont jamais recopiées.

Limites : le texte des pages caviardées n'est plus sélectionnable et le fichier grossit ; les pages sans texte (scans) ne peuvent pas être cherchées, la recherche le signale : caviardez-les à la main ; les valeurs saisies dans un formulaire ne figurent pas sur une page caviardée (enregistrez d'abord le formulaire rempli, rouvrez-le, puis caviardez). Un terme cherché qui reste lisible ailleurs (zone retirée exprès) est signalé à l'enregistrement.

---

## 🔒 Confidentialité — 100 % local

**Vos fichiers ne quittent jamais votre appareil.**

Toute la conversion s'effectue dans votre navigateur, y compris la reconnaissance de texte (OCR). Aucun fichier n'est envoyé sur un serveur, aucune donnée n'est collectée, aucun cookie n'est posé.

**Signature enregistrée** : seulement si vous cochez « Enregistrer sur cet appareil ». Elle est alors chiffrée dans le navigateur (AES-GCM 256 bits, clé tirée de votre phrase secrète par PBKDF2-SHA-256, 600 000 itérations) puis rangée dans le stockage local de ce navigateur, sur cet appareil uniquement. La phrase n'est jamais conservée : oubliée, la signature est perdue (redessinez-la). « Oublier la signature enregistrée » l'efface ; vider les données du site aussi.

Cette promesse n'est pas seulement tenue par le code : **le navigateur l'impose**.
- Il **bloque toute connexion** vers un autre serveur que ceux qui fournissent les composants de l'outil, en lecture seule. Même un composant piraté ne pourrait pas envoyer vos documents ailleurs.
- Chaque composant téléchargé est **vérifié** : s'il a été modifié, il est refusé et ne s'exécute pas.

Détails techniques : voir [Sécurité](#sécurité).

✅ Adapté pour : arrêtés municipaux, rapports internes, documents administratifs, données RH, courriers confidentiels.

---

## 📋 Formats pris en charge

| Catégorie | Extensions | Ce qui est restitué | Moteur |
| --- | --- | --- | --- |
| Word | `.docx` | Titres, listes, tableaux (cellules fusionnées comprises), images (extraites en fichiers), notes de bas de page | mammoth.js + Turndown |
| LibreOffice Writer | `.odt` | Titres, mise en forme, listes, tableaux, images, notes de bas de page | JSZip |
| PDF (texte) | `.pdf` | Titres, paragraphes, listes ; en-têtes et pieds de page répétés retirés | PDF.js |
| PDF scanné | `.pdf` | Texte reconnu par **OCR** (français), à la demande, sur votre appareil — document entier ou seulement les pages scannées d'un PDF texte (annexe signée, courrier numérisé) | PDF.js + Tesseract.js |
| Tableur (Excel, LibreOffice Calc) | `.xlsx`, `.xls`, `.ods` | Une section par feuille, valeurs telles qu'affichées (dates, montants, %) | SheetJS 0.20 |
| Données tabulaires | `.csv`, `.tsv` | Tableau ; séparateur et encodage détectés | PapaParse |
| PowerPoint | `.pptx` | Titres, puces, tableaux, images, notes de l'orateur, dans l'ordre réel | JSZip |
| LibreOffice Impress | `.odp` | Titres, puces, tableaux, images, notes de l'orateur | JSZip |
| Photo de document | `.png`, `.jpg`, `.jpeg`, `.webp` | Texte reconnu par **OCR** (français), à la demande | Tesseract.js |
| Texte | `.txt` | Texte brut | Natif |
| Page web | `.html`, `.htm` | Structure, tableaux, images intégrées (extraites en fichiers) | Turndown |
| Courriel | `.eml` | Expéditeur, destinataires, date, objet, corps (version HTML de préférence), images intégrées ; pièces jointes extraites dans `pieces-jointes/<document>/` | Natif + Turndown |
| Livre numérique | `.epub` | Chapitres dans l'ordre de lecture, titres, images | JSZip + Turndown |

Les **images** des documents sont enregistrées à côté du Markdown, dans `images/<document>/`, avec des liens relatifs : un document qui contient des images se télécharge en `.zip` (le `.md` et son dossier d'images).

---

## 🔧 Fonctionnalités

- ✅ **Plusieurs fichiers à la fois** : glisser-déposer ou sélecteur classique, jusqu'à 4 conversions en parallèle
- ✅ **Coller (Ctrl+V)** un texte copié depuis Word, un mail ou une page web : converti directement en Markdown (une capture d'écran collée passe par l'OCR)
- ✅ **OCR des PDF scannés et des photos de documents** : reconnaissance du texte sur votre appareil, à la demande
- ✅ **Aperçu** avant téléchargement (limité au début des très gros fichiers, pour rester instantané) et **copie en un clic** — toujours le fichier complet
- ✅ **Téléchargement individuel** ou archive `.zip` complète, images comprises
- ✅ **En-tête Obsidian** (case à cocher) : propriétés `title`, `source` et `date` en tête de chaque `.md`, choix mémorisé
- ✅ **Hors ligne** : après une première visite, l'outil fonctionne sans connexion, et peut s'installer comme une application
- ✅ **Interface fluide**, même pendant la conversion de gros tableurs
- ✅ **Encodage détecté automatiquement** (UTF-8, UTF-16, Windows-1252) pour les CSV et TXT
- ✅ **Formats LibreOffice** (`.odt`, `.ods`, `.odp`) au même titre que Microsoft Office
- ✅ **Mode sombre** : l'interface suit le réglage de votre système
- ✅ **Utilisable entièrement au clavier**

---

## ⚠️ Limites connues

- **Formats anciens (`.doc` / `.ppt`, avant 2007)** : non pris en charge. Ouvrez-les dans Word/PowerPoint et enregistrez en `.docx` / `.pptx`.
- **OCR** : français uniquement. La qualité dépend de celle du scan ou de la photo : le texte reconnu est signalé « à relire », avec la confiance moyenne. Les lignes illisibles (texte des captures d'écran) sont retirées et leur nombre est indiqué ; le texte en gros caractères d'une capture reste parfois lu, comme un titre. Une page est reconnue comme scannée si elle contient une image et presque pas de texte : une page mêlant texte et passage scanné n'est pas détectée. Sur une photo de quelques lignes, la séparation entre paragraphes est approximative.
- **Structure des PDF** : un PDF ne contient que du texte positionné ; titres et paragraphes sont déduits de la mise en page (taille de police, interlignes). Les mises en page complexes (plusieurs colonnes, tableaux) sont restituées imparfaitement. Un mot coupé en fin de ligne garde son trait d'union (« collec-tivités ») : sans dictionnaire, impossible de le distinguer d'un mot composé (« porte-monnaie »).
- **Courriels** : format `.eml` uniquement, produit par Thunderbird, Outlook sur le web et le nouvel Outlook (*Télécharger*). L'Outlook classique enregistre en `.msg`, format non pris en charge. Les images distantes d'un courriel (souvent des pixels de suivi) ne sont pas recopiées, seul leur texte alternatif est gardé.
- **Livres numériques** : les `.epub` protégés par DRM ne sont pas lisibles.
- **Images `.emf` / `.wmf`** (fréquentes dans les documents Office anciens) : extraites telles quelles, mais la plupart des lecteurs Markdown ne les affichent pas.
- **Première visite** : une connexion internet est nécessaire pour télécharger les composants de l'outil (environ 3 Mo, une seule fois), plus environ 5 Mo au premier usage de l'OCR. Tout reste ensuite disponible hors ligne.

---

## 🚀 Hébergement local (optionnel)

Si vous préférez héberger l'outil sur votre propre serveur ou en local :

```bash
# Cloner le repo
git clone https://github.com/brissonjo-sudo/my-personal-digital-space.git
cd my-personal-digital-space

# Aucune dépendance à installer : servir le dossier suffit
python -m http.server 8000   # puis ouvrir http://localhost:8000
```

Ouvert directement (double-clic sur `index.html` dans le dossier complet, sans serveur), l'outil fonctionne aussi, mais **sans mode hors ligne garanti** : celui-ci repose sur un service worker, que les navigateurs n'activent qu'à travers un serveur (le lien en ligne, ou un serveur local comme ci-dessus).

---

## 🏗️ Architecture technique

- **Un dossier, zéro build** :
  - `index.html` — coquille : sécurité (CSP), bibliothèques, barre latérale
  - `commun/` — routeur entre modules (`#/convertir`…), passerelle de fichiers en mémoire, jetons et styles communs (`style.css`, identité « Registre » : marine sobre, thème sombre automatique), icônes SVG au trait (`icones.js`, aucune bibliothèque) et `polices/` (voir ci-dessous)
  - `modules/<nom>/` — un dossier par module (scripts et styles). Module PDF : `pages.js` (modèle des pages affichées), `export.js` (reconstruit un PDF neuf), `miniatures.js`, `actions.js`, `annotations.js` (annotations par page, en points PDF, pile d'annulation), `calque.js` (calque SVG et gestes), `outils.js` (barre d'outils, raccourcis), `detourage.js` (contrôle et détourage de l'image de signature), `signature.js` (fenêtre de signature), `coffre.js` (signature enregistrée, chiffrée), `tampons.js` (catalogue, rendu, export des tampons), `formulaire.js` (détection, valeurs et couche de saisie des formulaires), `formulaire-export.js` (valeurs appliquées puis aplaties à l'export), `gabarit.js` (balisage de l'écran), `visionneuse.js`, `molette.js` (zoom et changement de page à la molette), `coordonnees.js` (point d'affichage ↔ point PDF), `texte.js` (contrôle de l'encodage WinAnsi du texte dessiné), `trame.js` (page rendue en image, zones caviardées noircies dans les pixels), `recherche.js` (recherche de texte pour le caviardage et contrôle du fichier exporté) et `caviardage.js` (panneau « Rechercher et caviarder »). Module Images : `metadonnees.js` (format reconnu aux premiers octets, retrait sans perte des métadonnées JPEG et PNG par liste blanche), `traitement.js` (décodage, redimensionnement, encodage par Canvas, contrôle du fichier produit, `.zip`) et `images.js` (interface)
  - Le dossier complet fonctionne aussi ouvert depuis le disque (`file://`), sans le mode hors ligne : scripts classiques uniquement, pas de modules ES
  - `sw.js` — service worker : cache hors ligne (fichier séparé obligatoire, doit être servi en HTTP(S) même-origine)
  - `manifest.webmanifest` — manifeste PWA (installation)
  - `icone.svg` — icône de l'application
- **Zéro framework** : JavaScript vanilla, pas de webpack, pas de build
- **Conversions lourdes déléguées** : les tableurs / CSV / PowerPoint / OpenDocument sont parsés dans un **Web Worker** (construit à partir de la fonction `codePartage()` de `modules/convertir/partage.js`, sans duplication de code), avec repli automatique sur le fil principal si le worker ne peut pas démarrer
- **Hors ligne (PWA)** : le service worker met en cache les bibliothèques à la première visite, et les fichiers de l'OCR à son premier usage
- **Bibliothèques tierces** : chargées depuis [cdnjs.cloudflare.com](https://cdnjs.com), [cdn.sheetjs.com](https://cdn.sheetjs.com) pour SheetJS (plus publié sur cdnjs depuis la 0.18.5, vulnérable) et [jsDelivr](https://www.jsdelivr.com) pour l'OCR et l'écriture de PDF, versions épinglées, empreintes SRI vérifiées
- **Écriture de PDF** : [`@cantoo/pdf-lib`](https://github.com/cantoo-scribe/pdf-lib) 2.11.1 (fork maintenu de pdf-lib, qui n'est plus publié depuis 2021 et ne sait pas ouvrir un PDF chiffré, comme beaucoup de Cerfa). Chargée **à la demande** au premier enregistrement (≈ 600 Ko) : `MPDS.chargerScript` télécharge le fichier, vérifie son empreinte SRI, puis l'exécute depuis une URL `blob:`. Elle n'a donc pas de balise dans la page et la CSP est inchangée
- **Polices auto-hébergées** : Source Serif 4 (titres) et Source Sans 3 (texte), sous-ensemble latin en woff2 dans `commun/polices/`, installées depuis les paquets npm `@fontsource/*` 5.3.1. Aucune requête vers un service de polices (la CSP n'autorise que `font-src 'self'`). Licence SIL Open Font License 1.1 : `commun/polices/LICENCE-OFL.txt`
- **Accessibilité** : navigation clavier complète, contrastes vérifiés par un test (4,5:1 pour le texte, 3:1 pour les contrôles et le focus, thèmes clair et sombre), cibles d'au moins 36 px, focus visible, focus piégé dans la fenêtre d'aperçu, attributs ARIA, journal annoncé aux lecteurs d'écran (`aria-live`)
- **Compatibilité** : Chrome, Edge et Firefox récents ; tests automatisés sous Chromium

### Sécurité

- ✅ Conversion 100 % côté client (zéro requête réseau pour les fichiers)
- ✅ CSP : la page ne peut se connecter qu'à elle-même et aux trois CDN ci-dessus, en lecture seule (vérifié par des tests qui tentent des fuites)
- ✅ SRI : toute bibliothèque, y compris celles chargées par les workers, l'OCR et l'écriture de PDF, est vérifiée par son empreinte ; la CI compare ces empreintes aux fichiers réellement servis par les CDN
- ✅ Données de langue de l'OCR : ce sont des données, pas du code, et elles ne sont pas vérifiées par empreinte ; la CSP garantit qu'elles ne peuvent venir que de jsDelivr
- ✅ Construction DOM sécurisée (pas d'`innerHTML` avec données externes → pas de XSS)
- ✅ HTML malveillant neutralisé (DOMParser inerte, `<script>`/`<style>` retirés)
- ✅ Liens exécutables (`javascript:`, `vbscript:`, `data:`) retirés du Markdown produit : un clic dans votre éditeur ne peut rien exécuter
- ✅ Pièces jointes des courriels : noms rendus sûrs (un nom piégé « ../ » ne peut pas sortir de son dossier à l'extraction du ZIP) ; images distantes non recopiées
- ✅ Polices servies par l'application elle-même : aucun domaine de polices externe, vérifié par un test
- ✅ Validation par tests automatisés en navigateur (Playwright), à chaque modification

### Tests

Une suite de tests Playwright (`tests/`) vérifie chaque format de bout en bout dans Chromium : fichiers générés à la volée (PDF, PDF scanné, photo, Word, PowerPoint, Excel, LibreOffice, courriel, EPUB), fichiers réels produits par LibreOffice et pandoc (`tests/fichiers/`, régénérables par `generer.sh`), contenu exact du Markdown produit, archives ZIP téléchargées, Web Worker et repli, OCR, collage, fonctionnement hors ligne, confidentialité (CSP et SRI). Tout test échoue s'il provoque une violation de la CSP ou un échec de vérification d'empreinte. Elle tourne **sans réseau** : un petit serveur de test (`tests/serveur.js`) sert l'application en remplaçant les CDN par les mêmes versions des bibliothèques, installées via npm.

Les tests se lancent automatiquement sur GitHub à chaque pull request et à chaque modification de `main`, avec une vérification des empreintes SRI contre les fichiers réellement servis par les CDN (`tests/verifier-cdn.js`). Pour les lancer localement :

```bash
npm install                          # outillage de test uniquement
npx playwright install chromium
npm test
```

---

## 🛠️ Contribuer

Pour modifier l'outil :

1. **Modification rapide via GitHub** : cliquez sur le crayon ✏️ sur le fichier concerné, éditez, commit. L'URL se met à jour en 1-2 min.
2. **Modification locale** : `git clone`, modifier, `git push`. Idem.

L'application ne demande ni compilation ni dépendance : `package.json` ne sert qu'aux tests (voir ci-dessus), qui vérifient automatiquement chaque pull request.

> **Note (bibliothèques et service worker)** : modifier `index.html`, `commun/` ou `modules/` ne demande rien de particulier — ces fichiers sont servis « réseau d'abord », la nouvelle version s'affiche au rechargement suivant. En revanche, si vous **changez la version d'une bibliothèque CDN** :
> 1. mettez à jour son URL **et son empreinte** dans `index.html` (attribut `integrity` de la balise) ou dans la table `INTEGRITE` (`modules/convertir/convertir.js`) ; `node tests/verifier-cdn.js` donne l'empreinte réelle ;
> 2. mettez à jour l'URL dans `sw.js` (`PRECACHE`) et incrémentez sa constante `VERSION` pour purger l'ancien cache ;
> 3. pour les tests, épinglez la même version dans `package.json` (SheetJS : archive `https://cdn.sheetjs.com/xlsx-<version>/xlsx-<version>.tgz`, l'éditeur ne publiant plus sur npm).

---

## 📅 Roadmap (idées, non engageant)

- ✅ Module PDF : visionneuse, pages, annotations
- ✅ Module PDF : signer, tamponner
- ✅ Module PDF : formulaires
- ✅ Images : compresser, redimensionner, convertir, retirer les métadonnées
- ✅ PDF : caviarder
- 🔭 PDF : compresser
- 🔭 Markdown → Word / PDF
- 🔭 Outils texte : comparer, nettoyer, anonymiser
- 🔭 OCR dans d'autres langues que le français
- 🔭 Courriels Outlook `.msg`
- 🔭 Interface mobile optimisée (actuellement responsive mais perfectible)

---

## 📜 Licence

MIT — voir le fichier `LICENSE`. Utilisez, modifiez, partagez librement.

---

*Outil développé pour faciliter la rédaction et l'archivage de documents administratifs.*
