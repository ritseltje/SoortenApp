import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import './style.css';
import { loadSpecies, loadGrid, links, norm, GROUP_ICONS } from './data.js';
import { allLogs, putLog, deleteLog, newId } from './db.js';
import { readPhotoMeta, shrinkPhoto } from './photo.js';

L.Icon.Default.mergeOptions({ iconUrl: markerIcon, iconRetinaUrl: markerIcon2x, shadowUrl: markerShadow });

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const fmtTime = (iso) => new Date(iso).toLocaleString('nl-NL', { dateStyle: 'medium', timeStyle: 'short' });
const fmtNum = (n) => n.toLocaleString('nl-NL');

const TILES = 'https://service.pdok.nl/brt/achtergrondkaart/wmts/v2_0/standaard/EPSG:3857/{z}/{x}/{y}.png';
const TILE_ATTR = 'Kaart © <a href="https://www.pdok.nl">PDOK</a> · Data: <a href="https://www.gbif.org">GBIF</a>, NSR';

const state = {
  data: null,
  logs: [],
  logged: new Map(), // species key -> logs
  groups: new Set(load('groups', null) ?? []),
  tab: load('tab', 'common'),
  commonShown: 60,
};

function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

const groupOn = (s) => state.groups.has(s.g);
const isLogged = (s) => state.logged.has(s.k);
const displayName = (s) => s.n ?? s.l;

// ---------------------------------------------------------------- startup
async function start() {
  try {
    state.data = await loadSpecies();
  } catch (e) {
    $('#main').innerHTML = `<p class="empty">${esc(e.message)}</p>`;
    return;
  }
  if (!state.groups.size) state.data.meta.groups.forEach((g) => state.groups.add(g.id));
  await refreshLogs();
  navigator.storage?.persist?.();
  renderChips();
  document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  $('#quick-log').addEventListener('click', () => openLog({}));
  showTab(state.tab);
  if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register('sw.js');
}

async function refreshLogs() {
  state.logs = (await allLogs()).sort((a, b) => b.t.localeCompare(a.t));
  state.logged = new Map();
  for (const l of state.logs) {
    if (!state.logged.has(l.k)) state.logged.set(l.k, []);
    state.logged.get(l.k).push(l);
  }
}

function rerender() {
  renderChips();
  views[state.tab]();
}

function showTab(tab) {
  if (!views[tab]) tab = 'common';
  state.tab = tab;
  save('tab', tab);
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.body.dataset.tab = tab;
  views[tab]();
}

// ---------------------------------------------------------------- group filter
function renderChips() {
  const { groups } = state.data.meta;
  const all = state.groups.size === groups.length;
  $('#chips').innerHTML = `<button class="chip ${all ? 'on' : ''}" data-g="*">Alle</button>` + groups.map((g) =>
    `<button class="chip ${state.groups.has(g.id) && !all ? 'on' : ''}" data-g="${g.id}">${GROUP_ICONS[g.id]} ${esc(g.name)}</button>`).join('');
  $('#chips').onclick = (e) => {
    const g = e.target.closest('.chip')?.dataset.g;
    if (!g) return;
    if (g === '*') {
      groups.forEach((x) => state.groups.add(x.id));
    } else if (state.groups.size === groups.length) {
      state.groups = new Set([g]); // from "all", tapping a group selects only that group
    } else if (state.groups.has(g)) {
      state.groups.delete(g);
      if (!state.groups.size) groups.forEach((x) => state.groups.add(x.id));
    } else {
      state.groups.add(g);
    }
    save('groups', [...state.groups]);
    state.commonShown = 60;
    rerender();
  };
}

// ---------------------------------------------------------------- species rows
function speciesRow(s, extra = '') {
  const done = isLogged(s);
  return `<li class="row" data-k="${s.k}">
    <span class="icon">${GROUP_ICONS[s.g]}</span>
    <span class="names"><b>${esc(displayName(s))}</b>${s.n ? `<i>${esc(s.l)}</i>` : ''}</span>
    ${extra}
    ${done ? '<span class="tick" title="Gelogd">✓</span>' : `<button class="add" data-log="${s.k}" aria-label="Loggen">＋</button>`}
  </li>`;
}

