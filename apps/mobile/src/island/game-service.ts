import type { Clock } from '@abnehm/clock';
import { EntityId, LocalDate, TimeZone } from '@abnehm/contracts/base';
import type { ContributionState } from '@abnehm/contracts/contribution';
import type { IslandRole, PlacementTarget } from '@abnehm/contracts/island';
import type { WirContribution, WirContributionSource } from '@abnehm/contracts/wir';
import { reactionMood } from '@abnehm/game-rules/mood';

import { motion } from '../design/tokens';
import type { Haptics } from '../haptics/haptics';
import type { LocalDatabase, ReadContext } from '../local-db';
import { readOwnPerson } from '../local-db/person-header';
import type { Refresh } from '../shell/followed-source';
import type { TodaySource, TodayState } from '../shell/today-registry';
import type { SyncWriter } from '../sync';
import { buildObject, type BuildOutcome } from './build-object';
import { takeGrowthIntro } from './growth-intro';
import { claimReaction, eventsOf, hapticOf, hasUnshownReactions, type MomoReaction } from './momo-reactions';
import { createMoodState, distinct } from './mood-state';
import { placeObject, upgradeObject, type PlaceOutcome, type UpgradeOutcome } from './object-commands';
import { readIslandStage, roleChoiceCommands, type IslandStage, type RoleChoiceOutcome } from './role-choice';

// Spieldienst der App für den Tab „Momo“ (Spezifikation 4, Abschnitt 1): ein Lesemodell der Stufe von
// der Laichkugel über die Rollenwahl (#180) bis zur geschlüpften Insel (#184), die Befehle der Rollenwahl,
// Bauen (#191), Aufwerten und Platzieren (#194), das Einmal-Flag „So wächst Momo“, Momos Reaktionen und Stimmungen (#188) und die Beiträge an „Heute“
// (`momo.character`) und „Wir“ (`pending_shared_action`, `shared_event`). Die App-Sitzung erzeugt ihn je
// geöffneter Kontodatenbank und meldet ihn an (`src/session/device-session.ts`).

export type GameServiceDependencies = Readonly<{
  database: LocalDatabase;
  writer: SyncWriter;
  clock: Clock;
  newId: () => EntityId;
  /** Erfolgshaptik (#95); der Spieldienst ist ihr einziger Aufrufer. */
  haptics: Haptics;
  /** Takt, zu dem die Stimmung ohne Datenbankänderung neu abgeleitet wird, etwa um 20:00 und am Tageswechsel. */
  refresh: Refresh;
}>;

export type GameService = Readonly<{
  /**
   * Meldet die aktuelle Stufe und jede Änderung nach einem Commit; liefert die Abmeldung. Momos Stimmung
   * ist die der Inselansicht: Abends schläft Momo dort.
   */
  observeStage(listener: (stage: IslandStage) => void): () => void;
  /**
   * Momos Reaktionen auf eigene Tageszielerfüllungen und Gutschriften, je Commit zu einer zusammengefasst.
   * Solange ein Beobachter angemeldet ist, beansprucht der Dienst jedes neue Ereignis genau einmal je
   * Installation, löst dazu höchstens eine Haptik aus und lässt Momo kurz reagieren. Ohne Beobachter wartet
   * das Ereignis.
   */
  observeReactions(listener: (reaction: MomoReaction) => void): () => void;
  /** Schlägt die Rollen vor, indem die eigene Person ihre Rolle wählt. */
  proposeRoles(role: IslandRole): RoleChoiceOutcome;
  /** Nimmt den offenen Vorschlag des Partners an; Momo schlüpft auf dem Server mit dem nächsten Sync. */
  acceptRoles(actionId: EntityId): RoleChoiceOutcome;
  /** Lehnt den offenen Vorschlag des Partners ab. */
  declineRoles(actionId: EntityId): RoleChoiceOutcome;
  /** Zieht den eigenen offenen Vorschlag zurück. */
  withdrawRoles(actionId: EntityId): RoleChoiceOutcome;
  /**
   * Baut einen Bauplan auf ein eigenes freies Feld; die eigene Hälfte wächst sofort, auch offline. Ein
   * Levelaufstieg entsteht erst über den Sync (#191).
   */
  build(request: Readonly<{ fieldId: EntityId; blueprintKey: string }>): BuildOutcome;
  /** Wertet ein eigenes gebautes Objekt eine Stufe auf; die eigene Hälfte wächst sofort, auch offline (#194). */
  upgrade(islandObjectId: EntityId): UpgradeOutcome;
  /** Stellt ein eigenes Objekt kostenlos auf ein freies eigenes Feld oder legt es ins Lager (#194). */
  place(islandObjectId: EntityId, target: PlacementTarget): PlaceOutcome;
  /**
   * Ob „So wächst Momo“ jetzt erscheinen soll; genau beim ersten Aufruf je Installation `true` und dann
   * gemerkt (Einmal-Flag ohne Sync).
   */
  takeGrowthIntro(): boolean;
  /** Beitrag `momo.character` für „Heute“. */
  momoCharacter: TodaySource<'momo.character'>;
  /** Beiträge von Spezifikation 4 für „Wir“. */
  wirContributions: WirContributionSource;
}>;

