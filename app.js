// Interface de la liste d'animés. Aucune dépendance : DOM natif, textContent partout (pas d'innerHTML).
import { appliquerOps, champsDepuisMedia, idOperation } from './journal.js';
import * as mobile from './mobile.js';

const STATUTS = {
  vu: { libelle: 'Vu', couleur: 'var(--st-vu)' },
  en_cours: { libelle: 'En cours', couleur: 'var(--st-en_cours)' },
  a_voir: { libelle: 'À voir', couleur: 'var(--st-a_voir)' },
  abandonne: { libelle: 'Abandonné', couleur: 'var(--st-abandonne)' },
};
const TYPES = { serie: 'Animé', film: "Film d'animation", cinema: 'Film', serietv: 'Série', livre: 'Livre', manga: 'Manga', manhwa: 'Manhwa' };
const estSerie = (type) => type === 'serie' || type === 'serietv'; // des épisodes plutôt qu'une durée
const TYPES_COURT = { film: 'Film anim.' }; // pastille sur l'affiche
// Trois grandes catégories. `statuts` : ceux qui ont un sens dans la catégorie ; `defaut` : statut affiché d'abord.
const CATEGORIES = {
  anime: { libelle: 'Animé', types: ['serie', 'film'], statuts: ['vu', 'en_cours', 'a_voir', 'abandonne'], defaut: 'vu', recherche: 'anime' },
  lecture: { libelle: 'Lecture', types: ['livre', 'manga', 'manhwa'], statuts: ['vu', 'a_voir'], defaut: '', recherche: 'manga' },
  film: { libelle: 'Film', types: ['cinema', 'serietv'], statuts: ['vu', 'a_voir'], defaut: 'vu', recherche: null },
};
const categorieDe = (type) => Object.keys(CATEGORIES).find((c) => CATEGORIES[c].types.includes(type)) ?? 'anime';
// « Vu » devient « Lu » pour une lecture ; « À voir » devient « À lire ».
const LIBELLES_LECTURE = { vu: 'Lu', a_voir: 'À lire' };
const libelleStatut = (type, statut) => (categorieDe(type) === 'lecture' && LIBELLES_LECTURE[statut]) || STATUTS[statut].libelle;
const MIN_PAR_EPISODE = 24; // hypothèse pour l'estimation des heures (affichée comme telle)
const MIN_PAR_EPISODE_TV = 50; // série en prises de vues réelles (valeur donnée dans ta liste : « épisode = 50 min »)

// 112 -> « 1 h 52 » ; 45 -> « 45 min »
const formaterDuree = (min) => (min >= 60 ? `${Math.floor(min / 60)} h${String(min % 60).padStart(2, '0')}` : `${min} min`);
// Année du premier visionnage (champ « periode » : « 2021 », « Avant 2020 »).
const texteAnnee = (a) => (a.periode && a.statut !== 'a_voir' ? (/^\d{4}(-\d{4})?$/.test(a.periode) ? `Vu en ${a.periode}` : `Vu ${a.periode.toLowerCase()}`) : null);

const $ = (s, r = document) => r.querySelector(s);
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function h(tag, attrs = {}, ...enfants) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const e of enfants.flat()) if (e != null && e !== false) el.append(e);
  return el;
}

const stockage = {
  lire(k, defaut) { try { return localStorage.getItem(k) ?? defaut; } catch { return defaut; } },
  ecrire(k, v) { try { localStorage.setItem(k, v); } catch { /* navigation privée */ } },
};

const etat = {
  animes: [],
  admin: false,
  adminDispo: false,
  statique: false, // site publié sur GitHub Pages : pas de serveur, édition par journal GitHub
  base: [], // animes.json tel que publié (mode statique)
  opsDistantes: [], // journal déjà envoyé sur GitHub, pas encore rejoué sur le PC
  synchro: { envoi: false, erreur: '' },
  onglet: 'anime', // 'anime' | 'lecture' | 'film' | 'stats'
  cat: 'anime', // catégorie dont la collection est affichée (dernière catégorie ouverte, même sur « stats »)
  vue: stockage.lire('vue', 'grille'),
  f: { q: '', statut: 'vu', type: '', tag: '', periode: '', genre: '' },
  tri: 'ordre',
};

// ---------- Réseau ----------