function bindRows(root) {
  root.onclick = (e) => {
    const log = e.target.closest('[data-log]');
    if (log) return openLog({ species: state.data.byKey.get(+log.dataset.log) });
    const row = e.target.closest('[data-k]');
    if (row) openSpecies(state.data.byKey.get(+row.dataset.k));
  };
}

// ---------------------------------------------------------------- tab: common
function renderCommon() {
  const list = state.data.species.filter((s) => groupOn(s) && !isLogged(s))
    .sort((a, b) => b.c - a.c || b.ct - a.ct);
  const shown = list.slice(0, state.commonShown);
  $('#main').innerHTML = `
    <p class="hint">Algemene soorten die je nog niet hebt gelogd, op volgorde van aantal waarnemingen in Nederland (${esc(state.data.meta.recentYears.replace(',', '–'))}).</p>
    <ul class="list">${shown.map((s) => speciesRow(s, `<span class="count">${fmtNum(s.c)}</span>`)).join('')}</ul>
    ${list.length > shown.length ? `<button class="more">Meer tonen (${fmtNum(list.length - shown.length)} over)</button>` : ''}
    ${!list.length ? '<p class="empty">Alles gelogd in deze groep(en)! 🎉</p>' : ''}`;
  bindRows($('#main .list'));
  $('#main .more')?.addEventListener('click', () => { state.commonShown += 100; renderCommon(); });
}

// ---------------------------------------------------------------- tab: map
let map, cellLayer, logLayer, gridCells;
async function renderMap() {
  const main = $('#main');
  if (!map) {
    main.innerHTML = '<div id="map"></div><div id="map-legend"></div><div id="cell-panel" hidden></div>';
    map = L.map('map', { zoomControl: false, attributionControl: true }).setView([52.2, 5.3], 7);
    L.tileLayer(TILES, { maxZoom: 19, minZoom: 6, attribution: TILE_ATTR }).addTo(map);
    L.control.zoom({ position: 'topright' }).addTo(map);
    const Locate = L.Control.extend({
      onAdd: () => {
        const b = L.DomUtil.create('button', 'locate');
        b.textContent = '◎';
        b.title = 'Mijn locatie';
        L.DomEvent.on(b, 'click', (e) => {
          L.DomEvent.stop(e);
          getPosition().then((p) => map.setView([p.lat, p.lon], 11)).catch((err) => toast(err.message));
        });
        return b;
      },
    });
    new Locate({ position: 'topright' }).addTo(map);
    cellLayer = L.layerGroup().addTo(map);
    logLayer = L.layerGroup().addTo(map);
    gridCells = await loadGrid();
  } else {
    // map element survives tab switches; re-attach it
    if (!main.contains($('#map'))) main.replaceChildren(...mapNodes);
    setTimeout(() => map.invalidateSize(), 0);
  }
  mapNodes = [...main.children];
  drawCells();
}
let mapNodes = [];

function cellUnlogged(cell) {
  const sp = state.data.species;
  const out = [];
  for (let j = 0; j < cell.idx.length; j++) {
    const s = sp[cell.idx[j]];
    if (s && groupOn(s) && !isLogged(s)) out.push([s, cell.cnt[j]]);
  }
  return out;
}

