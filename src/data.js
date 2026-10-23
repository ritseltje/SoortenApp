// Loads the species list and hotspot grid produced by scripts/build-data.mjs.

export const GROUP_ICONS = {
  vogels: '🐦', planten: '🌿', reptielen: '🦎', amfibieen: '🐸', zoogdieren: '🦔',
  bijen: '🐝', kevers: '🪲', mieren: '🐜', spinnen: '🕷️', paddenstoelen: '🍄',
  wantsen: '🛡️', sprinkhanen: '🦗', dagvlinders: '🦋', nachtvlinders: '🌙', slakken: '🐌',
  libellen: '🪽', hooiwagens: '🦵', zweefvliegen: '🪰',
};

// Own icons: src/icons/<group id>.svg (or .png) replaces that group's emoji.
const ICON_FILES = import.meta.glob('./icons/*.{svg,png}', { eager: true, query: '?url', import: 'default' });
for (const [path, url] of Object.entries(ICON_FILES)) {
  const id = path.match(/([^/]+)\.\w+$/)[1];
  if (id in GROUP_ICONS) GROUP_ICONS[id] = `<img class="gicon" src="${url}" alt="">`;
}

export const norm = (s) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export async function loadSpecies() {
  const res = await fetch('data/species.json');
  if (!res.ok) throw new Error(`Soortenlijst laden mislukt (${res.status})`);
  const { meta, species } = await res.json();
  species.forEach((s, i) => {
    s.i = i;
    s.search = `${norm(s.n)} ${norm(s.l)}`;
  });
  const byKey = new Map(species.map((s) => [s.k, s]));
  return { meta, species, byKey };
}

let gridPromise;
export function loadGrid() {
  gridPromise ??= fetch('data/grid.json')
    .then((r) => (r.ok ? r.json() : []))
    .then((cells) => cells.map(({ r, c, s }) => {
      const parts = s.split(',');
      const idx = new Int32Array(parts.length);
      const cnt = new Int32Array(parts.length);
      let prev = 0;
      parts.forEach((p, j) => {
        const [d, n] = p.split(':');
        prev += parseInt(d, 36);
        idx[j] = prev;
        cnt[j] = parseInt(n, 36);
      });
      return { r, c, idx, cnt };
    }));
  return gridPromise;
}

export const links = (s) => ({
  waarneming: `https://waarneming.nl/species/search/?q=${encodeURIComponent(s.l)}`,
  atlas: s.va ? `https://www.verspreidingsatlas.nl/${s.va}` : null,
  nsr: s.nsr ? `https://www.nederlandsesoorten.nl/nsr/concept/${s.nsr}` : null,
});
