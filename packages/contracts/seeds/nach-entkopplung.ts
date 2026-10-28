import { ServerVersion } from '../src/base.ts';
import { revocationNoticeId } from '../src/partner.ts';
import { compareCodeUnits } from './canonical.ts';
import { gekoppeltExtensions, gekoppeltState } from './gekoppelt.ts';
import { seedAccounts, seedClock, seedDays, seedIds, seedInstallations } from './ids.ts';
import { SeedManifest, type SeedRow, type SeedRows, type SeedState } from './manifest.ts';

// Szenario `nach_entkopplung` (Spezifikation 0, Abschnitt 12; #117). Es startet im Zustand von
// `gekoppelt`: Beide Geräte zeigen Zusammenfassungen und Tageszielstand des Partners. Dann entkoppelt
// Anna über den Entkopplungs-Kern (#107), und beide Geräte synchronisieren. Der Sollzustand ist also
// ein tatsächlich ausgeführter Widerruf, kein direkt geseedeter, bereinigter Zustand.
//
// Spezifikation 5 erweitert das Szenario später um ihren Befehl `requestUncoupling` (lokal `offen`, vom
// Server sofort angenommen). Der ruft denselben Kern auf und ergänzt den Sollzustand um seinen Intent
// `entkopplung` und den Sicherheitslog-Eintrag, ohne den hier beschriebenen Kernübergang zu duplizieren.

/** Anfrage des Schritts `entkoppeln` an den Entkopplungs-Kern: das Konto als Person aufgelöst. */
export type SeedUncouplingRequest = Readonly<{ couplingId: string; actionId: string; at: string; requesterPersonId: string }>;

/** Löst den Schritt `entkoppeln` über die Konten des Manifests auf; Seeder, Tests und Sollzustand teilen das. */
export function uncouplingRequestOf(
  step: Readonly<{ account: string; couplingId: string; actionId: string; at: string }>,
  accounts: readonly Readonly<{ key: string; personId: string }>[],
): SeedUncouplingRequest {
  const requester = accounts.find((account) => account.key === step.account);
  if (requester === undefined) throw new Error(`Seed: unbekanntes Konto ${step.account}`);
  return { couplingId: step.couplingId, actionId: step.actionId, at: step.at, requesterPersonId: requester.personId };
}

/** Widerrufbare Partner-Projektionen; der Kern löscht sie in dieser Reihenfolge. */
const projectionTables = ['partner_summary', 'partner_daily_goal_status'] as const;

const rowsOf = (rows: SeedRows, table: string): SeedRow[] => rows[table] ?? [];
const byField = (field: string) => (a: SeedRow, b: SeedRow) => compareCodeUnits(String(a[field]), String(b[field]));
/** Die Mitglieder folgen dem Status ihrer Kopplung per `ON UPDATE CASCADE`, ohne neue Version. */
const archiveMembers = (rows: SeedRows, couplingId: string): SeedRow[] =>
  rowsOf(rows, 'coupling_member').map((row) => (row.coupling_id === couplingId ? { ...row, coupling_status: 'archiviert' } : row));

/**
 * Sollzustand nach `entkoppeln` und dem anschließenden Sync aller Installationen, abgeleitet aus einem
 * Ausgangszustand mit aktiver Kopplung. Er beschreibt, was der Entkopplungs-Kern (#107) samt Widerruf
 * (#106) schreibt, in dessen Reihenfolge der Serverversionen:
 *
 * 1. Kopplung archiviert; die Mitglieder folgen per `ON UPDATE CASCADE` ohne neue Version.
 * 2. Insel archiviert.
 * 3. Offene gemeinsame Aktionen nach ID: `zurueckgezogen`.
 * 4. Die Entkopplung als gemeinsame Aktion `entkoppeln`, sofort `angenommen`.
 * 5. Lebendige Projektionen der Kopplung nach ID, erst Zusammenfassungen, dann Tageszielstand: Löschmarkierung.
 * 6. Je Mitglied nach Personen-ID eine Revocation-Notice `kopplung`/`entkopplung`.
 *
 * Danach hat jedes Gerät gezogen: Es kennt die archivierte Kopplung, seine Mitglieder sind archiviert und
 * der Partnercache der Kopplung ist leer. Insel und gemeinsame Aktionen bleiben dort, wie sie waren; die
 * beim Entkoppeln beendeten Aktionen kommen erst mit einer Reaktivierung an (#107).
 */
