import type { Clock } from '@abnehm/clock';
import type { EntityId } from '@abnehm/contracts/base';

import type { LocalDatabase } from '../local-db';
import { person } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import { requestPersonTimeZone, type LocalCommandRegistry } from '../sync';

// Zeitzone der Person (Spezifikation 0, Abschnitt 8): Sobald die kanonische Person auf dem Gerät ist,
// setzt die App `time_zone` beim Start und bei jedem Zeitzonenwechsel über `updatePersonTimeZone`.
// „Start“ ist das Öffnen der Kontodatenbank mit vorhandener Person oder deren erstes Eintreffen per
// Pull. Ein Pull mit der Zone eines anderen Geräts derselben Person löst nichts aus; sonst schickten
// sich zwei Geräte in verschiedenen Zonen die Zone bei jedem Sync hin und her.

export type TimeZoneFollower = {
  /** Für `onAccountOpened` der App-Sitzung; die Rückgabe löst die Beobachtung beim Sperren. */
  opened(database: LocalDatabase): () => void;
  /** Bei einem möglichen Zeitzonenwechsel, etwa Rückkehr in den Vordergrund oder geänderten Kalendereinstellungen. */
  check(): void;
};

export function followPersonTimeZone({ clock, commandsFor, newId, onError }: {
  clock: Clock;
  /** Die lokalen Fachbefehle über der geöffneten Kontodatenbank. */
  commandsFor(database: LocalDatabase): LocalCommandRegistry;
  newId: () => EntityId;
  onError: (error: unknown) => void;
}): TimeZoneFollower {
  let current: { database: LocalDatabase; commands: LocalCommandRegistry } | null = null;

  function update() {
    if (current === null) return;
    try {
      requestPersonTimeZone(current.database, current.commands, clock.read().timeZone, newId);
    } catch (error) {
      onError(error);
    }
  }

  return {
    opened(database) {
      const own = { database, commands: commandsFor(database) };
      current = own;
      let present = false;
      const stop = database.observe(
        (tx) => sqliteOf(tx).select({ id: person.id }).from(person).limit(1).get() !== undefined,
        (exists) => {
          const arrived = exists && !present;
          present = exists;
          if (arrived) update();
        },
      );
      return () => {
        stop();
        if (current === own) current = null;
      };
    },
    check: update,
  };
}
