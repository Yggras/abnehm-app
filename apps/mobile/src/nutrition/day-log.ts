import { EntityId, MealKey, type Instant, type LocalDate, type TimeZone } from '@abnehm/contracts/base';
import {
  dailyIntakeKcal,
  roundKcal,
  type CaptureMethod,
  type DisplayUnit,
  type EntryTotals,
  type NutritionSnapshot,
} from '@abnehm/contracts/nutrition';

import type { ReadContext } from '../local-db';
import { readOwnPerson } from '../local-db/person-header';
import { entriesOfDay, readOwnLivingEntry } from './entry-repository';

// Abfragen Tagesprotokoll und Tagesaufnahme (Spezifikation 2, Abschnitte 2 und 6): die nicht
// gelöschten Einträge eines lokalen Tags, gegliedert nach den vier Mahlzeiten in fester Reihenfolge,
// dazu ein einzelner Eintrag für seine Mengenansicht (`readEntryDetail`).

/** Ein Eintrag, wie ihn das Protokoll zeigt: Name, Menge und kcal. */
export type DayLogEntry = Readonly<{
  id: EntityId;
  name: string;
  displayUnit: DisplayUnit;
  displayAmountMilli: number;
  /** Ganze kcal, kaufmännisch gerundet. */
  kcal: number;
  /** Aus einem Foto erfasst: Das Protokoll zeigt das Foto-/KI-Symbol (Spezifikation 2, Abschnitt 6). */
  fromPhoto: boolean;
  /** Werte der KI-Schätzung (Quelle `ki`), nicht durch ein Suchergebnis ersetzt (Spezifikation 2, Abschnitt 12). */
  aiEstimate: boolean;
}>;

export type DayLogMeal = Readonly<{
  meal: MealKey;
  /** Gerundete Summe der `milli_kcal` der Mahlzeit. */
  kcal: number;
  entries: readonly DayLogEntry[];
}>;

export type DayLog = Readonly<{
  localDate: LocalDate;
  /** Tagesaufnahme: die gerundete Summe der `milli_kcal` aller nicht gelöschten Einträge des Tags. */
  intakeKcal: number;
  /** Tagesmakros: Summen der Eintragsmakros in mg; gerundet wird erst für die Anzeige (Spezifikation 2, Abschnitt 2). */
  macros: Readonly<Pick<EntryTotals, 'proteinMg' | 'carbsMg' | 'fatMg'>>;
  /** Frühstück, Mittagessen, Abendessen, Snacks; auch leere Mahlzeiten. */
  meals: readonly DayLogMeal[];
}>;

/** Das Tagesprotokoll der eigenen Person; `null`, bis sie mit dem ersten Pull angekommen ist. */
export function readDayLog(tx: ReadContext, localDate: LocalDate): DayLog | null {
  const person = readOwnPerson(tx);
  if (person === undefined) return null;
  const entries = entriesOfDay(tx, EntityId.parse(person.id), localDate);
  return {
    localDate,
    intakeKcal: dailyIntakeKcal(entries.map((entry) => entry.totalMilliKcal)),
    macros: {
      proteinMg: sum(entries.map((entry) => entry.totalProteinMg)),
      carbsMg: sum(entries.map((entry) => entry.totalCarbsMg)),
      fatMg: sum(entries.map((entry) => entry.totalFatMg)),
    },
    meals: MealKey.options.map((meal) => {
      const ofMeal = entries.filter((entry) => entry.meal === meal);
      return {
        meal,
        kcal: dailyIntakeKcal(ofMeal.map((entry) => entry.totalMilliKcal)),
        entries: ofMeal.map(({ id, name, captureMethod, source, displayUnit, displayAmountMilli, totalMilliKcal }): DayLogEntry => ({
          id,
          name,
          displayUnit,
          displayAmountMilli,
          kcal: roundKcal(totalMilliKcal),
          fromPhoto: captureMethod === 'foto',
          aiEstimate: source === 'ki',
        })),
      };
    }),
  };
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** Ein bestehender Eintrag in der Mengenansicht: was sich ändern lässt und was die Details zeigen. */
export type EntryDetail = Readonly<{
  id: EntityId;
  /** Nicht änderbar (Spezifikation 2, Abschnitt 6). */
  localDate: LocalDate;
  meal: MealKey;
  captureMethod: CaptureMethod;
  /** Der gespeicherte Snapshot; eine neue Menge rechnet aus ihm. */
  snapshot: NutritionSnapshot;
  displayUnit: DisplayUnit;
  displayAmountMilli: number;
  /** Erfassungszeitpunkt samt IANA-Zone der Erfassung. */
  consumedAt: Instant;
  timeZone: TimeZone;
}>;

/** Ein nicht gelöschter Eintrag der eigenen Person; sonst `null`. */
export function readEntryDetail(tx: ReadContext, entryId: EntityId): EntryDetail | null {
  const stored = readOwnLivingEntry(tx, entryId);
  if (stored === undefined) return null;
  const { content } = stored;
  return {
    id: entryId,
    localDate: content.localDate,
    meal: content.meal,
    captureMethod: content.captureMethod,
    snapshot: content.snapshot,
    displayUnit: content.amount.displayUnit,
    displayAmountMilli: content.amount.displayAmountMilli,
    consumedAt: content.consumedAt,
    timeZone: content.timeZone,
  };
}
