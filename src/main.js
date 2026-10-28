import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import './style.css';
import { loadSpecies, loadGrid, links, norm, GROUP_ICONS } from './data.js';
import { allLogs, putLog, deleteLog, newId } from './db.js';
import { readPhotoMeta, shrinkPhoto } from './photo.js';
import { parseCsv, waarnemingLogs } from './waarneming.js';

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
  hokKm: load('hokKm', 10), // hok size on the map
  near: load('near', false), // "Te zoeken" for the hokken around a location instead of all of NL
  nearPos: load('nearPos', null), // { lat, lon, src: 'gps' | 'kaart' }
  mineYear: load('mineYear', new Date().getFullYear()), // year shown in Mijn lijst, or 'all'
  season: load('season', true), // Te zoeken: hide species that are out of season
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
const logYear = (l) => new Date(l.t).getFullYear();

// Season: s.m holds the share of observations per month (percent, base36, capped at 35).
// A species is "nu te vinden" when this month and the months around it together have at least 10%.
const monthShares = (s) => (s.m ? [...s.m].map((ch) => parseInt(ch, 36)) : null);
function inSeason(s, month = new Date().getMonth()) {
  const m = monthShares(s);
  if (!m) return true; // too few observations to tell
  return m[(month + 11) % 12] + m[month] + m[(month + 1) % 12] >= 10;
}
// Worked out once per month: the map checks this for every species in every hok
let seasonMonth = null;
function updateSeason() {
  const month = new Date().getMonth();
  if (month === seasonMonth) return;
  seasonMonth = month;
  for (const s of state.data.species) s.ins = inSeason(s, month);
}
const seasonOn = (s) => !state.season || s.ins;

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
  setupInstall();
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

// Each tab keeps its own scroll position; tapping the active tab again scrolls to the top
const scrollPos = {};
function showTab(tab) {
  if (!views[tab]) tab = 'common';
  updateSeason(); // the app can stay open into the next month
  const again = tab === document.body.dataset.tab;
  if (document.body.dataset.tab) scrollPos[document.body.dataset.tab] = again ? 0 : scrollY;
  state.tab = tab;
  save('tab', tab);
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.body.dataset.tab = tab;
  views[tab]();
  scrollTo(0, scrollPos[tab] ?? 0);
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
  if (state.near) return renderNear();
  const list = state.data.species.filter((s) => groupOn(s) && !isLogged(s) && seasonOn(s))
    .sort((a, b) => b.c - a.c || b.ct - a.ct);
  $('#main').innerHTML = `${scopeToggle()}
    <p class="hint">Algemene soorten die je nog niet hebt gelogd, op volgorde van aantal waarnemingen in Nederland (${esc(state.data.meta.recentYears.replace(',', '–'))}).</p>
    ${commonList(list.map((s) => [s, s.c]))}`;
  bindCommon(list.length);
}

// Toggle between the national list and the list for the hokken around a location
function scopeToggle() {
  return `<div class="seg"><button data-scope="nl" class="${state.near ? '' : 'on'}">Heel Nederland</button><button data-scope="near" class="${state.near ? 'on' : ''}">In de buurt</button></div>
    ${seasonCheck()}`;
}

// Season filter: one setting for Te zoeken and the map
function seasonCheck() {
  const month = new Date().toLocaleString('nl-NL', { month: 'long' });
  return `<label class="check"><input type="checkbox" data-act="season"${state.season ? ' checked' : ''}> Alleen soorten die je rond ${month} kunt vinden</label>`;
}

function commonList(rows) {
  const shown = rows.slice(0, state.commonShown);
  return `<ul class="list">${shown.map(([s, n]) => speciesRow(s, `<span class="count">${fmtNum(n)}</span>`)).join('')}</ul>
    ${rows.length > shown.length ? `<button class="more">Meer tonen (${fmtNum(rows.length - shown.length)} over)</button>` : ''}
    ${!rows.length ? `<p class="empty">${state.season ? 'Geen soorten meer die je nu kunt vinden. Zet het vinkje uit voor de rest.' : 'Alles gelogd in deze groep(en)! 🎉'}</p>` : ''}`;
}

