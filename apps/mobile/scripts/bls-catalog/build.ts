import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { blsCatalogVersion } from '../../src/nutrition/bls-catalog-version.ts';
import { blsAttribution, readBlsArchive } from './bls-source.ts';
import { writeCatalogFile } from './catalog-file.ts';

// Baut den BLS-Katalog der App aus dem BLS 4.0 (#154; Ablauf in docs/entwicklung.md):
//
//   npm run bls-katalog --workspace @abnehm/mobile                         # lädt die Quelle von blsdb.de
//   npm run bls-katalog --workspace @abnehm/mobile -- --quelle <zip>       # nutzt eine geladene Quelle
//   npm run bls-katalog --workspace @abnehm/mobile -- --pruefen            # vergleicht nur mit dem Asset
//
// Die Quelle ist das ZIP-Archiv der Downloadseite https://www.blsdb.de/download; ihre Prüfsumme steht
// unten. Eine andere Datei bricht ab, damit dasselbe Skript immer dasselbe Asset erzeugt.

const source = {
  url: 'https://www.blsdb.de/assets/uploads/BLS_4_0_2025_DE.zip?token=0L5P-0Z91-EEBN-VE6D-AGM3-6NEB-0J2F-Q97X',
  sha256: '12b7a6ba62807ec9b301eb276f897dc85f99b2292311618dec3749a12d984c91',
  /** „Anzahl Lebensmittel 7.140 Einträge“ (BLS-4.0-Dokumentation, Abschnitt 2.1). */
  rows: 7_140,
};

const assetPath = fileURLToPath(new URL('../../assets/catalog/bls-katalog.db', import.meta.url));

const { values: options } = parseArgs({ options: { quelle: { type: 'string' }, pruefen: { type: 'boolean', default: false } } });

const archive = options.quelle === undefined ? await download(source.url) : readFileSync(options.quelle);
const archiveSha256 = sha256(archive);
if (archiveSha256 !== source.sha256) {
  throw new Error(`Unerwartete Quelle (SHA-256 ${archiveSha256}); erwartet wird BLS_4_0_2025_DE.zip mit ${source.sha256}.`);
}

const { foods, excluded } = readBlsArchive(archive);
if (foods.length + excluded.length !== source.rows) {
  throw new Error(`${foods.length + excluded.length} Lebensmittel gelesen, erwartet ${source.rows}.`);
}
const catalog = writeCatalogFile(foods, { version: blsCatalogVersion, attribution: blsAttribution });

console.log(`Katalogversion ${blsCatalogVersion}: ${foods.length} Lebensmittel, ${excluded.length} ausgelassen`);
for (const food of excluded) console.log(`  ausgelassen ${food.key} ${food.name}: ${food.reason}`);
console.log(`Asset: ${catalog.length} Bytes, SHA-256 ${sha256(catalog)}`);

if (options.pruefen) {
  const same = readFileSync(assetPath).equals(catalog);
  console.log(same ? 'Das eingecheckte Asset stimmt überein.' : 'Das eingecheckte Asset weicht ab.');
  if (!same) process.exitCode = 1;
} else {
  mkdirSync(dirname(assetPath), { recursive: true });
  writeFileSync(assetPath, catalog);
  console.log(`Geschrieben: ${assetPath}`);
}

async function download(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download fehlgeschlagen (HTTP ${response.status}). Die Datei von https://www.blsdb.de/download laden und mit --quelle angeben.`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function sha256(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}