async function api(url, options = {}) {
  if (etat.statique && url.startsWith('/api/')) return apiMobile(url, options);
  const r = await fetch(url, {
    ...options,
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (r.status === 204) return null;
  const donnees = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(donnees.erreur || `Erreur ${r.status}`);
  return donnees;
}

// ---------- Édition sans serveur (site GitHub Pages sur téléphone) ----------
// Les mêmes appels /api/... que sur le PC sont traduits en opérations du journal (voir journal.js).

const opsActives = () => [...etat.opsDistantes, ...mobile.file.lire()];
const recalculer = () => { etat.animes = appliquerOps(etat.base, opsActives()); };

function majPied() {
  const info = $('#pied-info');
  if (!etat.admin) { info.textContent = 'Lecture seule.'; return; }
  if (!etat.statique) { info.textContent = 'Mode édition : clique sur une fiche pour la modifier.'; return; }
  const n = mobile.file.lire().length;
  const etatEnvoi = etat.synchro.envoi ? 'envoi à GitHub…'
    : n > 0 ? `${n} modification${n > 1 ? 's' : ''} pas encore envoyée${n > 1 ? 's' : ''}` : 'tout est envoyé à GitHub';
  info.replaceChildren(...[
    `Édition sur téléphone : ${etatEnvoi}`,
    etat.synchro.erreur ? h('span', { class: 'erreur' }, ` (${etat.synchro.erreur})`) : null,
    n > 0 && !etat.synchro.envoi ? ' ' : null,
    n > 0 && !etat.synchro.envoi ? h('button', { type: 'button', class: 'discret', onclick: envoyer }, 'Réessayer') : null,
  ].filter(Boolean));
}

async function envoyer() {
  if (etat.synchro.envoi || !mobile.file.lire().length) { majPied(); return; }
  etat.synchro = { envoi: true, erreur: '' };
  majPied();
  try {
    const r = await mobile.envoyerFile();
    if (r.journal) etat.opsDistantes = r.journal;
  } catch (e) {
    etat.synchro.erreur = e.message;
  }
  etat.synchro.envoi = false;
  majPied();
  if (!etat.synchro.erreur && mobile.file.lire().length) envoyer(); // ajoutées pendant l'envoi
}

async function enregistrerOp(op) {
  mobile.file.ajouter({ id: idOperation(), le: new Date().toISOString(), ...op });
  recalculer();
  envoyer(); // sans attendre : la modification est déjà visible, l'envoi se fait en arrière-plan
}

async function apiMobile(url, { method = 'GET', body } = {}) {
  if (!mobile.jeton()) throw new Error("L'édition n'est pas activée sur ce téléphone.");
  const u = new URL(url, location.href);
  const trouve = (id) => etat.animes.find((a) => a.id === id);
  if (u.pathname === '/api/anilist/recherche') {
    const q = (u.searchParams.get('q') || '').trim().slice(0, 100);
    return q.length < 2 ? [] : mobile.chercherAnilist(q, u.searchParams.get('genre') === 'manga' ? 'manga' : 'anime');
  }
  const genreDe = (type) => CATEGORIES[categorieDe(type)].recherche ?? 'anime';
  if (method === 'POST' && u.pathname === '/api/animes') {
    let corps = { ...body };
    if (corps.anilist_id) corps = { ...champsDepuisMedia(await mobile.detailAnilist(corps.anilist_id, genreDe(corps.type)), corps), ...corps };
    const cid = Date.now();
    await enregistrerOp({ op: 'ajout', cid, corps });
    return trouve(-cid);
  }
  const m = u.pathname.match(/^\/api\/animes\/(-?\d+)(\/associer)?$/);
  if (m) {
    const cible = Number(m[1]);
    const a = trouve(cible);
    if (!a) throw new Error('Anime introuvable.');
    if (method === 'PUT' && !m[2]) { await enregistrerOp({ op: 'maj', cible, corps: body }); return trouve(cible); }
    if (method === 'DELETE' && !m[2]) { await enregistrerOp({ op: 'suppr', cible }); return null; }
    if (method === 'POST' && m[2]) {
      const media = await mobile.detailAnilist(body?.anilist_id, genreDe(a.type));
      await enregistrerOp({ op: 'maj', cible, corps: champsDepuisMedia(media, a) });
      return trouve(cible);
    }
  }
  throw new Error('Action indisponible sur téléphone.');
}

let minuterieToast;
function toast(message, erreur = false) {
  const t = $('#toast');
  t.textContent = message;
  t.classList.toggle('erreur-toast', erreur);
  t.classList.add('visible');
  clearTimeout(minuterieToast);
  minuterieToast = setTimeout(() => t.classList.remove('visible'), erreur ? 5000 : 2500);
}

// ---------- Éléments réutilisables ----------

function etoiles(note, { estimee = false, editable = false, onChange } = {}) {
  const conteneur = h('span', {
    class: `etoiles${editable ? ' editable' : ''}${estimee ? ' estimee' : ''}`,
    role: editable ? 'slider' : 'img',
    tabindex: editable ? '0' : null,
    'aria-label': note == null ? 'Pas de note' : `Note : ${note} sur 5`,
    'aria-valuemin': editable ? '0' : null,
    'aria-valuemax': editable ? '5' : null,
    'aria-valuenow': editable ? String(note ?? 0) : null,
    title: estimee && note != null ? 'Note estimée automatiquement depuis ta liste' : null,
  });
  const rempli = h('span', { class: 'etoiles-rempli', 'aria-hidden': 'true' }, '★★★★★');
  rempli.style.width = `${(note ?? 0) * 20}%`;
  conteneur.append(h('span', { class: 'etoiles-fond', 'aria-hidden': 'true' }, '★★★★★'), rempli);
  if (editable) {
    const choisir = (v) => {
      const valeur = Math.min(5, Math.max(0.5, v));
      rempli.style.width = `${valeur * 20}%`;
      conteneur.setAttribute('aria-valuenow', String(valeur));
      onChange(valeur);
    };
    conteneur.addEventListener('click', (e) => {
      const r = conteneur.getBoundingClientRect();
      choisir(Math.ceil(((e.clientX - r.left) / r.width) * 10) / 2);
    });
    conteneur.addEventListener('keydown', (e) => {
      const actuel = Number(conteneur.getAttribute('aria-valuenow')) || 0;
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); choisir(actuel + 0.5); }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); choisir(actuel - 0.5); }
    });
  }
  return conteneur;
}

function teinte(titre) {
  let n = 0;
  for (const c of titre) n = (n * 31 + c.codePointAt(0)) % 360;
  return n;
}

function initiales(titre) {
  const mots = titre.replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean);
  return (mots.length > 1 ? mots[0][0] + mots[1][0] : (mots[0] ?? '?').slice(0, 2)).toUpperCase();
}

