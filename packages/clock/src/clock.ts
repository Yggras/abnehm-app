import { TimeZone, type Instant, type LocalDate } from '@abnehm/contracts/base';

import { readingAt } from './reading.ts';

/** Eine Ablesung der Uhr: Zeitpunkt, Zone, lokaler Tag und Offset gehören zum selben Moment. */
export type ClockReading = Readonly<{
  instant: Instant;
  timeZone: TimeZone;
  localDate: LocalDate;
  /** Offset der Zone zu UTC in Minuten zu diesem Zeitpunkt, etwa 120 für Berlin im Sommer. */
  utcOffsetMinutes: number;
}>;

/**
 * Einzige Quelle für „jetzt“ und „heute“ im Bereichscode.
 *
 * Ohne Argument liest die Uhr in ihrer eigenen Zone (in der App die Gerätezone),
 * mit Argument in der angegebenen Zone (im Backend die `time_zone` der Person).
 * Zeitpunkt und lokaler Tag stammen immer aus einer einzigen Ablesung, damit sie
 * auch um Mitternacht zusammenpassen.
 */
export interface Clock {
  read(timeZone?: TimeZone): ClockReading;
}

/**
 * Produktionsuhr: Systemzeit plus eine Zonenquelle. Die Quelle wird bei jedem
 * Ablesen neu gefragt, damit ein Zonenwechsel (Reise) sofort wirkt.
 */
export function createSystemClock(source: { timeZone: () => string }): Clock {
  return {
    read: (timeZone) => readingAt(Date.now(), timeZone ?? TimeZone.parse(source.timeZone())),
  };
}