function bindCommon() {
  const list = $('#main .list');
  if (list) bindRows(list);
  $('#main .more')?.addEventListener('click', () => { state.commonShown += 100; renderCommon(); });
  $('#main .seg').onclick = (e) => {
    const b = e.target.closest('[data-scope]');
    if (!b || (b.dataset.scope === 'near') === state.near) return;
    state.near = b.dataset.scope === 'near';
    save('near', state.near);
    state.commonShown = 60;
    renderCommon();
  };
  $('#main [data-act="near-gps"]')?.addEventListener('click', () => locateNear());
  $('#main [data-act="season"]').onchange = (e) => {
    state.season = e.target.checked;
    save('season', state.season);
    state.commonShown = 60;
    renderCommon();
  };
}

// "In de buurt": the data grid cell at the location plus the 8 cells around it
let gridIndex;
async function nearCells(pos) {
  gridCells ??= await loadGrid();
  gridIndex ??= new Map(gridCells.map((c) => [`${c.r},${c.c}`, c]));
  const { grid } = state.data.meta;
  const r = Math.floor((pos.lat - grid.lat0) / grid.dLat), c = Math.floor((pos.lon - grid.lon0) / grid.dLon);
  const out = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    const cell = gridIndex.get(`${r + dr},${c + dc}`);
    if (cell) out.push(cell);
  }
  return out;
}

function locateNear() {
  nearStatus = 'locatie bepalen…';
  renderCommon();
  getPosition().then((p) => setNearPos({ lat: p.lat, lon: p.lon, src: 'gps' }))
    .catch((e) => { nearStatus = e.message; if (state.tab === 'common') renderCommon(); });
}

function setNearPos(pos) {
  state.nearPos = pos;
  save('nearPos', pos);
  nearStatus = '';
  if (state.tab === 'common') renderCommon();
}

let nearStatus = '';
async function renderNear() {
  const main = $('#main');
  const pos = state.nearPos;
  const head = (text) => `${scopeToggle()}<p class="hint near-head">${nearStatus ? esc(nearStatus) : text}
    <button class="small" data-act="near-gps">◎ ${pos ? 'Locatie vernieuwen' : 'Gebruik mijn locatie'}</button></p>`;
  if (!pos) {
    main.innerHTML = `${head('Nog geen locatie gekozen.')}
      <p class="empty">Gebruik je locatie, of tik op de kaart op een hok en kies <b>Te zoeken hier</b>.</p>`;
    bindCommon();
    if (!nearStatus) locateNear();
    return;
  }
  if (!gridCells) {
    main.innerHTML = `${head('Hokdata laden…')}`;
    bindCommon();
  }
  const cells = await nearCells(pos);
  if (state.tab !== 'common' || !state.near || state.nearPos !== pos) return;
  const sum = new Map();
  for (const cell of cells) {
    for (let j = 0; j < cell.idx.length; j++) sum.set(cell.idx[j], (sum.get(cell.idx[j]) ?? 0) + cell.cnt[j]);
  }
  const sp = state.data.species;
  const rows = [...sum].map(([i, n]) => [sp[i], n]).filter(([s]) => s && groupOn(s) && !isLogged(s) && seasonOn(s))
    .sort((a, b) => b[1] - a[1] || b[0].c - a[0].c);
  const where = pos.src === 'gps' ? 'je locatie' : 'de gekozen plek op de kaart';
  main.innerHTML = `${head(`Rond ${where} (±15×15 km) · <b>${fmtNum(rows.length)}</b> soorten nog te vinden, op volgorde van aantal waarnemingen daar.`)}
    ${cells.length ? commonList(rows) : '<p class="empty">Geen hokdata voor deze plek.</p>'}`;
  bindCommon();
}

