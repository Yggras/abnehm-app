import { localDateAfter, type LocalDate } from '@abnehm/contracts/base';

import { activityNames } from '../shell/texts';
import { dayText, originNames, shortDate, timeText } from './entry-texts';
import type { SportListEntry, SportWeek } from './sport-week';

// Texte des Sport-Detailbildschirms (Spezifikation 3, Abschnitt 5; #38). Kalorien stehen in `milli_kcal`
// und werden nur hier auf ganze kcal gerundet; sie sind eine Anzeige und zählen nirgends.

/** Kalorien einer Einheit als Näherung, etwa „≈ 210 kcal“; gesprochen „etwa 210 kcal“. */
const kcalText = (milliKcal: number, spoken: boolean) => `${spoken ? 'etwa' : '≈'} ${Math.round(milliKcal / 1000).toLocaleString('de-DE')} kcal`;

export const sportTexts = {
  loading: 'Sport lädt …',
  failed: 'Die Sportwoche lässt sich gerade nicht laden.',
  add: '+ Einheit',
  previousWeek: 'Vorige Woche',
  nextWeek: 'Nächste Woche',
  barLabel: 'Sport in dieser Woche',
  editTitle: 'Einheit bearbeiten',
  /** „Diese Woche“, „Letzte Woche“ oder der Zeitraum, etwa „28.09.–04.10.“. */
  weekTitle({ monday, sunday, isCurrent, today }: Pick<SportWeek, 'monday' | 'sunday' | 'isCurrent' | 'today'>): string {
    if (isCurrent) return 'Diese Woche';
    if (sunday >= localDateAfter(today, -7)) return 'Letzte Woche';
    return `${shortDate(monday)}–${shortDate(sunday)}`;
  },
  /** Zugänglicher Name des Zeitraums, etwa „Woche vom 12.10. bis 18.10.“. */
  weekSpoken: ({ monday, sunday }: Pick<SportWeek, 'monday' | 'sunday'>) => `Woche vom ${shortDate(monday)} bis ${shortDate(sunday)}`,
  /** Wert des Wochenbalkens, etwa „75 von 150 min“. */
  progress: (weekMinutes: number, targetMinutes: number) => `${weekMinutes} von ${targetMinutes} min`,
  /** Neben der großen Wochensumme, etwa „von 150 min“; ohne gültige Zielversion „in dieser Woche“. */
  ofTarget: (targetMinutes: number) => `von ${targetMinutes} min`,
  thisWeek: 'in dieser Woche',
  reached: 'erreicht',
  empty: (isCurrent: boolean) => (isCurrent ? 'Noch keine Einheit in dieser Woche.' : 'In dieser Woche gab es keine Einheit.'),
  /** Überschrift eines Tags, etwa „Heute“ oder „Mo, 12.10.“. */
  day(localDate: LocalDate, today: LocalDate): string {
    const text = dayText(localDate, today);
    return text.charAt(0).toUpperCase() + text.slice(1);
  },
  minutes: (durationMinutes: number) => `${durationMinutes} min`,
  /** Unterzeile einer Einheit: Uhrzeit, Herkunft bzw. Quell-App und Kalorien, etwa „07:00 · Manuell · ≈ 210 kcal“. */
  details(entry: SportListEntry, spoken = false): string {
    // Manuell steht die Herkunft, bei Importen die Quell-App; die Herkunft zeigt dort das Abzeichen.
    const originOrApp = entry.origin === 'manuell' ? originNames.manuell : entry.sourceAppName;
    const kcal = entry.activeMilliKcal === null ? null : kcalText(entry.activeMilliKcal, spoken);
    return [timeText(entry.startedAt, entry.timeZone), originOrApp, kcal].filter(Boolean).join(' · ');
  },
  /** Zugänglicher Name einer Zeile, etwa „Laufen, 30 min, 07:00 · Manuell · etwa 210 kcal“. */
  entrySpoken(entry: SportListEntry): string {
    const imported = entry.origin === 'manuell' ? '' : `, ${originNames[entry.origin]}`;
    return `${activityNames[entry.activityType]}, ${entry.durationMinutes} min, ${sportTexts.details(entry, true)}${imported}`;
  },
} as const;