function affiche(a) {
  const conteneur = h('div', { class: 'affiche' });
  const vide = () => {
    const v = h('div', { class: 'affiche-vide' }, initiales(a.titre));
    v.style.background = `linear-gradient(145deg, hsl(${teinte(a.titre)} 55% 42%), hsl(${(teinte(a.titre) + 50) % 360} 60% 30%))`;
    return v;
  };
  if (a.affiche) {
    const img = h('img', { src: a.affiche, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
    img.addEventListener('error', () => img.replaceWith(vide()));
    conteneur.append(img);
  } else conteneur.append(vide());
  return conteneur;
}

function progression(a) {
  const fois = a.statut === 'vu' && a.visionnages > 1 ? ` ×${a.visionnages}` : '';
  // Un film : sa durée, pas un nombre d'épisodes.
  if (a.type === 'film' || a.type === 'cinema') return { texte: ((a.duree ? formaterDuree(a.duree) : '') + fois).trim(), pct: a.statut === 'vu' ? 100 : 0 };
  if (categorieDe(a.type) === 'lecture') return { texte: '', pct: null };
  if (a.episodes_total) {
    const vus = a.episodes_vus ?? (a.statut === 'vu' ? a.episodes_total : 0);
    return { texte: `${vus}/${a.episodes_total} ép.${fois}`, pct: Math.min(100, (vus / a.episodes_total) * 100) };
  }
  if (a.episodes_vus != null) return { texte: `${a.episodes_vus} ép. vus${fois}`, pct: null };
  return { texte: fois.trim(), pct: null };
}

// Menu de statut directement sur la carte (admin) : un clic, une modification enregistrée.
async function changerStatut(a, statut) {
  const corps = { statut };
  if (statut === 'vu' && estSerie(a.type) && a.episodes_total) corps.episodes_vus = a.episodes_total;
  try {
    remplacerLocal(await api(`/api/animes/${a.id}`, { method: 'PUT', body: corps }));
    toast(`« ${a.titre} » : ${libelleStatut(a.type, statut)}`);
  } catch (e) {
    toast(e.message, true);
    rafraichirApresChangement();
  }
}

function selecteurStatut(a, classe) {
  const s = h('select', {
    class: `${classe} statut-edit`, 'aria-label': `Statut de ${a.titre}`, title: 'Changer le statut',
    onclick: (e) => e.stopPropagation(), onkeydown: (e) => e.stopPropagation(),
    onchange: () => changerStatut(a, s.value),
  }, ...optionsStatut(a.type, a.statut));
  return s;
}

// Statuts proposés pour un type (Film et Lecture n'en ont que deux) ; le statut actuel reste toujours listé.
function optionsStatut(type, courant) {
  const permis = CATEGORIES[categorieDe(type)].statuts;
  return Object.keys(STATUTS).filter((k) => permis.includes(k) || k === courant)
    .map((k) => h('option', { value: k, selected: k === courant }, libelleStatut(type, k)));
}

// ---------- Collection ----------

function indexer() {
  for (const a of etat.animes) {
    a._rech = norm([a.titre, a.titre_officiel, a.commentaire, a.tags.join(' '), a.genres.join(' ')].join(' '));
  }
}

const dansCategorie = (cat) => etat.animes.filter((a) => categorieDe(a.type) === cat);

// Statut affiché d'abord : celui de la catégorie s'il contient des entrées, sinon le suivant (ex. Film : « À voir »).
function statutParDefaut(cat) {
  const { defaut, statuts } = CATEGORIES[cat];
  if (!defaut) return '';
  const presents = dansCategorie(cat);
  return [defaut, ...statuts].find((s) => presents.some((a) => a.statut === s)) ?? defaut;
}

function filtrer({ ignorerStatut = false } = {}) {
  const { q, statut, type, tag, periode, genre } = etat.f;
  const mots = norm(q).split(/\s+/).filter(Boolean);
  return etat.animes.filter((a) => {
    if (categorieDe(a.type) !== etat.cat) return false;
    if (!ignorerStatut && statut && a.statut !== statut) return false;
    if (type && a.type !== type) return false;
    if (tag && !a.tags.includes(tag)) return false;
    if (periode && a.periode !== periode) return false;
    if (genre && !a.genres.includes(genre)) return false;
    return mots.every((m) => a._rech.includes(m));
  });
}

const nullDernier = (x, y, f) => (x == null ? (y == null ? 0 : 1) : y == null ? -1 : f(x, y));
const TRIS = {
  ordre: (a, b) => a.ordre - b.ordre || a.id - b.id,
  titre: (a, b) => a.titre.localeCompare(b.titre, 'fr', { sensitivity: 'base' }),
  note_desc: (a, b) => nullDernier(a.note, b.note, (x, y) => y - x),
  note_asc: (a, b) => nullDernier(a.note, b.note, (x, y) => x - y),
  annee_desc: (a, b) => nullDernier(a.annee, b.annee, (x, y) => y - x),
  recent: (a, b) => b.maj_le.localeCompare(a.maj_le),
  progression: (a, b) => (progression(b).pct ?? -1) - (progression(a).pct ?? -1),
};

function carte(a) {
  const st = STATUTS[a.statut];
  const libelle = libelleStatut(a.type, a.statut);
  const prog = progression(a);
  const annee = texteAnnee(a);
  const el = h('article', {
    class: 'carte', tabindex: '0', role: 'button', 'data-id': a.id,
    'aria-label': `${a.titre}, ${libelle}${annee ? `, ${annee}` : ''}`,
  });
  el.style.setProperty('--couleur', st.couleur);
  const aff = affiche(a);
  aff.append(etat.admin ? selecteurStatut(a, 'etiquette-statut') : h('span', { class: 'etiquette-statut' }, libelle));
  // Pastille de type : utile quand la catégorie en mélange plusieurs (Animé / Film d'animation, Livre / Manga / Manhwa).
  if (a.type !== 'serie' && a.type !== 'cinema') aff.append(h('span', { class: 'etiquette-type' }, TYPES_COURT[a.type] ?? TYPES[a.type]));
  el.append(
    aff,
    h('div', { class: 'carte-corps' },
      h('div', { class: 'carte-titre', title: a.titre }, a.titre),
      etat.admin ? selecteurStatut(a, 'statut-texte') : h('span', { class: 'statut-texte' }, libelle),
      annee && h('div', { class: 'annee-vue', title: 'Année du premier visionnage' }, annee),
      prog.texte && h('div', { class: 'meta' }, prog.texte),
      prog.pct != null && h('div', { class: 'progression' }, h('span', { style: `width:${prog.pct}%` })),
      a.note != null ? etoiles(a.note, { estimee: a.note_estimee }) : h('span', { class: 'sans-note' }, 'Pas de note'),
    ),
  );
  return el;
}

function rendreCollection() {
  const liste = filtrer().sort(TRIS[etat.tri]);
  const conteneur = $('#liste');
  conteneur.className = `grille${etat.vue === 'liste' ? ' liste' : ''}`;
  // Une entrée abîmée ne doit pas vider toute la liste : on la saute et on le signale dans la console.
  const cartes = liste.map((a) => { try { return carte(a); } catch (e) { console.error(`Carte illisible : ${a.titre}`, e); return null; } }).filter(Boolean);
  let vide = 'Rien ne correspond à ces filtres.';
  if (!liste.length && etat.f.q.trim()) {
    const ailleurs = filtrer({ ignorerStatut: true }).length;
    if (ailleurs) vide = `Aucun résultat avec ce statut — ${ailleurs} dans les autres statuts de cette catégorie.`;
  }
  conteneur.replaceChildren(...(cartes.length ? cartes : [h('p', { class: 'vide' }, vide)]));
  $('#compteur').textContent = `${liste.length} sur ${dansCategorie(etat.cat).length} dans « ${CATEGORIES[etat.cat].libelle} »`;
  $('#vue-grille').setAttribute('aria-pressed', String(etat.vue === 'grille'));
  $('#vue-liste').setAttribute('aria-pressed', String(etat.vue === 'liste'));
}

function compter(champ, liste = etat.animes) {
  const m = new Map();
  for (const a of liste) for (const v of [].concat(a[champ] ?? [])) if (v) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()];
}

// Sur téléphone les filtres occupent l'écran : après un choix, on amène le début de la liste à l'écran.
function voirListe() {
  const haut = $('#compteur').getBoundingClientRect().top;
  if (haut > innerHeight * 0.55) $('#compteur').scrollIntoView({ block: 'start', behavior: 'smooth' });
}

// Ouvre une catégorie : filtres remis à zéro (statut par défaut : « Vu » pour Animé et Film).
function choisirCategorie(cat) {
  etat.cat = cat;
  etat.f = { ...etat.f, statut: statutParDefaut(cat), type: '', tag: '', periode: '', genre: '' };
  for (const id of ['#f-tag', '#f-periode', '#f-genre']) $(id).value = '';
}

function rendreOnglets() {
  document.querySelectorAll('[data-onglet]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.onglet === etat.onglet));
    const nb = b.querySelector('b');
    if (nb && CATEGORIES[b.dataset.onglet]) nb.textContent = String(dansCategorie(b.dataset.onglet).length);
  });
}