function drawCells() {
  const { grid } = state.data.meta;
  cellLayer.clearLayers();
  logLayer.clearLayers();
  if (!gridCells.length) {
    $('#map-legend').innerHTML = 'Nog geen hotspotdata beschikbaar.';
    return;
  }
  const counts = gridCells.map((c) => cellUnlogged(c).length);
  const sorted = counts.filter((n) => n > 0).sort((a, b) => a - b);
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
  const breaks = [q(0.2), q(0.4), q(0.6), q(0.8), q(0.95)];
  const colors = ['#ffffb2', '#fed976', '#feb24c', '#fd8d3c', '#f03b20', '#bd0026'];
  const color = (n) => colors[breaks.filter((b) => n > b).length];
  gridCells.forEach((cell, i) => {
    const n = counts[i];
    if (!n) return;
    const lat = grid.lat0 + cell.r * grid.dLat;
    const lon = grid.lon0 + cell.c * grid.dLon;
    L.rectangle([[lat, lon], [lat + grid.dLat, lon + grid.dLon]], {
      weight: 0.5, color: '#7a2a00', fillColor: color(n), fillOpacity: 0.55,
    }).on('click', () => showCell(cell, lat, lon)).addTo(cellLayer);
  });
  for (const l of state.logs) {
    if (l.lat == null) continue;
    const s = state.data.byKey.get(l.k);
    if (!s || !groupOn(s)) continue;
    L.circleMarker([l.lat, l.lon], { radius: 5, weight: 1.5, color: '#fff', fillColor: '#1565c0', fillOpacity: 1 })
      .bindPopup(`<b>${esc(displayName(s))}</b><br>${esc(fmtTime(l.t))}`).addTo(logLayer);
  }
  $('#map-legend').innerHTML = `<span>Nog niet gelogde soorten per hok</span><span class="scale">${colors.map((c, i) =>
    `<i style="background:${c}"></i>${i < breaks.length ? `<small>${breaks[i]}</small>` : ''}`).join('')}</span>`;
}

function showCell(cell, lat, lon) {
  const list = cellUnlogged(cell).sort((a, b) => b[1] - a[1]);
  const panel = $('#cell-panel');
  panel.hidden = false;
  panel.innerHTML = `<header><b>${fmtNum(list.length)} nog niet gelogde soorten</b>
      <small>hok ${lat.toFixed(2)}°N ${lon.toFixed(2)}°O · aantal waarnemingen</small>
      <button class="close" aria-label="Sluiten">✕</button></header>
    <ul class="list">${list.slice(0, 300).map(([s, n]) => speciesRow(s, `<span class="count">${fmtNum(n)}</span>`)).join('')}</ul>`;
  panel.querySelector('.close').onclick = () => { panel.hidden = true; };
  bindRows(panel.querySelector('.list'));
}

// ---------------------------------------------------------------- tab: taxonomy / search
const treeOpen = new Set();
let searchQuery = '';
function renderTree() {
  $('#main').innerHTML = `<div class="search"><input type="search" placeholder="Zoek op Nederlandse of Latijnse naam" value="${esc(searchQuery)}" autocomplete="off"></div><div id="tree"></div>`;
  const input = $('#main input');
  input.addEventListener('input', () => { searchQuery = input.value; drawTree(); });
  drawTree();
}

