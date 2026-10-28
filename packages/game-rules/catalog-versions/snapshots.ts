import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';

import { catalogDedications, type CatalogSnapshot } from '../src/catalog-check.ts';
import type { GameCatalog } from '../src/catalog.ts';

// Schnappschüsse der Katalogversionen, je Version eine Datei `‹version›.json`. Nur für Test und
// Skript (Node); weder App noch Backend-Image enthalten sie.

/** Schnappschuss mit Digest des ganzen Katalogs: Jede Änderung, auch an Namen oder Preisen, braucht eine neue Version. */
export type StoredSnapshot = CatalogSnapshot & Readonly<{ digest: string }>;

export const snapshotDirectory = new URL('./', import.meta.url);

export function snapshotOf(catalog: GameCatalog): StoredSnapshot {
  const digest = `sha256:${createHash('sha256').update(JSON.stringify(catalog)).digest('hex')}`;
  return { version: catalog.version, digest, keys: catalogDedications(catalog) };
}

export function serialize(snapshot: StoredSnapshot): string {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}

/** Alle eingecheckten Schnappschüsse, nach Version sortiert. */
export function readSnapshots(): StoredSnapshot[] {
  return readdirSync(snapshotDirectory)
    .filter((file) => file.endsWith('.json'))
    .map((file) => JSON.parse(readFileSync(new URL(file, snapshotDirectory), 'utf8')) as StoredSnapshot)
    .sort((a, b) => a.version - b.version);
}
