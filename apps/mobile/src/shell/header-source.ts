import type { Clock } from '@abnehm/clock';
import type { TimeZone } from '@abnehm/contracts/base';
import { AppState } from 'react-native';

import { headerFor } from './TodayScreen';
import type { TodayRegistry } from './today-registry';

/** Person wird aus ihrer eigenen Kontodatenbank gelesen, nie aus fremden Bereichstabellen. */
export type HeaderPerson = { displayName: string; timeZone: TimeZone };
export type ObserveHeaderPerson = (listener: (person: HeaderPerson | null) => void) => () => void;

/** Uhr und Person werden gemeinsam bei einer Beobachtung, nach Vordergrundwechsel und am Tageswechsel gelesen. */
export function registerTodayHeader(registry: TodayRegistry, clock: Clock, observePerson: ObserveHeaderPerson) {
  return registry.register('fundament', 'header', {
    subscribe(listener) {
      let person: HeaderPerson | null = null;
      const update = () => listener(person
        ? { type: 'ready', data: headerFor(person.displayName, clock.read(person.timeZone).localDate) }
        : { type: 'loading' });
      const stop = observePerson((next) => { person = next; update(); });
      const interval = setInterval(update, 60_000);
      const appState = AppState.addEventListener('change', (state) => { if (state === 'active') update(); });
      return () => { stop(); clearInterval(interval); appState.remove(); };
    },
  });
}