function drawTree() {
  const out = $('#tree');
  const species = state.data.species.filter(groupOn);
  const hn = state.data.meta.higherNames;
  const q = norm(searchQuery.trim());
  if (q) {
    const hits = species.filter((s) => s.search.includes(q))
      .sort((a, b) => rank(a, q) - rank(b, q) || b.c - a.c).slice(0, 200);
    out.innerHTML = hits.length
      ? `<ul class="list">${hits.map((s) => speciesRow(s, `<span class="path">${esc(hn[s.f] ?? s.f ?? '')}</span>`)).join('')}</ul>`
      : '<p class="empty">Geen soorten gevonden.</p>';
    bindRows(out.querySelector('.list') ?? out);
    return;
  }
  // order > family > genus > species
  const tree = new Map();
  for (const s of species) {
    const o = s.o ?? 'Onbekend', f = s.f ?? 'Onbekend';
    if (!tree.has(o)) tree.set(o, new Map());
    const fam = tree.get(o);
    if (!fam.has(f)) fam.set(f, new Map());
    const gen = fam.get(f);
    if (!gen.has(s.ge)) gen.set(s.ge, []);
    gen.get(s.ge).push(s);
  }
  const count = (list) => {
    const done = list.filter(isLogged).length;
    return `<span class="count">${done}/${list.length}</span>`;
  };
  const flat = (m) => (Array.isArray(m) ? m : [...m.values()].flatMap(flat));
  const label = (name, level) => `${hn[name] && level !== 'g' ? `${esc(hn[name])} <i>${esc(name)}</i>` : `<i>${esc(name)}</i>`}`;
  const node = (path, name, children, level) => {
    const id = `${path}/${name}`;
    const open = treeOpen.has(id);
    const inner = !open ? '' : Array.isArray(children)
      ? `<ul class="list">${children.sort((a, b) => a.l.localeCompare(b.l)).map((s) => speciesRow(s)).join('')}</ul>`
      : `<ul class="tree">${[...children.keys()].sort().map((k) => node(id, k, children.get(k), level === 'o' ? 'f' : 'g')).join('')}</ul>`;
    return `<li class="node ${level} ${open ? 'open' : ''}"><button data-node="${esc(id)}">${label(name, level)}${count(flat(children))}</button>${inner}</li>`;
  };
  out.innerHTML = `<ul class="tree">${[...tree.keys()].sort().map((o) => node('', o, tree.get(o), 'o')).join('')}</ul>`;
  out.onclick = (e) => {
    const b = e.target.closest('[data-node]');
    if (b) {
      const id = b.dataset.node;
      treeOpen.has(id) ? treeOpen.delete(id) : treeOpen.add(id);
      drawTree();
      return;
    }
    const log = e.target.closest('[data-log]');
    if (log) return openLog({ species: state.data.byKey.get(+log.dataset.log) });
    const row = e.target.closest('[data-k]');
    if (row) openSpecies(state.data.byKey.get(+row.dataset.k));
  };
}

function rank(s, q) {
  const n = norm(s.n), l = norm(s.l);
  if (n === q || l === q) return 0;
  if (n.startsWith(q) || l.startsWith(q)) return 1;
  if (n.split(/[\s-]/).some((w) => w.startsWith(q))) return 2;
  return 3;
}

// ---------------------------------------------------------------- tab: my logs
function renderMine() {
  const { groups } = state.data.meta;
  const stats = groups.map((g) => {
    const all = state.data.species.filter((s) => s.g === g.id);
    return { g, total: all.length, done: all.filter(isLogged).length };
  });
  const logs = state.logs.filter((l) => {
    const s = state.data.byKey.get(l.k);
    return s && groupOn(s);
  });
  $('#main').innerHTML = `
    <div class="stats">${stats.map(({ g, total, done }) =>
      `<div><span>${GROUP_ICONS[g.id]} ${esc(g.name)}</span><b>${fmtNum(done)}</b><small>van ${fmtNum(total)}</small></div>`).join('')}</div>
    <div class="actions">
      <button id="exp-csv">Exporteer CSV</button>
      <button id="exp-json">Back-up maken</button>
      <label class="button">Back-up terugzetten<input type="file" accept="application/json,.json" hidden id="imp"></label>
    </div>
    <ul class="list logs">${logs.map(logRow).join('')}</ul>
    ${!logs.length ? '<p class="empty">Nog geen waarnemingen gelogd. Tik op ＋ om te beginnen.</p>' : ''}`;
  attachThumbs($('#main'));
  bindRows($('#main .logs'));
  $('#exp-csv').onclick = exportCsv;
  $('#exp-json').onclick = exportJson;
  $('#imp').onchange = (e) => importJson(e.target.files[0]);
}

function logRow(l) {
  const s = state.data.byKey.get(l.k);
  return `<li class="row" data-k="${l.k}">
    ${l.photo ? `<img class="thumb" data-photo="${l.id}" alt="">` : `<span class="icon">${GROUP_ICONS[s.g]}</span>`}
    <span class="names"><b>${esc(displayName(s))}</b><small>${esc(fmtTime(l.t))}${l.lat != null ? ` · ${l.lat.toFixed(4)}, ${l.lon.toFixed(4)}` : ''}</small></span>
  </li>`;
}

