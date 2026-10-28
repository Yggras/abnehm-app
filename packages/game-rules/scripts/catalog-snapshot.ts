import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import { serialize, snapshotDirectory, snapshotOf, type StoredSnapshot } from '../catalog-versions/snapshots.ts';
import { gameCatalog } from '../content/index.ts';
import { catalogChanges, checkCatalog } from '../src/catalog-check.ts';

// Legt den Schnappschuss der aktuellen Katalogversion unter `catalog-versions/` an. Aufruf nach jeder
// Katalogänderung mit erhöhter `version`: `npm run catalog:snapshot --workspace @abnehm/game-rules`.
// Ein bestehender Schnappschuss wird nie überschrieben; entfernte oder umgewidmete Schlüssel brechen ab.

const fileOf = (version: number) => new URL(`${version}.json`, snapshotDirectory);
const current = snapshotOf(gameCatalog);

const issues = checkCatalog(gameCatalog);
if (issues.length > 0) {
  console.error('Der Katalog verletzt die Katalogprüfung:', issues);
  process.exit(1);
}

const file = fileOf(current.version);
if (existsSync(file)) {
  if (readFileSync(file, 'utf8') === serialize(current)) {
    console.log(`Schnappschuss für Version ${current.version} ist aktuell.`);
    process.exit(0);
  }
  console.error(`Version ${current.version} hat schon einen anderen Schnappschuss. Erst \`version\` in content/index.ts erhöhen.`);
  process.exit(1);
}

if (current.version > 1) {
  const previousFile = fileOf(current.version - 1);
  if (!existsSync(previousFile)) {
    console.error(`Schnappschuss der vorigen Version ${current.version - 1} fehlt.`);
    process.exit(1);
  }
  const changes = catalogChanges(JSON.parse(readFileSync(previousFile, 'utf8')) as StoredSnapshot, current);
  if (changes.removed.length > 0 || changes.rededicated.length > 0) {
    console.error('Schlüssel dürfen nie entfernt oder umgewidmet werden:', changes);
    process.exit(1);
  }
}

writeFileSync(file, serialize(current));
console.log(`Schnappschuss für Version ${current.version} angelegt.`);
