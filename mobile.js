// Édition depuis le téléphone, sans serveur : AniList (recherche de fiches) et GitHub (journal).
// Le jeton GitHub ne quitte jamais ce navigateur (localStorage) et n'est envoyé qu'à api.github.com.
import { FICHIER_JOURNAL } from './journal.js';

const URL_ANILIST = 'https://graphql.anilist.co';
const URL_GITHUB = 'https://api.github.com';
const CHAMPS = `id title { romaji english native } format episodes seasonYear genres description(asHtml: false) coverImage { large }`;

const stockage = {
  lire(k) { try { return localStorage.getItem(k); } catch { return null; } },
  ecrire(k, v) { try { localStorage.setItem(k, v); } catch { /* navigation privée */ } },
  effacer(k) { try { localStorage.removeItem(k); } catch { /* idem */ } },
};

// ---------- AniList ----------

async function anilist(query, variables) {
  const r = await fetch(URL_ANILIST, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(15000),
  });
  if (r.status === 429) throw new Error('AniList : trop de requêtes, réessaie dans une minute.');
  if (!r.ok) throw new Error(`AniList : HTTP ${r.status}`);
  const j = await r.json();
  if (j.errors) throw new Error(`AniList : ${j.errors[0].message}`);
  return j.data;
}

function nettoyerSynopsis(s) {
  if (!s) return null;
  return s.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#039;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n').trim().slice(0, 2000);
}

const versMedia = (m) => ({
  id: m.id,
  titre: m.title.romaji || m.title.english || m.title.native,
  format: m.format,
  episodes: m.episodes,
  annee: m.seasonYear,
  genres: m.genres || [],
  synopsis: nettoyerSynopsis(m.description),
  affiche: m.coverImage?.large || null,
});

export async function chercherAnilist(q, n = 6) {
  q = String(q).normalize('NFD').replace(/[̀-ͯ]/g, ''); // AniList ne trouve rien avec les accents
  const data = await anilist(
    `query ($q: String, $n: Int) { Page(perPage: $n) { media(search: $q, type: ANIME, isAdult: false, sort: SEARCH_MATCH) { ${CHAMPS} } } }`,
    { q, n });
  return data.Page.media.map(versMedia);
}

export async function detailAnilist(id) {
  const data = await anilist(`query ($id: Int) { Media(id: $id, type: ANIME) { ${CHAMPS} } }`, { id });
  return versMedia(data.Media);
}

// ---------- GitHub : le journal vit dans modifications.json du dépôt ----------

// Sur GitHub Pages (<compte>.github.io/<dépôt>/) le dépôt se déduit de l'adresse ; en local,
// il faut le donner (localStorage « depot », ex. « compte/anime-list-site »).
export function depot() {
  const m = location.hostname.match(/^([^.]+)\.github\.io$/i);
  const dossier = location.pathname.split('/').filter(Boolean)[0];
  if (m && dossier && !dossier.includes('.')) return `${m[1]}/${dossier}`;
  return stockage.lire('depot');
}

const octets = (txt) => new TextEncoder().encode(txt);
function versBase64(txt) {
  let bin = '';
  const o = octets(txt);
  for (let i = 0; i < o.length; i += 0x8000) bin += String.fromCharCode(...o.subarray(i, i + 0x8000));
  return btoa(bin);
}
const depuisBase64 = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0)));

