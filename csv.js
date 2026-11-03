// Export CSV de toute la liste (Animé, Lecture, Film/Séries). Module sans DOM : testé par `npm test`.
// Pensé pour Excel en français : séparateur « ; », UTF-8 avec BOM (accents), notes à virgule décimale, lignes en CRLF.
// Tri : catégorie, type, statut (dans l'ordre du site), puis titre A → Z.

const SEPARATEUR = ';';

// Excel / LibreOffice liraient une cellule texte commençant par = + - @ comme une formule : on la préfixe d'une apostrophe.
const neutraliser = (s) => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s);

function cellule(valeur, texte = true) {
  if (valeur == null) return '';
  let s = String(valeur);
  if (texte) s = neutraliser(s);
  return /[";\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

const liste = (v) => (Array.isArray(v) ? v.join(' | ') : (v ?? ''));

// [en-tête, valeur de la cellule, cellule de texte ?] : les champs longs sont à la fin.
const colonnes = (ctx) => [
  ['Catégorie', (a) => ctx.categories[ctx.categorieDe(a.type)].libelle],
  ['Type', (a) => ctx.types[a.type] ?? a.type],
  ['Titre', (a) => a.titre],
  ['Statut', (a) => ctx.libelleStatut(a.type, a.statut)],
  ['Note (/5)', (a) => (a.note == null ? '' : String(a.note).replace('.', ',')), false],
  ['Note estimée', (a) => (a.note != null && a.note_estimee ? 'oui' : '')],
  ['Année du 1er visionnage', (a) => a.periode],
  ['Visionnages', (a) => a.visionnages, false],
  ['Épisodes vus', (a) => a.episodes_vus, false],
  ['Épisodes total', (a) => a.episodes_total, false],
  ['Durée (min)', (a) => a.duree, false],
  ['Année de sortie', (a) => a.annee, false],
  ['Étiquettes', (a) => liste(a.tags)],
  ['Genres', (a) => liste(a.genres)],
  ['Titre officiel', (a) => a.titre_officiel],
  ['Commentaire', (a) => a.commentaire],
  ['Synopsis', (a) => a.synopsis],
  ['Affiche (URL)', (a) => a.affiche],
  ['AniList (id)', (a) => a.anilist_id, false],
  ['Ajouté le', (a) => a.cree_le, false],
  ['Modifié le', (a) => a.maj_le, false],
  ['Ordre dans ma liste', (a) => a.ordre, false],
];

// ctx : { categories, types, statuts (clés dans l'ordre d'affichage), categorieDe(type), libelleStatut(type, statut) }
// fournis par app.js, qui reste la seule source des libellés.
export function construireCsv(animes, ctx) {
  const cols = colonnes(ctx);
  const ordreCat = Object.keys(ctx.categories);
  const rang = (a) => {
    const cat = ctx.categorieDe(a.type);
    return [ordreCat.indexOf(cat), ctx.categories[cat].types.indexOf(a.type), ctx.statuts.indexOf(a.statut)];
  };
  const tries = [...animes].sort((a, b) => {
    const ra = rang(a);
    const rb = rang(b);
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] - rb[i];
    return String(a.titre).localeCompare(String(b.titre), 'fr', { numeric: true, sensitivity: 'base' }) || a.id - b.id;
  });
  const lignes = [cols.map(([entete]) => cellule(entete, false)).join(SEPARATEUR)];
  for (const a of tries) lignes.push(cols.map(([, valeur, texte]) => cellule(valeur(a), texte !== false)).join(SEPARATEUR));
  return `﻿${lignes.join('\r\n')}\r\n`;
}

// ma-liste-2026-11-03.csv (date locale)
export function nomFichierCsv(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `ma-liste-${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}.csv`;
}