// ---------------------------------------------------------------- tab: map
let map, cellLayer, logLayer, gridCells;
async function renderMap() {
  const main = $('#main');
  if (!gridCells) {
    main.innerHTML = '<p class="empty">Kaart laden…</p>';
    gridCells = await loadGrid();
    if (state.tab !== 'map') return; // switched tabs while loading
  }
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
  } else {
    // map element survives tab switches; re-attach it
    if (!main.contains($('#map'))) main.replaceChildren(...mapNodes);
    setTimeout(() => map.invalidateSize(), 0);
  }
  mapNodes = [...main.children];
  drawCells();
}
let mapNodes = [];

// Hok sizes offered on the map; each is a whole number of data grid cells per side
const HOK_KM = [5, 10];
const baseKm = () => Math.max(5, Math.round(state.data.meta.grid.dLat * 111 / 5) * 5); // data grid is ±5 or ±10 km
const hokSizes = () => HOK_KM.filter((km) => km % baseKm() === 0);
const hokKmNow = () => (hokSizes().includes(state.hokKm) ? state.hokKm : hokSizes().at(-1));

// Data grid cells merged into k x k blocks; occurrence counts are summed per species
const mergedGrids = new Map();
function hokCells(k) {
  if (k === 1) return gridCells;
  if (mergedGrids.has(k)) return mergedGrids.get(k);
  const blocks = new Map();
  for (const cell of gridCells) {
    const r = Math.floor(cell.r / k), c = Math.floor(cell.c / k);
    const key = `${r},${c}`;
    if (!blocks.has(key)) blocks.set(key, { r, c, sum: new Map() });
    const { sum } = blocks.get(key);
    for (let j = 0; j < cell.idx.length; j++) sum.set(cell.idx[j], (sum.get(cell.idx[j]) ?? 0) + cell.cnt[j]);
  }
  const out = [...blocks.values()].map(({ r, c, sum }) => {
    const idx = Int32Array.from(sum.keys());
    return { r, c, idx, cnt: Int32Array.from(idx, (i) => sum.get(i)) };
  });
  mergedGrids.set(k, out);
  return out;
}

function cellUnlogged(cell) {
  const sp = state.data.species;
  const out = [];
  for (let j = 0; j < cell.idx.length; j++) {
    const s = sp[cell.idx[j]];
    if (s && groupOn(s) && !isLogged(s) && seasonOn(s)) out.push([s, cell.cnt[j]]);
  }
  return out;
}

