// A whole-database snapshot as JSON, and putting one back. `query(sql, args)` must resolve to { rows, rowCount },
// like a node-postgres client, and every call must go to the same connection (one transaction).
import { TABLES, WITH_IDENTITY } from './tables.js';

const FORMAT = 1;

const encode = (_, value) => (value?.type === 'Buffer' && Array.isArray(value.data) ? { $b: Buffer.from(value.data).toString('base64') } : value);
const decode = (_, value) => (typeof value?.$b === 'string' ? Buffer.from(value.$b, 'base64') : value);

/**
 * Read every table. Images are the bulk of the data (and of the download), so only up to `imageBudget` bytes of them
 * are fetched: ones awaiting a moderator or live first, newest first. Returns { json, dropped }.
 */
export async function takeSnapshot(query, imageBudget) {
  const tables = {};
  let dropped = 0;
  for (const table of TABLES) {
    if (table !== 'confession_images') {
      tables[table] = (await query(`SELECT * FROM public.${table}`)).rows;
      continue;
    }
    const { rows: sizes } = await query(
      `SELECT i.confession_id AS id, octet_length(i.data) AS size
         FROM public.confession_images i LEFT JOIN public.confessions c ON c.id = i.confession_id
        ORDER BY CASE WHEN c.status IN ('pending', 'scheduled', 'hidden') THEN 0 WHEN c.status = 'posted' THEN 1 ELSE 2 END,
                 i.confession_id DESC`,
    );
    const wanted = [];
    let used = 0;
    for (const { id, size } of sizes) {
      if (used + Number(size) > imageBudget) dropped++;
      else {
        used += Number(size);
        wanted.push(id);
      }
    }
    tables[table] = wanted.length ? (await query('SELECT * FROM public.confession_images WHERE confession_id = ANY($1::bigint[])', [wanted])).rows : [];
  }
  const sequences = {};
  for (const table of WITH_IDENTITY) {
    const { rows } = await query('SELECT pg_sequence_last_value(pg_get_serial_sequence($1, $2)::regclass) AS n', [`public.${table}`, 'id']);
    sequences[table] = Number(rows[0].n ?? 0);
  }
  return { json: JSON.stringify({ format: FORMAT, createdAt: new Date().toISOString(), sequences, tables }, encode), dropped };
}

/** Fill an empty, migrated database from a snapshot. Run inside a transaction. Returns row counts per table. */
export async function loadSnapshot(query, json) {
  const snapshot = JSON.parse(json, decode);
  if (snapshot.format !== FORMAT) throw new Error(`unknown backup format ${snapshot.format}`);
  for (const table of TABLES) {
    if ((await query(`SELECT 1 FROM public.${table} LIMIT 1`)).rows.length) {
      throw new Error(`${table} already has data. A restore only fills an empty database.`);
    }
  }
  const counts = {};
  for (const table of TABLES) {
    const rows = snapshot.tables[table] ?? [];
    counts[table] = rows.length;
    if (!rows.length) continue;
    const columns = Object.keys(rows[0]);
    const names = columns.map((c) => `"${c.replaceAll('"', '""')}"`).join(', ');
    const size = table === 'confession_images' ? 5 : 200;
    for (let at = 0; at < rows.length; at += size) {
      const batch = rows.slice(at, at + size);
      const values = batch.map((_, r) => `(${columns.map((__, c) => `$${r * columns.length + c + 1}`).join(', ')})`);
      await query(`INSERT INTO public.${table} (${names}) VALUES ${values.join(', ')}`, batch.flatMap((row) => columns.map((c) => row[c])));
    }
  }
  for (const table of WITH_IDENTITY) {
    const last = Math.max(snapshot.sequences?.[table] ?? 0, ...(snapshot.tables[table] ?? []).map((r) => r.id), 0);
    if (last > 0) await query('SELECT setval(pg_get_serial_sequence($1, $2), $3, true)', [`public.${table}`, 'id', last]);
  }
  return counts;
}
