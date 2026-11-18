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
  /**
   * Nur Server, nie synchronisiert, etwa ein Fotoentwurf (#162): ohne Serverversion, ohne Eintrag im
   * Änderungsprotokoll und auf keinem Gerät. Die Positionen der übrigen Entitäten bleiben unverändert.
   */
  serverOnly?: true;
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
      if (entity.serverOnly) {
        if (entity.entityType !== undefined || entity.children !== undefined) throw new Error(`${part.area}: ${entity.table} ${id} ist nur Server`);
        add(server, entity.table, { ...entity.row });
        continue;
      }
      position += 1;
      const versioned = { ...entity.row, server_version: String(position) };
      add(server, entity.table, versioned);
      if (entity.entityType !== undefined) add(server, 'change_log', changeLogEntry(entity, position, createdAt));
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

/**
 * Ändert Entitäten eines fertigen Zustands auf dem Server, nachdem die Geräte zuletzt gezogen haben
 * (#113), etwa eine Korrektur von einem anderen Gerät oder einen neu berechneten Partnerstand. Jede
 * Entität ersetzt die Zeile mit ihrer ID oder kommt neu dazu und erhält in Reihenfolge die nächste
 * Serverversion samt Eintrag im Änderungsprotokoll. Die Geräte bleiben, wie sie waren; was ein Pull
 * danach übernimmt, beschreibt `pulledBy`.
 */
export function changedOnServer(state: SeedState, { changes, createdAt }: { changes: readonly SeedEntity[]; createdAt: string }): SeedState {
  const server: Record<string, SeedRow[]> = { ...state.server };
  let position = Number(server.sync_clock?.[0]?.position ?? 0);
  for (const entity of changes) {
    if (entity.entityType === undefined) throw new Error(`${entity.table}: Nach dem Seed ändern sich nur beim Sync angemeldete Entitäten`);
    if (entity.children !== undefined) throw new Error(`${entity.table}: abhängige Zeilen ändern sich nur mit einem neuen Beitrag`);
    position += 1;
    const versioned = { ...entity.row, server_version: String(position) };
    const rows = server[entity.table] ?? [];
    server[entity.table] = rows.some((row) => row.id === entity.row.id)
      ? rows.map((row) => (row.id === entity.row.id ? versioned : row))
      : [...rows, versioned];
    server.change_log = [...(server.change_log ?? []), changeLogEntry(entity, position, createdAt)];
  }
  server.sync_clock = [{ id: 1, position: String(position) }];
  return { server, devices: state.devices };
}

/** Partner-Projektionen, die das Gerät nur als Lesecache führt (#106). */
const partnerCacheTables: readonly string[] = ['partner_summary', 'partner_daily_goal_status'];
/** Projektionen, deren Anlage- und Änderungszeit auf dem Gerät ihr Datenstand ist: der Partnercache und der Inselfortschritt (#184). */
const dataAsOfTables: readonly string[] = [...partnerCacheTables, 'island_progress'];

/**
 * Was der Pull einer Installation übernimmt: jede für ihre Person sichtbare Änderung nach ihrem Cursor,
 * danach steht der Cursor auf der letzten Position. Wie die Adapter der App:
 *
 * - Eine Fassung übernimmt das Gerät mit allen Spalten des Servers (`applyCanonical`).
 * - Eine Löschmarkierung setzt nur `deleted_at` und Serverversion einer bekannten Zeile (`applyTombstone`).
 * - Der Partnercache und der Inselfortschritt führen Anlage- und Änderungszeit einer Projektion als ihren
 *   Datenstand. Gelöschte Partnerprojektionen löscht der Cache ganz; die beschreibt `uncoupledState`, hier
 *   sind sie nicht vorgesehen.
 */
export function pulledBy(state: SeedState, installation: SeedKey, personId: string): SeedState {
  const device = state.devices[installation];
  if (device === undefined) throw new Error(`Seed: unbekannte Installation ${installation}`);
  const cursor = Number(device.cursor ?? 0);
  const members = membershipsOfRows(state.server.coupling_member ?? []);
  const rows: Record<string, SeedRow[]> = { ...device.rows };
  for (const entry of state.server.change_log ?? []) {
    if (Number(entry.position) <= cursor) continue;
    const table = String(entry.entity_type);
    const scope: SeedEntity = {
      table,
      entityType: table,
      ...(entry.owner_person_id === null ? {} : { ownerPersonId: String(entry.owner_person_id) }),
      ...(entry.coupling_id === null ? {} : { couplingId: String(entry.coupling_id) }),
      ...(entry.recipient_person_id === null ? {} : { recipientPersonId: String(entry.recipient_person_id) }),
      row: {},
    };
    if (!visibleTo(scope, personId, members)) continue;
    const cached = partnerCacheTables.includes(table);
    if (entry.operation === 'delete' && cached) throw new Error(`${table}: widerrufene Projektionen beschreibt uncoupledState`);
    const current = (state.server[table] ?? []).find((row) => row.id === entry.entity_id);
    if (current === undefined) throw new Error(`Seed: ${table} ${String(entry.entity_id)} fehlt auf dem Server`);
    const local = rows[table] ?? [];
    const known = local.some((row) => row.id === current.id);
    if (entry.operation === 'delete') {
      if (known) {
        rows[table] = local.map((row) => (row.id === current.id ? { ...row, deleted_at: current.deleted_at ?? null, server_version: current.server_version ?? null } : row));
      }
      continue;
    }
    const pulled = dataAsOfTables.includes(table) ? { ...current, created_at: current.data_as_of ?? null, updated_at: current.data_as_of ?? null } : current;
    rows[table] = known ? local.map((row) => (row.id === current.id ? pulled : row)) : [...local, pulled];
  }
  const latest = String(state.server.sync_clock?.[0]?.position ?? '0') as SeedState['devices'][string]['cursor'];
  return { server: state.server, devices: { ...state.devices, [installation]: { ...device, rows, cursor: latest } } };
}

function changeLogEntry(entity: SeedEntity, position: number, createdAt: string): SeedRow {
  return {
    position: String(position),
    entity_type: entity.entityType ?? null,
    entity_id: String(entity.row.id),
    operation: entity.row.deleted_at == null ? 'upsert' : 'delete',
    owner_person_id: entity.ownerPersonId ?? null,
    coupling_id: entity.couplingId ?? null,
    recipient_person_id: entity.recipientPersonId ?? null,
    created_at: createdAt,
  };
}

type Memberships = ReadonlyMap<string, readonly Readonly<{ personId: string; active: boolean }>[]>;

/** Mitglieder je Kopplung aus den Zeilen `coupling_member` der Beiträge. */
function membershipsOf(parts: readonly SeedPart[]): Memberships {
  return membershipsOfRows(parts.flatMap((part) => part.entities).filter((entity) => entity.table === 'coupling_member').map(({ row }) => row));
}

function membershipsOfRows(rows: readonly SeedRow[]): Memberships {
  const members = new Map<string, { personId: string; active: boolean }[]>();
  for (const row of rows) {
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
