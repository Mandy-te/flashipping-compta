/* =========================================================================
   FLASHIPPING - Logique PWA
   Fonctionne hors ligne : les saisies sont mises en file dans IndexedDB
   puis envoyees automatiquement des que le reseau revient.
   ========================================================================= */

/* -------- A CONFIGURER ------------------------------------------------- */
const API_URL = 'https://script.google.com/macros/s/AKfycbyA8oEoUQB_C9K67Wl6jFZp6Fe8KOT6W20k8VtGJzU41dCr2behwJpWGIOZGU5P3tInvg/exec';
// Doit etre IDENTIQUE au TOKEN en haut de Code.gs
const TOKEN   = 'FLASHIPPING@2026';
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
    req.onerror = () => reject(req.error);
  });
}

function tx(store, mode) {
  return db.transaction(store, mode).objectStore(store);
}

function fileAjouter(item) {
  return new Promise((res, rej) => {
    const r = tx('file', 'readwrite').add(item);
    r.onsuccess = () => res(); r.onerror = () => rej(r.error);
  });
}

function fileLire() {
  return new Promise((res, rej) => {
    const r = tx('file', 'readonly').getAll();
    r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error);
  });
}

function fileSupprimer(id) {
  return new Promise((res) => {
    const r = tx('file', 'readwrite').delete(id);
    r.onsuccess = () => res(); r.onerror = () => res();
  });
}

function cacheEcrire(cle, valeur) {
  return new Promise((res) => {
    const r = tx('cache', 'readwrite').put({ cle, valeur, t: Date.now() });
    r.onsuccess = () => res(); r.onerror = () => res();
  });
}

function cacheLire(cle) {
  return new Promise((res) => {
    const r = tx('cache', 'readonly').get(cle);
    r.onsuccess = () => res(r.result ? r.result.valeur : null);
    r.onerror = () => res(null);
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

async function soumettre(type, payload, msgId, apresSucces) {
  const item = { local_id: localId(), type, payload, cree: Date.now() };

  if (!navigator.onLine) {
    await fileAjouter(item);
    await majReseau();
    afficher(msgId, 'ok', 'Enregistré sur le téléphone. Envoi dès le retour du réseau.');
    apresSucces();
    return;
  }

  try {
    const rep = await api({ action: type, data: payload });
    if (rep.ok) {
      afficher(msgId, 'ok', 'Enregistré — ' + rep.id + ' · ' + gdes(rep.montant_gdes));
      apresSucces();
      await chargerSoldes();
    } else if (rep.code === 'SOLDE_INSUFFISANT') {
      afficher(msgId, 'err', rep.message);
    } else {
      afficher(msgId, 'err', rep.message || 'Enregistrement refusé.');
    }
  } catch (e) {
    await fileAjouter(item);
    await majReseau();
    afficher(msgId, 'ok', 'Réseau indisponible. Gardé sur le téléphone, envoi automatique plus tard.');
    apresSucces();
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
    return `<div class="ligne">
      <div class="g">
        <div class="nom">${a.nom}</div>
        <div class="meta">Part ${(a.part * 100).toFixed(0)}% ·
          apports ${gdes(a.apports)}</div>
      </div>
      <div class="val ${n ? 'neg' : ''}">${gdes(a.solde_gdes)}</div>
    </div>`;
  }).join('') || '<div class="vide">Aucun associé actif.</div>';
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
          <div class="meta">Part ${(a.part * 100).toFixed(0)}% ·
            solde ${gdes(a.solde_gdes)}</div></div>
        <div class="val ${n ? 'neg' : 'pos'}">${gdes(a.part_profit_gdes)}</div></div>`;
    }).join('') + `</div>`;

  html += `<button class="principal" onclick="window.print()"
    style="margin-bottom:24px">Imprimer / PDF</button>`;

  zone.innerHTML = html;
}

/* ============================ Initialisation ============================ */

async function init() {
  await ouvrirDB();

  document.getElementById('d-date').value = aujourdhui();
  document.getElementById('r-date').value = aujourdhui();
  document.getElementById('c-date').value = aujourdhui();

  // navigation
  document.querySelectorAll('nav button').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('nav button').forEach(x => x.classList.remove('on'));
      document.querySelectorAll('section').forEach(x => x.classList.remove('actif'));
      b.classList.add('on');
      document.getElementById(b.dataset.v).classList.add('actif');
      if (b.dataset.v === 'v-soldes') chargerSoldes();
    });
  });

  // bascules devise
  brancherBascule('d-devise', () => apercuConversion('d-montant', 'd-devise', 'd-apercu'));
  brancherBascule('r-devise', () => apercuConversion('r-montant', 'r-devise', 'r-apercu'));
  brancherBascule('c-devise', () => apercuConversion('c-montant', 'c-devise', 'c-apercu'));

  document.getElementById('d-montant').addEventListener('input',
    () => apercuConversion('d-montant', 'd-devise', 'd-apercu'));
  document.getElementById('r-montant').addEventListener('input',
    () => apercuConversion('r-montant', 'r-devise', 'r-apercu'));
  document.getElementById('c-montant').addEventListener('input',
    () => apercuConversion('c-montant', 'c-devise', 'c-apercu'));

  // depense
  document.getElementById('d-envoyer').addEventListener('click', async () => {
    const sel = document.getElementById('d-objet');
    const opt = sel.options[sel.selectedIndex];
    const montant = parseFloat(document.getElementById('d-montant').value);
    if (!montant || montant <= 0) {
      afficher('msg-dep', 'err', 'Indiquez un montant supérieur à zéro.'); return;
    }
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
    });
  });

  // revenu
  document.getElementById('r-envoyer').addEventListener('click', async () => {
    const montant = parseFloat(document.getElementById('r-montant').value);
    if (!montant || montant <= 0) {
      afficher('msg-rev', 'err', 'Indiquez un montant supérieur à zéro.'); return;
    }
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
    });
  });

  // contribution
  document.getElementById('c-envoyer').addEventListener('click', async () => {
    const montant = parseFloat(document.getElementById('c-montant').value);
    if (!montant || montant <= 0) {
      afficher('msg-ctr', 'err', 'Indiquez un montant supérieur à zéro.'); return;
    }
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
    });
  });

  document.getElementById('s-rafraichir')
    .addEventListener('click', chargerSoldes);

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

  await majReseau();
  await chargerReference();
  await chargerSoldes();
  await synchroniser();

  setInterval(synchroniser, 60000);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
