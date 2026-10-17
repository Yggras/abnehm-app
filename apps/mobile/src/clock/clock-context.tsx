import type { Clock } from '@abnehm/clock';
import { createContext, use, type ReactNode } from 'react';

import { deviceClock } from './device-clock';

const ClockContext = createContext<Clock>(deviceClock);

/** Ersetzt die Geräteuhr für einen Teilbaum, etwa durch die Testuhr in Tests. */
export function ClockProvider({ clock, children }: { clock: Clock; children: ReactNode }) {
  return <ClockContext value={clock}>{children}</ClockContext>;
}

/** Bereichscode liest Zeitpunkt, Zone und lokalen Tag nur über diese Uhr; ohne Provider ist es die Geräteuhr. */
export function useClock(): Clock {
  return use(ClockContext);
}