function rendreFiltres() {
  rendreOnglets();
  const cat = CATEGORIES[etat.cat];
  const dedans = dansCategorie(etat.cat);
  // Statut : une seule pastille active. Animé et Film n'ont pas de « Tous » ; Lecture peut tout montrer (aucune active).
  const pastilleStatut = (k) => h('button', {
    type: 'button', class: 'pastille', 'aria-pressed': String(etat.f.statut === k),
    onclick: () => { etat.f.statut = cat.defaut || etat.f.statut !== k ? k : ''; rendreFiltres(); rendreCollection(); voirListe(); },
  }, libelleStatutCategorie(etat.cat, k), h('b', {}, String(dedans.filter((a) => a.statut === k).length)));
  const pastilleType = (k) => h('button', {
    type: 'button', class: 'pastille', 'aria-pressed': String(etat.f.type === k),
    onclick: () => { etat.f.type = etat.f.type === k ? '' : k; rendreFiltres(); rendreCollection(); voirListe(); },
  }, TYPES[k], h('b', {}, String(dedans.filter((a) => a.type === k).length)));
  const separateur = h('span', { class: 'separateur', 'aria-hidden': 'true' });
  const statuts = cat.statuts.map(pastilleStatut);
  // Types : seulement quand la catégorie en mélange plusieurs (Film n'a qu'un type).
  const types = cat.types.length > 1 ? cat.types.map(pastilleType) : [];
  $('#pastilles').replaceChildren(...(etat.cat === 'lecture' ? [...types, separateur, ...statuts] : [...statuts, ...(types.length ? [separateur] : []), ...types]));
  $('#pastilles').setAttribute('aria-label', `Filtrer : ${cat.libelle}`);

  const remplir = (id, vide, options) => {
    const s = $(id);
    const ancien = s.value;
    s.replaceChildren(h('option', { value: '' }, vide), ...options.map(([v, l]) => h('option', { value: v }, l)));
    s.value = options.some(([v]) => v === ancien) ? ancien : '';
    s.hidden = options.length === 0;
  };
  remplir('#f-tag', 'Toutes les étiquettes',
    compter('tags', dedans).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0], 'fr')).map(([t, n]) => [t, `${t} (${n})`]));
  remplir('#f-periode', 'Toutes les années',
    compter('periode', dedans).sort((x, y) => x[0].localeCompare(y[0])).map(([p, n]) => [p, `${p} (${n})`]));
  remplir('#f-genre', 'Tous les genres',
    compter('genres', dedans).sort((x, y) => y[1] - x[1]).map(([g, n]) => [g, `${g} (${n})`]));
  for (const [id, cle] of [['#f-tag', 'tag'], ['#f-periode', 'periode'], ['#f-genre', 'genre']]) etat.f[cle] = $(id).value; // une valeur absente de la catégorie est abandonnée
}

// Libellé d'un statut dans une catégorie (« Lu » / « À lire » pour Lecture).
const libelleStatutCategorie = (cat, statut) => libelleStatut(CATEGORIES[cat].types[0], statut);

// ---------- Statistiques ----------

function barres(titre, lignes, { total, couleur } = {}) {
  const max = Math.max(1, ...lignes.map((l) => l.valeur));
  return h('div', { class: 'panneau' },
    h('h3', {}, titre),
    ...lignes.map((l) => {
      const piste = h('span', { style: `width:${(l.valeur / (total ?? max)) * 100}%` });
      if (l.couleur ?? couleur) piste.style.setProperty('--couleur', l.couleur ?? couleur);
      return h('div', { class: 'barre-stat' },
        h('span', { class: 'lib', title: l.label }, l.label),
        h('span', { class: 'piste' }, piste),
        h('span', { class: 'nb' }, String(l.valeur)));
    }),
    !lignes.length && h('p', { class: 'muted' }, 'Pas encore de données.'),
  );
}