const thumbUrls = new Map();
function attachThumbs(root) {
  root.querySelectorAll('[data-photo]').forEach((img) => {
    const log = state.logs.find((l) => l.id === img.dataset.photo);
    if (!log?.photo) return;
    if (!thumbUrls.has(log.id)) thumbUrls.set(log.id, URL.createObjectURL(log.photo));
    img.src = thumbUrls.get(log.id);
  });
}

function download(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function exportCsv() {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['datum', 'nederlandse_naam', 'latijnse_naam', 'groep', 'breedtegraad', 'lengtegraad', 'bron', 'notitie']];
  for (const l of state.logs) {
    const s = state.data.byKey.get(l.k);
    rows.push([l.t, s?.n, s?.l, s?.g, l.lat, l.lon, l.src, l.note]);
  }
  download('waarnemingen.csv', new Blob([rows.map((r) => r.map(q).join(',')).join('\n')], { type: 'text/csv' }));
}

const blobToDataUrl = (b) => new Promise((r) => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); });

async function exportJson() {
  const logs = await Promise.all(state.logs.map(async (l) => ({ ...l, photo: l.photo ? await blobToDataUrl(l.photo) : null })));
  download(`soortenapp-backup-${new Date().toISOString().slice(0, 10)}.json`, new Blob([JSON.stringify({ version: 1, logs })], { type: 'application/json' }));
}

async function importJson(file) {
  if (!file) return;
  try {
    const { logs } = JSON.parse(await file.text());
    for (const l of logs) {
      if (l.photo) l.photo = await (await fetch(l.photo)).blob();
      await putLog(l);
    }
    await refreshLogs();
    toast(`${logs.length} waarnemingen teruggezet`);
    rerender();
  } catch (e) {
    toast(`Terugzetten mislukt: ${e.message}`);
  }
}

const views = { common: renderCommon, map: renderMap, tree: renderTree, mine: renderMine };

// ---------------------------------------------------------------- sheets
function openSheet(html) {
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  sheet.innerHTML = `<div class="sheet-body">${html}</div>`;
  document.body.append(sheet);
  history.pushState({ sheet: true }, '');
  const close = () => {
    if (!sheet.isConnected) return;
    sheet.remove();
    window.removeEventListener('popstate', onPop);
  };
  const onPop = () => close();
  window.addEventListener('popstate', onPop);
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet || e.target.closest('.close')) history.back();
  });
  return { el: sheet, close: () => history.back() };
}

