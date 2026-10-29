import type { Clock } from '@abnehm/clock';
import { DisplayName } from '@abnehm/contracts/base';

import type { LocalDatabase } from '../local-db';
import { readOwnPerson } from '../local-db/person-header';
import { updateOwnPerson, type SyncWriter } from '../sync';

// Der eigene Anzeigename unter „Konto“ (Spezifikation 5, Abschnitt 6). Er steht an der eigenen Person
// und ändert sich nur über den Person-Upsert des Fundaments (#110): lokal samt Outbox, Last-Write-Wins.
// Der Server zieht ihn in derselben Transaktion am Kopplungsmitglied nach; den Partnernamen liest das
// Partnergerät nur dort. `time_zone` gehört nicht zum Upsert und bleibt unberührt.

export type RenameResult =
  | Readonly<{ type: 'renamed'; displayName: DisplayName }>
  /** Derselbe Name wie bisher; es entsteht keine Operation. */
  | Readonly<{ type: 'unchanged' }>
  /** Nach dem Kürzen des Leerraums am Rand nicht 1–30 Zeichen. */
  | Readonly<{ type: 'invalid' }>
  /** Keine Kontodatenbank offen oder die eigene Person noch nicht angekommen. */
  | Readonly<{ type: 'no_person' }>;

export type OwnDisplayName = Readonly<{
  /** Anzeigename der eigenen Person; `null`, solange keine Kontodatenbank mit Person offen ist. */
  current(): DisplayName | null;
  /** Meldet jede Änderung des Namens, auch nach einem Pull oder beim Sperren. */
  subscribe(listener: () => void): () => void;
  /** Ändert den Namen; Leerraum am Rand fällt weg, wie beim Tippen kaum vermeidbar. */
  rename(input: string): RenameResult;
}>;

export type OwnDisplayNameOptions = Readonly<{ writer: SyncWriter; clock: Clock }>;

/**
 * Folgt der jeweils geöffneten Kontodatenbank: Die App-Sitzung meldet sie mit `opened` an und löst sie
 * mit dessen Rückgabe beim Sperren wieder.
 */
export function followOwnDisplayName({ writer, clock }: OwnDisplayNameOptions): OwnDisplayName & { opened(database: LocalDatabase): () => void } {
  let database: LocalDatabase | null = null;
  let current: DisplayName | null = null;
  const listeners = new Set<() => void>();

  function publish(next: DisplayName | null) {
    if (next === current) return;
    current = next;
    for (const listener of [...listeners]) listener();
  }

  return {
    current: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    rename(input) {
      const displayName = DisplayName.safeParse(input.trim());
      if (!displayName.success) return { type: 'invalid' };
      if (database === null) return { type: 'no_person' };
      return database.transaction((tx): RenameResult => {
        const own = readOwnPerson(tx);
        if (own === undefined) return { type: 'no_person' };
        if (own.displayName === displayName.data) return { type: 'unchanged' };
        updateOwnPerson(tx, writer, { displayName: displayName.data }, clock.read().instant);
        return { type: 'renamed', displayName: displayName.data };
      });
    },
    opened(next) {
      database = next;
      const stop = next.observe((tx) => {
        const own = readOwnPerson(tx);
        return own === undefined ? null : DisplayName.parse(own.displayName);
      }, publish);
      return () => {
        stop();
        if (database !== next) return;
        database = null;
        publish(null);
      };
    },
  };
}
