import { BausteinKey, type MealKey } from '@abnehm/contracts/base';
import { NutritionEntryAddedValues } from '@abnehm/contracts/nutrition';
import { QuickCommandKey } from '@abnehm/contracts/today';
import { SportMessageValues, WaterAddedValues, WeightMessageValues } from '@abnehm/contracts/trackers';
import { z } from 'zod';

import type { ToastLine } from '../design';
import { activityNames, bausteinNames, germanList, quickCommandOwnerName, shellTexts, thousandthsWithOneDecimal } from './texts';

// Texte des Meldungs-Hosts: Die sichtbare Zeile entsteht in der App aus `messageKey` und
// typisierten Werten (Spezifikation 0, Abschnitt 2). Bereiche tragen ihre Meldungen hier ein,
// etwa Spezifikation 3 „+250 ml Wasser“ und Spezifikation 4 „Wasserziel erfüllt · +1 Energie“.

/**
 * Die Zeilen einer Meldung: meist eine, für Momos Reaktion auf gestern und heute zwei (#188). Eine
 * zweizeilige Meldung hat nie „Rückgängig“.
 */
export type MessageLines = ToastLine | readonly [ToastLine, ToastLine];

/** Ein Eintrag: Schema der Werte und die daraus erzeugten Zeilen. */
export type MessageTextEntry<S extends z.ZodType = z.ZodType> = Readonly<{
  values: S;
  render: (values: z.output<S>) => MessageLines;
}>;

/** Typisiert einen Eintrag, sodass `render` die Werte aus dem Schema kennt. */
export function messageText<S extends z.ZodType>(values: S, render: (values: z.output<S>) => MessageLines): MessageTextEntry {
  return { values, render } as MessageTextEntry;
}

/** Ziel einer Mahlzeit im Dativ, etwa „zum Frühstück“. */
const toMeal: Readonly<Record<MealKey, string>> = {
  fruehstueck: 'zum Frühstück',
  mittagessen: 'zum Mittagessen',
  abendessen: 'zum Abendessen',
  snacks: 'zu den Snacks',
};

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
  'sport.eingetragen': messageText(SportMessageValues, ({ activityType, durationMinutes }) => ({
    text: `${durationMinutes} min ${activityNames[activityType]} eingetragen`,
  })),
  /** Spezifikation 3: manuelle Einheit bearbeitet („45 min Laufen gespeichert · Rückgängig“; #174). */
  'sport.geaendert': messageText(SportMessageValues, ({ activityType, durationMinutes }) => ({
    text: `${durationMinutes} min ${activityNames[activityType]} gespeichert`,
  })),
  /** Spezifikation 3: manuelle Einheit ohne Bestätigungsdialog gelöscht („30 min Laufen gelöscht · Rückgängig“; #174). */
  'sport.geloescht': messageText(SportMessageValues, ({ activityType, durationMinutes }) => ({
    text: `${durationMinutes} min ${activityNames[activityType]} gelöscht`,
  })),
  /**
   * Spezifikation 4: Momos Reaktion auf neue eigene Gutschriften eines Commits, als eine Meldung (#188):
   * „Wasserziel erfüllt · +1 Energie“ und „Alle drei geschafft · +1 Energie“ wie in Abschnitt 6. Kommen
   * mehrere zusammen, fasst die Meldung sie mit der Summe der Energie zusammen, etwa „Alle drei geschafft ·
   * +2 Energie“ für das dritte Tagesziel samt Bonus. Die gebündelten Tagesende-Gutschriften des Vortags
   * stehen in einer eigenen Zeile über heute, etwa „Gestern im Kalorienbudget, alle drei geschafft · +2
   * Energie“; sie gibt es nur für „Im Kalorienbudget“ und den Bonus an solchen Tagen (CONTEXT.md).
   * `energie` und `gesternEnergie` sind die Summen der Gutschriften je Tag, 0 heißt ohne diesen Tag
   * (Nutzerentscheidungen in #188, https://github.com/Yggras/abnehm-app/issues/188#issuecomment-6986767756).
   * Die zusammengesetzten Wortlaute sind Designwerte, nicht belegt. Ohne „Rückgängig“; steht eine Meldung
   * mit „Rückgängig“, hängt der Host die Zeile von heute an.
   */
  'momo.energie': messageText(
    z
      .strictObject({
        ziel1: BausteinKey.optional(),
        ziel2: BausteinKey.optional(),
        ziel3: BausteinKey.optional(),
        bonus: z.boolean(),
        energie: z.int().nonnegative(),
        gesternBonus: z.boolean(),
        gesternEnergie: z.int().nonnegative(),
      })
      .refine((values) => values.energie + values.gesternEnergie > 0, { message: 'Meldung ohne Gutschrift' }),
    ({ ziel1, ziel2, ziel3, bonus, energie, gesternBonus, gesternEnergie }) => {
      const goals = [ziel1, ziel2, ziel3].flatMap((goal) => (goal === undefined ? [] : [bausteinNames[goal]]));
      const todayText = bonus ? 'Alle drei geschafft' : `${germanList(goals)} erfüllt`;
      const today: ToastLine = { text: `${todayText} · +${energie} Energie`, energy: true };
      const yesterday: ToastLine = {
        text: `Gestern im Kalorienbudget${gesternBonus ? ', alle drei geschafft' : ''} · +${gesternEnergie} Energie`,
        energy: true,
      };
      if (gesternEnergie === 0) return today;
      return energie === 0 ? yesterday : [yesterday, today];
    },
  ),
  /** Spezifikation 5: Anzeigename unter „Konto“ geändert. */
  'konto.name_gespeichert': messageText(z.strictObject({}), () => ({ text: 'Name gespeichert' })),
  /** Spezifikation 1: „Ziele ändern“ hat eine Zielversion ab morgen angelegt (#147). */
  'ziele.ab_morgen_gespeichert': messageText(z.strictObject({}), () => ({ text: 'Ziele gespeichert · gelten ab morgen' })),
  /** Spezifikation 5: Benachrichtigungseinstellung gespeichert (#132). */
  'benachrichtigungen.gespeichert': messageText(z.strictObject({}), () => ({ text: 'Benachrichtigungen gespeichert' })),
  /** Spezifikation 5: Passwort geändert; das Backend hat dabei alle anderen Sitzungen widerrufen. */
  'konto.passwort_geaendert': messageText(z.strictObject({}), () => ({ text: 'Passwort geändert. Deine anderen Geräte sind abgemeldet.' })),
  /** Ein unbekanntes oder ungültiges Ziel, etwa ein veralteter Link, hat „Heute“ geöffnet. */
  'shell.ziel_unbekannt': messageText(z.strictObject({}), () => ({ text: 'Das gibt es nicht mehr.' })),
};