let drawnFor = null; // what the hokken were last drawn for; tab switches skip an unchanged redraw
function drawCells() {
  const { grid } = state.data.meta;
  const drawKey = [state.logs, [...state.groups].join(), state.season, hokKmNow(), seasonMonth];
  if (drawnFor?.every((v, i) => v === drawKey[i])) return;
  drawnFor = drawKey;
  cellLayer.clearLayers();
  logLayer.clearLayers();
  if (!gridCells.length) {
    $('#map-legend').innerHTML = 'Nog geen hotspotdata beschikbaar.';
    return;
  }
  const sizes = hokSizes();
  const km = hokKmNow();
  const k = km / baseKm();
  const cells = hokCells(k);
  const counts = cells.map((c) => cellUnlogged(c).length);
  const sorted = counts.filter((n) => n > 0).sort((a, b) => a - b);
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
  const breaks = [q(0.2), q(0.4), q(0.6), q(0.8), q(0.95)];
  const colors = ['#ffffb2', '#fed976', '#feb24c', '#fd8d3c', '#f03b20', '#bd0026'];
  const color = (n) => colors[breaks.filter((b) => n > b).length];
  cells.forEach((cell, i) => {
    const n = counts[i];
    if (!n) return;
    const lat = grid.lat0 + cell.r * k * grid.dLat;
    const lon = grid.lon0 + cell.c * k * grid.dLon;
    // blocks at the grid's edge are cut off where the data grid ends
    const h = Math.min(k, grid.rows - cell.r * k) * grid.dLat;
    const w = Math.min(k, grid.cols - cell.c * k) * grid.dLon;
    L.rectangle([[lat, lon], [lat + h, lon + w]], {
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
  const picker = sizes.length > 1 ? `<label>Hokken van <select>${sizes.map((s) =>
    `<option value="${s}"${s === km ? ' selected' : ''}>±${s}×${s} km</option>`).join('')}</select></label>` : '';
  $('#map-legend').innerHTML = `${picker}${seasonCheck()}
    <span>Nog niet gelogde soorten per hok</span><span class="scale">${colors.map((c, i) =>
    `<i style="background:${c}"></i>${i < breaks.length ? `<small>${breaks[i]}</small>` : ''}`).join('')}</span>`;
  if (picker) $('#map-legend select').onchange = (e) => {
    state.hokKm = +e.target.value;
    save('hokKm', state.hokKm);
    $('#cell-panel').hidden = true;
    drawCells();
  };
  $('#map-legend [data-act="season"]').onchange = (e) => {
    state.season = e.target.checked;
    save('season', state.season);
    state.commonShown = 60;
    drawCells();
  };
  // keep an open hok list in step with logs, groups and the season filter
  if (openCell && !$('#cell-panel').hidden) showCell(...openCell);
}

let openCell = null; // [cell, lat, lon] shown in the hok panel
function showCell(cell, lat, lon) {
  openCell = [cell, lat, lon];
  const list = cellUnlogged(cell).sort((a, b) => b[1] - a[1]);
  const panel = $('#cell-panel');
  panel.hidden = false;
  panel.innerHTML = `<header><b>${fmtNum(list.length)} nog niet gelogde soorten</b>
      <small>hok ${lat.toFixed(2)}°N ${lon.toFixed(2)}°O · aantal waarnemingen</small>
      <button class="small" data-act="here">⭐ Te zoeken hier</button>
      <button class="close" aria-label="Sluiten">✕</button></header>
    <ul class="list">${list.slice(0, 300).map(([s, n]) => speciesRow(s, `<span class="count">${fmtNum(n)}</span>`)).join('')}</ul>`;
  panel.querySelector('.close').onclick = () => { panel.hidden = true; };
  panel.querySelector('[data-act="here"]').onclick = () => {
    const { grid } = state.data.meta;
    const k = hokKmNow() / baseKm();
    state.near = true;
    save('near', true);
    setNearPos({ lat: lat + (k * grid.dLat) / 2, lon: lon + (k * grid.dLon) / 2, src: 'kaart' });
    panel.hidden = true;
    scrollPos.common = 0;
    showTab('common');
  };
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
    bindRows(out);
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
  // year list: the selected calendar year, or all years ('all')
  const years = [...new Set([new Date().getFullYear(), ...state.logs.map(logYear)])].sort((a, b) => b - a);
  const year = state.mineYear === 'all' || years.includes(state.mineYear) ? state.mineYear : years[0];
  const inYear = (l) => year === 'all' || logYear(l) === year;
  const seen = new Set(state.logs.filter(inYear).map((l) => l.k));
  const stats = groups.map((g) => {
    const all = state.data.species.filter((s) => s.g === g.id);
    return { g, total: all.length, done: all.filter((s) => seen.has(s.k)).length };
  });
  const logs = state.logs.filter((l) => {
    const s = state.data.byKey.get(l.k);
    return s && groupOn(s) && inYear(l);
  });
  const nSeen = state.data.species.filter((s) => groupOn(s) && seen.has(s.k)).length;
  $('#main').innerHTML = `
    <div class="year"><b>${year === 'all' ? 'Totaal' : year}: ${fmtNum(nSeen)} ${nSeen === 1 ? 'soort' : 'soorten'}</b>
      <select aria-label="Jaar">${years.map((y) => `<option value="${y}"${y === year ? ' selected' : ''}>${y}</option>`).join('')}
        <option value="all"${year === 'all' ? ' selected' : ''}>Alle jaren</option></select></div>
    <div class="stats">${stats.map(({ g, total, done }) =>
      `<div><span>${GROUP_ICONS[g.id]} ${esc(g.name)}</span><b>${fmtNum(done)}</b><small>van ${fmtNum(total)}</small></div>`).join('')}</div>
    <div class="actions">
      <button id="exp-csv">Exporteer CSV</button>
      <button id="exp-json">Back-up maken</button>
      <label class="button">Back-up terugzetten<input type="file" accept="application/json,.json" hidden id="imp"></label>
      <label class="button">Importeer van waarneming.nl<input type="file" accept="text/csv,.csv" hidden id="imp-wnl"></label>
    </div>
    <ul class="list logs">${logs.map(logRow).join('')}</ul>
    ${!logs.length ? `<p class="empty">${year === 'all' ? 'Nog geen waarnemingen gelogd' : `Nog geen waarnemingen in ${year}`}. Tik op ＋ om te beginnen.</p>` : ''}`;
  $('#main .year select').onchange = (e) => {
    state.mineYear = e.target.value === 'all' ? 'all' : +e.target.value;
    save('mineYear', state.mineYear);
    renderMine();
  };
  attachThumbs($('#main'));
  bindRows($('#main .logs'));
  $('#exp-csv').onclick = exportCsv;
  $('#exp-json').onclick = exportJson;
  $('#imp').onchange = (e) => importJson(e.target.files[0]);
  $('#imp-wnl').onchange = (e) => importWaarneming(e.target.files[0]);
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
  const rows = [['datum', 'nederlandse_naam', 'latijnse_naam', 'groep', 'breedtegraad', 'lengtegraad', 'bron', 'notitie', 'link']];
  for (const l of state.logs) {
    const s = state.data.byKey.get(l.k);
    rows.push([l.t, s?.n, s?.l, s?.g, l.lat, l.lon, l.src, l.note, l.url]);
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

// CSV export of waarneming.nl: new observations are added, changed ones updated, the rest left alone
async function importWaarneming(file) {
  if (!file) return;
  try {
    const { logs, unmatched } = waarnemingLogs(parseCsv(await file.text()), state.data.species);
    const known = new Set(state.logs.map((l) => l.k));
    let added = 0, updated = 0;
    const newSpecies = new Set();
    for (const log of logs) {
      const old = state.logs.find((l) => l.id === log.id);
      if (old?.modified === log.modified) continue;
      await putLog(old ? { ...old, ...log } : log);
      if (old) updated++;
      else added++;
      if (!known.has(log.k)) newSpecies.add(log.k);
    }
    await refreshLogs();
    rerender();
    const line = (n, one, many) => `${fmtNum(n)} ${n === 1 ? one : many}`;
    openSheet(`
      <header><h2>Import van waarneming.nl</h2><button class="close" aria-label="Sluiten">✕</button></header>
      <p>${line(added, 'nieuwe waarneming', 'nieuwe waarnemingen')}, ${line(updated, 'bijgewerkt', 'bijgewerkt')}, ${fmtNum(logs.length - added - updated)} al aanwezig.</p>
      ${newSpecies.size ? `<p>🎉 ${line(newSpecies.size, 'soort', 'soorten')} nieuw voor je lijst.</p>` : ''}
      ${unmatched.length ? `<h3>Niet gevonden in de app (${unmatched.length})</h3>
        <p class="hint">Deze soorten zitten niet in de soortenlijst van de app en zijn overgeslagen.</p>
        <ul class="list">${unmatched.map((u) => `<li class="row"><span class="names"><b>${esc(u.name)}</b><i>${esc(u.latin)}</i></span>${u.url ? `<a href="${esc(u.url)}" target="_blank" rel="noopener">↗</a>` : ''}</li>`).join('')}</ul>` : ''}`);
  } catch (e) {
    toast(`Importeren mislukt: ${e.message}`);
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
    ${seasonBar(s)}
    <div class="links">
      <a href="${lk.waarneming}" target="_blank" rel="noopener">Waarneming.nl ↗</a>
      ${lk.atlas ? `<a href="${lk.atlas}" target="_blank" rel="noopener">Verspreidingsatlas ↗</a>` : ''}
      ${lk.nsr ? `<a href="${lk.nsr}" target="_blank" rel="noopener">Soortenregister ↗</a>` : ''}
    </div>
    <button class="primary" data-act="log">＋ Waarneming loggen</button>
    ${logs.length ? `<h3>Mijn waarnemingen (${logs.length})</h3><ul class="list logs">${logs.map((l) => `
      <li class="row">
        ${l.photo ? `<img class="thumb big" data-photo="${l.id}" alt="">` : ''}
        <span class="names"><b>${esc(fmtTime(l.t))}</b><small>${l.lat != null ? `${l.lat.toFixed(5)}, ${l.lon.toFixed(5)}` : 'geen locatie'} · ${esc(srcLabel(l.src))}</small>${l.note ? `<small>${esc(l.note)}</small>` : ''}${l.url ? `<small><a href="${esc(l.url)}" target="_blank" rel="noopener">Bekijk op waarneming.nl ↗</a></small>` : ''}</span>
        <button class="del" data-edit="${l.id}" aria-label="Bewerken">✏️</button>
        <button class="del" data-del="${l.id}" aria-label="Verwijderen">🗑</button>
      </li>`).join('')}</ul>` : ''}`);
  attachThumbs(el);
  el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-act="log"]')) {
      history.back();
      setTimeout(() => openLog({ species: s }), 50);
    }
    const edit = e.target.closest('[data-edit]');
    if (edit) {
      const log = logs.find((l) => l.id === edit.dataset.edit);
      history.back();
      setTimeout(() => openLog({ edit: log }), 50);
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

// 12 bars: share of observations per month, the current month highlighted
function seasonBar(s) {
  const m = monthShares(s);
  if (!m) return '';
  const max = Math.max(...m);
  const now = new Date().getMonth();
  return `<div class="season" title="Aandeel waarnemingen per maand">${m.map((v, i) =>
    `<span class="${i === now ? 'now' : ''}"><i style="height:${Math.round((40 * v) / max)}px"></i><small>${'jfmamjjasond'[i]}</small></span>`).join('')}</div>`;
}

const srcLabel = (src) => ({ gps: 'GPS-locatie', foto: 'uit foto', kaart: 'gekozen op kaart', waarneming: 'van waarneming.nl' }[src] ?? 'onbekend');

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

// Opens the log form for a new observation, or with `edit` for an existing one
function openLog({ species, edit }) {
  const log = edit ? { ...edit }
    : { id: newId(), k: species?.k ?? null, t: new Date().toISOString(), lat: null, lon: null, acc: null, src: null, note: '', photo: null };
  const { el, close } = openSheet(`
    <header><h2>${edit ? 'Waarneming bewerken' : 'Waarneming loggen'}</h2><button class="close" aria-label="Sluiten">✕</button></header>
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
      <button class="small" data-act="no-photo" hidden>Foto verwijderen</button>
      <p class="photo-info hint"></p>
    </div>
    <div class="field">
      <label>Tijdstip</label>
      <input type="datetime-local" name="time" value="${toLocalInput(new Date(log.t))}">
    </div>
    <div class="field">
      <label>Locatie <small class="loc-src"></small></label>
      <div id="log-map"></div>
      <button class="small" data-act="gps">◎ Gebruik mijn huidige locatie</button>
    </div>
    <div class="field">
      <label>Notitie (optioneel)</label>
      <textarea name="note" rows="2">${esc(log.note)}</textarea>
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
  if (!edit) useGps();
  else if (log.lat != null) {
    setLoc(log.lat, log.lon, log.src, log.acc);
    lmap.setView([log.lat, log.lon], 15);
  } else $('.loc-src', el).textContent = 'geen locatie – tik op de kaart';

  const showPhoto = () => {
    const prev = $('.preview', el);
    prev.hidden = !log.photo;
    if (log.photo) prev.src = URL.createObjectURL(log.photo);
    $('[data-act="no-photo"]', el).hidden = !log.photo;
  };
  showPhoto();

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
    showPhoto();
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
    if (e.target.closest('[data-act="no-photo"]')) { log.photo = null; showPhoto(); $('.photo-info', el).textContent = ''; }
    if (e.target.closest('[data-act="save"]')) {
      if (!log.k) return toast('Kies eerst een soort');
      const t = $('[name="time"]', el).value;
      log.t = t ? new Date(t).toISOString() : new Date().toISOString();
      log.note = $('[name="note"]', el).value.trim();
      // is this the first log of the species, or the first one in its year?
      const others = state.logs.filter((l) => l.k === log.k && l.id !== log.id);
      const moved = !edit || edit.k !== log.k || logYear(edit) !== logYear(log);
      const news = !moved ? '' : !others.length ? 'nieuw voor je lijst!'
        : !others.some((l) => logYear(l) === logYear(log)) ? `nieuw voor ${logYear(log)}!` : '';
      await putLog(log);
      thumbUrls.delete(log.id);
      await refreshLogs();
      const s = state.data.byKey.get(log.k);
      close();
      if (news) toast(`🎉 ${displayName(s)}: ${news}`);
      else toast(edit ? `${displayName(s)} bijgewerkt` : `${displayName(s)} gelogd${log.lat == null ? ' (zonder locatie)' : ''}`);
      rerender();
    }
  });
}

// Install button: Android/desktop Chrome get the native prompt, iOS gets instructions
// (Safari has no install prompt; it only offers "Zet op beginscherm" in the share menu).
// Brave (and Chrome without Play services) add a home screen shortcut instead of a real app,
// and still fire beforeinstallprompt inside it, so check the display mode there too.
let installPrompt = null;
const isStandalone = () => ['standalone', 'fullscreen', 'minimal-ui'].some((m) => matchMedia(`(display-mode: ${m})`).matches) || navigator.standalone === true;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  $('#install').hidden = isStandalone();
});
window.addEventListener('appinstalled', () => { $('#install').hidden = true; });
matchMedia('(display-mode: standalone)').addEventListener('change', (e) => { if (e.matches) $('#install').hidden = true; });

function setupInstall() {
  const standalone = isStandalone();
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const btn = $('#install');
  if (standalone) return;
  btn.hidden = false;
  btn.addEventListener('click', async () => {
    if (installPrompt) {
      installPrompt.prompt();
      const { outcome } = await installPrompt.userChoice;
      if (outcome === 'accepted') btn.hidden = true;
      installPrompt = null;
      return;
    }
    const safari = ios && !/crios|fxios|edgios/i.test(navigator.userAgent);
    openSheet(`
      <header><h2>App installeren</h2><button class="close" aria-label="Sluiten">✕</button></header>
      ${ios ? `<ol class="steps">
        ${safari ? '' : '<li>Werkt het niet? Open deze pagina in <b>Safari</b>.</li>'}
        <li>Tik op de <b>Deel</b>-knop <span aria-hidden="true">⬆️</span> (onderaan of naast de adresbalk).</li>
        <li>Scroll omlaag en kies <b>Zet op beginscherm</b>.</li>
        <li>Tik op <b>Voeg toe</b>. De app staat nu tussen je andere apps.</li>
      </ol>` : `<ol class="steps">
        <li>Open deze pagina in <b>Chrome</b>.</li>
        <li>Tik rechtsboven op het menu <b>⋮</b>.</li>
        <li>Kies <b>App installeren</b> of <b>Toevoegen aan startscherm</b>.</li>
      </ol>`}
      <p class="hint">Na installeren werkt de app ook offline.</p>`);
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
