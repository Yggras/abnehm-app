import type { BaseUnit } from '@abnehm/contracts/nutrition';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Chip, Notice, ProblemMessage, space, Text, TextField } from '../design';
import { checkOwnFoodDraft, type OwnFoodDraft, type OwnFoodField, type PortionDraft } from './own-food-input';
import type { OwnFoodValues } from './own-foods';
import { nutritionTexts, ownFoodProblemText } from './texts';

// Formular „Eigenes Lebensmittel“ (Spezifikation 2, Abschnitte 3 und 6): Name, Einheit g oder ml,
// Bezugsmenge, kcal, Makros und optional Stück und Portion. Es ist ein Schritt des Hinzufügen-
// Bildschirms, kein Sheet: Das Formular braucht Tastatur und Platz, und Sheets liegen nie in Sheets.
// Probleme zeigt es ab dem ersten „Speichern“, jeweils am Feld mit Lösungsweg.

const texts = nutritionTexts.ownFood;

export type OwnFoodFormProps = {
  title: string;
  /** Hinweis unter dem Titel, etwa dass die BLS-Daten bei einer Korrektur unverändert bleiben. */
  hint?: string;
  initial: OwnFoodDraft;
  /** Gültige Werte; der Aufrufer speichert sie und schließt das Formular. */
  onSave: (values: OwnFoodValues) => void;
  onCancel: () => void;
  /** Nur bei einem bestehenden eigenen Lebensmittel; fragt vorher inline nach. */
  onDelete?: () => void;
};

export function OwnFoodForm({ title, hint, initial, onSave, onCancel, onDelete }: OwnFoodFormProps) {
  const [draft, setDraft] = useState(initial);
  const [submitted, setSubmitted] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const check = checkOwnFoodDraft(draft);
  const problem = (field: OwnFoodField) =>
    submitted && check.type === 'probleme' && check.problems[field] !== undefined ? ownFoodProblemText(field, check.problems[field], draft.baseUnit) : undefined;
  const change = (next: Partial<OwnFoodDraft>) => setDraft((current) => ({ ...current, ...next }));
  const changePortion = (unit: 'stueck' | 'portion', next: Partial<PortionDraft>) => setDraft((current) => ({ ...current, [unit]: { ...current[unit], ...next } }));
  const macrosProblem = problem('makros');

  return (
    <View style={styles.form} testID="eigenes-lebensmittel">
      <View style={styles.head}>
        <Text variant="title" accessibilityRole="header">
          {title}
        </Text>
        {hint === undefined ? null : (
          <Text variant="label" tone="inkMuted">
            {hint}
          </Text>
        )}
      </View>
      <TextField kind="text" label={texts.name} value={draft.name} onChangeText={(name) => change({ name })} problem={problem('name')} />
      <View style={styles.group}>
        <Text variant="label" importantForAccessibility="no">
          {texts.unit}
        </Text>
        <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={texts.unit}>
          {(['g', 'ml'] as const satisfies readonly BaseUnit[]).map((unit) => (
            <Chip key={unit} label={unit} selection="single" selected={draft.baseUnit === unit} onPress={() => change({ baseUnit: unit })} />
          ))}
        </View>
      </View>
      <TextField
        kind="number"
        label={texts.referenceAmount}
        unit={draft.baseUnit}
        value={draft.referenceAmount}
        onChangeText={(referenceAmount) => change({ referenceAmount })}
        problem={problem('referenceAmount')}
      />
      <TextField kind="number" label={texts.kcal} unit="kcal" value={draft.kcal} onChangeText={(kcal) => change({ kcal })} problem={problem('kcal')} />
      <TextField kind="number" label={texts.protein} unit="g" value={draft.protein} onChangeText={(protein) => change({ protein })} problem={problem('protein')} />
      <TextField kind="number" label={texts.carbs} unit="g" value={draft.carbs} onChangeText={(carbs) => change({ carbs })} problem={problem('carbs')} />
      <TextField kind="number" label={texts.fat} unit="g" value={draft.fat} onChangeText={(fat) => change({ fat })} problem={problem('fat')} />
      {macrosProblem === undefined ? null : <ProblemMessage text={macrosProblem} />}
      <View style={styles.head}>
        <Text variant="headline" accessibilityRole="header">
          {texts.conversions}
        </Text>
        <Text variant="label" tone="inkMuted">
          {texts.conversionsHint}
        </Text>
      </View>
      {(['stueck', 'portion'] as const).map((unit) => (
        <View key={unit} style={styles.group}>
          <TextField
            kind="number"
            label={texts.conversionAmount(unit)}
            unit={draft.baseUnit}
            value={draft[unit].amount}
            onChangeText={(amount) => changePortion(unit, { amount })}
            problem={problem(unit === 'stueck' ? 'stueckAmount' : 'portionAmount')}
          />
          <TextField
            kind="text"
            label={texts.conversionLabel(unit)}
            placeholder={texts.conversionPlaceholder(unit)}
            value={draft[unit].label}
            onChangeText={(label) => changePortion(unit, { label })}
            problem={problem(unit === 'stueck' ? 'stueckLabel' : 'portionLabel')}
          />
        </View>
      ))}
      <Button
        label={texts.save}
        block
        onPress={() => {
          setSubmitted(true);
          if (check.type === 'werte') onSave(check.values);
        }}
      />
      {confirmDelete && onDelete !== undefined ? (
        <>
          <Notice tone="hint" text={texts.deleteQuestion(initial.name)} />
          <View style={styles.actions}>
            <Button variant="secondary" label={texts.cancel} onPress={() => setConfirmDelete(false)} />
            <Button variant="secondary" label={texts.confirmDelete} onPress={onDelete} />
          </View>
        </>
      ) : (
        <View style={styles.actions}>
          {onDelete === undefined ? null : <Button variant="text" label={texts.delete} onPress={() => setConfirmDelete(true)} />}
          <Button variant="text" label={texts.cancel} onPress={onCancel} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: space[4] },
  head: { gap: space[1] },
  group: { gap: space[2] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], justifyContent: 'flex-end' },
});
