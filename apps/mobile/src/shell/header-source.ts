import type { Clock } from '@abnehm/clock';
import type { TimeZone } from '@abnehm/contracts/base';

import { headerFor } from './TodayScreen';
import type { TodaySource } from './today-registry';
import { todayRefresh } from './today-refresh';

/** Person wird aus ihrer eigenen Kontodatenbank gelesen, nie aus fremden Bereichstabellen. */
export type HeaderPerson = { displayName: string; timeZone: TimeZone };
export type ObserveHeaderPerson = (listener: (person: HeaderPerson | null) => void) => () => void;

/** Uhr und Person werden gemeinsam bei einer Beobachtung, nach Vordergrundwechsel und am Tageswechsel gelesen. */
export function todayHeaderSource(clock: Clock, observePerson: ObserveHeaderPerson): TodaySource<'header'> {
  return {
    subscribe(listener) {
      let person: HeaderPerson | null = null;
      const update = () => listener(person
        ? { type: 'ready', data: headerFor(person.displayName, clock.read(person.timeZone).localDate) }
        : { type: 'loading' });
      const stop = observePerson((next) => { person = next; update(); });
      const stopRefresh = todayRefresh(update);
      return () => { stop(); stopRefresh(); };
    },
  };
}
