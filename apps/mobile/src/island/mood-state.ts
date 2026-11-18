import { minutesOfDay, type Clock } from '@abnehm/clock';
import { EntityId, LocalDate } from '@abnehm/contracts/base';
import { momoMood, type MomoReactionMood, type MomoView } from '@abnehm/game-rules/mood';

import { latestCompletionDate } from '../daily-goals';
import type { LocalDatabase, ReadContext } from '../local-db';
import { readOwnPerson } from '../local-db/person-header';
import type { Refresh } from '../shell/followed-source';
import { readIslandStage, type IslandStage } from './role-choice';

// Momos Stimmung im Spieldienst (Spezifikation 4, Abschnitt 6; #188): die laufende Reaktion, der Takt und
// die Ableitung je Ansicht mit `momoMood` aus den Spielregeln. Der Spieldienst (`game-service.ts`) startet
// Reaktionen und gibt die Stufe samt Stimmung an „Heute“ und den Tab „Momo“ weiter.

/** Meldet einen Wert nur, wenn er sich geändert hat. */
export function distinct<T>(listener: (value: T) => void): (value: T) => void {
  let last: string | null = null;
  return (value) => {
    const serialized = JSON.stringify(value);
    if (serialized === last) return;
    last = serialized;
    listener(value);
  };
}

/** Was Momos Stimmung aus der Datenbank braucht: die Stufe und die jüngste eigene Tageszielerfüllung. */
type MomoFacts = Readonly<{ stage: IslandStage; lastOwnCompletion: LocalDate | null }>;

function readMomoFacts(tx: ReadContext): MomoFacts {
  const own = readOwnPerson(tx);
  const personId = own === undefined ? null : EntityId.parse(own.id);
  return { stage: readIslandStage(tx), lastOwnCompletion: personId === null ? null : latestCompletionDate(tx, personId) };
}

/**
 * Momos Stimmung je betrachtender Person (Spezifikation 4, Abschnitt 6): nur auf diesem Gerät, nie
 * synchronisiert. Die laufende Reaktion lebt im Speicher; nach einem Neustart reagiert Momo nicht erneut.
 * Neu abgeleitet wird bei jedem Commit, bei Beginn und Ende einer Reaktion und im Takt.
 */
export function createMoodState(clock: Clock, refresh: Refresh) {
  let reaction: MomoReactionMood | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const changed = new Set<() => void>();
  const notify = () => {
    for (const update of [...changed]) update();
  };

  function withMood({ stage, lastOwnCompletion }: MomoFacts, view: MomoView): IslandStage {
    if (stage.type !== 'geschluepft' || stage.island === null) return stage;
    const reading = clock.read();
    const moodKey = momoMood({
      view,
      reaction,
      minuteOfDay: minutesOfDay(reading),
      // Insel-Ereignisse liefern ihren Hinweis mit #203; bis dahin wartet auf der Insel nichts.
      islandNotice: 0,
      today: LocalDate.parse(reading.localDate),
      lastOwnCompletion,
    });
    return { ...stage, island: { ...stage.island, appearance: { ...stage.island.appearance, moodKey } } };
  }

  return {
    /**
     * Momo reagiert für `durationMs`; eine neue Reaktion ersetzt die laufende. Aufgerufen nach dem Commit
     * der Beanspruchung: Die Datenbank lässt danach alle Beobachter neu lesen, die Reaktion erscheint also
     * mit dem neuen Stand, etwa der höheren Energie.
     */
    react(next: MomoReactionMood, durationMs: number) {
      clearTimeout(timer);
      reaction = next;
      timer = setTimeout(() => {
        reaction = null;
        notify();
      }, durationMs);
    },
    /** Die Stufe samt Stimmung der Ansicht; gemeldet nur nach einer Änderung. */
    observe(database: LocalDatabase, view: MomoView, listener: (stage: IslandStage) => void): () => void {
      let facts: MomoFacts | null = null;
      const report = distinct(listener);
      const emit = () => {
        if (facts !== null) report(withMood(facts, view));
      };
      changed.add(emit);
      const stopTicks = refresh(emit);
      const stopDatabase = database.observe(readMomoFacts, (next) => {
        facts = next;
        emit();
      });
      return () => {
        changed.delete(emit);
        stopTicks();
        stopDatabase();
      };
    },
  };
}