function rendreStats() {
  const A = etat.animes;
  const nbType = (...types) => A.filter((a) => types.includes(a.type)).length;
  const vus = A.filter((a) => a.statut === 'vu');
  // Films vus : durée réelle quand elle est connue (revisionnages compris).
  const films = vus.filter((a) => a.type === 'film' || a.type === 'cinema');
  const minutesFilms = films.reduce((s, a) => s + (a.duree ?? 0) * a.visionnages, 0);
  const filmsSansDuree = films.filter((a) => !a.duree).length;
  // Épisodes regardés, revisionnages compris (24/24 vu deux fois = 48).
  const episodesDe = (type) => A.reduce((s, a) => {
    if (a.statut === 'a_voir' || a.type !== type) return s;
    const vus = a.episodes_vus ?? (a.statut === 'vu' ? a.episodes_total ?? 0 : 0);
    return s + vus * (a.statut === 'vu' ? a.visionnages : 1);
  }, 0);
  const episodes = episodesDe('serie');
  const episodesTv = episodesDe('serietv'); // séries en prises de vues réelles : épisodes d'environ 50 min
  const revus = A.filter((a) => a.statut === 'vu' && a.visionnages > 1).length;
  const notes = A.filter((a) => a.note != null);
  const moyenne = notes.length ? notes.reduce((s, a) => s + a.note, 0) / notes.length : null;
  const estimees = notes.filter((a) => a.note_estimee).length;
  const tuile = (valeur, libelle) => h('div', { class: 'tuile' }, h('div', { class: 'valeur' }, valeur), h('div', { class: 'libelle' }, libelle));

  const parNote = new Map();
  for (const a of notes) parNote.set(a.note, (parNote.get(a.note) ?? 0) + 1);
  const histo = Array.from({ length: 10 }, (_, i) => (i + 1) / 2).map((n) => ({ label: `${n} ★`, valeur: parNote.get(n) ?? 0 }));

  const parPeriode = new Map();
  for (const a of A) if (a.periode && a.statut !== 'a_voir') parPeriode.set(a.periode, (parPeriode.get(a.periode) ?? 0) + 1);
  const genres = compter('genres').sort((x, y) => y[1] - x[1]).slice(0, 8);
  const top = [...vus].filter((a) => a.note != null).sort((x, y) => y.note - x.note || x.titre.localeCompare(y.titre, 'fr')).slice(0, 10);

  $('#vue-stats').replaceChildren(
    h('div', { class: 'tuiles' },
      tuile(A.length, 'entrées au total'),
      tuile(vus.length, 'terminés'),
      tuile(episodes.toLocaleString('fr-FR'), `épisodes vus, revisionnages compris (${revus} animé${revus > 1 ? 's' : ''} vu${revus > 1 ? 's' : ''} plusieurs fois)`),
      tuile(`≈ ${Math.round((episodes * MIN_PAR_EPISODE + episodesTv * MIN_PAR_EPISODE_TV + minutesFilms) / 60).toLocaleString('fr-FR')} h`,
        `de visionnage (épisodes estimés à ${MIN_PAR_EPISODE} min, ${MIN_PAR_EPISODE_TV} min pour les séries, films à leur durée${filmsSansDuree ? `, ${filmsSansDuree} film${filmsSansDuree > 1 ? 's' : ''} sans durée non compté${filmsSansDuree > 1 ? 's' : ''}` : ''})`),
      tuile(moyenne == null ? '–' : `${moyenne.toFixed(2).replace('.', ',')} ★`, `note moyenne (${notes.length} notes, dont ${estimees} estimées)`),
      tuile(nbType('serie'), 'animés (séries)'),
      tuile(nbType('film'), "films d'animation"),
      tuile(nbType('livre', 'manga', 'manhwa'), 'lectures'),
      tuile(nbType('cinema'), 'films'),
      tuile(nbType('serietv'), 'séries'),
    ),
    h('div', { class: 'panneaux' },
      barres('Par statut', Object.entries(STATUTS).map(([k, v]) => ({ label: v.libelle, valeur: A.filter((a) => a.statut === k).length, couleur: v.couleur })), { total: A.length }),
      barres('Répartition des notes', histo),
      barres('Regardés par année (premier visionnage)',[...parPeriode.entries()].sort((x, y) => x[0].localeCompare(y[0])).map(([label, valeur]) => ({ label, valeur }))),
      barres('Genres les plus fréquents', genres.map(([label, valeur]) => ({ label, valeur }))),
      h('div', { class: 'panneau' }, h('h3', {}, 'Mes mieux notés'),
        top.length ? h('ol', { class: 'classement' }, ...top.map((a) => h('li', {}, `${a.titre} — ${a.note} ★`))) : h('p', { class: 'muted' }, 'Aucune note.')),
    ),
  );
}

// ---------- Fiche détaillée / édition ----------

const dlgDetail = $('#dlg-detail');

function rafraichirApresChangement() {
  indexer();
  rendreFiltres();
  rendreCollection();
  if (etat.onglet === 'stats') rendreStats();
}

function remplacerLocal(a) {
  const i = etat.animes.findIndex((x) => x.id === a.id);
  if (i >= 0) etat.animes[i] = a; else etat.animes.push(a);
  rafraichirApresChangement();
}

function ouvrirDetail(id) {
  const a = etat.animes.find((x) => x.id === id);
  if (!a) return;
  dlgDetail.replaceChildren(etat.admin ? ficheEdition(a) : ficheLecture(a));
  if (!dlgDetail.open) dlgDetail.showModal();
}

function fiche(a, droite) {
  const aff = affiche(a);
  return h('div', { class: 'dlg-corps' }, h('div', { class: 'fiche' }, aff, h('div', { class: 'fiche-droite' }, droite)));
}

function ficheLecture(a) {
  const st = STATUTS[a.statut];
  const prog = progression(a);
  const bouton = h('button', { type: 'button', class: 'discret espace', onclick: () => dlgDetail.close() }, 'Fermer');
  return fiche(a, [
    h('div', {}, h('h2', {}, a.titre), a.titre_officiel && norm(a.titre_officiel) !== norm(a.titre) && h('div', { class: 'sous-titre' }, a.titre_officiel)),
    h('div', { class: 'puces' },
      h('span', { class: 'puce', style: `background:${st.couleur};color:#fff` }, libelleStatut(a.type, a.statut)),
      h('span', { class: 'puce' }, TYPES[a.type]),
      a.annee && h('span', { class: 'puce', title: 'Année de sortie' }, `Sortie ${a.annee}`),
      prog.texte && h('span', { class: 'puce' }, prog.texte),
      a.statut === 'vu' && a.visionnages > 1 && h('span', { class: 'puce' }, `Vu ${a.visionnages} fois`),
      texteAnnee(a) && h('span', { class: 'puce' }, texteAnnee(a))),
    a.note != null ? h('div', {}, etoiles(a.note, { estimee: a.note_estimee }), a.note_estimee && h('span', { class: 'sous-titre' }, '  (estimée)')) : h('span', { class: 'sans-note' }, 'Pas de note'),
    a.commentaire && h('p', {}, a.commentaire),
    a.synopsis && h('p', { class: 'synopsis' }, a.synopsis),
    (a.genres.length || a.tags.length) && h('div', { class: 'puces' }, ...a.genres.map((g) => h('span', { class: 'puce' }, g)), ...a.tags.map((t) => h('span', { class: 'puce' }, `#${t}`))),
    h('div', { class: 'rangee' }, bouton),
  ]);
}

