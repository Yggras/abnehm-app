import type { Clock } from '@abnehm/clock';
import { createContext, use, type ReactNode } from 'react';

import { deviceClock } from './device-clock';

const ClockContext = createContext<Clock>(deviceClock);

/** Stellt der App eine Uhr bereit; ohne Provider gilt die Geräteuhr. Tests setzen hier die Testuhr ein. */
export function ClockProvider({ clock, children }: { clock: Clock; children: ReactNode }) {
  return <ClockContext value={clock}>{children}</ClockContext>;
}

/** Bereichscode liest Zeitpunkt, Zone und lokalen Tag nur über diese Uhr. */
export function useClock(): Clock {
  return use(ClockContext);
}
