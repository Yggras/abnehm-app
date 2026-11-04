import { EntityId, MealKey, type LocalDate } from '@abnehm/contracts/base';
import { dailyIntakeKcal, roundKcal, type DisplayUnit } from '@abnehm/contracts/nutrition';

import type { ReadContext } from '../local-db';
import { readOwnPerson } from '../local-db/person-header';
import { entriesOfDay } from './entry-repository';

// Abfragen Tagesprotokoll und Tagesaufnahme (Spezifikation 2, Abschnitte 2 und 6): die nicht
// gelöschten Einträge eines lokalen Tags, gegliedert nach den vier Mahlzeiten in fester Reihenfolge.

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
    meals: MealKey.options.map((meal) => {
      const ofMeal = entries.filter((entry) => entry.meal === meal);
      return {
        meal,
        kcal: dailyIntakeKcal(ofMeal.map((entry) => entry.totalMilliKcal)),
        entries: ofMeal.map(({ id, name, captureMethod, source, displayUnit, displayAmountMilli, totalMilliKcal }) => ({
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
