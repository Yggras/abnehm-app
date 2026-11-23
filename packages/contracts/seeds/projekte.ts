import { gameCatalog } from '@abnehm/game-rules/content';
import { islandProgress } from '@abnehm/game-rules/progress';
import { projectAt, projectOccasionKey } from '@abnehm/game-rules/projects';
import { levelOccasionKey } from '@abnehm/game-rules/unlocks';

import { EntityId, LocalDate } from '../src/base.ts';
import { energyBookingId } from '../src/energy.ts';
import { ContributeToProject, contributeToProjectKey, type IslandRole } from '../src/island.ts';
import { islandContentId, islandEventId } from '../src/island-records.ts';
import { notificationIntentId } from '../src/notifications.ts';
import { currentSyncSchemaVersion, OutboxOperation } from '../src/sync.ts';
import { buildSeedState, changedOnServer, pulledBy, type SeedEntity } from './build.ts';
import { gekoppeltExtensions, gekoppeltPartsBuilt } from './gekoppelt.ts';
import { seedAccounts, seedClock, seedDays, seedIds, seedInstallations } from './ids.ts';
import { SeedManifest, type SeedRow, type SeedState, type SeedValue } from './manifest.ts';
import { changedOffline, processed, type OfflineChange } from './sync-szenarien.ts';

// Szenario der Gemeinschaftsprojekte (Spezifikation 4, Abschnitt 13; #208), mit denselben IDs, derselben Uhr und
// derselben Zone wie `gekoppelt`:
//
// - `projekt-abschluss` („Projektabschluss mit Start des nächsten Projekts“): `gekoppelt`, aber noch ohne Bauten, also
//   auf Level 1 mit Projekt 1, dem Gartenhäuschen (je 20 Bedarf). Offline hat Anna auf ihrem Android 20 Energie in
//   ihren Natur-Anteil eingezahlt, Philipp auf seinem iPhone 20 in seinen Bau-Anteil. Erst synct Anna: Ihr Anteil ist
//   voll, gemeinsam ist das Projekt „gut unterwegs“. Dann Philipp: Beide Anteile sind voll, das Gartenhäuschen ist im
//   selben Befehl fertig, sein Wahrzeichen steht, und Projekt 2 beginnt, im ausgelieferten Katalog der
//   Gartenhäuschen-Ausbau mit je 30 Bedarf. Mit 20 verbaut je Person steigt die Insel dabei auf Level 2; der Katalog
//   hat dort keine Freischaltung. Zuletzt holt Annas Android den Abschluss ab. Beide bekommen je einen Intent
//   `projektabschluss` und `levelaufstieg`.
//
// Ohne Bauten, weil ein Abschluss sonst über Schwelle(4) = 36 auf das erste Formlevel samt Gebiet führte; das zeigen
// `levelaufstieg-ausstehend` und `formwechsel` (#200, #204). Alle Werte sind erfunden.

const philipp = seedIds.person.philipp;
const anna = seedIds.person.anna;
const couplingId = seedIds.coupling.philippAnna;
const islandId = EntityId.parse(seedIds.island.philippAnna);
const iphone = seedInstallations.philippIphone.key;
const android = seedInstallations.annaAndroid.key;
const now = seedClock.instant;
const today = LocalDate.parse(seedDays.heute);
const firstProject = seedIds.communityProject.gartenhaeuschen;
const nextProject = islandContentId('community_project', islandId, '2');
const membersInOrder = [philipp, anna].sort();

/** Je Person eine Einzahlung von 20 in den Anteil ihrer Rolle; `n` ist die laufende Nummer. */
type SeedContribution = Readonly<{ personId: string; role: IslandRole; n: number; operationId: string; at: string }>;

const einzahlungen = {
  anna: { personId: anna, role: 'natur', n: 1, operationId: seedIds.operation.projektAbschluss.android, at: '2026-10-14T10:00:00.000Z' },
  philipp: { personId: philipp, role: 'bauen', n: 2, operationId: seedIds.operation.projektAbschluss.iphone, at: '2026-10-14T11:00:00.000Z' },
} as const satisfies Record<string, SeedContribution>;

const amount = 20;

