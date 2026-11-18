import { EntityId, Instant, LocalDate, TimeZone } from '@abnehm/contracts/base';
import type { EffectivePlan, PlanReader } from '@abnehm/contracts/ports';
import {
  currentTrendG,
  dayWeightEntries,
  dayWeights,
  isCountingWeightEntry,
  sinceStartG,
  weightChange,
  weightForecast,
  weightTrend,
  type WeightChange,
} from '@abnehm/contracts/tracker-rules';

import type { ReadContext } from '../local-db';
import { readOwnPerson } from '../local-db/person-header';
import type { Source } from '../shell/followed-source';
import { observedSource, type Refresh } from './observed-source';
import type { TrackerDependencies } from './trackers';
import { weightEntriesOf, type WeightOrigin, type WeightRow } from './weight-repository';

// Lesemodell des Gewicht-Detailbildschirms `capture.weight` (Spezifikation 3, Abschnitte 3 und 5):
// Gewichtstrend, letztes Tagesgewicht, „seit Start“, Veränderung in 2 Wochen und Prognose, darunter alle
// zählenden Messungen mit Herkunft. Zielgewicht, Tempo und Haltemodus kommen aus dem `PlanReader`. Alle
// Zahlen stammen aus den Tracker-Regeln, wie im `WeightTrendReader` und im Mini-Tracker.

/** Eine zählende Messung im Verlauf. */
export type WeightHistoryEntry = Readonly<{
  id: EntityId;
  weightG: number;
  measuredAt: Instant;
  localDate: LocalDate;
  /** Zone der Anlage; in ihr zeigt der Verlauf die Uhrzeit. */
  timeZone: TimeZone;
  origin: WeightOrigin;
  /** Anzeigename der Quell-App eines Imports, falls bekannt. */
  sourceAppName: string | null;
  /** Die früheste zählende Messung ihres Tags. */
  isDayWeight: boolean;
}>;

/** Trend samt Ableitungen; nur ab drei Tagesgewichten. */
export type WeightTrendSummary = Readonly<{
  trendG: number;
  /** Trendwert heute minus erstes Tagesgewicht. */
  sinceStartG: number;
  /** Veränderung in 2 Wochen; ohne Tagesgewicht in den letzten 14 Tagen nicht verfügbar. */
  change: WeightChange;
}>;

export type WeightDetail = Readonly<{
  today: LocalDate;
  lastDayWeight: Readonly<{ localDate: LocalDate; weightG: number }> | null;
  trend: WeightTrendSummary | null;
  /** Prognose als Schätzung; entfällt im Haltemodus, ohne Trend, ohne Plan und am Ziel. */
  forecast: Readonly<{ localDate: LocalDate; goalWeightG: number }> | null;
  /** Neueste Messung zuerst. */
  entries: readonly WeightHistoryEntry[];
}>;

export type WeightDetailState = Readonly<{ type: 'loading' }> | Readonly<{ type: 'ready'; detail: WeightDetail }> | Readonly<{ type: 'error' }>;

type WeightReading = Readonly<{ personId: EntityId; today: LocalDate; rows: readonly WeightRow[] }>;

/**
 * Beobachtet das Lesemodell: neu bei jedem Commit der Kontodatenbank und auf Anstoß von `refresh`, etwa am
 * Tageswechsel. Ohne eigene Person lädt es; scheitert der `PlanReader`, meldet es `error`.
 */
export function weightDetailSource(
  { database, clock }: Pick<TrackerDependencies, 'database' | 'clock'>,
  planReader: PlanReader,
  refresh: Refresh,
): Source<WeightDetailState> {
  const read = (tx: ReadContext): WeightReading | null => {
    const person = readOwnPerson(tx);
    if (person === undefined) return null;
    const personId = EntityId.parse(person.id);
    return { personId, today: LocalDate.parse(clock.read().localDate), rows: weightEntriesOf(tx, personId) };
  };
  return observedSource<WeightReading, WeightDetailState>(
    database,
    refresh,
    read,
    async ({ personId, today, rows }) => ({ type: 'ready', detail: weightDetailOf(rows, today, await planReader.effectivePlan(personId, today)) }),
    { loading: { type: 'loading' }, failed: { type: 'error' } },
  );
}

/** Das Lesemodell aus allen Einträgen der Person (aufsteigend nach Messzeitpunkt), dem Tag und dem Plan. */
function weightDetailOf(rows: readonly WeightRow[], today: LocalDate, plan: EffectivePlan): WeightDetail {
  // Nur Tagesgewichte bis heute; ein später gemessener Tag (etwa nach einem Sprung der Uhr) zählt noch nicht.
  const points = weightTrend(dayWeights(rows)).filter((point) => point.localDate <= today);
  const last = points.at(-1);
  const trendG = currentTrendG(points);
  const sinceStart = sinceStartG(points, today);
  const trend: WeightTrendSummary | null =
    trendG === null || sinceStart === null ? null : { trendG, sinceStartG: sinceStart, change: weightChange(points, today) };
  const goal = plan.type === 'gueltig' ? plan.goal : null;
  const forecastDate = goal === null ? null : weightForecast({ today, trendG: trend?.trendG ?? null, goalWeightG: goal.goalWeightG, pace: goal.pace });
  return {
    today,
    lastDayWeight: last === undefined ? null : { localDate: LocalDate.parse(last.localDate), weightG: last.dayWeightG },
    trend,
    forecast: forecastDate === null || goal === null ? null : { localDate: LocalDate.parse(forecastDate), goalWeightG: goal.goalWeightG },
    entries: historyOf(rows),
  };
}

/** Zählende Messungen, neueste zuerst; welche Tagesgewicht ist, sagen die Tracker-Regeln (`dayWeightEntries`). */
function historyOf(rows: readonly WeightRow[]): WeightHistoryEntry[] {
  const dayWeightIds = new Set(dayWeightEntries(rows).map((row) => row.id));
  return rows
    .filter(isCountingWeightEntry)
    .map((row) => ({
      id: EntityId.parse(row.id),
      weightG: row.weightG,
      measuredAt: Instant.parse(row.measuredAt),
      localDate: LocalDate.parse(row.localDate),
      timeZone: TimeZone.parse(row.timeZone),
      origin: row.origin,
      sourceAppName: row.sourceAppName,
      isDayWeight: dayWeightIds.has(row.id),
    }))
    .reverse();
}