function openSpecies(s) {
  const hn = state.data.meta.higherNames;
  const lk = links(s);
  const logs = state.logged.get(s.k) ?? [];
  const group = state.data.meta.groups.find((g) => g.id === s.g);
  const taxon = (name) => (name ? `${hn[name] ? `${esc(hn[name])} ` : ''}<i>${esc(name)}</i>` : '–');
  const { el } = openSheet(`
    <header><div><h2>${esc(displayName(s))}</h2>${s.n ? `<p><i>${esc(s.l)}</i></p>` : ''}</div><button class="close" aria-label="Sluiten">✕</button></header>
    <dl class="taxon">
      <dt>Groep</dt><dd>${GROUP_ICONS[s.g]} ${esc(group?.name)}</dd>
      <dt>Orde</dt><dd>${taxon(s.o)}</dd>
      <dt>Familie</dt><dd>${taxon(s.f)}</dd>
      <dt>Geslacht</dt><dd><i>${esc(s.ge)}</i></dd>
      <dt>Waarnemingen NL</dt><dd>${fmtNum(s.c)} recent · ${fmtNum(s.ct)} totaal</dd>
    </dl>
    <div class="links">
      <a href="${lk.waarneming}" target="_blank" rel="noopener">Waarneming.nl ↗</a>
      ${lk.atlas ? `<a href="${lk.atlas}" target="_blank" rel="noopener">Verspreidingsatlas ↗</a>` : ''}
      ${lk.nsr ? `<a href="${lk.nsr}" target="_blank" rel="noopener">Soortenregister ↗</a>` : ''}
    </div>
    <button class="primary" data-act="log">＋ Waarneming loggen</button>
    ${logs.length ? `<h3>Mijn waarnemingen (${logs.length})</h3><ul class="list logs">${logs.map((l) => `
      <li class="row">
        ${l.photo ? `<img class="thumb big" data-photo="${l.id}" alt="">` : ''}
        <span class="names"><b>${esc(fmtTime(l.t))}</b><small>${l.lat != null ? `${l.lat.toFixed(5)}, ${l.lon.toFixed(5)}` : 'geen locatie'} · ${esc(srcLabel(l.src))}</small>${l.note ? `<small>${esc(l.note)}</small>` : ''}</span>
        <button class="del" data-del="${l.id}" aria-label="Verwijderen">🗑</button>
      </li>`).join('')}</ul>` : ''}`);
  attachThumbs(el);
  el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-act="log"]')) {
      history.back();
      setTimeout(() => openLog({ species: s }), 50);
    }
    const del = e.target.closest('[data-del]');
    if (del && confirm('Deze waarneming verwijderen?')) {
      await deleteLog(del.dataset.del);
      await refreshLogs();
      history.back();
      rerender();
    }
  });
}

const srcLabel = (src) => ({ gps: 'GPS-locatie', foto: 'uit foto', kaart: 'gekozen op kaart' }[src] ?? 'onbekend');

function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Locatie wordt niet ondersteund'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }),
      (e) => reject(new Error(e.code === 1 ? 'Geen toestemming voor locatie' : 'Locatie niet beschikbaar')),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 },
    );
  });
}

const toLocalInput = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

