// Builds public/data/*.json from GBIF (Nederlands Soortenregister + occurrence
// data) and verspreidingsatlas.nl. Runs in GitHub Actions: `node scripts/build-data.mjs`.
// Set QUICK=1 for a small, fast run (fewer grid cells) when testing.
import { mkdir, writeFile } from 'node:fs/promises';

const GBIF = 'https://api.gbif.org/v1';
const NSR = '4dd32523-a3a3-43b7-84df-4cda02f15cf7'; // Checklist Dutch Species Register
const OUT = new URL('../public/data/', import.meta.url);
const QUICK = !!process.env.QUICK;
const UA = 'SoortenApp data build (github.com/ritseltje/SoortenApp)';
const THIS_YEAR = new Date().getFullYear();
const RECENT = `${THIS_YEAR - 15},${THIS_YEAR}`; // years used for "common" and hotspots

// id: short code used in the app; taxa: names of higher taxa that make up the group.
const GROUPS = [
  { id: 'vogels', name: 'Vogels', taxa: [['Aves', 'CLASS']] },
  { id: 'planten', name: 'Planten', taxa: [['Tracheophyta', 'PHYLUM']] },
  { id: 'reptielen', name: 'Reptielen', taxa: [['Squamata', 'ORDER'], ['Testudines', 'ORDER']] },
  { id: 'amfibieen', name: 'Amfibieën', taxa: [['Amphibia', 'CLASS']] },
  { id: 'zoogdieren', name: 'Zoogdieren', taxa: [['Mammalia', 'CLASS']] },
  {
    id: 'bijen', name: 'Bijen',
    taxa: ['Apidae', 'Andrenidae', 'Halictidae', 'Colletidae', 'Megachilidae', 'Melittidae'].map((f) => [f, 'FAMILY']),
  },
  { id: 'kevers', name: 'Kevers', taxa: [['Coleoptera', 'ORDER']] },
  { id: 'mieren', name: 'Mieren', taxa: [['Formicidae', 'FAMILY']] },
  { id: 'spinnen', name: 'Spinnen', taxa: [['Araneae', 'ORDER']] },
  {
    id: 'paddenstoelen', name: 'Paddenstoelen',
    taxa: ['Agaricomycetes', 'Dacrymycetes', 'Pezizomycetes'].map((c) => [c, 'CLASS']),
  },
  {
    id: 'wantsen', name: 'Wantsen en cicaden',
    // families of the suborders Heteroptera and Auchenorrhyncha, which the NSR checklist does not
    // list as taxa; the split-off Lygaeidae families are listed for either classification
    taxa: [
      'Acanthosomatidae', 'Alydidae', 'Aneuridae', 'Anthocoridae', 'Aphelocheiridae', 'Aradidae', 'Artheneidae',
      'Berytidae', 'Blissidae', 'Ceratocombidae', 'Cimicidae', 'Coreidae', 'Corixidae', 'Cydnidae', 'Cymidae',
      'Dipsocoridae', 'Geocoridae', 'Gerridae', 'Hebridae', 'Heterogastridae', 'Hydrometridae', 'Leptopodidae',
      'Lyctocoridae', 'Lygaeidae', 'Mesoveliidae', 'Micronectidae', 'Microphysidae', 'Miridae', 'Nabidae',
      'Naucoridae', 'Nepidae', 'Notonectidae', 'Oxycarenidae', 'Pentatomidae', 'Piesmatidae', 'Plataspidae',
      'Pleidae', 'Pyrrhocoridae', 'Reduviidae', 'Rhopalidae', 'Rhyparochromidae', 'Saldidae', 'Scutelleridae',
      'Stenocephalidae', 'Thyreocoridae', 'Tingidae', 'Veliidae',
      'Achilidae', 'Aphrophoridae', 'Caliscelidae', 'Cercopidae', 'Cicadellidae', 'Cicadidae', 'Cixiidae',
      'Delphacidae', 'Dictyopharidae', 'Flatidae', 'Issidae', 'Meenoplidae', 'Membracidae', 'Tettigometridae',
      'Tropiduchidae',
    ].map((f) => [f, 'FAMILY']),
  },
  { id: 'sprinkhanen', name: 'Sprinkhanen en krekels', taxa: [['Orthoptera', 'ORDER']] },
  {
    id: 'dagvlinders', name: 'Dagvlinders',
    taxa: ['Hesperiidae', 'Papilionidae', 'Pieridae', 'Lycaenidae', 'Riodinidae', 'Nymphalidae'].map((f) => [f, 'FAMILY']),
  },
  {
    // macro-nachtvlinders in the traditional Dutch sense; older family names cover NSR's own classification
    id: 'nachtvlinders', name: 'Nachtvlinders (macro\'s)',
    taxa: [
      'Hepialidae', 'Cossidae', 'Zygaenidae', 'Limacodidae', 'Sesiidae', 'Lasiocampidae', 'Endromidae',
      'Saturniidae', 'Sphingidae', 'Drepanidae', 'Geometridae', 'Notodontidae', 'Erebidae', 'Nolidae',
      'Noctuidae', 'Euteliidae', 'Thyatiridae', 'Lymantriidae', 'Arctiidae',
    ].map((f) => [f, 'FAMILY']),
  },
  { id: 'slakken', name: 'Slakken', taxa: [['Gastropoda', 'CLASS']] },
  { id: 'libellen', name: 'Libellen en juffers', taxa: [['Odonata', 'ORDER']] },
  { id: 'hooiwagens', name: 'Hooiwagens', taxa: [['Opiliones', 'ORDER']] },
  { id: 'zweefvliegen', name: 'Zweefvliegen', taxa: [['Syrphidae', 'FAMILY']] },
];

