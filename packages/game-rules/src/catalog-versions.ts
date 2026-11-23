import { entriesOf, fieldKey, fieldPlans, keyedEntryKinds, type CatalogEntries, type GameCatalog, type KeyedEntryKind } from './catalog.ts';

// Widmung der Katalogschlüssel für die Versionsprüfung (Spezifikation 4, Abschnitt 4): Schlüssel werden
// nie entfernt oder umgewidmet. Die Schnappschüsse je Version liegen unter `catalog-versions/`.

/** Schlüssel einer Katalogversion mit ihrer Widmung, sortiert. */
export type CatalogSnapshot = Readonly<{ version: number; keys: Readonly<Record<string, string>> }>;

// Wofür ein Schlüssel steht: Art und die Eigenschaften, von denen gespeicherte Inseln abhängen. Eine
// neue Art in `CatalogEntries` ist hier ein Typfehler, bis ihre Widmung eingetragen ist.
const dedications: { [K in KeyedEntryKind]: (entry: CatalogEntries[K]) => string } = {
  bauplan: (blueprint) => `bauplan:${blueprint.role}:${blueprint.origin}`,
  deko: (entry) => (entry.origin === 'jahreszeit' ? `deko:jahreszeit:${entry.season}:${entry.yearIndex}` : `deko:${entry.origin}`),
  gebiet: (area) => `gebiet:${area.unlockLevel}`,
  landschaftsvorlage: () => 'landschaftsvorlage',
  besuchervorlage: () => 'besuchervorlage',
  accessoire: (accessory) => `accessoire:${accessory.slot}`,
  gemeinschaftsprojekt: (project) => `gemeinschaftsprojekt:${project.sequenceNumber}`,
  ausbauvorlage: (expansion) => `ausbauvorlage:${expansion.project}`,
  challenge_vorlage: () => 'challenge_vorlage',
};

/**
 * Widmung aller Schlüssel: Einträge je Art, Felder als `feld:‹art›[:‹seite›]` (Felder einer
 * Landschaftsvorlage unter `‹vorlage›:‹x›:‹y›`) und Level-Freischaltungen als `level:‹L›:‹rolle›`.
 */
export function catalogDedications(catalog: GameCatalog): Record<string, string> {
  const keys: Record<string, string> = {};
  for (const kind of keyedEntryKinds) {
    const dedicate = dedications[kind] as (entry: CatalogEntries[KeyedEntryKind]) => string;
    for (const entry of entriesOf(catalog, kind)) keys[entry.key] = dedicate(entry);
  }
  for (const { level, role, blueprint } of catalog.levelUnlocks) keys[`level:${level}:${role}`] = blueprint;
  for (const plan of fieldPlans(catalog)) {
    for (const field of plan.fields) keys[fieldKey(plan.area, field)] = 'side' in field ? `feld:${field.kind}:${field.side}` : `feld:${field.kind}`;
  }
  return Object.fromEntries(Object.entries(keys).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** Schlüssel der vorigen Version, die fehlen oder anders gewidmet sind; Ergänzungen sind erlaubt. */
export function catalogChanges(previous: CatalogSnapshot, current: CatalogSnapshot): { removed: string[]; rededicated: string[] } {
  const entries = Object.entries(previous.keys);
  return {
    removed: entries.filter(([key]) => !Object.hasOwn(current.keys, key)).map(([key]) => key),
    rededicated: entries.filter(([key, dedication]) => Object.hasOwn(current.keys, key) && current.keys[key] !== dedication).map(([key]) => key),
  };
}
