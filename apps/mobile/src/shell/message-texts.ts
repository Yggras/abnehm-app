import { BausteinKey, DisplayName, type MealKey } from '@abnehm/contracts/base';
import { NutritionEntryAddedValues } from '@abnehm/contracts/nutrition';
import { QuickCommandKey } from '@abnehm/contracts/today';
import { ActivityTypeOverriddenValues, ImportedSportMessageValues, ImportedWeightMessageValues, SportMessageValues, WaterAddedValues, WeightMessageValues } from '@abnehm/contracts/trackers';
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

/** Werte von Momos Reaktion auf Gutschriften: Tagesziele, Bonus und Energie je Tag (#188). */
const MomoEnergyValues = z.strictObject({
  ziel1: BausteinKey.optional(),
  ziel2: BausteinKey.optional(),
  ziel3: BausteinKey.optional(),
  bonus: z.boolean(),
  energie: z.int().nonnegative(),
  gesternBonus: z.boolean(),
  gesternEnergie: z.int().nonnegative(),
});

/** Was Momos Reaktion auf Gutschriften je Tag sagt, ohne Betrag; `null` ohne Gutschrift an diesem Tag. */
function energyParts({ ziel1, ziel2, ziel3, bonus, energie, gesternBonus, gesternEnergie }: z.output<typeof MomoEnergyValues>) {
  const goals = [ziel1, ziel2, ziel3].flatMap((goal) => (goal === undefined ? [] : [bausteinNames[goal]]));
  return {
    yesterday: gesternEnergie === 0 ? null : `Gestern im Kalorienbudget${gesternBonus ? ', alle drei geschafft' : ''}`,
    today: energie === 0 ? null : bonus ? 'Alle drei geschafft' : `${germanList(goals)} erfüllt`,
  };
}

const energyLine = (text: string, amount: number): ToastLine => ({ text: `${text} · +${amount} Energie`, energy: true });

/** Die Zeilen von `momo.energie` (siehe dort): eine je Tag mit Gutschriften, gestern über heute. */
function energyLines(values: z.output<typeof MomoEnergyValues>): MessageLines {
  const { yesterday, today } = energyParts(values);
  if (yesterday !== null && today !== null) return [energyLine(yesterday, values.gesternEnergie), energyLine(today, values.energie)];
  return yesterday !== null ? energyLine(yesterday, values.gesternEnergie) : energyLine(today!, values.energie);
}

/**
 * Gutschriften als eine Zeile, wenn neben ihnen nur eine Zeile Platz hat: gestern und heute zusammen mit der
 * Summe, etwa „Gestern im Kalorienbudget, heute Wasserziel erfüllt · +2 Energie“ (Wortlaut ist ein Designwert
 * aus #200, nicht belegt).
 */
