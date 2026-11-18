import { BausteinKey, type MealKey } from '@abnehm/contracts/base';
import { NutritionEntryAddedValues } from '@abnehm/contracts/nutrition';
import { QuickCommandKey } from '@abnehm/contracts/today';
import { SportRecordedValues, WaterAddedValues, WeightMessageValues } from '@abnehm/contracts/trackers';
import { z } from 'zod';

import type { ToastLine } from '../design';
import { activityNames, bausteinNames, quickCommandOwnerName, shellTexts, thousandthsWithOneDecimal } from './texts';

// Texte des Meldungs-Hosts: Die sichtbare Zeile entsteht in der App aus `messageKey` und
// typisierten Werten (Spezifikation 0, Abschnitt 2). Bereiche tragen ihre Meldungen hier ein,
// etwa Spezifikation 3 „+250 ml Wasser“ und Spezifikation 4 „Wasserziel erfüllt · +1 Energie“.

/** Ein Eintrag: Schema der Werte und die daraus erzeugte Zeile. */
export type MessageTextEntry<S extends z.ZodType = z.ZodType> = Readonly<{
  values: S;
  render: (values: z.output<S>) => ToastLine;
}>;

/** Typisiert einen Eintrag, sodass `render` die Werte aus dem Schema kennt. */
export function messageText<S extends z.ZodType>(values: S, render: (values: z.output<S>) => ToastLine): MessageTextEntry {
  return { values, render } as MessageTextEntry;
}

/** Ziel einer Mahlzeit im Dativ, etwa „zum Frühstück“. */
const toMeal: Readonly<Record<MealKey, string>> = {
  fruehstueck: 'zum Frühstück',
  mittagessen: 'zum Mittagessen',
  abendessen: 'zum Abendessen',
  snacks: 'zu den Snacks',
};

/** „A“, „A und B“, „A, B und C“. */
function germanList(items: readonly string[]): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} und ${items.at(-1)}`;
}

const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export const messageTexts: Readonly<Record<string, MessageTextEntry>> = {
  /** Development Build: Für einen Quick-Command fehlt noch der Handler seines Bereichs. */
  'shell.quick_command.in_arbeit': messageText(z.strictObject({ commandKey: QuickCommandKey }), ({ commandKey }) => ({
    text: `${shellTexts.placeholder} ${shellTexts.placeholderOwner(quickCommandOwnerName(commandKey))}`,
  })),
  /** Eine lokale Buchung oder ihr Undo ist technisch gescheitert. */
  'shell.nicht_geklappt': messageText(z.strictObject({}), () => ({ text: 'Das hat nicht geklappt. Versuch es bitte noch einmal.' })),
  /** Spezifikation 3: Wasser gebucht; „Rückgängig“ ergänzt der Meldungs-Host („+250 ml Wasser · Rückgängig“). */
  'wasser.hinzugefuegt': messageText(WaterAddedValues, ({ ml }) => ({ text: shellTexts.quickAddWater(ml) })),
  /** Spezifikation 2: Eintrag gespeichert; „Rückgängig“ ergänzt der Meldungs-Host („209 kcal zum Frühstück hinzugefügt · Rückgängig“). */
  'ernaehrung.eintrag_hinzugefuegt': messageText(NutritionEntryAddedValues, ({ meal, kcal }) => ({
    text: `${kcal.toLocaleString('de-DE')} kcal ${toMeal[meal]} hinzugefügt`,
  })),
  /** Spezifikation 3: Gewicht eingetragen („91,8 kg eingetragen · Rückgängig“); nur die Person selbst sieht es. */
  'gewicht.eingetragen': messageText(WeightMessageValues, ({ weightG }) => ({ text: `${thousandthsWithOneDecimal(weightG)} kg eingetragen` })),
  /** Spezifikation 3: manuelle Messung bearbeitet („82,1 kg gespeichert · Rückgängig“; #176). */
  'gewicht.geaendert': messageText(WeightMessageValues, ({ weightG }) => ({ text: `${thousandthsWithOneDecimal(weightG)} kg gespeichert` })),
  /** Spezifikation 3: manuelle Messung ohne Bestätigungsdialog gelöscht („82,4 kg gelöscht · Rückgängig“; #176). */
  'gewicht.geloescht': messageText(WeightMessageValues, ({ weightG }) => ({ text: `${thousandthsWithOneDecimal(weightG)} kg gelöscht` })),
  /** Spezifikation 3: manueller Sporteintrag angelegt („30 min Laufen eingetragen · Rückgängig“). */
  'sport.eingetragen': messageText(SportRecordedValues, ({ activityType, durationMinutes }) => ({
    text: `${durationMinutes} min ${activityNames[activityType]} eingetragen`,
  })),
  /**
   * Spezifikation 4: Momos Reaktion auf neue eigene Gutschriften eines Commits, als eine Meldung (#188):
   * „Wasserziel erfüllt · +1 Energie“ und „Alle drei geschafft · +1 Energie“ wie in Abschnitt 6. Kommen
   * mehrere zusammen, fasst die Meldung sie mit der Summe der Energie zusammen, etwa „Alle drei geschafft ·
   * +2 Energie“ für das dritte Tagesziel samt Bonus (Nutzerentscheidung in #188). `gestern` zählt die
   * gebündelten Tagesende-Gutschriften des Vortags; sie gibt es nur für „Im Kalorienbudget“ und den Bonus
   * an solchen Tagen (CONTEXT.md). Die zusammengesetzten Wortlaute sind Designwerte, nicht belegt. Ohne
   * „Rückgängig“; steht eine Meldung mit „Rückgängig“, wird sie deren zweite Zeile.
   */
  'momo.energie': messageText(
    z
      .strictObject({
        ziel1: BausteinKey.optional(),
        ziel2: BausteinKey.optional(),
        ziel3: BausteinKey.optional(),
        bonus: z.boolean(),
        gestern: z.int().min(0).max(2),
        gesternBonus: z.boolean(),
      })
      .refine((values) => values.gestern > 0 || values.bonus || values.ziel1 !== undefined, { message: 'Meldung ohne Gutschrift' }),
    ({ ziel1, ziel2, ziel3, bonus, gestern, gesternBonus }) => {
      const goals = [ziel1, ziel2, ziel3].flatMap((goal) => (goal === undefined ? [] : [bausteinNames[goal]]));
      const today = bonus ? 'alle drei geschafft' : goals.length > 0 ? `${germanList(goals)} erfüllt` : null;
      const yesterday = gestern > 0 ? `Gestern im Kalorienbudget${gesternBonus ? ', alle drei geschafft' : ''}` : null;
      const energy = gestern + goals.length + (bonus ? 1 : 0);
      const text = yesterday === null ? capitalized(today!) : today === null ? yesterday : `${yesterday}, heute ${today}`;
      return { text: `${text} · +${energy} Energie`, energy: true };
    },
  ),
  /** Spezifikation 5: Anzeigename unter „Konto“ geändert. */
  'konto.name_gespeichert': messageText(z.strictObject({}), () => ({ text: 'Name gespeichert' })),
  /** Spezifikation 5: Passwort geändert; das Backend hat dabei alle anderen Sitzungen widerrufen. */
  'konto.passwort_geaendert': messageText(z.strictObject({}), () => ({ text: 'Passwort geändert. Deine anderen Geräte sind abgemeldet.' })),
  /** Ein unbekanntes oder ungültiges Ziel, etwa ein veralteter Link, hat „Heute“ geöffnet. */
  'shell.ziel_unbekannt': messageText(z.strictObject({}), () => ({ text: 'Das gibt es nicht mehr.' })),
};