// verspreidingsatlas.nl only has species pages for these groups
const ATLAS_LISTS = { planten: 'vaatplanten', zoogdieren: 'zoogdieren', reptielen: 'reptielen', amfibieen: 'amfibieen' };

// Grid for hotspots: ~11 x 10 km cells over the Netherlands
const GRID = { lat0: 50.75, lon0: 3.35, dLat: 0.1, dLon: 0.15, rows: 28, cols: 26 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, { json = true, tries = 10 } = {}) {
  for (let i = 0; ; i++) {
    let wait = Math.min(60000, 1000 * 2 ** i);
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (res.ok) return json ? res.json() : res.text();
      if (res.status < 500 && res.status !== 429) throw new Error(`${res.status} ${url}`);
      if (i >= tries) throw new Error(`${res.status} ${url}`);
      const retryAfter = +res.headers.get('retry-after');
      if (retryAfter) wait = Math.max(wait, retryAfter * 1000);
    } catch (e) {
      if (i >= tries || /^4\d\d /.test(e.message)) throw e;
    }
    await sleep(wait);
  }
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  let done = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
      if (++done % 100 === 0) console.log(`  ${done}/${items.length}`);
    }
  }));
  return out;
}

const qs = (params) => new URLSearchParams(params.flatMap(([k, v]) => [].concat(v).map((x) => [k, x]))).toString();

// --- 1. Resolve group taxa in the NSR checklist and in the GBIF backbone ----
async function resolveTaxa(group) {
  group.nsrKeys = [];
  group.nubKeys = [];
  for (const [name, rank] of group.taxa) {
    const r = await get(`${GBIF}/species/search?${qs([['datasetKey', NSR], ['q', name], ['rank', rank], ['limit', 20]])}`);
    const hit = r.results.find((t) => t.canonicalName === name && t.taxonomicStatus === 'ACCEPTED');
    if (hit) group.nsrKeys.push(hit.key);
    let nub = hit?.nubKey;
    if (!nub) {
      const m = await get(`${GBIF}/species/match?${qs([['name', name], ['rank', rank]])}`);
      if (m.matchType !== 'NONE' && m.canonicalName === name) nub = m.usageKey;
    }
    if (nub) group.nubKeys.push(nub);
    console.log(`${group.id}: ${name} nsr=${hit?.key} nub=${nub}`);
  }
  if (!group.nsrKeys.length || !group.nubKeys.length) throw new Error(`Could not resolve ${group.id}`);
}

