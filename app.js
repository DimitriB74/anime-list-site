// Interface de la liste d'animés. Aucune dépendance : DOM natif, textContent partout (pas d'innerHTML).

const STATUTS = {
  vu: { libelle: 'Vu', couleur: 'var(--st-vu)' },
  en_cours: { libelle: 'En cours', couleur: 'var(--st-en_cours)' },
  a_voir: { libelle: 'À voir', couleur: 'var(--st-a_voir)' },
  abandonne: { libelle: 'Abandonné', couleur: 'var(--st-abandonne)' },
};
const TYPES = { serie: 'Série', film: 'Film', manga: 'Manga / lecture' };
const MIN_PAR_EPISODE = 24; // hypothèse pour l'estimation des heures (affichée comme telle)

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
  onglet: 'collection',
  vue: stockage.lire('vue', 'grille'),
  f: { q: '', statut: 'tous', type: '', tag: '', periode: '', genre: '' },
  tri: 'ordre',
};

// ---------- Réseau ----------

async function api(url, options = {}) {
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
  if (a.type === 'film') return { texte: (a.statut === 'vu' ? 'Film vu' : 'Film') + fois, pct: a.statut === 'vu' ? 100 : 0 };
  if (a.type === 'manga') return { texte: 'Lecture', pct: null };
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
  if (statut === 'vu' && a.type === 'serie' && a.episodes_total) corps.episodes_vus = a.episodes_total;
  try {
    remplacerLocal(await api(`/api/animes/${a.id}`, { method: 'PUT', body: corps }));
    toast(`« ${a.titre} » : ${STATUTS[statut].libelle}`);
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
  }, ...Object.entries(STATUTS).map(([k, v]) => h('option', { value: k, selected: k === a.statut }, v.libelle)));
  return s;
}

// ---------- Collection ----------

function indexer() {
  for (const a of etat.animes) {
    a._rech = norm([a.titre, a.titre_officiel, a.commentaire, a.tags.join(' '), a.genres.join(' ')].join(' '));
  }
}