export function uncoupledState(state: SeedState, { couplingId, actionId, at, requesterPersonId }: SeedUncouplingRequest): SeedState {
  const server: Record<string, SeedRow[]> = { ...state.server };
  const changeLog: SeedRow[] = [];
  let position = Number(rowsOf(server, 'sync_clock')[0]?.position ?? 0);
  /** Vergibt die nächste Serverversion und trägt die Änderung im Änderungsprotokoll ein. */
  const change = (entityType: string, entityId: string, operation: 'upsert' | 'delete', scope: { couplingId?: string; recipientPersonId?: string }) => {
    position += 1;
    const version = String(position);
    changeLog.push({
      position: version,
      entity_type: entityType,
      entity_id: entityId,
      operation,
      owner_person_id: null,
      coupling_id: scope.couplingId ?? null,
      recipient_person_id: scope.recipientPersonId ?? null,
      created_at: at,
    });
    return version;
  };
  const patch = (table: string, id: unknown, values: SeedRow) => {
    server[table] = rowsOf(server, table).map((row) => (row.id === id ? { ...row, ...values } : row));
  };
  const ofCoupling = (table: string) => rowsOf(server, table).filter((row) => row.coupling_id === couplingId);

  patch('coupling', couplingId, { status: 'archiviert', ended_at: at, updated_at: at, server_version: change('coupling', couplingId, 'upsert', { couplingId }) });
  server.coupling_member = archiveMembers(server, couplingId);

  const island = ofCoupling('island')[0];
  if (island === undefined) throw new Error('Seed: Insel der Kopplung fehlt');
  patch('island', island.id, { state: 'archiviert', updated_at: at, server_version: change('island', String(island.id), 'upsert', { couplingId }) });

  for (const action of ofCoupling('shared_action').filter((row) => row.status === 'offen').sort(byField('id'))) {
    const version = change('shared_action', String(action.id), 'upsert', { couplingId });
    patch('shared_action', action.id, { status: 'zurueckgezogen', decided_at: at, updated_at: at, server_version: version });
  }
  const uncouplingVersion = change('shared_action', actionId, 'upsert', { couplingId });
  server.shared_action = [
    ...rowsOf(server, 'shared_action'),
    {
      id: actionId,
      coupling_id: couplingId,
      kind: 'entkoppeln',
      requester_person_id: requesterPersonId,
      payload: {},
      status: 'angenommen',
      decided_at: at,
      created_at: at,
      updated_at: at,
      deleted_at: null,
      server_version: uncouplingVersion,
    },
  ];

  for (const table of projectionTables) {
    for (const projection of ofCoupling(table).filter((row) => row.deleted_at === null).sort(byField('id'))) {
      const version = change(table, String(projection.id), 'delete', { recipientPersonId: String(projection.recipient_person_id) });
      patch(table, projection.id, { deleted_at: at, updated_at: at, server_version: version });
    }
  }

  for (const member of ofCoupling('coupling_member').sort(byField('person_id'))) {
    const recipientPersonId = String(member.person_id);
    // Die ID folgt aus der Serverversion, die die Notice gleich erhält.
    const id = revocationNoticeId(ServerVersion.parse(String(position + 1)));
    const version = change('revocation_notice', id, 'upsert', { recipientPersonId });
    server.revocation_notice = [
      ...rowsOf(server, 'revocation_notice'),
      {
        id,
        recipient_person_id: recipientPersonId,
        coupling_id: couplingId,
        target_type: 'kopplung',
        projection_id: null,
        reason: 'entkopplung',
        created_at: at,
        server_version: version,
      },
    ];
  }
  server.change_log = [...rowsOf(server, 'change_log'), ...changeLog];
  server.sync_clock = [{ id: 1, position: String(position) }];

  const archived = rowsOf(server, 'coupling').find((row) => row.id === couplingId)!;
  const devices = Object.fromEntries(
    Object.entries(state.devices).map(([key, device]) => {
      const rows: Record<string, SeedRow[]> = { ...device.rows };
      rows.coupling = rowsOf(rows, 'coupling').map((row) => (row.id === couplingId ? archived : row));
      rows.coupling_member = archiveMembers(rows, couplingId);
      for (const table of projectionTables) rows[table] = rowsOf(rows, table).filter((row) => row.coupling_id !== couplingId);
      return [key, { ...device, rows, cursor: String(position) as SeedState['devices'][string]['cursor'] }];
    }),
  );
  return { server, devices };
}

const accounts = [seedAccounts.philipp, seedAccounts.anna];
const uncoupling = {
  type: 'entkoppeln',
  account: seedAccounts.anna.key,
  couplingId: seedIds.coupling.philippAnna,
  actionId: seedIds.sharedAction.annasEntkopplung,
  at: seedClock.instant,
} as const;

export const nachEntkopplungManifest = SeedManifest.parse({
  formatVersion: 1,
  scenario: 'nach_entkopplung',
  revision: 1,
  clock: seedClock,
  localDates: seedDays,
  catalogVersion: null,
  accounts,
  installations: [seedInstallations.philippIphone, seedInstallations.annaAndroid],
  initial: gekoppeltState,
  steps: [
    uncoupling,
    { type: 'sync', installation: seedInstallations.philippIphone.key },
    { type: 'sync', installation: seedInstallations.annaAndroid.key },
  ],
  target: uncoupledState(gekoppeltState, uncouplingRequestOf(uncoupling, accounts)),
  extensions: gekoppeltExtensions,
});
