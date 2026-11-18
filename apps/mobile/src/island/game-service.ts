import type { Clock } from '@abnehm/clock';
import { TimeZone, type EntityId } from '@abnehm/contracts/base';
import type { ContributionState } from '@abnehm/contracts/contribution';
import type { IslandRole } from '@abnehm/contracts/island';
import type { WirContribution, WirContributionSource } from '@abnehm/contracts/wir';

import type { LocalDatabase } from '../local-db';
import type { TodaySource, TodayState } from '../shell/today-registry';
import type { SyncWriter } from '../sync';
import { growthIntroShown, markGrowthIntroShown } from './growth-intro';
import { readIslandStage, roleChoiceCommands, type IslandStage, type RoleChoiceOutcome } from './role-choice';

// Spieldienst der App für den Tab „Momo“ (Spezifikation 4, Abschnitt 1): ein Lesemodell der Stufe von
// der Laichkugel über die Rollenwahl (#180) bis zur geschlüpften Insel (#184), die Befehle der Rollenwahl,
// das Einmal-Flag „So wächst Momo“ und die Beiträge an „Heute“ (`momo.character`) und „Wir“
// (`pending_shared_action`, `shared_event`). Die App-Sitzung erzeugt ihn je geöffneter
// Kontodatenbank und meldet ihn an (`src/session/device-session.ts`).

export type GameServiceDependencies = Readonly<{
  database: LocalDatabase;
  writer: SyncWriter;
  clock: Clock;
  newId: () => EntityId;
}>;

export type GameService = Readonly<{
  /** Meldet die aktuelle Stufe und jede Änderung nach einem Commit; liefert die Abmeldung. */
  observeStage(listener: (stage: IslandStage) => void): () => void;
  /** Schlägt die Rollen vor, indem die eigene Person ihre Rolle wählt. */
  proposeRoles(role: IslandRole): RoleChoiceOutcome;
  /** Nimmt den offenen Vorschlag des Partners an; Momo schlüpft auf dem Server mit dem nächsten Sync. */
  acceptRoles(actionId: EntityId): RoleChoiceOutcome;
  /** Lehnt den offenen Vorschlag des Partners ab. */
  declineRoles(actionId: EntityId): RoleChoiceOutcome;
  /** Zieht den eigenen offenen Vorschlag zurück. */
  withdrawRoles(actionId: EntityId): RoleChoiceOutcome;
  /** Ob „So wächst Momo“ auf dieser Installation noch nicht erschienen ist (Einmal-Flag ohne Sync). */
  growthIntroPending(): boolean;
  /** Merkt, dass „So wächst Momo“ erschienen ist. */
  markGrowthIntroShown(): void;
  /** Beitrag `momo.character` für „Heute“. */
  momoCharacter: TodaySource<'momo.character'>;
  /** Beiträge von Spezifikation 4 für „Wir“. */
  wirContributions: WirContributionSource;
}>;

const inviteAction = { actionId: 'momo.invite_partner', target: { type: 'partner.invite' } } as const;
const roleChoiceAction = { actionId: 'momo.open_role_choice', target: { type: 'momo', view: 'rollenwahl' } } as const;
const answerRoleChoiceAction = { actionId: 'wir.answer_role_choice', target: { type: 'momo', view: 'rollenwahl' } } as const;
const openIslandAction = { actionId: 'wir.open_island', target: { type: 'momo' } } as const;

export function createGameService({ database, writer, clock, newId }: GameServiceDependencies): GameService {
  const commands = roleChoiceCommands({ writer, newId, timeZone: () => TimeZone.parse(clock.read().timeZone) });
  const observeStage = (listener: (stage: IslandStage) => void) => observeDistinct(database, listener);
  return {
    observeStage,
    proposeRoles: (role) => database.transaction((tx) => commands.propose(tx, role)),
    acceptRoles: (actionId) => database.transaction((tx) => commands.accept(tx, actionId)),
    growthIntroPending: () => database.read((tx) => !growthIntroShown(tx)),
    markGrowthIntroShown: () => database.transaction((tx) => markGrowthIntroShown(tx, clock.read().instant)),
    declineRoles: (actionId) => database.transaction((tx) => commands.decline(tx, actionId)),
    withdrawRoles: (actionId) => database.transaction((tx) => commands.withdraw(tx, actionId)),
    momoCharacter: { subscribe: (listener) => observeStage((stage) => listener(momoCharacterOf(stage))) },
    wirContributions: { subscribe: (listener) => observeStage((stage) => listener(wirContributionsOf(stage))) },
  };
}

