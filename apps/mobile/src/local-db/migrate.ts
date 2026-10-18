import { sql } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import { migrate } from 'drizzle-orm/expo-sqlite/migrator';

import type { SqliteDatabase } from './connection';
import bundledMigrations from './migrations/migrations';
import type * as schema from './schema';

/**
 * Führt die mit der App gebündelten Migrationen aus (`migrations/migrations.js`, erzeugt von
 * drizzle-kit). Drizzle merkt sich angewandte Migrationen in `__drizzle_migrations` und führt
 * ausstehende in einer Transaktion aus; ein erneuter Aufruf ist folgenlos.
 *
 * Während der Migration sind Fremdschlüssel aus, weil SQLite manche Schemaänderungen nur über einen
 * Tabellenneubau kann und `PRAGMA foreign_keys` innerhalb einer Transaktion wirkungslos ist
 * (https://www.sqlite.org/lang_altertable.html#otheralter). Danach muss `foreign_key_check` leer sein.
 */
export async function migrateLocalDatabase(db: SqliteDatabase): Promise<void> {
  db.run(sql`PRAGMA foreign_keys = OFF`);
  try {
    // Der Migrator von Drizzle für expo-sqlite ruft nur `db.dialect.migrate(…, db.session)` auf
    // (https://unpkg.com/drizzle-orm@0.45.4/expo-sqlite/migrator.js). Bei better-sqlite3 (Tests) sind
    // das derselbe synchrone SQLite-Dialekt und eine gleichwertige synchrone Sitzung.
    await migrate(db as unknown as ExpoSQLiteDatabase<typeof schema>, bundledMigrations);
    const violations = db.all(sql`PRAGMA foreign_key_check`);
    if (violations.length > 0) throw new Error(`Migration hinterlässt ${violations.length} Fremdschlüsselverletzungen`);
  } finally {
    db.run(sql`PRAGMA foreign_keys = ON`);
  }
}
