// One Postgres connection for the maintenance scripts.
import pg, { pgConfig } from '../src/pg-config.js';

export async function connect() {
  const client = new pg.Client(pgConfig());
  await client.connect();
  return client;
}