/** Meldet die Stufe nur, wenn sie sich geändert hat; jeder Commit der Datenbank liest sie neu. */
function observeDistinct(database: LocalDatabase, listener: (stage: IslandStage) => void) {
  let last: string | null = null;
  return database.observe(readIslandStage, (stage) => {
    const serialized = JSON.stringify(stage);
    if (serialized === last) return;
    last = serialized;
    listener(stage);
  });
}

/**
 * `momo.character` (Spezifikation 4, Abschnitt 2.6): ohne Kopplung die Laichkugel mit „Partner einladen“,
 * vor dem Schlüpfen die Rollenwahl, für die vorschlagende Person als „Vorschlag gesendet“. Nach dem
 * Schlüpfen Momo mit Energie, Level und beiden Balkenanteilen aus dem Inselfortschritt (#184).
 * `waitingForPartner` und `islandNotice` füllen „Bauen: Fachbefehl“ (#191) und „Insel-Ereignisse:
 * Hinweise“ (#203).
 */
export function momoCharacterOf(stage: IslandStage): TodayState<'momo.character'> {
  switch (stage.type) {
    case 'ohne_person':
      return { type: 'loading' };
    case 'geschluepft': {
      if (stage.island === null) return { type: 'loading' };
      const { appearance, energy, progress, viewerPersonId } = stage.island;
      const own = progress.members.find((member) => member.personId === viewerPersonId);
      const partner = progress.members.find((member) => member.personId !== viewerPersonId);
      if (own === undefined || partner === undefined) throw new Error('Inselfortschritt ohne die eigene Person');
      return {
        type: 'ready',
        data: { appearance, energy, level: progress.level, ownHalfPercent: own.halfPercent, partnerHalfPercent: partner.halfPercent, waitingForPartner: false },
      };
    }
    case 'laichkugel':
      return { type: 'empty', reasonKey: 'momo_wartet_im_ei', action: inviteAction };
    case 'rollenwahl':
      return { type: 'empty', reasonKey: stage.proposal?.by === 'self' ? 'rollenwahl_gesendet' : 'rollenwahl_offen', action: roleChoiceAction };
  }
}

/**
 * Beiträge an „Wir“: `pending_shared_action` nur für die Person, die antworten muss, also für den
 * bestätigten Vorschlag des Partners in der aktiven Kopplung, solange sie ihn nicht schon angenommen hat.
 * Aktionen einer archivierten Kopplung sind beendet, auch wenn sie lokal noch offen sind (#107);
 * `readIslandStage` liest nur die aktive. Nach dem Schlüpfen die gemeinsamen Ereignisse der Insel für
 * „Neu bei euch“ als `shared_event`, bisher „Momo ist geschlüpft“ (#184).
 */
export function wirContributionsOf(stage: IslandStage): ContributionState<WirContribution[]> {
  if (stage.type === 'ohne_person') return { type: 'loading' };
  if (stage.type === 'geschluepft') {
    if (stage.island === null) return { type: 'loading' };
    const { islandId, sharedEvents } = stage.island;
    return {
      type: 'ready',
      data: sharedEvents.map((event) => ({
        type: 'shared_event',
        id: event.eventId,
        dataAsOf: event.occurredAt,
        action: openIslandAction,
        eventId: event.eventId,
        eventType: event.type,
        occurredAt: event.occurredAt,
        messageKey: `neu_bei_euch.${event.type}`,
        objectId: islandId,
      })),
    };
  }
  if (stage.type !== 'rollenwahl' || stage.proposal?.by !== 'partner' || stage.proposal.createdAt === null || stage.proposal.accepted) {
    return { type: 'ready', data: [] };
  }
  const { actionId, createdAt } = stage.proposal;
  return {
    type: 'ready',
    data: [
      {
        type: 'pending_shared_action',
        id: actionId,
        dataAsOf: createdAt,
        action: answerRoleChoiceAction,
        actionId,
        kind: 'rollenwahl',
        requesterDisplayName: stage.partnerDisplayName,
      },
    ],
  };
}