// --- 2. All accepted species of the group in the NSR checklist --------------
async function nsrSpecies(group) {
  const all = [];
  for (const key of group.nsrKeys) {
    for (let offset = 0; ; offset += 1000) {
      const r = await get(`${GBIF}/species/search?${qs([
        ['datasetKey', NSR], ['higherTaxonKey', key], ['rank', 'SPECIES'], ['status', 'ACCEPTED'],
        ['limit', 1000], ['offset', offset],
      ])}`);
      all.push(...r.results);
      if (r.endOfRecords || !r.results.length) break;
    }
  }
  return all;
}

// --- 3. Occurrence counts per backbone species key in NL ---------------------
async function speciesCounts(params) {
  const counts = new Map();
  const limit = 10000;
  for (let offset = 0; ; offset += limit) {
    const r = await get(`${GBIF}/occurrence/search?${qs([
      ['country', 'NL'], ['occurrenceStatus', 'PRESENT'], ...params,
      ['limit', 0], ['facet', 'speciesKey'], ['facetLimit', limit], ['facetOffset', offset],
    ])}`);
    const c = r.facets[0]?.counts ?? [];
    for (const { name, count } of c) counts.set(+name, count);
    if (c.length < limit) break;
  }
  return counts;
}

// --- 4. verspreidingsatlas species codes ------------------------------------
async function atlasCodes(list) {
  const html = await get(`https://www.verspreidingsatlas.nl/soortenlijst/${list}`, { json: false });
  const codes = new Map(); // scientific name -> { code, name (Dutch) }
  const re = /href='\/([A-Z]?\d+)'>\s*([^<]+?)\s*<\/a>\s*<\/td>\s*<td[^>]*>([^<]*)<\/td>/g;
  for (const m of html.matchAll(re)) codes.set(m[2].trim(), { code: m[1], name: m[3].trim() || null });
  console.log(`atlas ${list}: ${codes.size} codes`);
  return codes;
}

const nld = (t) => t.vernacularNames?.find((v) => v.language === 'nld')?.vernacularName;
const cap = (s) => s && s[0].toUpperCase() + s.slice(1);