function energyLineCombined(values: z.output<typeof MomoEnergyValues>): ToastLine {
  const { yesterday, today } = energyParts(values);
  if (yesterday === null || today === null) {
    const lines = energyLines(values);
    return 'text' in lines ? lines : lines[0];
  }
  // Bausteinnamen sind Substantive und bleiben groß; nur „Alle drei geschafft“ steht mitten im Satz klein.
  return energyLine(`${yesterday}, heute ${values.bonus ? 'alle drei geschafft' : today}`, values.gesternEnergie + values.energie);
}

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
  /** Spezifikation 2: Menge, Einheit oder Mahlzeit eines Eintrags geändert („Eintrag gespeichert · Rückgängig“; #156). */
  'ernaehrung.eintrag_gespeichert': messageText(z.strictObject({}), () => ({ text: 'Eintrag gespeichert' })),
  /** Spezifikation 2, Abschnitt 6: Eintrag ohne Bestätigungsdialog gelöscht („Eintrag gelöscht · Rückgängig“; #156). */
  'ernaehrung.eintrag_geloescht': messageText(z.strictObject({}), () => ({ text: 'Eintrag gelöscht' })),
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
  /** Spezifikation 3: importiertes Training ohne Bestätigungsdialog ausgeblendet („52 min Radfahren ausgeblendet · Rückgängig“; #186). */
  'sport.ausgeblendet': messageText(ImportedSportMessageValues, ({ activityType, durationMinutes }) => ({
    text: `${durationMinutes} min ${activityNames[activityType]} ausgeblendet`,
  })),
  /**
   * Spezifikation 3: Aktivitätsart eines importierten Trainings geändert („Jetzt Krafttraining statt Radfahren ·
   * Rückgängig“; #186). Der Wortlaut ist ein Designwert aus der Impeccable-Kritik, nicht belegt.
   */
  'sport.art_geaendert': messageText(ActivityTypeOverriddenValues, ({ activityType, previousActivityType }) => ({
    text: `Jetzt ${activityNames[activityType]} statt ${activityNames[previousActivityType]}`,
  })),
  /** Spezifikation 3: importiertes Gewicht ohne Bestätigungsdialog ausgeblendet („82,4 kg ausgeblendet · Rückgängig“; #186). */
  'gewicht.ausgeblendet': messageText(ImportedWeightMessageValues, ({ weightG }) => ({ text: `${thousandthsWithOneDecimal(weightG)} kg ausgeblendet` })),
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
    MomoEnergyValues.refine((values) => values.energie + values.gesternEnergie > 0, { message: 'Meldung ohne Gutschrift' }),
    energyLines,
  ),
  /**
   * Spezifikation 4, Abschnitt 6: Momos Feier eines Levelaufstiegs, „Momo ist jetzt auf Level N“ (#200); bei
   * mehreren übersprungenen Leveln das höchste. Kommen im selben Commit Gutschriften dazu, steht ihre Zeile
   * davor, gestern und heute zusammengefasst, weil eine Meldung höchstens zwei Zeilen hat. Die Levelzeile
   * steht zuletzt: Steht eine Meldung mit „Rückgängig“, hängt der Host nur sie an.
   */
  'momo.levelaufstieg': messageText(MomoEnergyValues.extend({ level: z.int().min(2) }), ({ level, ...energy }) => {
    const levelLine: ToastLine = { text: `Momo ist jetzt auf Level ${level}` };
    if (energy.energie + energy.gesternEnergie === 0) return levelLine;
    return [energyLineCombined(energy), levelLine];
  }),
  /** Spezifikation 5: Anzeigename unter „Konto“ geändert. */
  'konto.name_gespeichert': messageText(z.strictObject({}), () => ({ text: 'Name gespeichert' })),
  /** Spezifikation 5, Abschnitt 4: Anfeuerung gesendet (#123); ohne „Rückgängig“ und ohne Haptik. */
  'anfeuern.gesendet': messageText(z.strictObject({ partnerDisplayName: DisplayName }), ({ partnerDisplayName }) => ({
    text: `Anfeuerung an ${partnerDisplayName} gesendet`,
  })),
  /** Spezifikation 5, Abschnitt 4: offline vorgemerkt; die Outbox sendet sie beim nächsten Push (#123). */
  'anfeuern.vorgemerkt': messageText(z.strictObject({}), () => ({ text: 'Wird gesendet, sobald du online bist' })),
  /** Freigabe ohne Verbindung abgeschaltet: Der Partner sieht sie erst nach dem nächsten Push nicht mehr (#129). */
  'freigaben.gilt_wenn_online': messageText(z.strictObject({}), () => ({ text: 'Gilt, sobald du wieder online bist' })),
  /** Spezifikation 1: „Ziele ändern“ hat eine Zielversion ab morgen angelegt (#147). */
  'ziele.ab_morgen_gespeichert': messageText(z.strictObject({}), () => ({ text: 'Ziele gespeichert · gelten ab morgen' })),
  /** Spezifikation 5: Benachrichtigungseinstellung gespeichert (#132). */
  'benachrichtigungen.gespeichert': messageText(z.strictObject({}), () => ({ text: 'Benachrichtigungen gespeichert' })),
  /** Spezifikation 5: Passwort geändert; das Backend hat dabei alle anderen Sitzungen widerrufen. */
  'konto.passwort_geaendert': messageText(z.strictObject({}), () => ({ text: 'Passwort geändert. Deine anderen Geräte sind abgemeldet.' })),
  /** Ein unbekanntes oder ungültiges Ziel, etwa ein veralteter Link, hat „Heute“ geöffnet. */
  'shell.ziel_unbekannt': messageText(z.strictObject({}), () => ({ text: 'Das gibt es nicht mehr.' })),
};
