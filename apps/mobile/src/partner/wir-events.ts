import { readingOf, type ClockReading } from '@abnehm/clock';
import { LocalDate, localDateAfter, localDaysBetween, Weekday, weekdayOf, type Instant } from '@abnehm/contracts/base';

import type { IconName } from '../design/icon-shapes';
import { historyTexts } from './texts';

// Gemeinsame Ereignisse für „Neu bei euch“ und den Verlauf dahinter (Spezifikation 5, Abschnitt 2; #124).
// Jede Quelle liefert ihre Ereignisse schon als `WirEvent`: heute die Spiel-`shared_event`s von Spezifikation 4,
// mit #126 die Anfeuern-Ereignisse. Die Komposition kennt nur diese Form und ändert sich mit neuen Quellen nicht.
// Individuelle Tracker-Eingaben und Tageszielerfüllungen sind nie Ereignisse.

/** Ein gemeinsames Ereignis mit sichtbarem Text, etwa „Momo ist geschlüpft“. */
export type WirEvent = Readonly<{ id: string; occurredAt: Instant; icon: IconName; text: string }>;

/** Eine Kalenderwoche des Verlaufs mit „Diese Woche“, „Letzte Woche“ oder „KW n“. */
export type WeekGroup = Readonly<{ label: string; events: readonly WirEvent[] }>;

/** „Neu bei euch“ zeigt die drei neuesten Ereignisse. */
export const newsCount = 3;

/** Alle Ereignisse, neuestes zuerst; bei gleichem Zeitpunkt entscheidet die ID, damit die Reihenfolge stabil bleibt. */
export function newestFirst(events: readonly WirEvent[]): WirEvent[] {
  return [...events].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt) || (a.id < b.id ? -1 : 1));
}

function mondayOf(localDate: LocalDate): LocalDate {
  return localDateAfter(localDate, -Weekday.options.indexOf(weekdayOf(localDate)));
}

/** ISO-Kalenderwoche einer Woche: Sie gehört zum Jahr ihres Donnerstags. */
function isoWeekOf(monday: LocalDate): number {
  const thursday = localDateAfter(monday, 3);
  const dayOfYear = localDaysBetween(LocalDate.parse(`${thursday.slice(0, 4)}-01-01`), thursday);
  return Math.floor(dayOfYear / 7) + 1;
}

/**
 * Verlauf hinter „Alle anzeigen“: Kalenderwochen Montag bis Sonntag in der Zeitzone der betrachtenden Person
 * (`now`), neueste Woche und darin neuestes Ereignis zuerst.
 */
export function historyOf(events: readonly WirEvent[], now: ClockReading): WeekGroup[] {
  const thisWeek = mondayOf(now.localDate);
  const groups = new Map<LocalDate, WirEvent[]>();
  for (const event of newestFirst(events)) {
    const monday = mondayOf(readingOf(event.occurredAt, now.timeZone).localDate);
    groups.set(monday, [...(groups.get(monday) ?? []), event]);
  }
  return [...groups].map(([monday, entries]) => {
    const weeksAgo = localDaysBetween(monday, thisWeek) / 7;
    const label = weeksAgo === 0 ? historyTexts.thisWeek : weeksAgo === 1 ? historyTexts.lastWeek : historyTexts.week(isoWeekOf(monday));
    return { label, events: entries };
  });
}