async function main() {
  await mkdir(OUT, { recursive: true });
  for (const g of GROUPS) await resolveTaxa(g);

  const species = [];
  const byNub = new Map();
  for (const g of GROUPS) {
    const list = await nsrSpecies(g);
    const counts = await speciesCounts(g.nubKeys.map((k) => ['taxonKey', k]));
    const recent = await speciesCounts([...g.nubKeys.map((k) => ['taxonKey', k]), ['year', RECENT]]);
    let atlas = new Map();
    if (ATLAS_LISTS[g.id]) {
      try { atlas = await atlasCodes(ATLAS_LISTS[g.id]); } catch (e) { console.warn(`atlas failed: ${e.message}`); }
    }
    // NSR names can map to a backbone synonym; occurrences are counted under the accepted key
    const missing = list.filter((t) => t.nubKey && !counts.has(t.nubKey));
    await pool(missing, 8, async (t) => {
      try {
        const b = await get(`${GBIF}/species/${t.nubKey}`);
        if (b.acceptedKey && counts.has(b.acceptedKey)) t.nubKey = b.acceptedKey;
      } catch (e) { console.warn(e.message); }
    });
    let kept = 0;
    for (const t of list) {
      const total = counts.get(t.nubKey) ?? 0;
      if (!t.nubKey || total === 0 || byNub.has(t.nubKey)) continue; // never recorded in NL: skip
      const va = atlas.get(t.canonicalName);
      const sp = {
        g: g.id,
        n: cap(nld(t) ?? va?.name) ?? null,
        l: t.canonicalName,
        o: t.order ?? null,
        f: t.family ?? null,
        ge: t.genus ?? t.canonicalName.split(' ')[0],
        k: t.nubKey,
        nsr: t.references?.split('/').pop() ?? null,
        va: va?.code ?? null,
        c: recent.get(t.nubKey) ?? 0,
        ct: total,
      };
      byNub.set(t.nubKey, species.length);
      species.push(sp);
      kept++;
    }
    console.log(`${g.id}: ${list.length} in NSR, ${kept} recorded in NL`);
  }

  // Dutch names for orders and families (the NSR export only names species)
  const higherNames = {};
  const higher = [...new Set(species.flatMap((s) => [s.o && `ORDER|${s.o}`, s.f && `FAMILY|${s.f}`]).filter(Boolean))];
  await pool(higher, 8, async (h) => {
    const [rank, name] = h.split('|');
    try {
      const m = await get(`${GBIF}/species/match?${qs([['name', name], ['rank', rank]])}`);
      if (!m.usageKey || m.canonicalName !== name) return;
      const r = await get(`${GBIF}/species/${m.usageKey}/vernacularNames?limit=200`);
      const nl = r.results.filter((x) => x.language === 'nld' || x.language === 'nl');
      const v = nl.find((x) => /soortenregister|nsr/i.test(x.source ?? '')) ?? nl[0];
      if (v) higherNames[name] = cap(v.vernacularName.split(',')[0].trim());
    } catch (e) { console.warn(e.message); }
  });
  console.log(`Dutch names for ${Object.keys(higherNames).length} orders/families`);

  // Hotspot grid: which species were recorded (recently) in each cell
  const allTaxa = GROUPS.flatMap((g) => g.nubKeys.map((k) => ['taxonKey', k]));
  const cells = [];
  for (let r = 0; r < GRID.rows; r++) {
    for (let c = 0; c < GRID.cols; c++) cells.push([r, c]);
  }
  const todo = QUICK ? cells.filter(([r, c]) => r % 7 === 3 && c % 7 === 3) : cells;
  console.log(`grid: ${todo.length} cells`);
  const grid = await pool(todo, 3, async ([r, c]) => {
    const lat = GRID.lat0 + r * GRID.dLat;
    const lon = GRID.lon0 + c * GRID.dLon;
    const counts = await speciesCounts([
      ...allTaxa, ['year', RECENT],
      ['decimalLatitude', `${lat.toFixed(3)},${(lat + GRID.dLat).toFixed(3)}`],
      ['decimalLongitude', `${lon.toFixed(3)},${(lon + GRID.dLon).toFixed(3)}`],
    ]);
    const idx = [];
    for (const [k, n] of counts) {
      const i = byNub.get(k);
      if (i !== undefined) idx.push([i, n]);
    }
    if (!idx.length) return null;
    idx.sort((a, b) => a[0] - b[0]);
    // delta-encoded species indices plus occurrence counts, both base36
    let prev = 0;
    const s = idx.map(([i, n]) => { const d = (i - prev).toString(36); prev = i; return `${d}:${n.toString(36)}`; }).join(',');
    return { r, c, s };
  });

  const meta = {
    built: new Date().toISOString(),
    recentYears: RECENT,
    groups: GROUPS.map(({ id, name }) => ({ id, name })),
    grid: GRID,
    higherNames,
  };
  await writeFile(new URL('species.json', OUT), JSON.stringify({ meta, species }));
  await writeFile(new URL('grid.json', OUT), JSON.stringify(grid.filter(Boolean)));
  console.log(`done: ${species.length} species, ${grid.filter(Boolean).length} grid cells`);
}

main().catch((e) => { console.error(e); process.exit(1); });
