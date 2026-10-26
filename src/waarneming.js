// Import of the CSV export from waarneming.nl (Observation.org): "Mijn waarnemingen" › export.
// Each observation becomes a log with id `wnl-<observation id>`, so importing the same export
// again updates those logs instead of adding duplicates. Photos stay on waarneming.nl.
import { norm } from './data.js';

// RFC 4180 CSV: quoted fields may contain the delimiter, quotes ("") and newlines
export function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const first = text.slice(0, text.indexOf('\n'));
  const delim = (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  const [head = [], ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, j) => [h.trim().toLowerCase(), r[j] ?? ''])));
}

// Returns { logs, unmatched }: logs ready for putLog, unmatched = rows whose species is not in the app
export function waarnemingLogs(rows, species) {
  if (rows.length && !('id' in rows[0] && 'scientific name' in rows[0]))
    throw new Error('Dit lijkt geen export van waarneming.nl');
  const byLatin = new Map(species.map((s) => [norm(s.l), s]));
  const byName = new Map(species.filter((s) => s.n).map((s) => [norm(s.n), s]));
  const find = (r) => {
    const l = norm(r['scientific name']).replace(/\s+/g, ' ').trim();
    return byLatin.get(l) ?? byLatin.get(l.split(' ').slice(0, 2).join(' ')) ?? byName.get(norm(r['species name']).trim());
  };
  const logs = [], unmatched = [];
  for (const r of rows) {
    if (!r.id) continue;
    const s = find(r);
    if (!s) { unmatched.push({ name: r['species name'], latin: r['scientific name'], url: r.link }); continue; }
    const t = new Date(`${r.date}T${r.time || '12:00:00'}`); // local (Dutch) time
    const lat = parseFloat(r.lat), lon = parseFloat(r.lng), acc = parseFloat(r.accuracy);
    logs.push({
      id: `wnl-${r.id}`,
      k: s.k,
      t: (Number.isNaN(t.getTime()) ? new Date() : t).toISOString(),
      lat: Number.isFinite(lat) ? lat : null,
      lon: Number.isFinite(lon) ? lon : null,
      acc: Number.isFinite(acc) ? acc : null,
      src: 'waarneming',
      note: r.notes ?? '',
      photo: null,
      url: r.link || `https://waarneming.nl/observation/${r.id}/`,
      modified: r.modified,
    });
  }
  return { logs, unmatched };
}
