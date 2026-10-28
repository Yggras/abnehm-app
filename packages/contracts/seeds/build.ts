import { seedClock, seedUtcOffsetMinutes } from './ids.ts';
import type { SeedKey, SeedRow, SeedRows, SeedState } from './manifest.ts';
import type { BausteinKey } from '../src/base.ts';
import type { OutboxOperation } from '../src/sync.ts';

// Baukasten für Seed-Zustände. Ein Szenario setzt sich aus Beiträgen der Bereiche zusammen; jeder
// Beitrag nennt seine synchronisierten Entitäten mit ihrer Sichtbarkeitsgrenze. Der Baukasten vergibt
// Serverversionen in Beitragsreihenfolge, schreibt das Änderungsprotokoll und die Sync-Clock und
// spiegelt die eigenen Entitäten in die lokale Datenbank jeder Installation. Das Ergebnis ist ein
// expliziter Zustand; der Seeder kennt den Baukasten nicht.

/** Tagesbezug einer Zeile: lokaler Tag in der Zone der festen Uhr samt Offset. */
export const seedDay = (localDate: string) => ({ local_date: localDate, time_zone: seedClock.timeZone, utc_offset_minutes: seedUtcOffsetMinutes });

/** Zeitstempel einer veränderlichen Zeile, die seit ihrer Anlage unverändert und nicht gelöscht ist. */
export const seedCreated = (at: string) => ({ created_at: at, updated_at: at, deleted_at: null });

/** Herkunft eines manuell erfassten Sport- oder Gewichtseintrags (Spezifikation 3). */
export const seedManualOrigin = { origin: 'manuell', external_key: null, source_app_id: null, source_app_name: null, hidden_at: null } as const;

export type SeedWeeklyPlan = Readonly<Record<string, readonly [BausteinKey, BausteinKey, BausteinKey]>>;

/** Wochenplanversion einer Person samt ihrer sieben Tage (Spezifikation 1). */
export function seedWeeklyPlan(options: { id: string; personId: string; validFrom: string; createdAt: string; plan: SeedWeeklyPlan }): SeedEntity {
  return {
    table: 'weekly_plan_version',
    ownerPersonId: options.personId,
    row: { id: options.id, person_id: options.personId, valid_from: options.validFrom, ...seedCreated(options.createdAt) },
    children: {
      weekly_plan_day: Object.entries(options.plan).map(([weekday, [baustein1, baustein2, baustein3]]) => ({
        weekly_plan_version_id: options.id,
        person_id: options.personId,
        weekday,
        baustein_1: baustein1,
        baustein_2: baustein2,
        baustein_3: baustein3,
      })),
    },
  };
}

/** Die drei Tagesziele eines Tags nach dem Wochenplantag, mit den Schwellen aus der Zielversion (Spezifikation 1). */
export function seedDailyGoals(options: {
  personId: string;
  ids: readonly [string, string, string];
  localDate: string;
  dayEndsAt: string;
  createdAt: string;
  bausteine: readonly [BausteinKey, BausteinKey, BausteinKey];
  thresholds: Readonly<Partial<Record<BausteinKey, Readonly<Record<string, number>>>>>;
}): SeedEntity[] {
  return options.bausteine.map((baustein, index) => {
    const slot = index + 1;
    return {
      table: 'daily_goal',
      ownerPersonId: options.personId,
      row: {
        id: options.ids[index] as string,
        person_id: options.personId,
        ...seedDay(options.localDate),
        slot,
        baustein,
        snapshot: {
          type: baustein,
          personId: options.personId,
          localDate: options.localDate,
          slot,
          timeZone: seedClock.timeZone,
          dayEndsAt: options.dayEndsAt,
          ...options.thresholds[baustein],
        },
        day_ends_at: options.dayEndsAt,
        created_at: options.createdAt,
      },
    };
  });
}

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
  const members = membershipsOf(parts);
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
        if (!visibleTo(entity, plan.personId, members)) continue;
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

type Memberships = ReadonlyMap<string, readonly Readonly<{ personId: string; active: boolean }>[]>;

/** Mitglieder je Kopplung aus den Zeilen `coupling_member` der Beiträge. */
function membershipsOf(parts: readonly SeedPart[]): Memberships {
  const members = new Map<string, { personId: string; active: boolean }[]>();
  for (const { row } of parts.flatMap((part) => part.entities).filter((entity) => entity.table === 'coupling_member')) {
    const couplingId = String(row.coupling_id);
    members.set(couplingId, [...(members.get(couplingId) ?? []), { personId: String(row.person_id), active: row.coupling_status === 'aktiv' }]);
  }
  return members;
}

/**
 * Wer eine Entität im Pull erhält, wie in `visibleTo` des Sync-Kerns: Adressiertes nur der Empfänger,
 * sonst der Eigentümer und die aktiven Mitglieder der Kopplung. Die Kopplung selbst ist ihr
 * Archivstatus und bleibt auch früheren Mitgliedern sichtbar (#103, #107). Der Sync-Kern liest die
 * Archivstatus-Entitäten aus der Registry (`archiveStatus`); hier steht die einzige, `coupling`, fest.
 */
function visibleTo(entity: SeedEntity, personId: string, memberships: Memberships): boolean {
  if (entity.recipientPersonId !== undefined) return entity.recipientPersonId === personId;
  if (entity.ownerPersonId === personId) return true;
  if (entity.couplingId === undefined) return false;
  const member = memberships.get(entity.couplingId)?.find((candidate) => candidate.personId === personId);
  return member !== undefined && (member.active || entity.entityType === 'coupling');
}