/** Buchung und Einzahlung, wie `contributeToProject` sie schreibt: zuerst die Buchung, auf die die Einzahlung verweist. */
function contributionEntities({ personId, role, n }: SeedContribution, at: string): SeedEntity[] {
  const commandId = seedIds.contributeCommand(n);
  const bookingId = energyBookingId(EntityId.parse(commandId));
  return [
    {
      table: 'energy_booking',
      entityType: 'energy_booking',
      ownerPersonId: personId,
      row: {
        id: bookingId,
        person_id: personId,
        type: 'project_contribution_debit',
        amount: -amount,
        local_date: today,
        booking_key: commandId,
        trigger: { commandId, projectId: firstProject },
        daily_goal_completion_id: null,
        island_object_id: null,
        community_project_id: firstProject,
        original_booking_id: null,
        created_at: at,
      },
    },
    {
      table: 'project_contribution',
      entityType: 'project_contribution',
      ownerPersonId: personId,
      row: {
        id: seedIds.contribution(n),
        community_project_id: firstProject,
        person_id: personId,
        role,
        amount,
        energy_booking_id: bookingId,
        command_id: commandId,
        created_at: at,
      },
    },
  ];
}

/** Die Offline-Einzahlung, wie der Spieldienst sie schreibt: Buchung und Einzahlung ohne Serverversion, dazu `contributeToProject`. */
function offlineContribution(contribution: SeedContribution): OfflineChange {
  const payload = ContributeToProject.parse({
    commandId: seedIds.contributeCommand(contribution.n),
    contributionId: seedIds.contribution(contribution.n),
    projectId: firstProject,
    amount,
    localDate: today,
  });
  return {
    rows: contributionEntities(contribution, contribution.at).map(({ table, row }) => ({ table, row: { ...row, server_version: null } })),
    operation: OutboxOperation.parse({
      type: 'contributeToProject',
      operationId: contribution.operationId,
      businessKey: contributeToProjectKey(payload.commandId),
      payload,
      knownServerVersion: null,
      schemaVersion: currentSyncSchemaVersion,
      createdAt: contribution.at,
    }),
  };
}

/** Eine Zeile des Servers, gesucht über ihre ID. */
function serverRow(state: SeedState, table: string, id: string): SeedRow {
  const row = state.server[table]?.find((candidate) => candidate.id === id);
  if (row === undefined) throw new Error(`Seed: ${table} ${id} fehlt`);
  return row;
}

/** Eine neue Fassung einer Kopplungszeile zur Uhr des Servers; die Serverversion vergibt `changedOnServer`. */
function revised(state: SeedState, table: string, id: string, changes: SeedRow): SeedEntity {
  const row = Object.fromEntries(Object.entries(serverRow(state, table, id)).filter(([column]) => column !== 'server_version'));
  return { table, entityType: table, couplingId, row: { ...row, ...changes, updated_at: now } };
}

/** Der Inselfortschritt nach den Einzahlungen, wie der Projector ihn schreibt: Mitglieder nach Person, ohne Energiemengen. */
function progressAfter(state: SeedState, spent: Readonly<Record<string, number>>, activeProject: { [key: string]: SeedValue }): SeedEntity {
  const { level, levelNeed, halves } = islandProgress([spent[membersInOrder[0]!]!, spent[membersInOrder[1]!]!]);
  return revised(state, 'island_progress', seedIds.islandProgress.philippAnna, {
    level,
    level_need: levelNeed,
    content: { members: membersInOrder.map((personId, index) => ({ personId, ...halves[index]! })), activeProject },
    data_as_of: now,
  });
}

/** Ein gemeinsames Ereignis der Insel, wie der Server es mit seinem Anlassschlüssel schreibt. */
function sharedEvent(type: 'projektabschluss' | 'levelaufstieg', occasionKey: string, templateKey: string | null): SeedEntity {
  return {
    table: 'island_event',
    entityType: 'island_event',
    couplingId,
    row: {
      id: islandEventId(islandId, occasionKey),
      island_id: islandId,
      coupling_id: couplingId,
      type,
      template_key: templateKey,
      responsible_person_id: null,
      occasion_key: occasionKey,
      status: 'abgeschlossen',
      reward: null,
      occurred_at: now,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    },
  };
}

/** Ein offener Intent an eine Person; nur Server, ohne Sync. */
function intent(type: 'projektabschluss' | 'levelaufstieg', occasionKey: string, recipientPersonId: string, payload: { [key: string]: SeedValue }): SeedRow {
  const sourceEventId = islandEventId(islandId, occasionKey);
  return {
    intent_id: notificationIntentId({ sourceEventId, recipientPersonId: EntityId.parse(recipientPersonId), type }),
    source_event_id: sourceEventId,
    recipient_person_id: recipientPersonId,
    type,
    message_key: type,
    payload,
    status: 'offen',
    created_at: now,
    status_changed_at: now,
  };
}