const inviteAction = { actionId: 'momo.invite_partner', target: { type: 'partner.invite' } } as const;
const roleChoiceAction = { actionId: 'momo.open_role_choice', target: { type: 'momo', view: 'rollenwahl' } } as const;
const answerRoleChoiceAction = { actionId: 'wir.answer_role_choice', target: { type: 'momo', view: 'rollenwahl' } } as const;
const openIslandAction = { actionId: 'wir.open_island', target: { type: 'momo' } } as const;

/** Wie lange Momo nach einem eigenen Ereignis reagiert (`duration-celebrate`, Design-System › Bewegung). */
const reactionMs = motion.duration.celebrate;

export function createGameService({ database, writer, clock, newId, haptics, refresh }: GameServiceDependencies): GameService {
  const commands = roleChoiceCommands({ writer, newId, timeZone: () => TimeZone.parse(clock.read().timeZone) });
  const mood = createMoodState(clock, refresh);
  const observeStage = (listener: (stage: IslandStage) => void) => mood.observe(database, 'insel', listener);

  function observeReactions(listener: (reaction: MomoReaction) => void) {
    return database.observe(
      (tx) => {
        const personId = ownPersonId(tx);
        return personId !== null && hasUnshownReactions(tx, personId, LocalDate.parse(clock.read().localDate));
      },
      // Der Beobachter schreibt selbst: Die Beanspruchung ist eine eigene Transaktion nach der auslösenden.
      // Ihr Commit lässt alle Beobachter noch innerhalb der laufenden Melderunde neu lesen; dieser hier
      // liest danach `false` und schreibt nicht wieder, die Runden enden also.
      (pending) => {
        if (!pending) return;
        const reaction = database.transaction((tx) => {
          const personId = ownPersonId(tx);
          const reading = clock.read();
          const claimed = personId === null ? null : claimReaction(tx, personId, LocalDate.parse(reading.localDate), reading.instant);
          // Erst nach dem Commit, aber bevor die Beobachter neu lesen: So zeigt „Heute“ Momo sofort reagierend.
          if (claimed !== null) {
            const events = eventsOf(claimed);
            tx.afterCommit(() => {
              haptics.feedback(hapticOf(events));
              mood.react(reactionMood(events), reactionMs);
            });
          }
          return claimed;
        });
        if (reaction !== null) listener(reaction);
      },
    );
  }

  return {
    observeStage,
    observeReactions,
    proposeRoles: (role) => database.transaction((tx) => commands.propose(tx, role)),
    acceptRoles: (actionId) => database.transaction((tx) => commands.accept(tx, actionId)),
    takeGrowthIntro: () => database.transaction((tx) => takeGrowthIntro(tx, clock.read().instant)),
    declineRoles: (actionId) => database.transaction((tx) => commands.decline(tx, actionId)),
    withdrawRoles: (actionId) => database.transaction((tx) => commands.withdraw(tx, actionId)),
    build: (request) => database.transaction((tx) => buildObject(tx, { writer, newId, clock }, request)),
    upgrade: (islandObjectId) => database.transaction((tx) => upgradeObject(tx, { writer, newId, clock }, { islandObjectId })),
    place: (islandObjectId, target) => database.transaction((tx) => placeObject(tx, { writer, newId, clock }, { islandObjectId, target })),
    momoCharacter: { subscribe: (listener) => mood.observe(database, 'heute', (stage) => listener(momoCharacterOf(stage))) },
    // „Wir“ zeigt Momo nicht; seine Beiträge folgen nur der Datenbank.
    wirContributions: { subscribe: (listener) => database.observe(readIslandStage, distinct((stage) => listener(wirContributionsOf(stage)))) },
  };
}

function ownPersonId(tx: ReadContext): EntityId | null {
  const own = readOwnPerson(tx);
  return own === undefined ? null : EntityId.parse(own.id);
}

/**
 * `momo.character` (Spezifikation 4, Abschnitt 2.6): ohne Kopplung die Laichkugel mit „Partner einladen“,
 * vor dem Schlüpfen die Rollenwahl, für die vorschlagende Person als „Vorschlag gesendet“. Nach dem
 * Schlüpfen Momo mit Energie, Level und beiden Balkenanteilen (#184); die eigene Hälfte und
 * `waitingForPartner` folgen den eigenen Buchungen (#191). `islandNotice` füllt „Insel-Ereignisse:
 * Hinweise“ (#203).
 */
export function momoCharacterOf(stage: IslandStage): TodayState<'momo.character'> {
  switch (stage.type) {
    case 'ohne_person':
      return { type: 'loading' };
    case 'geschluepft': {
      if (stage.island === null) return { type: 'loading' };
      const { appearance, energy, halves, partnerDisplayName } = stage.island;
      return {
        type: 'ready',
        data: {
          appearance,
          energy,
          level: halves.level,
          ownHalfPercent: halves.own.halfPercent,
          partnerHalfPercent: halves.partner.halfPercent,
          waitingForPartner: halves.waitingForPartner,
          partnerDisplayName,
        },
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
