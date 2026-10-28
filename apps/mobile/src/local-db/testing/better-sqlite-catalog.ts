import Database from 'better-sqlite3';

import type { CatalogDatabase } from '../catalog';

/**
 * Test-Adapter einer Katalogdatenbank über better-sqlite3, schreibgeschützt wie in der App: eine Datei
 * (etwa das eingecheckte Asset) oder die Bytes eines im Test gebauten Katalogs. Nur in Tests mit
 * `@jest-environment node` nutzbar.
 */
export function openCatalog(source: string | Buffer): CatalogDatabase & { close(): void } {
  const client = typeof source === 'string' ? new Database(source, { readonly: true, fileMustExist: true }) : new Database(source);
  client.pragma('query_only = ON');
  return {
    all: <Row>(sql: string, params: readonly (string | number | null)[] = []) => client.prepare(sql).all(...params) as Row[],
    close: () => client.close(),
  };
}