function filtrer() {
  const { q, statut, type, tag, periode, genre } = etat.f;
  const mots = norm(q).split(/\s+/).filter(Boolean);
  return etat.animes.filter((a) => {
    if (statut !== 'tous' && a.statut !== statut) return false;
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
  const prog = progression(a);
  const el = h('article', {
    class: 'carte', tabindex: '0', role: 'button', 'data-id': a.id,
    'aria-label': `${a.titre}, ${st.libelle}`,
  });
  el.style.setProperty('--couleur', st.couleur);
  const aff = affiche(a);
  aff.append(etat.admin ? selecteurStatut(a, 'etiquette-statut') : h('span', { class: 'etiquette-statut' }, st.libelle));
  if (a.type !== 'serie') aff.append(h('span', { class: 'etiquette-type' }, TYPES[a.type].split(' ')[0]));
  el.append(
    aff,
    h('div', { class: 'carte-corps' },
      h('div', { class: 'carte-titre', title: a.titre }, a.titre),
      etat.admin ? selecteurStatut(a, 'statut-texte') : h('span', { class: 'statut-texte' }, st.libelle),
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
  conteneur.replaceChildren(...(liste.length ? liste.map(carte) : [h('p', { class: 'vide' }, 'Aucun animé ne correspond à ces filtres.')]));
  $('#compteur').textContent = `${liste.length} sur ${etat.animes.length} entrées`;
  $('#vue-grille').setAttribute('aria-pressed', String(etat.vue === 'grille'));
  $('#vue-liste').setAttribute('aria-pressed', String(etat.vue === 'liste'));
}

function compter(champ) {
  const m = new Map();
  for (const a of etat.animes) for (const v of [].concat(a[champ] ?? [])) if (v) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()];
}

function rendreFiltres() {
  const nb = (s) => etat.animes.filter((a) => a.statut === s).length;
  const pastilles = [['tous', 'Tous', etat.animes.length], ...Object.entries(STATUTS).map(([k, v]) => [k, v.libelle, nb(k)])];
  const nbType = (t) => etat.animes.filter((a) => a.type === t).length;
  const pastilleType = ([k, lib]) => nbType(k) > 0 && h('button', {
    type: 'button', class: 'pastille', 'aria-pressed': String(etat.f.type === k),
    onclick: () => { etat.f.type = etat.f.type === k ? '' : k; rendreFiltres(); rendreCollection(); },
  }, lib, h('b', {}, String(nbType(k))));
  $('#pastilles').replaceChildren(
    ...pastilles.map(([k, lib, n]) =>
      h('button', {
        type: 'button', class: 'pastille', 'aria-pressed': String(etat.f.statut === k),
        onclick: () => { etat.f.statut = k; rendreFiltres(); rendreCollection(); },
      }, lib, h('b', {}, String(n)))),
    h('span', { class: 'separateur', 'aria-hidden': 'true' }),
    ...[['serie', 'Séries'], ['film', 'Films'], ['manga', 'Lectures']].map(pastilleType).filter(Boolean),
  );

  const remplir = (id, vide, options) => {
    const s = $(id);
    const ancien = s.value;
    s.replaceChildren(h('option', { value: '' }, vide), ...options.map(([v, l]) => h('option', { value: v }, l)));
    s.value = options.some(([v]) => v === ancien) ? ancien : '';
    s.hidden = options.length === 0;
  };
  remplir('#f-tag', 'Toutes les étiquettes',
    compter('tags').sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0], 'fr')).map(([t, n]) => [t, `${t} (${n})`]));
  remplir('#f-periode', 'Toutes les périodes',
    compter('periode').sort((x, y) => x[0].localeCompare(y[0])).map(([p, n]) => [p, `${p} (${n})`]));
  remplir('#f-genre', 'Tous les genres',
    compter('genres').sort((x, y) => y[1] - x[1]).map(([g, n]) => [g, `${g} (${n})`]));
}

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
  const series = A.filter((a) => a.type !== 'manga');
  const vus = A.filter((a) => a.statut === 'vu');
  // Épisodes regardés, revisionnages compris (24/24 vu deux fois = 48).
  const episodes = A.reduce((s, a) => {
    if (a.statut === 'a_voir') return s;
    const vus = a.episodes_vus ?? (a.statut === 'vu' ? a.episodes_total ?? 0 : 0);
    return s + vus * (a.statut === 'vu' ? a.visionnages : 1);
  }, 0);
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
      tuile(`≈ ${Math.round((episodes * MIN_PAR_EPISODE) / 60).toLocaleString('fr-FR')} h`, `de visionnage (estimé à ${MIN_PAR_EPISODE} min / épisode)`),
      tuile(moyenne == null ? '–' : `${moyenne.toFixed(2).replace('.', ',')} ★`, `note moyenne (${notes.length} notes, dont ${estimees} estimées)`),
      tuile(series.length - A.filter((a) => a.type === 'film').length, 'séries'),
    ),
    h('div', { class: 'panneaux' },
      barres('Par statut', Object.entries(STATUTS).map(([k, v]) => ({ label: v.libelle, valeur: A.filter((a) => a.statut === k).length, couleur: v.couleur })), { total: A.length }),
      barres('Répartition des notes', histo),
      barres('Regardés par période', [...parPeriode.entries()].sort((x, y) => x[0].localeCompare(y[0])).map(([label, valeur]) => ({ label, valeur }))),
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
      h('span', { class: 'puce', style: `background:${st.couleur};color:#fff` }, st.libelle),
      h('span', { class: 'puce' }, TYPES[a.type]),
      a.annee && h('span', { class: 'puce' }, String(a.annee)),
      prog.texte && h('span', { class: 'puce' }, prog.texte),
      a.statut === 'vu' && a.visionnages > 1 && h('span', { class: 'puce' }, `Vu ${a.visionnages} fois`),
      a.periode && h('span', { class: 'puce' }, `Période ${a.periode}`)),
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
  const iStatut = h('select', {}, ...Object.entries(STATUTS).map(([k, v]) => h('option', { value: k, selected: k === a.statut }, v.libelle)));
  const iVus = h('input', { type: 'number', min: '0', value: a.episodes_vus ?? '' });
  const iTotal = h('input', { type: 'number', min: '0', value: a.episodes_total ?? '' });
  const iFois = h('input', { type: 'number', min: '1', max: '99', value: a.visionnages ?? 1, title: '2 = vu deux fois' });
  const iPeriode = h('input', { value: a.periode ?? '', maxlength: '30' });
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
      episodes_vus: nombre(iVus), episodes_total: nombre(iTotal), periode: iPeriode.value || null,
      visionnages: Math.min(99, Math.max(1, nombre(iFois) ?? 1)),
      tags: iTags.value.split(',').map((t) => t.trim()).filter(Boolean), commentaire: iCom.value,
      affiche: iAffiche.value || null,
    };
    if (corps.statut === 'vu' && corps.episodes_total && corps.episodes_vus == null && corps.type === 'serie') corps.episodes_vus = corps.episodes_total;
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
      const res = await api(`/api/anilist/recherche?q=${encodeURIComponent(iRecherche.value)}`);
      zoneRecherche.replaceChildren(...(res.length ? res.map((m) => resultat(m, 'Choisir', async () => {
        try {
          remplacerLocal(await api(`/api/animes/${a.id}/associer`, { method: 'POST', body: { anilist_id: m.id } }));
          toast('Fiche associée');
          ouvrirDetail(a.id);
        } catch (e) { toast(e.message, true); }
      })) : [h('p', { class: 'muted' }, 'Aucun résultat.')]));
    } catch (e) { zoneRecherche.replaceChildren(h('p', { class: 'erreur' }, e.message)); }
  };

  return fiche(a, [
    h('h2', {}, 'Modifier la fiche'),
    h('div', { class: 'grille-form' },
      champ('Titre', iTitre, 'large'), champ('Type', iType), champ('Statut', iStatut),
      champ('Épisodes vus', iVus), champ('Épisodes (total)', iTotal),
      champ('Nombre de visionnages', iFois), champ('Période', iPeriode),
      champ('Étiquettes (séparées par des virgules)', iTags, 'large'), champ('URL de l\'affiche', iAffiche, 'large')),
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
      etat.animes.push(a);
      rafraichirApresChangement();
      toast(`« ${a.titre} » ajouté`);
      dlg.close();
      ouvrirDetail(a.id);
    } catch (e) { toast(e.message, true); }
  };
  $('#btn-ajouter').addEventListener('click', () => { zone.replaceChildren(); dlg.showModal(); $('#ajout-q').focus(); });
  $('#form-recherche').addEventListener('submit', async (e) => {
    e.preventDefault();
    zone.replaceChildren(h('p', { class: 'muted' }, 'Recherche…'));
    try {
      const res = await api(`/api/anilist/recherche?q=${encodeURIComponent($('#ajout-q').value)}`);
      zone.replaceChildren(...(res.length
        ? res.map((m) => resultat(m, 'Ajouter', () => creer({ titre: m.titre, anilist_id: m.id, type: ['MOVIE', 'SPECIAL'].includes(m.format) ? 'film' : 'serie' })))
        : [h('p', { class: 'muted' }, 'Aucun résultat.')]));
    } catch (err) { zone.replaceChildren(h('p', { class: 'erreur' }, err.message)); }
  });
  $('#ajout-manuel').addEventListener('click', () => {
    const titre = $('#ajout-q').value.trim();
    if (titre) creer({ titre }); else $('#ajout-q').focus();
  });
}

