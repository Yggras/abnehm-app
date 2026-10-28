import Database from 'better-sqlite3';

import { searchNames } from '../../src/nutrition/search-text.ts';

// Aufbau der schreibgeschützten Katalogdatenbank (Spezifikation 2, Abschnitt 3). Dieselbe Funktion
// erzeugt das Asset der App und die Test-Kataloge der Modultests, damit beide gleich gebaut sind.
// Gelesen wird die Datei von `src/nutrition/bls-catalog.ts`.

/** Ein Lebensmittel des Katalogs mit Werten je 100 g in `milli_kcal` bzw. mg. */
export type CatalogFood = Readonly<{
  key: string;
  name: string;
  milliKcalPer100: number;
  proteinMgPer100: number;
  carbsMgPer100: number;
  fatMgPer100: number;
}>;

export type CatalogInfo = Readonly<{ version: string; attribution: string }>;

const schema = `
  CREATE TABLE catalog_info (
    version TEXT NOT NULL,
    attribution TEXT NOT NULL
  ) STRICT;

  CREATE TABLE food (
    key TEXT NOT NULL PRIMARY KEY,
    name TEXT NOT NULL,
    search_name TEXT NOT NULL,
    search_alt TEXT,
    milli_kcal_per_100 INTEGER NOT NULL CHECK (milli_kcal_per_100 >= 0),
    protein_mg_per_100 INTEGER NOT NULL CHECK (protein_mg_per_100 >= 0),
    carbs_mg_per_100 INTEGER NOT NULL CHECK (carbs_mg_per_100 >= 0),
    fat_mg_per_100 INTEGER NOT NULL CHECK (fat_mg_per_100 >= 0),
    CHECK (protein_mg_per_100 + carbs_mg_per_100 + fat_mg_per_100 <= 100000)
  ) STRICT;

  -- Präfixsuche über beide Schreibweisen; den Inhalt hält die Tabelle food (external content,
  -- https://www.sqlite.org/fts5.html#external_content_tables).
  CREATE VIRTUAL TABLE food_search USING fts5(search_name, search_alt, content='food', content_rowid='rowid');
`;

/**
 * Baut den Katalog im Speicher und liefert die Datei als Bytes. Gleiche Eingaben ergeben mit
 * derselben SQLite-Version dieselben Bytes: feste Reihenfolge nach Schlüssel, FTS-Index neu
 * aufgebaut und optimiert, Datei per `VACUUM` verdichtet.
 */
export function writeCatalogFile(foods: readonly CatalogFood[], info: CatalogInfo): Buffer {
  const db = new Database(':memory:');
  try {
    db.exec(schema);
    db.prepare('INSERT INTO catalog_info (version, attribution) VALUES (?, ?)').run(info.version, info.attribution);
    const insert = db.prepare(
      `INSERT INTO food (key, name, search_name, search_alt, milli_kcal_per_100, protein_mg_per_100, carbs_mg_per_100, fat_mg_per_100)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    db.transaction(() => {
      for (const food of [...foods].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))) {
        const { searchName, searchAlt } = searchNames(food.name);
        insert.run(
          food.key,
          food.name,
          searchName,
          searchAlt,
          food.milliKcalPer100,
          food.proteinMgPer100,
          food.carbsMgPer100,
          food.fatMgPer100,
        );
      }
    })();
    db.exec(`INSERT INTO food_search (food_search) VALUES ('rebuild');
             INSERT INTO food_search (food_search) VALUES ('optimize');
             VACUUM;`);
    return db.serialize();
  } finally {
    db.close();
  }
}