function ficheEdition(a) {
  const b = { ...a, tags: [...a.tags] };
  let noteChangee = false;
  const champ = (libelle, input, classe = '') => h('label', { class: classe }, libelle, input);
  const iTitre = h('input', { value: a.titre, maxlength: '200', required: true });
  const iType = h('select', {}, ...Object.entries(TYPES).map(([k, v]) => h('option', { value: k, selected: k === a.type }, v)));
  const iStatut = h('select', {}, ...optionsStatut(a.type, a.statut));
  const iVus = h('input', { type: 'number', min: '0', value: a.episodes_vus ?? '' });
  const iTotal = h('input', { type: 'number', min: '0', value: a.episodes_total ?? '' });
  const iDuree = h('input', { type: 'number', min: '1', max: '1000', value: a.duree ?? '', placeholder: 'ex. 112' });
  const iFois = h('input', { type: 'number', min: '1', max: '99', value: a.visionnages ?? 1, title: '2 = vu deux fois' });
  const iPeriode = h('input', { value: a.periode ?? '', maxlength: '30', placeholder: 'ex. 2021' });
  const iTags = h('input', { value: a.tags.join(', '), list: 'liste-tags' });
  const iAffiche = h('input', { type: 'url', value: a.affiche ?? '', placeholder: 'https://…' });
  const iCom = h('textarea', { maxlength: '2000' }, a.commentaire);
  const listeTags = h('datalist', { id: 'liste-tags' }, ...compter('tags').map(([t]) => h('option', { value: t })));
  const zoneNote = h('div', {});
  const dessinerNote = () => zoneNote.replaceChildren(...[
    etoiles(b.note, { editable: true, estimee: b.note_estimee && !noteChangee, onChange: (v) => { b.note = v; noteChangee = true; } }),
    ' ',
    h('button', { type: 'button', class: 'discret', onclick: () => { b.note = null; noteChangee = true; dessinerNote(); } }, 'Effacer'),
    a.note_estimee && !noteChangee && h('span', { class: 'sous-titre' }, '  note estimée : clique pour la corriger'),
  ].filter(Boolean));
  dessinerNote();

  const nombre = (i) => (i.value === '' ? null : Math.max(0, Math.floor(Number(i.value))));
  const enregistrer = async () => {
    if (!iTitre.value.trim()) { iTitre.focus(); return; }
    const corps = {
      titre: iTitre.value, type: iType.value, statut: iStatut.value,
      episodes_vus: nombre(iVus), episodes_total: nombre(iTotal), duree: nombre(iDuree) || null, periode: iPeriode.value || null,
      visionnages: Math.min(99, Math.max(1, nombre(iFois) ?? 1)),
      tags: iTags.value.split(',').map((t) => t.trim()).filter(Boolean), commentaire: iCom.value,
      affiche: iAffiche.value || null,
    };
    if (corps.statut === 'vu' && corps.episodes_total && corps.episodes_vus == null && estSerie(corps.type)) corps.episodes_vus = corps.episodes_total;
    if (noteChangee) corps.note = b.note;
    try {
      remplacerLocal(await api(`/api/animes/${a.id}`, { method: 'PUT', body: corps }));
      toast('Enregistré');
      dlgDetail.close();
    } catch (e) { toast(e.message, true); }
  };
  const supprimer = async () => {
    if (!confirm(`Supprimer « ${a.titre} » de la liste ? Cette action est définitive.`)) return;
    try {
      await api(`/api/animes/${a.id}`, { method: 'DELETE' });
      etat.animes = etat.animes.filter((x) => x.id !== a.id);
      rafraichirApresChangement();
      toast('Supprimé');
      dlgDetail.close();
    } catch (e) { toast(e.message, true); }
  };

  const zoneRecherche = h('div', { class: 'resultats' });
  const iRecherche = h('input', { type: 'search', value: a.titre_officiel || a.titre, 'aria-label': 'Rechercher la fiche' });
  const lancerRecherche = async () => {
    zoneRecherche.replaceChildren(h('p', { class: 'muted' }, 'Recherche…'));
    try {
      const res = await api(`/api/anilist/recherche?q=${encodeURIComponent(iRecherche.value)}&genre=${CATEGORIES[categorieDe(iType.value)].recherche ?? 'anime'}`);
      zoneRecherche.replaceChildren(...(res.length ? res.map((m) => resultat(m, 'Choisir', async () => {
        try {
          remplacerLocal(await api(`/api/animes/${a.id}/associer`, { method: 'POST', body: { anilist_id: m.id } }));
          toast('Fiche associée');
          ouvrirDetail(a.id);
        } catch (e) { toast(e.message, true); }
      })) : [h('p', { class: 'muted' }, 'Aucun résultat.')]));
    } catch (e) { zoneRecherche.replaceChildren(h('p', { class: 'erreur' }, e.message)); }
  };

  const grille = h('div', { class: 'grille-form' },
    champ('Titre', iTitre, 'large'), champ('Type', iType), champ('Statut', iStatut),
    champ('Épisodes vus', iVus, 'ch-serie'), champ('Épisodes (total)', iTotal, 'ch-serie'),
    champ('Durée (minutes)', iDuree, 'ch-film'),
    champ('Nombre de visionnages', iFois, 'ch-vu'), champ('Année du premier visionnage', iPeriode),
    champ('Étiquettes (séparées par des virgules)', iTags, 'large'), champ('URL de l\'affiche', iAffiche, 'large'));
  // Les champs dépendent du type : épisodes pour un animé, durée pour un film, pas de visionnages pour une lecture.
  const majChamps = () => {
    const type = iType.value;
    const statut = iStatut.value;
    iStatut.replaceChildren(...optionsStatut(type, statut));
    iStatut.value = [...iStatut.options].some((o) => o.value === statut) ? statut : iStatut.options[0].value;
    for (const l of grille.querySelectorAll('.ch-serie')) l.hidden = !estSerie(type);
    for (const l of grille.querySelectorAll('.ch-film')) l.hidden = type !== 'film' && type !== 'cinema';
    for (const l of grille.querySelectorAll('.ch-vu')) l.hidden = categorieDe(type) === 'lecture';
  };
  iType.addEventListener('change', majChamps);
  majChamps();

  return fiche(a, [
    h('h2', {}, 'Modifier la fiche'),
    grille,
    h('div', {}, h('div', { class: 'sous-titre' }, 'Note'), zoneNote),
    champ('Commentaire', iCom), listeTags,
    h('details', {},
      h('summary', {}, 'Associer une fiche (affiche, synopsis, genres)'),
      h('div', { class: 'rangee', style: 'margin:10px 0' }, iRecherche, h('button', { type: 'button', onclick: lancerRecherche }, 'Chercher')),
      zoneRecherche),
    h('div', { class: 'rangee' },
      h('button', { type: 'button', class: 'danger', onclick: supprimer }, 'Supprimer'),
      h('button', { type: 'button', class: 'discret espace', onclick: () => dlgDetail.close() }, 'Annuler'),
      h('button', { type: 'button', class: 'primaire', onclick: enregistrer }, 'Enregistrer')),
  ]);
}

