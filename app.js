/* =========================================================================
   FLASHIPPING - Logique PWA
   Fonctionne hors ligne : les saisies sont mises en file dans IndexedDB
   puis envoyees automatiquement des que le reseau revient.
   ========================================================================= */

/* -------- A CONFIGURER ------------------------------------------------- */
const API_URL = 'https://script.google.com/macros/library/d/1nyn0E9cDpuER_sTDlzti10N-1TNLrj52TV80mylCeBce0pw_it8lEcD7/10';
// Doit etre IDENTIQUE au TOKEN en haut de Code.gs
const TOKEN   = 'FLASHIPPING@2026;
/* ----------------------------------------------------------------------- */

const OBJETS_DEPENSE = {
  'Logistique': ['Colis Boxpaq','Hiace','Moto Ouanaminthe','Moto Cap-Haitien',
                 'Douane','Sac','Frais Transfert','Frais Retrait','Essence/Carburant'],
  'RH': ['Salaire Employe','Commission Partenaire','Salaire Associe'],
  'Structure': ['Loyer','Electricite','Internet/Telephone','Impressions/Fournitures'],
  'Marketing': ['Publicite','Reseaux Sociaux'],
  'Autre': ['Entretien Vehicule','Frais Bancaires','Divers']
};

let etat = {
  taux: 135,
  associes: [],
  agences: [],
  enLigne: navigator.onLine,
  fileCount: 0
};

/* ====================== IndexedDB : file d'attente ====================== */

let db = null;
let memFile = [];   // repli si IndexedDB est indisponible
let memCache = {};

/* Bandeau d'erreur visible (pas de console sur telephone) */
function erreurGlobale(txt) {
  let el = document.getElementById('erreur-globale');
  if (!el) {
    el = document.createElement('div');
    el.id = 'erreur-globale';
    el.style.cssText = 'position:fixed;bottom:64px;left:8px;right:8px;z-index:999;'
      + 'background:#B3352C;color:#fff;padding:10px 12px;border-radius:8px;'
      + 'font-size:12px;line-height:1.35;white-space:pre-wrap';
    el.addEventListener('click', () => el.remove());
    document.body.appendChild(el);
  }
  el.textContent = 'Erreur : ' + txt + '\n(toucher pour fermer)';
}

window.addEventListener('error', (e) => erreurGlobale(e.message));
window.addEventListener('unhandledrejection', (e) =>
  erreurGlobale(String(e.reason && e.reason.message || e.reason)));

function ouvrirDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('flashipping', 1);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('file')) {
        d.createObjectStore('file', { keyPath: 'local_id' });
      }
      if (!d.objectStoreNames.contains('cache')) {
        d.createObjectStore('cache', { keyPath: 'cle' });
      }
    };
    req.onsuccess = () => { db = req.result; resolve(db); };
    req.onerror = () => { db = null; resolve(null); };   // on continue en memoire
    setTimeout(() => { if (!db) resolve(null); }, 3000);  // WebView bloquee
  });
}

function tx(store, mode) {
  return db.transaction(store, mode).objectStore(store);
}

function fileAjouter(item) {
  if (!db) { memFile.push(item); return Promise.resolve(); }
  return new Promise((res) => {
    try {
      const r = tx('file', 'readwrite').add(item);
      r.onsuccess = () => res();
      r.onerror = () => { memFile.push(item); res(); };
    } catch (e) { memFile.push(item); res(); }
  });
}

function fileLire() {
  if (!db) return Promise.resolve(memFile.slice());
  return new Promise((res) => {
    try {
      const r = tx('file', 'readonly').getAll();
      r.onsuccess = () => res(r.result || []);
      r.onerror = () => res(memFile.slice());
    } catch (e) { res(memFile.slice()); }
  });
}

function fileSupprimer(id) {
  memFile = memFile.filter((x) => x.local_id !== id);
  if (!db) return Promise.resolve();
  return new Promise((res) => {
    try {
      const r = tx('file', 'readwrite').delete(id);
      r.onsuccess = () => res(); r.onerror = () => res();
    } catch (e) { res(); }
  });
}