function openLog({ species }) {
  const log = { id: newId(), k: species?.k ?? null, t: new Date().toISOString(), lat: null, lon: null, acc: null, src: null, note: '', photo: null };
  const { el, close } = openSheet(`
    <header><h2>Waarneming loggen</h2><button class="close" aria-label="Sluiten">✕</button></header>
    <div class="field species-pick">
      <label>Soort</label>
      <div class="picked"></div>
      <input type="search" placeholder="Zoek soort…" autocomplete="off" hidden>
      <ul class="list picks"></ul>
    </div>
    <div class="field">
      <label>Foto (optioneel)</label>
      <div class="photo-buttons">
        <label class="button">📷 Camera<input type="file" accept="image/*" capture="environment" hidden data-photo-input></label>
        <label class="button">🖼 Galerij<input type="file" accept="image/*" hidden data-photo-input></label>
      </div>
      <img class="preview" hidden alt="">
      <p class="photo-info hint"></p>
    </div>
    <div class="field">
      <label>Tijdstip</label>
      <input type="datetime-local" name="time" value="${toLocalInput(new Date())}">
    </div>
    <div class="field">
      <label>Locatie <small class="loc-src"></small></label>
      <div id="log-map"></div>
      <button class="small" data-act="gps">◎ Gebruik mijn huidige locatie</button>
    </div>
    <div class="field">
      <label>Notitie (optioneel)</label>
      <textarea name="note" rows="2"></textarea>
    </div>
    <button class="primary" data-act="save">Opslaan</button>`);

  // species picker
  const picked = $('.picked', el), search = $('.species-pick input', el), picks = $('.picks', el);
  const showPicked = () => {
    const s = state.data.byKey.get(log.k);
    picked.innerHTML = s ? `<span>${GROUP_ICONS[s.g]} <b>${esc(displayName(s))}</b> <i>${esc(s.n ? s.l : '')}</i></span><button class="small" data-act="change">Wijzig</button>` : '';
    search.hidden = !!s;
    if (!s) search.focus();
  };
  search.addEventListener('input', () => {
    const q = norm(search.value.trim());
    const hits = q ? state.data.species.filter((s) => s.search.includes(q)).sort((a, b) => rank(a, q) - rank(b, q) || b.c - a.c).slice(0, 30) : [];
    picks.innerHTML = hits.map((s) => `<li class="row" data-pick="${s.k}"><span class="icon">${GROUP_ICONS[s.g]}</span><span class="names"><b>${esc(displayName(s))}</b>${s.n ? `<i>${esc(s.l)}</i>` : ''}</span></li>`).join('');
  });
  showPicked();

  // location map
  const lmap = L.map($('#log-map', el), { attributionControl: false }).setView([52.2, 5.3], 7);
  L.tileLayer(TILES, { maxZoom: 19 }).addTo(lmap);
  let marker = null;
  const setLoc = (lat, lon, src, acc = null) => {
    Object.assign(log, { lat, lon, src, acc });
    if (!marker) {
      marker = L.marker([lat, lon], { draggable: true }).addTo(lmap);
      marker.on('dragend', () => { const p = marker.getLatLng(); setLoc(p.lat, p.lng, 'kaart'); });
    } else {
      marker.setLatLng([lat, lon]);
    }
    if (src !== 'kaart') lmap.setView([lat, lon], 15);
    $('.loc-src', el).textContent = `${lat.toFixed(5)}, ${lon.toFixed(5)} · ${srcLabel(src)}${acc ? ` (±${Math.round(acc)} m)` : ''}`;
  };
  lmap.on('click', (e) => setLoc(e.latlng.lat, e.latlng.lng, 'kaart'));
  setTimeout(() => lmap.invalidateSize(), 100);
  const useGps = () => {
    $('.loc-src', el).textContent = 'locatie bepalen…';
    getPosition().then((p) => { if (log.src !== 'foto') setLoc(p.lat, p.lon, 'gps', p.acc); })
      .catch((e) => { if (log.lat == null) $('.loc-src', el).textContent = `${e.message} – tik op de kaart`; });
  };
  useGps();

  // photo
  el.querySelectorAll('[data-photo-input]').forEach((inp) => inp.addEventListener('change', async () => {
    const file = inp.files[0];
    if (!file) return;
    const info = $('.photo-info', el);
    info.textContent = 'Foto verwerken…';
    const meta = await readPhotoMeta(file);
    try {
      log.photo = await shrinkPhoto(file);
    } catch {
      log.photo = file;
    }
    const prev = $('.preview', el);
    prev.src = URL.createObjectURL(log.photo);
    prev.hidden = false;
    const found = [];
    if (meta.time) {
      $('[name="time"]', el).value = toLocalInput(meta.time);
      found.push('tijd');
    }
    if (meta.lat != null) {
      setLoc(meta.lat, meta.lon, 'foto');
      found.push('locatie');
    }
    info.textContent = found.length ? `✓ ${found.join(' en ')} overgenomen uit de foto` : 'Geen tijd/locatie in de foto gevonden – huidige tijd en locatie gebruikt.';
  }));

  el.addEventListener('click', async (e) => {
    const pick = e.target.closest('[data-pick]');
    if (pick) { log.k = +pick.dataset.pick; search.value = ''; picks.innerHTML = ''; showPicked(); }
    if (e.target.closest('[data-act="change"]')) { log.k = null; showPicked(); }
    if (e.target.closest('[data-act="gps"]')) { log.src = null; useGps(); }
    if (e.target.closest('[data-act="save"]')) {
      if (!log.k) return toast('Kies eerst een soort');
      const t = $('[name="time"]', el).value;
      log.t = t ? new Date(t).toISOString() : new Date().toISOString();
      log.note = $('[name="note"]', el).value.trim();
      await putLog(log);
      await refreshLogs();
      const s = state.data.byKey.get(log.k);
      close();
      toast(`${displayName(s)} gelogd${log.lat == null ? ' (zonder locatie)' : ''}`);
      rerender();
    }
  });
}

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.append(t);
  setTimeout(() => t.remove(), 3500);
}

start();