function resultat(m, libelleBouton, onClick) {
  return h('div', { class: 'resultat' },
    m.affiche ? h('img', { src: m.affiche, alt: '', loading: 'lazy' }) : h('div', { class: 'affiche-vide', style: 'width:44px;height:62px;font-size:.8rem' }, '?'),
    h('div', { class: 'texte' }, h('b', {}, m.titre),
      h('span', { class: 'sous-titre' }, [m.annee, m.format, m.episodes ? `${m.episodes} ép.` : null].filter(Boolean).join(' · '))),
    h('button', { type: 'button', class: 'primaire', onclick: onClick }, libelleBouton));
}

// ---------- Ajout ----------

function configurerAjout() {
  const dlg = $('#dlg-ajout');
  const zone = $('#ajout-resultats');
  const creer = async (corps) => {
    try {
      const a = await api('/api/animes', { method: 'POST', body: { statut: $('#ajout-statut').value, ...corps } });
      remplacerLocal(a);
      toast(`« ${a.titre} » ajouté`);
      dlg.close();
      ouvrirDetail(a.id);
    } catch (e) { toast(e.message, true); }
  };
  // Les statuts proposés suivent le type choisi (Film : Vu / À voir ; Lecture : Lu / À lire).
  const majStatuts = () => {
    const type = $('#ajout-cat').value;
    const voulu = $('#ajout-statut').value;
    const permis = CATEGORIES[categorieDe(type)].statuts;
    $('#ajout-statut').replaceChildren(...['a_voir', 'en_cours', 'vu'].filter((k) => permis.includes(k))
      .map((k) => h('option', { value: k }, libelleStatut(type, k))));
    $('#ajout-statut').value = permis.includes(voulu) ? voulu : 'a_voir';
  };
  $('#ajout-cat').addEventListener('change', () => { majStatuts(); zone.replaceChildren(); });
  $('#btn-ajouter').addEventListener('click', () => {
    zone.replaceChildren();
    // Par défaut : la catégorie ouverte, et le statut qu'on est en train de regarder.
    $('#ajout-cat').value = { anime: 'serie', lecture: 'manga', film: 'cinema' }[etat.cat];
    $('#ajout-statut').value = etat.f.statut;
    majStatuts();
    dlg.showModal();
    $('#ajout-q').focus();
  });
  $('#form-recherche').addEventListener('submit', async (e) => {
    e.preventDefault();
    const type = $('#ajout-cat').value;
    const genre = CATEGORIES[categorieDe(type)].recherche;
    if (!genre) { zone.replaceChildren(h('p', { class: 'muted' }, "Pas de recherche automatique pour cette catégorie : utilise « Ajouter sans fiche ».")); return; }
    zone.replaceChildren(h('p', { class: 'muted' }, 'Recherche…'));
    try {
      const res = await api(`/api/anilist/recherche?q=${encodeURIComponent($('#ajout-q').value)}&genre=${genre}`);
      // Animé : la fiche dit si c'est un film (durée) ou une série (épisodes) ; sinon le type choisi s'applique.
      const typeDe = (m) => (genre === 'anime' && type !== 'film' ? (['MOVIE', 'SPECIAL'].includes(m.format) ? 'film' : 'serie') : type);
      zone.replaceChildren(...(res.length
        ? res.map((m) => resultat(m, 'Ajouter', () => creer({ titre: m.titre, anilist_id: m.id, type: typeDe(m) })))
        : [h('p', { class: 'muted' }, 'Aucun résultat.')]));
    } catch (err) { zone.replaceChildren(h('p', { class: 'erreur' }, err.message)); }
  });
  $('#ajout-manuel').addEventListener('click', () => {
    const titre = $('#ajout-q').value.trim();
    if (titre) creer({ titre, type: $('#ajout-cat').value }); else $('#ajout-q').focus();
  });
}

// ---------- Session ----------

function majSession() {
  $('#btn-ajouter').hidden = !etat.admin;
  const b = $('#btn-connexion');
  b.textContent = etat.statique ? (etat.admin ? "Désactiver l'édition" : "Activer l'édition") : (etat.admin ? 'Se déconnecter' : 'Se connecter');
  b.hidden = !etat.admin && !etat.adminDispo;
  majPied();
  rendreFiltres();
  rendreCollection();
}

function configurerConnexion() {
  const dlg = $('#dlg-connexion');
  $('#btn-connexion').addEventListener('click', async () => {
    if (etat.admin) {
      const attente = mobile.file.lire().length;
      if (etat.statique) {
        if (attente && !confirm(`${attente} modification(s) ne sont pas encore envoyées à GitHub. Désactiver quand même l'édition ?`)) return;
        mobile.desactiver();
      } else await api('/api/logout', { method: 'POST' });
      etat.admin = false;
      majSession();
      toast(etat.statique ? 'Édition désactivée sur ce téléphone' : 'Déconnecté');
    } else {
      const jeton = etat.statique;
      $('#titre-connexion').textContent = jeton ? "Activer l'édition sur ce téléphone" : 'Connexion administrateur';
      $('#texte-connexion').textContent = jeton
        ? "Crée sur GitHub un jeton limité à ce seul dépôt (permission « Contents : Read and write »), puis colle-le ici. Il reste uniquement dans ce navigateur."
        : 'Seule la personne qui tient la liste peut la modifier.';
      $('#lien-jeton').hidden = $('#lien-jeton').parentElement.hidden = !jeton;
      $('#libelle-mdp').textContent = jeton ? 'Jeton GitHub' : 'Mot de passe';
      $('#btn-valider-connexion').textContent = jeton ? 'Activer' : 'Se connecter';
      $('#erreur-connexion').textContent = '';
      $('#motdepasse').value = '';
      dlg.showModal();
      $('#motdepasse').focus();
    }
  });
  $('#form-connexion').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      if (etat.statique) {
        await mobile.activer($('#motdepasse').value);
        etat.admin = true;
        $('#motdepasse').value = '';
        dlg.close();
        majSession();
        toast("Édition activée : les ajouts partent sur GitHub");
        synchroniserAuDemarrage();
      } else {
        await api('/api/login', { method: 'POST', body: { motdepasse: $('#motdepasse').value } });
        etat.admin = true;
        dlg.close();
        majSession();
        toast('Connecté : tu peux modifier la liste');
      }
    } catch (err) { $('#erreur-connexion').textContent = err.message; }
  });
}

