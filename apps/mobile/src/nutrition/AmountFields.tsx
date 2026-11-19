import { roundKcal, type DisplayUnit, type NutritionSnapshot } from '@abnehm/contracts/nutrition';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Chip, space, Text, TextField } from '../design';
import { checkAmountInput, defaultAmountMilli, type AmountCheck } from './amount-input';
import type { AmountPrefill } from './amount-prefill';
import { amountProblemText, kcalText, macrosText, milliText, nutritionTexts, unitChipText, unitText } from './texts';

// Die Mengenansicht (Spezifikation 2, Abschnitt 6), gemeinsam für die Mengenprüfung beim Hinzufügen und
// das Bearbeiten eines Eintrags: Mengenfeld mit Einheiten-Chips, kcal groß (`number-xl`-Familie) und
// Makros klein. Stück und Portion gibt es nur mit bekannter Umrechnung im Snapshot.

/** Eingabestand des Mengenfelds samt Prüfung gegen den Snapshot. */
export type AmountDraft = Readonly<{
  unit: DisplayUnit;
  input: string;
  check: AmountCheck;
  /** Satz mit Lösungsweg; ein leeres Feld beim Tippen ist erst nach dem Absenden ein Fehler. */
  problem: string | undefined;
  setInput: (input: string) => void;
  /** Wechselt die Einheit und setzt deren Standardmenge. */
  chooseUnit: (unit: DisplayUnit) => void;
  /** Markiert das Absenden; liefert die geprüfte Menge oder `undefined`, wenn das Feld ein Problem zeigt. */
  submit: () => Extract<AmountCheck, { type: 'menge' }> | undefined;
}>;

export function useAmountDraft(snapshot: NutritionSnapshot, initial: AmountPrefill): AmountDraft {
  const [unit, setUnit] = useState<DisplayUnit>(initial.displayUnit);
  const [input, setInput] = useState(() => milliText(initial.displayAmountMilli));
  const [submitted, setSubmitted] = useState(false);
  const check = checkAmountInput(snapshot, unit, input);
  const problem = check.type === 'problem' && (submitted || check.problem !== 'leer') ? amountProblemText(check.problem, snapshot.baseUnit) : undefined;
  return {
    unit,
    input,
    check,
    problem,
    setInput,
    chooseUnit(option) {
      if (option === unit) return;
      setUnit(option);
      setInput(milliText(defaultAmountMilli(snapshot, option)));
    },
    submit() {
      setSubmitted(true);
      return check.type === 'menge' ? check : undefined;
    },
  };
}

/** Mengenfeld, Einheiten-Chips sowie kcal und Makros der eingegebenen Menge. */
export function AmountFields({ snapshot, draft }: { snapshot: NutritionSnapshot; draft: AmountDraft }) {
  const units: DisplayUnit[] = [snapshot.baseUnit, ...snapshot.portions.map((portion) => portion.unit)];
  const { check } = draft;
  return (
    <>
      <TextField kind="number" label={nutritionTexts.amount} unit={unitText(draft.unit)} value={draft.input} onChangeText={draft.setInput} problem={draft.problem} />
      <View testID="einheiten" style={styles.chips}>
        {units.map((option) => (
          <Chip key={option} label={unitChipText(snapshot, option)} selection="single" selected={option === draft.unit} onPress={() => draft.chooseUnit(option)} />
        ))}
      </View>
      <View style={styles.values}>
        <Text variant="numberXl">{check.type === 'menge' ? kcalText(roundKcal(check.totals.milliKcal)) : nutritionTexts.noKcal}</Text>
        {check.type === 'menge' ? (
          <Text variant="label" tone="inkMuted">
            {macrosText(check.totals)}
          </Text>
        ) : null}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  values: { gap: space[1] },
});