async function github(chemin, { methode = 'GET', corps, jeton } = {}) {
  const r = await fetch(`${URL_GITHUB}/repos/${depot()}${chemin}`, {
    method: methode,
    headers: {
      Authorization: `Bearer ${jeton}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
      ...(corps ? { 'Content-Type': 'application/json' } : {}),
    },
    body: corps ? JSON.stringify(corps) : undefined,
    cache: 'no-store',
    signal: AbortSignal.timeout(20000),
  });
  const donnees = await r.json().catch(() => ({}));
  return { statut: r.status, ok: r.ok, donnees };
}

export const jeton = () => stockage.lire('jeton-github');

export async function activer(valeur) {
  valeur = String(valeur).trim();
  if (!depot()) throw new Error("Dépôt GitHub inconnu : ouvre le site depuis son adresse github.io.");
  if (!valeur) throw new Error('Colle le jeton GitHub.');
  const r = await github('', { jeton: valeur }).catch(() => { throw new Error('GitHub injoignable (connexion ?).'); });
  if (r.statut === 401) throw new Error('Jeton refusé par GitHub (expiré ou mal copié).');
  if (!r.ok) throw new Error(`GitHub a répondu ${r.statut} : le jeton n'a pas accès à ce dépôt.`);
  if (!r.donnees.permissions?.push) throw new Error('Ce jeton ne peut pas écrire dans le dépôt (permission « Contents : Read and write » manquante).');
  stockage.ecrire('jeton-github', valeur);
}

export function desactiver() { stockage.effacer('jeton-github'); }

async function lireJournalDistant(j) {
  const r = await github(`/contents/${FICHIER_JOURNAL}`, { jeton: j });
  if (r.statut === 404) return { ops: [], sha: null };
  if (r.statut === 401) throw new Error("Jeton refusé ou expiré : désactive puis réactive l'édition avec un nouveau jeton.");
  if (!r.ok) throw new Error(`Journal illisible (GitHub ${r.statut}).`);
  let ops = [];
  try { const parsed = JSON.parse(depuisBase64(r.donnees.content)); if (Array.isArray(parsed.ops)) ops = parsed.ops; } catch { /* fichier vide ou abîmé : on repart de zéro */ }
  return { ops, sha: r.donnees.sha };
}

export async function chargerJournal() {
  const j = jeton();
  return j ? (await lireJournalDistant(j)).ops : [];
}

// ---------- File d'attente locale (fonctionne hors connexion) ----------

// Gardée en mémoire et recopiée dans localStorage : en navigation privée, l'envoi marche quand même.
let memoire = [];
try { const v = JSON.parse(stockage.lire('file-modifications') || '[]'); if (Array.isArray(v)) memoire = v; } catch { /* file abîmée : on repart de zéro */ }

export const file = {
  lire: () => memoire,
  ecrire(ops) { memoire = ops; stockage.ecrire('file-modifications', JSON.stringify(ops)); },
  ajouter(op) { this.ecrire([...memoire, op]); },
};

let envoiEnCours = null;

// Envoie la file sur GitHub (une écriture de modifications.json) ; en cas d'échec elle est conservée.
export function envoyerFile() {
  envoiEnCours ??= (async () => {
    const j = jeton();
    if (!j || !file.lire().length) return { envoyees: 0 };
    for (let essai = 0; essai < 3; essai++) {
      const aEnvoyer = file.lire();
      if (!aEnvoyer.length) return { envoyees: 0 };
      const { ops, sha } = await lireJournalDistant(j);
      const connus = new Set(ops.map((o) => o.id));
      const total = [...ops, ...aEnvoyer.filter((o) => !connus.has(o.id))];
      const r = await github(`/contents/${FICHIER_JOURNAL}`, {
        methode: 'PUT', jeton: j,
        corps: {
          message: `Modifications depuis le téléphone (${aEnvoyer.length})`,
          content: versBase64(JSON.stringify({ ops: total }, null, 1)),
          ...(sha ? { sha } : {}),
        },
      });
      if (r.ok) {
        const envoyes = new Set(aEnvoyer.map((o) => o.id));
        file.ecrire(file.lire().filter((o) => !envoyes.has(o.id))); // garde ce qui a été ajouté pendant l'envoi
        return { envoyees: aEnvoyer.length, journal: total };
      }
      if (r.statut !== 409 && r.statut !== 422) throw new Error(`GitHub a refusé l'écriture (${r.statut}) ${r.donnees.message || ''}`.trim());
      // 409/422 : le journal a changé entre la lecture et l'écriture -> on relit et on réessaie
    }
    throw new Error('Le journal change trop vite, réessaie.');
  })().finally(() => { envoiEnCours = null; });
  return envoiEnCours;
}
