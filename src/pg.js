// The bot's Postgres pool and four small helpers. SQL is written with `?` placeholders.
import { AsyncLocalStorage } from 'node:async_hooks';
import pg, { pgConfig } from './pg-config.js';

const pool = new pg.Pool({
  ...pgConfig(),
  max: Number(process.env.PG_POOL_MAX) || 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  query_timeout: 15_000,
  keepAlive: true,
});
// An idle connection dropped by the server must not crash the bot: the pool opens a new one on the next query.
pool.on('error', (err) => console.error('Idle database connection failed:', err.message));

/** The connection of the transaction this code is running in, if any. */
const current = new AsyncLocalStorage();

const numbered = (sql) => {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
};
const query = (sql, args) => (current.getStore() ?? pool).query(numbered(sql), args);

/** The first row, or undefined. */
export const get = async (sql, ...args) => (await query(sql, args)).rows[0];
export const all = async (sql, ...args) => (await query(sql, args)).rows;
/** Returns the number of rows changed. */
export const run = async (sql, ...args) => (await query(sql, args)).rowCount;

/** Run `fn` in one transaction. Helper calls made inside it, however deep, use the same connection. */
export async function transaction(fn) {
  if (current.getStore()) return fn(); // already inside one
  const client = await pool.connect();
  let broken;
  try {
    await client.query('BEGIN');
    const result = await current.run(client, fn);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch((rollbackErr) => (broken = rollbackErr));
    throw err;
  } finally {
    client.release(broken);
  }
}

/** Inside a transaction: make others using the same name wait until it ends. */
export const lock = (name) => query('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', [name]);

/** Run `fn(query)` in a read-only transaction that sees one unchanging view of the data. */
export async function snapshotTransaction(fn) {
  const client = await pool.connect();
  let broken;
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    return await fn((sql, args) => client.query(sql, args));
  } finally {
    await client.query('ROLLBACK').catch((err) => (broken = err));
    client.release(broken);
  }
}

export const closePool = () => pool.end();
