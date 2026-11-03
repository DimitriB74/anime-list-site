// Journal des modifications faites depuis le téléphone, partagé par le navigateur et le PC.
// Le site publié est statique : le téléphone ne peut pas écrire dans la base. Il ajoute donc des
// « opérations » à un fichier modifications.json du dépôt GitHub ; le PC les rejoue dans la base
// (npm run publier) puis vide le fichier.
//
// Opération = { id, op, ... } avec id unique (rejeu sans effet) :
//   { op: 'ajout', cid, corps }       cid = horodatage entier ; l'entrée porte l'id temporaire -cid
//   { op: 'maj',   cible, corps }     cible = id de l'entrée (négatif = entrée créée par un 'ajout')
//   { op: 'suppr', cible }

export const FICHIER_JOURNAL = 'modifications.json';

const DEFAUTS = {
  titre_officiel: null, type: 'serie', statut: 'a_voir', episodes_vus: null, episodes_total: null,
  note: null, note_estimee: false, commentaire: '', tags: [], periode: null, affiche: null,
  synopsis: null, genres: [], annee: null, anilist_id: null, visionnages: 1,
};

export const idOperation = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// Une note saisie à la main n'est plus « estimée » (même règle que la validation côté serveur).
function normaliser(corps) {
  const c = { ...corps };
  if ('note' in c && !('note_estimee' in c)) c.note_estimee = false;
  if ('note_estimee' in c) c.note_estimee = !!c.note_estimee;
  return c;
}

// Applique des opérations sur une copie de la liste. Tolérant : une cible absente est ignorée.
export function appliquerOps(liste, ops) {
  let res = liste.map((a) => ({ ...a }));
  const vus = new Set();
  for (const o of ops) {
    if (!o || vus.has(o.id)) continue;
    vus.add(o.id);
    if (o.op === 'ajout') {
      const id = -o.cid;
      if (res.some((a) => a.id === id)) continue;
      const ordre = res.reduce((m, a) => Math.max(m, a.ordre ?? 0), -1) + 1;
      res.push({ ...DEFAUTS, tags: [], genres: [], ...normaliser(o.corps), id, ordre, source: 'telephone' });
    } else if (o.op === 'maj') {
      const a = res.find((x) => x.id === o.cible);
      if (a) Object.assign(a, normaliser(o.corps));
    } else if (o.op === 'suppr') {
      res = res.filter((x) => x.id !== o.cible);
    }
  }
  return res;
}

// Champs d'une fiche AniList à recopier sur une entrée (même règle que le serveur : ne remplace
// pas un nombre d'épisodes déjà connu).
export function champsDepuisMedia(media, existant = {}) {
  return {
    titre_officiel: media.titre,
    affiche: media.affiche,
    synopsis: media.synopsis,
    genres: media.genres,
    annee: media.annee ?? null,
    anilist_id: media.id,
    episodes_total: existant.episodes_total ?? media.episodes ?? null,
  };
}
