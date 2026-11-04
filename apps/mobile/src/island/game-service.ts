import type { Clock } from '@abnehm/clock';
import { TimeZone, type EntityId } from '@abnehm/contracts/base';
import type { ContributionState } from '@abnehm/contracts/contribution';
import type { IslandRole } from '@abnehm/contracts/island';
import type { WirContribution, WirContributionSource } from '@abnehm/contracts/wir';

import type { LocalDatabase } from '../local-db';
import type { TodaySource, TodayState } from '../shell/today-registry';
import type { SyncWriter } from '../sync';
import { readIslandStage, roleChoiceCommands, type IslandStage, type RoleChoiceOutcome } from './role-choice';

// Spieldienst der App für den Tab „Momo“ (Spezifikation 4, Abschnitt 1), bisher mit Laichkugel und
// Rollenwahl (#180): ein Lesemodell der Stufe, die Befehle der Rollenwahl und die Beiträge an „Heute“
// (`momo.character`) und „Wir“ (`pending_shared_action`). Die App-Sitzung erzeugt ihn je geöffneter
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
  /** Lehnt den offenen Vorschlag des Partners ab. */
  declineRoles(actionId: EntityId): RoleChoiceOutcome;
  /** Zieht den eigenen offenen Vorschlag zurück. */
  withdrawRoles(actionId: EntityId): RoleChoiceOutcome;
  /** Beitrag `momo.character` für „Heute“. */
  momoCharacter: TodaySource<'momo.character'>;
  /** Beiträge von Spezifikation 4 für „Wir“. */
  wirContributions: WirContributionSource;
}>;

const inviteAction = { actionId: 'momo.invite_partner', target: { type: 'partner.invite' } } as const;
const roleChoiceAction = { actionId: 'momo.open_role_choice', target: { type: 'momo', view: 'rollenwahl' } } as const;
const answerRoleChoiceAction = { actionId: 'wir.answer_role_choice', target: { type: 'momo', view: 'rollenwahl' } } as const;

export function createGameService({ database, writer, clock, newId }: GameServiceDependencies): GameService {
  const commands = roleChoiceCommands({ writer, newId, timeZone: () => TimeZone.parse(clock.read().timeZone) });
  const observeStage = (listener: (stage: IslandStage) => void) => observeDistinct(database, listener);
  return {
    observeStage,
    proposeRoles: (role) => database.transaction((tx) => commands.propose(tx, role)),
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
 * vor dem Schlüpfen die Rollenwahl, für die vorschlagende Person als „Vorschlag gesendet“. Den Zustand
 * `ready` nach dem Schlüpfen liefert #184; bis dahin lädt der Beitrag.
 */
export function momoCharacterOf(stage: IslandStage): TodayState<'momo.character'> {
  switch (stage.type) {
    case 'ohne_person':
    case 'geschluepft':
      return { type: 'loading' };
    case 'laichkugel':
      return { type: 'empty', reasonKey: 'momo_wartet_im_ei', action: inviteAction };
    case 'rollenwahl':
      return { type: 'empty', reasonKey: stage.proposal?.by === 'self' ? 'rollenwahl_gesendet' : 'rollenwahl_offen', action: roleChoiceAction };
  }
}

/**
 * Beiträge an „Wir“: `pending_shared_action` nur für die Person, die antworten muss, also für den
 * bestätigten Vorschlag des Partners in der aktiven Kopplung. Aktionen einer archivierten Kopplung sind
 * beendet, auch wenn sie lokal noch offen sind (#107); `readIslandStage` liest nur die aktive.
 */
export function wirContributionsOf(stage: IslandStage): ContributionState<WirContribution[]> {
  if (stage.type === 'ohne_person') return { type: 'loading' };
  if (stage.type !== 'rollenwahl' || stage.proposal?.by !== 'partner' || stage.proposal.createdAt === null) return { type: 'ready', data: [] };
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
