import { EntityId, Instant, LocalDate } from '@abnehm/contracts/base';
import type { EffectivePlan, PlanReader } from '@abnehm/contracts/ports';
import {
  dayWeights,
  isCountingWeightEntry,
  manualOrigin,
  showsTrend,
  sinceStartG,
  weightChange,
  weightForecast,
  weightTrend,
  type DayWeight,
  type WeightChange,
} from '@abnehm/contracts/tracker-rules';
import type { ImportOrigin } from '@abnehm/contracts/trackers';

import type { ReadContext } from '../local-db';
import { readOwnPerson } from '../local-db/person-header';
import { observedSource, type ObservedSource, type Refresh } from './today-source';
import type { TrackerDependencies } from './trackers';
import { weightEntriesOf, type WeightRow } from './weight-repository';

// Lesemodell des Gewicht-Detailbildschirms `capture.weight` (Spezifikation 3, Abschnitte 3 und 5):
// Trendgewicht, letztes Tagesgewicht, „seit Start“, Veränderung in 2 Wochen und Prognose, darunter alle
// zählenden Messungen mit Herkunft. Zielgewicht, Tempo und Haltemodus kommen aus dem `PlanReader`. Alle
// Zahlen stammen aus den Tracker-Regeln, wie im `WeightTrendReader` und im Mini-Tracker.

/** Eine zählende Messung im Verlauf. */
export type WeightHistoryEntry = Readonly<{
  id: EntityId;
  weightG: number;
  measuredAt: Instant;
  localDate: LocalDate;
  origin: typeof manualOrigin | ImportOrigin;
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
  dayWeightCount: number;
  lastDayWeight: DayWeight | null;
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
): ObservedSource<WeightDetailState> {
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
export function weightDetailOf(rows: readonly WeightRow[], today: LocalDate, plan: EffectivePlan): WeightDetail {
  const points = weightTrend(dayWeights(rows));
  const last = points.at(-1);
  const trend: WeightTrendSummary | null =
    last !== undefined && showsTrend(points.length)
      ? { trendG: last.trendG, sinceStartG: sinceStartG(points, today) ?? 0, change: weightChange(points, today) }
      : null;
  const goal = plan.type === 'gueltig' ? plan.goal : null;
  const forecastDate = goal === null ? null : weightForecast({ today, trendG: trend?.trendG ?? null, goalWeightG: goal.goalWeightG, pace: goal.pace });
  return {
    today,
    dayWeightCount: points.length,
    lastDayWeight: last === undefined ? null : { localDate: last.localDate, weightG: last.dayWeightG },
    trend,
    forecast: forecastDate === null || goal === null ? null : { localDate: LocalDate.parse(forecastDate), goalWeightG: goal.goalWeightG },
    entries: historyOf(rows),
  };
}

/** Zählende Messungen, neueste zuerst; die erste je lokalem Tag (aufsteigend gelesen) ist das Tagesgewicht. */
function historyOf(rows: readonly WeightRow[]): WeightHistoryEntry[] {
  const seenDays = new Set<string>();
  const entries: WeightHistoryEntry[] = [];
  for (const row of rows) {
    if (!isCountingWeightEntry(row)) continue;
    const isDayWeight = !seenDays.has(row.localDate);
    seenDays.add(row.localDate);
    entries.push({
      id: EntityId.parse(row.id),
      weightG: row.weightG,
      measuredAt: Instant.parse(row.measuredAt),
      localDate: LocalDate.parse(row.localDate),
      origin: row.origin as WeightHistoryEntry['origin'],
      sourceAppName: row.sourceAppName,
      isDayWeight,
    });
  }
  return entries.reverse();
}