// ---------- Démarrage ----------

function appliquerTheme(theme) {
  if (theme) document.documentElement.dataset.theme = theme;
}

function init() {
  appliquerTheme(stockage.lire('theme', ''));
  $('#btn-theme').addEventListener('click', () => {
    const sombre = matchMedia('(prefers-color-scheme: dark)').matches;
    const actuel = document.documentElement.dataset.theme || (sombre ? 'dark' : 'light');
    const suivant = actuel === 'dark' ? 'light' : 'dark';
    appliquerTheme(suivant);
    stockage.ecrire('theme', suivant);
  });

  $('#plus-filtres').open = matchMedia('(min-width: 701px)').matches; // fermés sur téléphone : la liste passe avant
  document.querySelectorAll('[data-onglet]').forEach((b) => b.addEventListener('click', () => {
    etat.onglet = b.dataset.onglet;
    if (CATEGORIES[etat.onglet] && etat.onglet !== etat.cat) choisirCategorie(etat.onglet);
    $('#vue-collection').hidden = etat.onglet === 'stats';
    $('#vue-stats').hidden = etat.onglet !== 'stats';
    if (etat.onglet === 'stats') { rendreOnglets(); rendreStats(); } else { rendreFiltres(); rendreCollection(); }
  }));

  let attente;
  $('#recherche').addEventListener('input', (e) => {
    clearTimeout(attente);
    attente = setTimeout(() => { etat.f.q = e.target.value; rendreCollection(); }, 120);
  });
  $('#tri').addEventListener('change', (e) => { etat.tri = e.target.value; rendreCollection(); });
  for (const [id, cle] of [['#f-tag', 'tag'], ['#f-periode', 'periode'], ['#f-genre', 'genre']]) {
    $(id).addEventListener('change', (e) => { etat.f[cle] = e.target.value; rendreCollection(); });
  }
  $('#f-reset').addEventListener('click', () => {
    etat.f.q = '';
    choisirCategorie(etat.cat);
    $('#recherche').value = '';
    rendreFiltres();
    rendreCollection();
  });
  $('#vue-grille').addEventListener('click', () => { etat.vue = 'grille'; stockage.ecrire('vue', 'grille'); rendreCollection(); });
  $('#vue-liste').addEventListener('click', () => { etat.vue = 'liste'; stockage.ecrire('vue', 'liste'); rendreCollection(); });

  const ouvrirDepuisCarte = (e) => {
    const c = e.target.closest('.carte');
    if (c) ouvrirDetail(Number(c.dataset.id));
  };
  $('#liste').addEventListener('click', ouvrirDepuisCarte);
  $('#liste').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ouvrirDepuisCarte(e); } });
  document.querySelectorAll('dialog').forEach((d) => {
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
    d.addEventListener('click', (e) => { if (e.target.closest('[data-fermer]')) d.close(); });
  });

  configurerConnexion();
  configurerAjout();
}

// Journal déjà envoyé sur GitHub (ajouts faits depuis un autre appareil ou avant un rechargement).
async function synchroniserAuDemarrage() {
  try {
    etat.opsDistantes = await mobile.chargerJournal();
    recalculer();
    rafraichirApresChangement();
  } catch (e) {
    toast(`Journal GitHub indisponible : ${e.message}`, true);
  }
  envoyer();
}

// Mise à jour automatique de l'application installée : le service worker sert l'ancienne version depuis son cache,
// donc sans ceci une nouvelle version n'apparaît qu'à la 2e ouverture. Ici : on cherche une nouvelle version à
// chaque retour au premier plan, et quand elle prend la main la page se recharge (sauf fiche ouverte).
function surveillerMiseAJour() {
  if (!('serviceWorker' in navigator)) return;
  const etaitPilotee = !!navigator.serviceWorker.controller; // 1re installation : rien à recharger
  let rechargee = false;
  const recharger = () => {
    if (document.querySelector('dialog[open]')) return void setTimeout(recharger, 3000);
    location.reload();
  };
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!etaitPilotee || rechargee) return;
    rechargee = true;
    recharger();
  });
  navigator.serviceWorker.register('sw.js').then((reg) => {
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
  }).catch(() => {});
}

async function demarrer() {
  init();
  try {
    try {
      const [session, animes] = await Promise.all([api('/api/session'), api('/api/animes')]);
      etat.admin = session.admin;
      etat.adminDispo = session.adminDispo;
      etat.animes = animes;
    } catch {
      // Pas de serveur (site publié sur GitHub Pages) : animes.json, chemin relatif ; édition possible
      // depuis un téléphone qui a un jeton GitHub (journal modifications.json).
      etat.statique = true;
      etat.base = await api('animes.json', { cache: 'no-cache' });
      etat.adminDispo = !!mobile.depot();
      etat.admin = etat.adminDispo && !!mobile.jeton();
      recalculer(); // la file locale (modifications pas encore envoyées) reste visible
      $('.pied a').href = 'animes.json';
      surveillerMiseAJour();
      addEventListener('online', envoyer);
    }
    indexer();
    choisirCategorie(etat.cat); // Animé s'ouvre sur « Vu »
  } catch (e) {
    $('#liste').replaceChildren(h('p', { class: 'vide' }, `Impossible de charger la liste : ${e.message}`));
    return;
  }
  majSession();
  if (etat.statique && etat.admin) synchroniserAuDemarrage();
}

demarrer();
