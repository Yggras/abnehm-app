import { z } from 'zod';

import type { DailyGoalEvaluated, DailyGoalState } from '@abnehm/contracts/daily-goals';

import { bausteinNames, thousandthsWithOneDecimal } from './texts';

// Texte der Tagesziele auf „Heute“ (Spezifikation 1, Abschnitt 6): Sie entstehen in der App aus
// `messageKey` und typisierten Werten (Spezifikation 0, Abschnitt 2). Der Schlüssel heißt
// `tagesziel.<baustein>.<zustand>`, die Werte sind die Fortschrittsfelder des Bausteins ohne `type`.
// So liefern ihn die Test-Evaluatoren des Fundaments (#104); die Evaluatoren der Spezifikationen 2 und 3
// folgen demselben Schema. Die Formulierungen sind Designwerte.

/**
 * Text eines Tagesziels. `title` ist die ganze Aussage („Wasserziel · 1,0 von 1,5 l“), `name` und `detail`
 * ihre Teile, damit die Zeile den Wert unter dem Namen zeigen kann, statt mitten im Wert umzubrechen.
 * `status` ist der Zustand in Worten; `null`, wenn der Wert ihn schon sagt („am Tagesende“).
 */
export type DailyGoalText = Readonly<{ title: string; name: string; detail: string | null; status: string | null }>;

const stateNames: Readonly<Record<DailyGoalState, string>> = {
  offen: 'offen',
  teilweise: 'teilweise',
  erfuellt: 'erfüllt',
  tagesende: 'am Tagesende',
};

// Wie die Fortschrittsfelder in `DailyGoalProgress` (Spezifikation 0, Abschnitt 3): Schwellen positiv, Zählungen ab 0.
const count = z.int().nonnegative();
const positive = z.int().positive();
const kcal = (value: number) => value.toLocaleString('de-DE');

type Entry = Readonly<{ values: z.ZodType; detail: (values: never) => string }>;
const entry = <S extends z.ZodType>(values: S, detail: (values: z.output<S>) => string): Entry => ({ values, detail: detail as Entry['detail'] });

const meals = entry(z.strictObject({ recordedMealCategories: count, minimumMealCategories: positive }), (v) =>
  `${v.recordedMealCategories} von ${v.minimumMealCategories} ${v.minimumMealCategories === 1 ? 'Mahlzeit' : 'Mahlzeiten'}`);
const budget = z.strictObject({ intakeKcal: count, budgetKcal: positive, lowerBoundKcal: positive });
const decidedBudget = entry(budget, (v) => `${kcal(v.intakeKcal)} von ${kcal(v.budgetKcal)} kcal`);
const water = entry(z.strictObject({ countedMl: count, targetMl: positive }), (v) =>
  `${thousandthsWithOneDecimal(v.countedMl)} von ${thousandthsWithOneDecimal(v.targetMl)} l`);
const sport = entry(z.strictObject({ longestSessionMinutes: count, minimumSingleSessionMinutes: positive }), (v) =>
  `${v.longestSessionMinutes} von ${v.minimumSingleSessionMinutes} min`);
const weighed = z.strictObject({ weightEntryCount: count });

/** Katalog je `messageKey`: Schema der Werte und der Teil nach dem Namen des Bausteins. */
const catalog: Readonly<Record<string, Entry>> = {
  'tagesziel.ernaehrung_erfasst.offen': meals,
  'tagesziel.ernaehrung_erfasst.teilweise': meals,
  'tagesziel.ernaehrung_erfasst.erfuellt': meals,
  'tagesziel.im_kalorienbudget.tagesende': entry(budget, () => stateNames.tagesende),
  'tagesziel.im_kalorienbudget.offen': decidedBudget,
  'tagesziel.im_kalorienbudget.erfuellt': decidedBudget,
  'tagesziel.wasserziel.offen': water,
  'tagesziel.wasserziel.teilweise': water,
  'tagesziel.wasserziel.erfuellt': water,
  'tagesziel.sporteinheit.offen': sport,
  'tagesziel.sporteinheit.teilweise': sport,
  'tagesziel.sporteinheit.erfuellt': sport,
  'tagesziel.gewogen.offen': entry(weighed, () => 'noch kein Eintrag'),
  'tagesziel.gewogen.erfuellt': entry(weighed, () => 'eingetragen'),
};

/**
 * Text eines ausgewerteten Tagesziels. Ein unbekannter Schlüssel oder unpassende Werte zeigen nur den
 * Namen des Bausteins, nie den Schlüssel. Ist das Tagesziel nach einer Korrektur nicht mehr erfüllt,
 * nennt der Zustand die festgehaltene Gutschrift („offen · bereits gutgeschrieben“).
 */
export function dailyGoalText(evaluation: DailyGoalEvaluated): DailyGoalText {
  const name = bausteinNames[evaluation.progress.type];
  const known = catalog[evaluation.messageKey];
  const values = known?.values.safeParse(evaluation.values);
  const detail = known !== undefined && values?.success ? known.detail(values.data as never) : null;
  const credited = evaluation.completion.type === 'festgehalten' && evaluation.currentState !== 'erfuellt';
  const state = stateNames[evaluation.currentState];
  return {
    title: detail === null ? name : `${name} · ${detail}`,
    name,
    detail,
    status: credited ? `${state} · bereits gutgeschrieben` : detail === state ? null : state,
  };
}
