import type { SeedKey, SeedRow, SeedRows, SeedState } from './manifest.ts';
import type { OutboxOperation } from '../src/sync.ts';

// Baukasten für Seed-Zustände. Ein Szenario setzt sich aus Beiträgen der Bereiche zusammen; jeder
// Beitrag nennt seine synchronisierten Entitäten mit ihrer Sichtbarkeitsgrenze. Der Baukasten vergibt
// Serverversionen in Beitragsreihenfolge, schreibt das Änderungsprotokoll und die Sync-Clock und
// spiegelt die eigenen Entitäten in die lokale Datenbank jeder Installation. Das Ergebnis ist ein
// expliziter Zustand; der Seeder kennt den Baukasten nicht.

/** Bereich, der einen Beitrag liefert (Spezifikationen 0–5). */
export type SeedArea = 'fundament' | 'ziele' | 'ernaehrung' | 'tracker' | 'spiel' | 'partner';

/** Synchronisierte Entität samt Sichtbarkeitsgrenze im Änderungsprotokoll. */
export type SeedEntity = Readonly<{
  table: string;
  /**
   * Sync-Typ, unter dem der Bereich die Entität beim Sync angemeldet hat. Nur dann entsteht ein Eintrag
   * im Änderungsprotokoll; der Pull kennt keine unangemeldeten Typen. Die Serverversion erhält jede
   * Entität, damit sich die Positionen nicht verschieben, wenn ein Bereich seine Entität anmeldet.
   */
  entityType?: string;
  ownerPersonId?: string;
  couplingId?: string;
  recipientPersonId?: string;
  /** Die Zeile ohne `server_version`; die vergibt der Baukasten. */
  row: SeedRow;
  /** Abhängige Zeilen ohne eigene Version, etwa die Tage einer Wochenplanversion. */
  children?: SeedRows;
}>;

export type SeedPart = Readonly<{
  area: SeedArea;
  entities: readonly SeedEntity[];
}>;

/** Eine Installation, deren lokale Datenbank die für ihre Person sichtbaren Entitäten spiegelt. */
export type SeedDevicePlan = Readonly<{
  personId: string;
  /** `latest`: bis zur letzten vergebenen Position gezogen; `null`: noch nie gezogen. */
  cursor: 'latest' | null;
  outbox?: readonly OutboxOperation[];
}>;

/**
 * Setzt die Beiträge zu einem Zustand zusammen. Doppelte Schlüssel über Beiträge hinweg sind ein
 * Fehler, damit ein Bereich keine gemeinsame ID überschreibt.
 */
export function buildSeedState({
  parts,
  createdAt,
  devices,
}: {
  parts: readonly SeedPart[];
  /** Zeitpunkt der Einträge im Änderungsprotokoll. */
  createdAt: string;
  devices: Readonly<Record<SeedKey, SeedDevicePlan>>;
}): SeedState {
  const server: Record<string, SeedRow[]> = {};
  const deviceRows: Record<string, SeedRows> = Object.fromEntries(Object.keys(devices).map((key) => [key, {}]));
  const seen = new Set<string>();
  const add = (rows: Record<string, SeedRow[]>, table: string, row: SeedRow) => (rows[table] ??= []).push(row);
  let position = 0;

  for (const part of parts) {
    for (const entity of part.entities) {
      const id = entity.row.id;
      if (typeof id !== 'string') throw new Error(`${part.area}: ${entity.table} ohne id`);
      if (seen.has(`${entity.table}:${id}`)) throw new Error(`${part.area}: ${entity.table} ${id} ist schon belegt`);
      seen.add(`${entity.table}:${id}`);
      position += 1;
      const versioned = { ...entity.row, server_version: String(position) };
      add(server, entity.table, versioned);
      if (entity.entityType !== undefined) {
        add(server, 'change_log', {
          position: String(position),
          entity_type: entity.entityType,
          entity_id: id,
          operation: entity.row.deleted_at == null ? 'upsert' : 'delete',
          owner_person_id: entity.ownerPersonId ?? null,
          coupling_id: entity.couplingId ?? null,
          recipient_person_id: entity.recipientPersonId ?? null,
          created_at: createdAt,
        });
      }
      for (const [table, rows] of Object.entries(entity.children ?? {})) for (const row of rows) add(server, table, row);
      for (const [key, plan] of Object.entries(devices)) {
        if (!visibleTo(entity, plan.personId)) continue;
        const local = deviceRows[key] as Record<string, SeedRow[]>;
        add(local, entity.table, versioned);
        for (const [table, rows] of Object.entries(entity.children ?? {})) for (const row of rows) add(local, table, row);
      }
    }
  }
  server.sync_clock = [{ id: 1, position: String(position) }];

  return {
    server,
    devices: Object.fromEntries(
      Object.entries(devices).map(([key, plan]) => [
        key,
        {
          rows: deviceRows[key] as SeedRows,
          cursor: plan.cursor === 'latest' ? (String(position) as SeedState['devices'][string]['cursor']) : null,
          outbox: [...(plan.outbox ?? [])],
        },
      ]),
    ),
  };
}

/** Eigene Entitäten und solche an die Person; Kopplungsdaten ergänzen die Partner-Szenarien (#117). */
function visibleTo(entity: SeedEntity, personId: string): boolean {
  return entity.ownerPersonId === personId || entity.recipientPersonId === personId;
}
