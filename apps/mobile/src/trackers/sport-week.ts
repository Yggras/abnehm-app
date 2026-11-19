import { EntityId, Instant, LocalDate, TimeZone } from '@abnehm/contracts/base';
import type { EffectivePlan, PlanReader } from '@abnehm/contracts/ports';
import { weekMinutes, weekOf } from '@abnehm/contracts/tracker-rules';
import { ActivityType } from '@abnehm/contracts/trackers';

import type { ReadContext } from '../local-db';
import { readOwnPerson } from '../local-db/person-header';
import type { Source } from '../shell/followed-source';
import { observedSource, type Refresh } from './observed-source';
import { sportEntriesOfWeek, type SportOrigin, type SportRow } from './sport-repository';
import type { TrackerDependencies } from './trackers';

// Lesemodell des Sport-Detailbildschirms `capture.sport` (Spezifikation 3, Abschnitte 3 und 5): eine Woche
// von Montag bis Sonntag mit den Wochenminuten nach der Sport-Zählregel, dem Sportwochenziel aus dem
// `PlanReader` und den Einträgen nach Tag. Maßgeblich ist wie überall der gespeicherte lokale Tag eines
// Eintrags, nicht die Zone des Geräts. Ausgeblendete Importe erscheinen nirgends (Spezifikation 3, Abschnitt 4).

/** Ein Eintrag der Wochenübersicht. */
export type SportListEntry = Readonly<{
  id: EntityId;
  /** Angezeigte Art: die überschriebene vor der Plattformart (Spezifikation 3, Abschnitt 5). */
  activityType: ActivityType;
  /** Bei Importen die von der Plattform erkannte Art, auch wenn die Person sie überschrieben hat (#186); sonst `null`. */
  recognizedActivityType: ActivityType | null;
  durationMinutes: number;
  startedAt: Instant;
  /** Gespeicherter lokaler Tag; nach ihm gruppiert die Übersicht. */
  localDate: LocalDate;
  /** Zone der Anlage; in ihr zeigt die Liste die Uhrzeit. */
  timeZone: TimeZone;
  origin: SportOrigin;
  /** Kennung und Anzeigename der Quell-App eines Imports, falls bekannt. */
  sourceAppId: string | null;
  sourceAppName: string | null;
  /** Aktive Kalorien in `milli_kcal`; werden nur angezeigt. */
  activeMilliKcal: number | null;
}>;

/** Ein Tag mit Einträgen; die neueste Einheit zuerst. */
export type SportDay = Readonly<{ localDate: LocalDate; entries: readonly SportListEntry[] }>;

export type SportWeek = Readonly<{
  monday: LocalDate;
  sunday: LocalDate;
  today: LocalDate;
  /** Die Woche von heute; weiter in die Zukunft blättert der Bildschirm nicht. */
  isCurrent: boolean;
  /** Summe der zählenden Einträge dieser Woche. */
  weekMinutes: number;
  /** Sportwochenziel der Zielversion am Sonntag der Woche, in der laufenden Woche von heute; ohne gültige `null`. */
  weeklyTargetMinutes: number | null;
  /** Tage mit Einträgen, der neueste zuerst. */
  days: readonly SportDay[];
}>;

export type SportWeekState = Readonly<{ type: 'loading' }> | Readonly<{ type: 'ready'; week: SportWeek }> | Readonly<{ type: 'error' }>;

type SportWeekReading = Readonly<{ personId: EntityId; today: LocalDate; monday: LocalDate; sunday: LocalDate; rows: readonly SportRow[] }>;

/**
 * Beobachtet die Woche von `week` (`null`: die Woche von heute): neu bei jedem Commit der Kontodatenbank
 * und auf Anstoß von `refresh`, etwa am Wochenwechsel. Eine Woche nach der laufenden zeigt die laufende.
 * Ohne eigene Person lädt es; scheitert der `PlanReader`, meldet es `error`.
 */
export function sportWeekSource(
  { database, clock }: Pick<TrackerDependencies, 'database' | 'clock'>,
  planReader: PlanReader,
  refresh: Refresh,
  week: LocalDate | null,
): Source<SportWeekState> {
  const read = (tx: ReadContext): SportWeekReading | null => {
    const person = readOwnPerson(tx);
    if (person === undefined) return null;
    const personId = EntityId.parse(person.id);
    const today = LocalDate.parse(clock.read().localDate);
    const day = week === null || week > today ? today : week;
    const { monday, sunday } = weekOf(day);
    return { personId, today, monday: LocalDate.parse(monday), sunday: LocalDate.parse(sunday), rows: sportEntriesOfWeek(tx, personId, day) };
  };
  return observedSource<SportWeekReading, SportWeekState>(
    database,
    refresh,
    read,
    async (reading) => {
      const isCurrent = reading.sunday >= reading.today;
      const plan = await planReader.effectivePlan(reading.personId, isCurrent ? reading.today : reading.sunday);
      return { type: 'ready', week: sportWeekOf(reading, isCurrent, plan) };
    },
    { loading: { type: 'loading' }, failed: { type: 'error' } },
  );
}

function sportWeekOf({ today, monday, sunday, rows }: SportWeekReading, isCurrent: boolean, plan: EffectivePlan): SportWeek {
  return {
    monday,
    sunday,
    today,
    isCurrent,
    weekMinutes: weekMinutes(rows, monday),
    weeklyTargetMinutes: plan.type === 'gueltig' ? plan.goal.weeklySportTargetMinutes : null,
    days: daysOf(rows.filter((row) => row.localDate >= monday && row.localDate <= sunday && row.deletedAt === null && row.hiddenAt === null)),
  };
}

/** Die sichtbaren Einträge nach Tag, neuester Tag und neueste Einheit zuerst. */
function daysOf(rows: readonly SportRow[]): SportDay[] {
  const days = new Map<string, SportListEntry[]>();
  for (const row of [...rows].reverse()) {
    const entries = days.get(row.localDate) ?? [];
    entries.push({
      id: EntityId.parse(row.id),
      activityType: ActivityType.parse(row.overrideActivityType ?? row.activityType),
      recognizedActivityType: row.origin === 'manuell' ? null : ActivityType.parse(row.activityType),
      durationMinutes: row.durationMinutes,
      startedAt: Instant.parse(row.startedAt),
      localDate: LocalDate.parse(row.localDate),
      timeZone: TimeZone.parse(row.timeZone),
      origin: row.origin,
      sourceAppId: row.sourceAppId,
      sourceAppName: row.sourceAppName,
      activeMilliKcal: row.activeMilliKcal,
    });
    days.set(row.localDate, entries);
  }
  return [...days.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([localDate, entries]) => ({ localDate: LocalDate.parse(localDate), entries }));
}