function projektAbschluss() {
  const synced = buildSeedState({
    parts: gekoppeltPartsBuilt([]),
    createdAt: now,
    devices: { [iphone]: { personId: philipp, cursor: 'latest' }, [android]: { personId: anna, cursor: 'latest' } },
  });
  const initial = [
    [android, einzahlungen.anna],
    [iphone, einzahlungen.philipp],
  ].reduce<SeedState>((state, [installation, contribution]) => changedOffline(state, installation as string, [offlineContribution(contribution as SeedContribution)]), synced);

  const first = projectAt(gameCatalog, 1);
  const next = projectAt(gameCatalog, 2);
  const completed = projectOccasionKey(islandId, 1);
  const levelTwo = levelOccasionKey(islandId, 2);
  // Annas Einzahlung: Ihr Natur-Anteil ist voll, gemeinsam die Hälfte von 40, also „gut unterwegs“.
  const annas = [
    ...contributionEntities(einzahlungen.anna, now),
    progressAfter(initial, { [anna]: amount, [philipp]: 0 }, { projectId: firstProject, templateKey: first.templateKey, sequenceNumber: 1, stage: 'gut_unterwegs' }),
  ];
  // Philipps Einzahlung: Projekt 1 fertig, Projekt 2 beginnt, das Ereignis, dann der Fortschritt auf Level 2 samt Aufstieg.
  const philipps = [
    ...contributionEntities(einzahlungen.philipp, now),
    revised(initial, 'community_project', firstProject, { status: 'fertig', completed_at: now }),
    {
      table: 'community_project',
      entityType: 'community_project',
      couplingId,
      row: {
        id: nextProject,
        island_id: islandId,
        coupling_id: couplingId,
        sequence_number: next.sequenceNumber,
        template_key: next.templateKey,
        build_need: next.need,
        nature_need: next.need,
        status: 'aktiv',
        completed_at: null,
        created_at: now,
        updated_at: now,
        deleted_at: null,
      },
    },
    sharedEvent('projektabschluss', completed, first.templateKey),
    progressAfter(initial, { [anna]: amount, [philipp]: amount }, { projectId: nextProject, templateKey: next.templateKey, sequenceNumber: 2, stage: 'gestartet' }),
    sharedEvent('levelaufstieg', levelTwo, null),
  ] satisfies SeedEntity[];
  const server = changedOnServer(initial, { createdAt: now, changes: [...annas, ...philipps] });
  const intents = [
    ...membersInOrder.map((personId) => intent('projektabschluss', completed, personId, { templateKey: first.templateKey })),
    ...membersInOrder.map((personId) => intent('levelaufstieg', levelTwo, personId, { level: 2 })),
  ];
  const withResults: SeedState = {
    server: {
      ...server.server,
      notification_intent: intents,
      processed_operation: [
        { ...processed(einzahlungen.anna.operationId, 'applied', { command: 'contributeToProject', businessKey: contributeToProjectKey(EntityId.parse(seedIds.contributeCommand(1))) }), person_id: anna },
        processed(einzahlungen.philipp.operationId, 'applied', { command: 'contributeToProject', businessKey: contributeToProjectKey(EntityId.parse(seedIds.contributeCommand(2))) }),
      ],
    },
    devices: server.devices,
  };
  const pulled = pulledBy(pulledBy(withResults, android, anna), iphone, philipp);
  return {
    initial,
    target: { server: pulled.server, devices: Object.fromEntries(Object.entries(pulled.devices).map(([key, device]) => [key, { ...device, outbox: [] }])) },
  };
}

const projektAbschlussStates = projektAbschluss();

export const projektAbschlussManifest = SeedManifest.parse({
  formatVersion: 1,
  scenario: 'projekt-abschluss',
  revision: 1,
  clock: seedClock,
  localDates: seedDays,
  catalogVersion: null,
  accounts: [seedAccounts.philipp, seedAccounts.anna],
  installations: [seedInstallations.philippIphone, seedInstallations.annaAndroid],
  initial: projektAbschlussStates.initial,
  // Erst Annas Android, dann Philipps iPhone mit dem Abschluss, zuletzt holt Annas Android ihn ab.
  steps: [
    { type: 'sync', installation: android },
    { type: 'sync', installation: iphone },
    { type: 'sync', installation: android },
  ],
  target: projektAbschlussStates.target,
  extensions: gekoppeltExtensions,
});