function cacheEcrire(cle, valeur) {
  memCache[cle] = valeur;
  if (!db) return Promise.resolve();
  return new Promise((res) => {
    try {
      const r = tx('cache', 'readwrite').put({ cle, valeur, t: Date.now() });
      r.onsuccess = () => res(); r.onerror = () => res();
    } catch (e) { res(); }
  });
}

function cacheLire(cle) {
  if (!db) return Promise.resolve(memCache[cle] || null);
  return new Promise((res) => {
    try {
      const r = tx('cache', 'readonly').get(cle);
      r.onsuccess = () => res(r.result ? r.result.valeur : (memCache[cle] || null));
      r.onerror = () => res(memCache[cle] || null);
    } catch (e) { res(memCache[cle] || null); }
  });
}

/* ============================== Réseau ================================= */

async function api(payload) {
  const r = await fetch(API_URL, {
    method: 'POST',
    // text/plain evite le preflight CORS qu'Apps Script ne gere pas
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(Object.assign({ token: TOKEN }, payload))
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return await r.json();
}

async function majReseau() {
  const bar = document.getElementById('reseau');
  const txt = document.getElementById('reseau-txt');
  const cpt = document.getElementById('reseau-file');
  const file = await fileLire();
  etat.fileCount = file.length;

  cpt.textContent = file.length ? file.length + ' en attente' : '';

  if (!navigator.onLine) {
    bar.className = 'hors-ligne';
    txt.textContent = 'Hors ligne — les saisies sont gardées';
  } else if (file.length) {
    bar.className = 'attente';
    txt.textContent = 'Envoi en cours…';
  } else {
    bar.className = '';
    txt.textContent = 'En ligne';
  }
}

async function synchroniser() {
  if (!navigator.onLine) return;
  const file = await fileLire();
  if (!file.length) return;

  await majReseau();
  try {
    const rep = await api({ action: 'lot', data: file });
    if (rep && rep.ok) {
      for (const r of rep.resultats) {
        if (r.resultat && r.resultat.ok) {
          await fileSupprimer(r.local_id);
        } else if (r.resultat && r.resultat.code === 'SOLDE_INSUFFISANT') {
          // on garde en file et on previent
          afficher('msg-dep', 'err',
            'Une dépense en attente a été refusée : ' + r.resultat.message);
          await fileSupprimer(r.local_id);
        } else {
          await fileSupprimer(r.local_id);
        }
      }
    }
  } catch (e) {
    // on retentera plus tard
  }
  await majReseau();
  await chargerSoldes();
}

/* ============================ Utilitaires =============================== */

const gdes = (n) => Number(n || 0).toLocaleString('fr-FR',
  { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' G';
const usd = (n) => '$' + Number(n || 0).toLocaleString('en-US',
  { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function aujourdhui() {
  const d = new Date();
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

function afficher(id, type, texte) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = 'msg ' + type;
  el.textContent = texte;
  if (type === 'ok') setTimeout(() => { el.className = 'msg'; }, 5000);
}

function deviseActive(id) {
  const on = document.querySelector('#' + id + ' button.on');
  return on ? on.dataset.v : 'Gourdes';
}

function brancherBascule(id, onChange) {
  document.querySelectorAll('#' + id + ' button').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('#' + id + ' button')
        .forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      if (onChange) onChange();
    });
  });
}

function apercuConversion(inputId, deviseId, cibleId) {
  const v = parseFloat(document.getElementById(inputId).value);
  const el = document.getElementById(cibleId);
  if (isNaN(v) || v <= 0) {
    el.textContent = 'Saisissez un montant pour voir la conversion.';
    return;
  }
  const dev = deviseActive(deviseId);
  const g = dev === 'USD' ? v * etat.taux : v;
  const u = dev === 'USD' ? v : v / etat.taux;
  el.textContent = gdes(g) + '  ·  ' + usd(u) + '   (taux ' + etat.taux + ')';
}

function localId() {
  return 'L' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
}

/* ======================== Envoi d'une saisie ============================ */

// Verrou global : empeche tout double-envoi, meme si l'agent
// tape plusieurs fois pendant que le reseau rame.
let envoiEnCours = false;

function vibrer(ms) {
  if (navigator.vibrate) { try { navigator.vibrate(ms); } catch (e) {} }
}

function flashCarte(btn) {
  const carte = btn.closest('.carte');
  if (!carte) return;
  carte.classList.remove('valide');
  void carte.offsetWidth;          // force le redemarrage de l'animation
  carte.classList.add('valide');
  setTimeout(() => carte.classList.remove('valide'), 1200);
}

async function soumettre(type, payload, msgId, apresSucces, btn) {
  if (envoiEnCours) return;
  envoiEnCours = true;

  if (btn) { btn.classList.add('charge'); btn.disabled = true; }
  vibrer(12);

  const item = { local_id: localId(), type, payload, cree: Date.now() };

  const liberer = () => {
    envoiEnCours = false;
    if (btn) { btn.classList.remove('charge'); btn.disabled = false; }
  };

  const succes = (texte) => {
    histoDonnees = [];          // force le rechargement de l'historique
    afficher(msgId, 'ok', texte);
    apresSucces();
    if (btn) flashCarte(btn);
    vibrer([18, 60, 18]);
  };

  if (!navigator.onLine) {
    await fileAjouter(item);
    await majReseau();
    succes('Enregistré sur le téléphone. Envoi dès le retour du réseau.');
    liberer();
    return;
  }

  try {
    const rep = await api({ action: type, data: payload });
    if (rep.ok) {
      succes('Enregistré — ' + rep.id + ' · ' + gdes(rep.montant_gdes));
      await chargerSoldes();
    } else if (rep.code === 'SOLDE_INSUFFISANT') {
      afficher(msgId, 'err', rep.message);
      vibrer(220);
    } else {
      afficher(msgId, 'err', rep.message || 'Enregistrement refusé.');
      vibrer(220);
    }
  } catch (e) {
    await fileAjouter(item);
    await majReseau();
    succes('Réseau indisponible. Gardé sur le téléphone, envoi automatique plus tard.');
  } finally {
    liberer();
  }
}

/* ========================= Données de référence ========================= */

async function chargerReference() {
  let ref = null;
  try {
    ref = await api({ action: 'reference' });
    if (ref.ok) await cacheEcrire('reference', ref);
  } catch (e) {
    ref = await cacheLire('reference');
  }
  if (!ref || !ref.ok) return;

  etat.taux = ref.taux || 135;
  etat.associes = ref.associes || [];
  etat.agences = ref.agences || [];

  // agences
  const optAg = etat.agences.map(a =>
    `<option value="${a.agence_id}">${a.nom_agence}</option>`).join('');
  document.getElementById('d-agence').innerHTML = optAg;
  document.getElementById('r-agence').innerHTML = optAg;

  // associes
  document.getElementById('c-associe').innerHTML = etat.associes.map(a =>
    `<option value="${a.associe_id}">${a.nom_complet}</option>`).join('');

  // objets de depense groupes
  document.getElementById('d-objet').innerHTML =
    Object.entries(OBJETS_DEPENSE).map(([cat, list]) =>
      `<optgroup label="${cat}">` +
      list.map(o => `<option value="${o}" data-cat="${cat}">${o}</option>`).join('') +
      `</optgroup>`).join('');
}

async function chargerSoldes() {
  let s = null;
  try {
    s = await api({ action: 'soldes' });
    if (s.ok) await cacheEcrire('soldes', s);
  } catch (e) {
    s = await cacheLire('soldes');
  }
  if (!s || !s.ok) return;

  const neg = s.solde_entreprise_gdes < 0;
  const el = document.getElementById('solde-ent');
  el.textContent = gdes(s.solde_entreprise_gdes);
  el.className = 'montant' + (neg ? ' neg' : '');
  document.getElementById('solde-ent-usd').textContent =
    usd(s.solde_entreprise_usd) + '  ·  taux ' + s.taux;

  document.getElementById('liste-soldes').innerHTML = s.associes.map(a => {
    const n = a.solde_gdes < 0;
    const eff = (a.part_effective * 100);
    const stat = (a.part * 100);
    const ecart = a.ecart_capital || 0;

    let etat;
    if (a.a_jour) {
      etat = `<span class="puce">a jour</span>`;
    } else if (ecart > 0) {
      etat = `<span class="puce attente">doit ${gdes(ecart)}</span>`;
    } else {
      etat = `<span class="puce">avance ${gdes(-ecart)}</span>`;
    }

    return `<div class="ligne">
      <div class="g">
        <div class="nom">${a.nom}</div>
        <div class="meta">
          Financement ${eff.toFixed(1)}% &middot; statut ${stat.toFixed(0)}%<br>
          Apports ${gdes(a.capital_finance)} &middot; profit ${gdes(a.part_profit)}
        </div>
        <div style="margin-top:5px">${etat}</div>
      </div>
      <div class="val ${n ? 'neg' : ''}">${gdes(a.solde_gdes)}</div>
    </div>`;
  }).join('') || '<div class="vide">Aucun associe actif.</div>';

  // bandeau d'explication du mode de repartition
  const zoneInfo = document.getElementById('info-repartition');
  if (zoneInfo) {
    if (s.parts_equilibrees) {
      zoneInfo.className = 'msg ok';
      zoneInfo.innerHTML = 'Tous les associes financent a hauteur de leur part. '
        + 'Le profit se repartit donc selon les parts statutaires 40/20/20/20.';
    } else {
      zoneInfo.className = 'msg err';
      zoneInfo.innerHTML = 'Les apports ne correspondent pas encore aux parts statutaires. '
        + 'Le profit est reparti au prorata du financement reel de chacun. '
        + 'Des que les apports seront a niveau, la repartition redeviendra 40/20/20/20 '
        + 'automatiquement.';
    }
  }
}


/* ============================= Historique =============================== */

let histoType = 'depense';
let histoDonnees = [];

function rendreHistorique() {
  const zone = document.getElementById('histo-liste');
  const resume = document.getElementById('histo-resume');
  const q = (document.getElementById('histo-recherche').value || '')
    .toLowerCase().trim();

  let lignes = histoDonnees;
  if (q) {
    lignes = lignes.filter(l =>
      (l.titre || '').toLowerCase().includes(q) ||
      (l.detail || '').toLowerCase().includes(q) ||
      (l.lieu || '').toLowerCase().includes(q) ||
      (l.id || '').toLowerCase().includes(q) ||
      (l.date || '').includes(q));
  }

  const total = lignes.reduce((s, l) => s + (l.montant_gdes || 0), 0);
  const mot = histoType === 'depense' ? 'depense'
            : histoType === 'revenu' ? 'revenu' : 'apport';
  resume.textContent = lignes.length + ' ' + mot + (lignes.length > 1 ? 's' : '')
    + '  ·  ' + gdes(total);

  if (!lignes.length) {
    zone.innerHTML = '<div class="vide">' +
      (q ? 'Aucun resultat pour cette recherche.' : 'Aucune ecriture enregistree.') +
      '</div>';
    return;
  }

  // regroupement par jour
  let html = '';
  let jourCourant = null;
  lignes.forEach(l => {
    if (l.date !== jourCourant) {
      jourCourant = l.date;
      html += `<div class="jour">${dateLisible(l.date)}</div>`;
    }

    const negatif = histoType === 'depense' || l.retrait;
    const signe = negatif ? '-' : '+';
    const couleur = negatif ? 'neg' : 'pos';

    let puces = '';
    if (l.urgente) puces += '<span class="puce attente">a regulariser</span> ';
    if (l.statut && l.statut !== 'Valide' && l.statut !== 'Encaisse'
        && l.statut !== 'Confirme' && !l.urgente) {
      puces += `<span class="puce">${l.statut}</span> `;
    }
    if (l.poids) puces += `<span class="puce">${l.poids} lb</span> `;

    const bas = [l.detail, l.lieu].filter(Boolean).join(' · ');

    html += `<div class="ligne">
      <div class="g">
        <div class="nom">${l.titre || ''}</div>
        ${bas ? `<div class="meta">${bas}</div>` : ''}
        <div class="meta"><span class="ref">${l.id}</span>
          ${l.devise === 'USD' ? ' · saisi en USD' : ''}</div>
        ${puces ? `<div style="margin-top:5px">${puces}</div>` : ''}
      </div>
      <div class="val ${couleur}">${signe} ${gdes(l.montant_gdes)}</div>
    </div>`;
  });

  zone.innerHTML = html;
}

function dateLisible(iso) {
  const jours = ['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'];
  const mois = ['janvier','fevrier','mars','avril','mai','juin',
                'juillet','aout','septembre','octobre','novembre','decembre'];
  const d = new Date(iso + 'T12:00:00');
  if (isNaN(d.getTime())) return iso;
  const auj = aujourdhui();
  if (iso === auj) return "Aujourd'hui";
  return jours[d.getDay()] + ' ' + d.getDate() + ' ' + mois[d.getMonth()];
}

async function chargerHistorique(type) {
  histoType = type || histoType;
  const zone = document.getElementById('histo-liste');
  zone.innerHTML = '<div class="vide">Chargement…</div>';

  let r = null;
  try {
    r = await api({ action: 'historique', type: histoType, limite: 200 });
    if (r && r.ok) await cacheEcrire('histo-' + histoType, r);
  } catch (e) {
    r = await cacheLire('histo-' + histoType);
  }

  if (!r || !r.ok) {
    zone.innerHTML = '<div class="vide">Hors ligne, et cet historique '
      + "n'a pas encore ete consulte. Reconnectez-vous une fois pour le garder.</div>";
    document.getElementById('histo-resume').textContent = '—';
    return;
  }

  histoDonnees = r.lignes || [];
  rendreHistorique();
}

/* ============================== Rapports ================================ */

async function chargerRapport(type) {
  const zone = document.getElementById('rapport-zone');
  zone.innerHTML = '<div class="vide">Chargement…</div>';

  let r = null;
  try {
    r = await api({ action: 'rapport', type });
    await cacheEcrire('rapport-' + type, r);
  } catch (e) {
    r = await cacheLire('rapport-' + type);
    if (!r) {
      zone.innerHTML = '<div class="vide">Hors ligne, et ce rapport ' +
        'n\'a pas encore été consulté. Reconnectez-vous une fois pour le garder.</div>';
      return;
    }
  }
  if (!r || !r.ok) { zone.innerHTML = '<div class="vide">Rapport indisponible.</div>'; return; }

  const profitPos = r.profit_gdes >= 0;

  let html = `
  <div class="carte" style="padding:12px 14px">
    <div class="meta" style="font-size:13px;color:var(--gris)">
      Du ${r.debut} au ${r.fin}
    </div>
  </div>
  <div class="chiffres">
    <div class="chiffre"><div class="t">Revenus</div>
      <div class="v pos">${gdes(r.total_revenus_gdes)}</div></div>
    <div class="chiffre"><div class="t">Dépenses</div>
      <div class="v neg">${gdes(r.total_depenses_gdes)}</div></div>
    <div class="chiffre"><div class="t">Profit</div>
      <div class="v ${profitPos ? 'pos' : 'neg'}">${gdes(r.profit_gdes)}</div></div>
    <div class="chiffre"><div class="t">Poids livré</div>
      <div class="v">${Number(r.poids_livre_total || 0).toFixed(1)} lb</div></div>
  </div>`;

  if (r.a_regulariser > 0) {
    html += `<div class="msg err" style="display:block">
      ${r.a_regulariser} dépense(s) urgente(s) à régulariser sur cette période.</div>`;
  }

  const objets = Object.entries(r.depenses_par_objet || {})
    .sort((a, b) => b[1] - a[1]);
  if (objets.length) {
    html += `<h2 style="margin-top:18px">Dépenses par objet</h2><div class="carte">` +
      objets.map(([k, v]) => `<div class="ligne">
        <div class="g"><div class="nom">${k}</div></div>
        <div class="val">${gdes(v)}</div></div>`).join('') + `</div>`;
  }

  const sources = Object.entries(r.revenus_par_source || {})
    .sort((a, b) => b[1] - a[1]);
  if (sources.length) {
    html += `<h2 style="margin-top:18px">Revenus par source</h2><div class="carte">` +
      sources.map(([k, v]) => `<div class="ligne">
        <div class="g"><div class="nom">${k}</div></div>
        <div class="val">${gdes(v)}</div></div>`).join('') + `</div>`;
  }

  html += `<h2 style="margin-top:18px">Répartition du profit</h2><div class="carte">` +
    (r.repartition || []).map(a => {
      const n = a.part_profit_gdes < 0;
      return `<div class="ligne">
        <div class="g"><div class="nom">${a.nom}</div>
          <div class="meta">Financement ${(a.part_effective * 100).toFixed(1)}% ·
            statut ${(a.part * 100).toFixed(0)}% · solde ${gdes(a.solde_gdes)}</div></div>
        <div class="val ${n ? 'neg' : 'pos'}">${gdes(a.part_profit_gdes)}</div></div>`;
    }).join('') + `</div>`;

  html += `<button class="principal" onclick="window.print()"
    style="margin-bottom:24px">Imprimer / PDF</button>`;

  zone.innerHTML = html;
}

/* ============================ Initialisation ============================ */

/* --- Branchement de l'interface : SYNCHRONE, aucune dependance reseau/DB --- */
function brancherUI() {
  document.getElementById('d-date').value = aujourdhui();
  document.getElementById('r-date').value = aujourdhui();
  document.getElementById('c-date').value = aujourdhui();

  // navigation entre les vues
  document.querySelectorAll('nav button').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('nav button').forEach(x => x.classList.remove('on'));
      document.querySelectorAll('section').forEach(x => x.classList.remove('actif'));
      b.classList.add('on');
      const vue = document.getElementById(b.dataset.v);
      if (vue) vue.classList.add('actif');
      window.scrollTo(0, 0);
      if (b.dataset.v === 'v-soldes') chargerSoldes();
      if (b.dataset.v === 'v-histo' && !histoDonnees.length) chargerHistorique();
    });
  });

  // bascules de devise
  brancherBascule('d-devise', () => apercuConversion('d-montant', 'd-devise', 'd-apercu'));
  brancherBascule('r-devise', () => apercuConversion('r-montant', 'r-devise', 'r-apercu'));
  brancherBascule('c-devise', () => apercuConversion('c-montant', 'c-devise', 'c-apercu'));

  document.getElementById('d-montant').addEventListener('input',
    () => apercuConversion('d-montant', 'd-devise', 'd-apercu'));
  document.getElementById('r-montant').addEventListener('input',
    () => apercuConversion('r-montant', 'r-devise', 'r-apercu'));
  document.getElementById('c-montant').addEventListener('input',
    () => apercuConversion('c-montant', 'c-devise', 'c-apercu'));

  // ---- depense ----
  document.getElementById('d-envoyer').addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    const sel = document.getElementById('d-objet');
    const opt = sel.options[sel.selectedIndex];
    const montant = parseFloat(document.getElementById('d-montant').value);
    if (!montant || montant <= 0) {
      afficher('msg-dep', 'err', 'Indiquez un montant superieur a zero.'); return;
    }
    try {
      await soumettre('depense', {
        date: document.getElementById('d-date').value,
        objet: sel.value,
        categorie: opt ? opt.dataset.cat : '',
        description: document.getElementById('d-desc').value,
        agence_id: document.getElementById('d-agence').value,
        montant_saisi: montant,
        devise_saisie: deviseActive('d-devise'),
        urgente_hors_solde: document.getElementById('d-urgente').checked ? 'Oui' : 'Non'
      }, 'msg-dep', () => {
        document.getElementById('d-montant').value = '';
        document.getElementById('d-desc').value = '';
        document.getElementById('d-urgente').checked = false;
        document.getElementById('d-apercu').textContent =
          'Saisissez un montant pour voir la conversion.';
      }, btn);
    } catch (e) {
      afficher('msg-dep', 'err', String(e.message || e));
    }
  });

  // ---- revenu ----
  document.getElementById('r-envoyer').addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    const montant = parseFloat(document.getElementById('r-montant').value);
    if (!montant || montant <= 0) {
      afficher('msg-rev', 'err', 'Indiquez un montant superieur a zero.'); return;
    }
    try {
      await soumettre('revenu', {
        date: document.getElementById('r-date').value,
        source: document.getElementById('r-source').value,
        agence_id: document.getElementById('r-agence').value,
        client: document.getElementById('r-client').value,
        montant_saisi: montant,
        devise_saisie: deviseActive('r-devise'),
        poids_livre: parseFloat(document.getElementById('r-poids').value) || 0,
        statut: 'Encaisse'
      }, 'msg-rev', () => {
        document.getElementById('r-montant').value = '';
        document.getElementById('r-poids').value = '';
        document.getElementById('r-client').value = '';
        document.getElementById('r-apercu').textContent =
          'Saisissez un montant pour voir la conversion.';
      }, btn);
    } catch (e) {
      afficher('msg-rev', 'err', String(e.message || e));
    }
  });

  // ---- contribution ----
  document.getElementById('c-envoyer').addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    const montant = parseFloat(document.getElementById('c-montant').value);
    if (!montant || montant <= 0) {
      afficher('msg-ctr', 'err', 'Indiquez un montant superieur a zero.'); return;
    }
    try {
      await soumettre('contribution', {
        date: document.getElementById('c-date').value,
        associe_id: document.getElementById('c-associe').value,
        type_contribution: document.getElementById('c-type').value,
        montant_saisi: montant,
        devise_saisie: deviseActive('c-devise'),
        mode_paiement: document.getElementById('c-mode').value,
        reference: document.getElementById('c-ref').value,
        statut: 'Confirme'
      }, 'msg-ctr', () => {
        document.getElementById('c-montant').value = '';
        document.getElementById('c-ref').value = '';
        document.getElementById('c-apercu').textContent =
          'Saisissez un montant pour voir la conversion.';
      }, btn);
    } catch (e) {
      afficher('msg-ctr', 'err', String(e.message || e));
    }
  });

  document.getElementById('s-rafraichir').addEventListener('click', async (ev) => {
    const b = ev.currentTarget;
    b.classList.add('charge'); b.disabled = true;
    vibrer(12);
    try { await chargerSoldes(); }
    finally { b.classList.remove('charge'); b.disabled = false; }
  });

  // historique : onglets Depenses / Revenus / Apports
  document.querySelectorAll('#histo-onglets button').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('#histo-onglets button')
        .forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      document.getElementById('histo-recherche').value = '';
      vibrer(10);
      chargerHistorique(b.dataset.t);
    });
  });

  document.getElementById('histo-recherche')
    .addEventListener('input', rendreHistorique);

  document.getElementById('histo-actualiser').addEventListener('click', async (ev) => {
    const b = ev.currentTarget;
    b.classList.add('charge'); b.disabled = true;
    vibrer(12);
    try { await chargerHistorique(); }
    finally { b.classList.remove('charge'); b.disabled = false; }
  });

  // rapports
  document.querySelectorAll('#periodes button').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('#periodes button').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      chargerRapport(b.dataset.p);
    });
  });

  window.addEventListener('online', async () => { await majReseau(); synchroniser(); });
  window.addEventListener('offline', majReseau);
}

/* --- Chargement des donnees : chaque etape isolee, un echec n'arrete rien --- */
async function init() {
  brancherUI();                       // 1. l'interface repond TOUJOURS

  try { await ouvrirDB(); }           // 2. IndexedDB facultatif
  catch (e) { db = null; }

  try { await majReseau(); }          catch (e) {}
  try { await chargerReference(); }   catch (e) { erreurGlobale('reference : ' + e.message); }
  try { await chargerSoldes(); }      catch (e) { erreurGlobale('soldes : ' + e.message); }
  try { await synchroniser(); }       catch (e) {}

  setInterval(() => { synchroniser().catch(() => {}); }, 60000);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js?v=2').catch(() => {});
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
