// Module PDF — annotations : modèle et pile d'annulation (une par document). Les annotations sont
// rattachées à l'entrée de page du modèle (page.annots) : elles suivent la page quand on la déplace,
// la pivote ou la supprime. Coordonnées en POINTS PDF (espace utilisateur, voir coordonnees.js) :
//   surlig : { type, x, y, w, h (coin bas-gauche, w/h > 0), couleur '#rrggbb', opacite 0–1 }
//   texte  : { type, x, y (début de la ligne de base), texte, police (clé de StandardFonts), taille,
//              couleur, angle (sens de lecture, degrés anti-horaires : celui de la rotation affichée) }
//   dessin : { type, pts [[x, y], …], couleur, epaisseur }
// Publie MPDS.pdfAnnotations.creer(modele, surChangement(page)).
(() => {
  'use strict';

  function creer(modele, surChangement) {
    let faits = [], defaits = [], suivant = 0;   // commandes : { op: 'ajout'|'suppr'|'dep', page, a, i | avant, apres }
    const vivante = c => modele.liste.includes(c.page);

    // sens > 0 : exécuter la commande ; sens < 0 : la défaire
    function appliquer(c, sens) {
      const liste = c.page.annots;
      if (c.op === 'dep') { Object.assign(c.a, sens > 0 ? c.apres : c.avant); return; }
      if ((c.op === 'ajout') === (sens > 0)) liste.splice(Math.min(c.i, liste.length), 0, c.a);
      else { const i = liste.indexOf(c.a); if (i >= 0) liste.splice(i, 1); }
    }
    function terminer(c) { modele.marquerModifie(); surChangement(c.page); }
    function faire(c) { appliquer(c, 1); faits.push(c); defaits = []; terminer(c); }

    // Rejoue la dernière commande dont la page existe encore (une page supprimée est ignorée)
    function rejouer(de, vers, sens) {
      let c;
      do c = de.pop(); while (c && !vivante(c));
      if (!c) return false;
      appliquer(c, sens); vers.push(c); terminer(c);
      return true;
    }

    return {
      ajouter(page, a) { a.id = ++suivant; faire({ op: 'ajout', page, a, i: page.annots.length }); return a; },
      supprimer(page, a) { const i = page.annots.indexOf(a); if (i >= 0) faire({ op: 'suppr', page, a, i }); },
      // avant/apres : géométrie ({ x, y } ou { pts }) ; l'annotation vient d'être déplacée en direct
      deplacer(page, a, avant, apres) { faire({ op: 'dep', page, a, avant, apres }); },
      annuler: () => rejouer(faits, defaits, -1),
      retablir: () => rejouer(defaits, faits, 1),
      peutAnnuler: () => faits.some(vivante),
      peutRetablir: () => defaits.some(vivante),
      vider() { faits = []; defaits = []; },
    };
  }

  MPDS.pdfAnnotations = { creer };
})();