// ---------- Session ----------

function majSession() {
  $('#btn-ajouter').hidden = !etat.admin;
  const b = $('#btn-connexion');
  b.textContent = etat.admin ? 'Se déconnecter' : 'Se connecter';
  b.hidden = !etat.admin && !etat.adminDispo;
  $('#pied-info').textContent = etat.admin ? 'Mode édition : clique sur une fiche pour la modifier.' : 'Lecture seule.';
  rendreFiltres();
  rendreCollection();
}

function configurerConnexion() {
  const dlg = $('#dlg-connexion');
  $('#btn-connexion').addEventListener('click', async () => {
    if (etat.admin) {
      await api('/api/logout', { method: 'POST' });
      etat.admin = false;
      majSession();
      toast('Déconnecté');
    } else {
      $('#erreur-connexion').textContent = '';
      $('#motdepasse').value = '';
      dlg.showModal();
      $('#motdepasse').focus();
    }
  });
  $('#form-connexion').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/login', { method: 'POST', body: { motdepasse: $('#motdepasse').value } });
      etat.admin = true;
      dlg.close();
      majSession();
      toast('Connecté : tu peux modifier la liste');
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

  document.querySelectorAll('[data-onglet]').forEach((b) => b.addEventListener('click', () => {
    etat.onglet = b.dataset.onglet;
    document.querySelectorAll('[data-onglet]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    $('#vue-collection').hidden = etat.onglet !== 'collection';
    $('#vue-stats').hidden = etat.onglet !== 'stats';
    if (etat.onglet === 'stats') rendreStats();
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
    etat.f = { q: '', statut: 'tous', type: '', tag: '', periode: '', genre: '' };
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

async function demarrer() {
  init();
  try {
    try {
      const [session, animes] = await Promise.all([api('/api/session'), api('/api/animes')]);
      etat.admin = session.admin;
      etat.adminDispo = session.adminDispo;
      etat.animes = animes;
    } catch {
      // Pas de serveur (site publié sur GitHub Pages) : lecture seule depuis animes.json, chemin relatif.
      etat.animes = await api('animes.json');
      etat.admin = false;
      etat.adminDispo = false;
      const lien = $('.pied a');
      lien.href = 'animes.json';
    }
    indexer();
  } catch (e) {
    $('#liste').replaceChildren(h('p', { class: 'vide' }, `Impossible de charger la liste : ${e.message}`));
    return;
  }
  majSession();
}

demarrer();
