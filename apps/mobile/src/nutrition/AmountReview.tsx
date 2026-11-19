import type { CaptureMethod, DisplayUnit, FoodRef, NutritionSnapshot, PortionConversion } from '@abnehm/contracts/nutrition';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Chip, IconButton, space, Text, TextField } from '../design';
import { defaultAmountMilli } from './amount-input';
import { AmountFields, useAmountDraft } from './AmountFields';
import type { Nutrition } from './nutrition';
import { conversionFields, type ConversionUnit } from './own-food-fields';
import { checkPortionDraft, editableBaseOf } from './own-food-input';
import { conversionProblemText, nutritionTexts, ownFoodProblemText, sourceNames } from './texts';

// Mengenprüfung des Hinzufügen-Bildschirms (Spezifikation 2, Abschnitte 2 und 6) samt dem Schritt
// „Umrechnung eintragen“ (#157). Beide stehen im selben Sheet; Sheets liegen nie in Sheets.

/** Ein Lebensmittel in der Mengenprüfung: Referenz, aktuelle Fassung und wie die Person es gefunden hat. */
export type Selection = Readonly<{
  ref: FoodRef;
  snapshot: NutritionSnapshot;
  captureMethod: CaptureMethod;
  /** Vorgewählte Einheit, etwa die gerade eingetragene Umrechnung; sonst die Vorbelegung des Moduls. */
  unit?: DisplayUnit;
}>;

/**
 * Mengenprüfung als Sheet: Name und Quelle, Mengenfeld mit Einheiten-Chips, kcal groß, Makros klein und
 * „Hinzufügen“. Vorbelegt ist die letzte Menge dieses Lebensmittels, sonst eine Portion, sonst 100 g bzw. ml.
 * Stück und Portion gibt es nur mit bekannter Umrechnung; eine fehlende trägt die Person hier ein.
 */
export function AmountReview({
  selection,
  target,
  nutrition,
  onClose,
  onAdd,
  onEdit,
  onConversion,
}: {
  selection: Selection;
  /** Mahlzeit und Tag, etwa „Abendessen · Gestern, Dienstag, 13.10.2026“: Beim Nachtragen steht der Tag bis zum letzten Schritt. */
  target: string;
  nutrition: Nutrition;
  onClose: () => void;
  onAdd: (displayUnit: DisplayUnit, displayAmountMilli: number) => void;
  onEdit: () => void;
  onConversion: (conversion: PortionConversion) => void;
}) {
  const { snapshot } = selection;
  const [prefill] = useState(() =>
    selection.unit === undefined
      ? nutrition.prefillAmount(selection.ref, snapshot)
      : { displayUnit: selection.unit, displayAmountMilli: defaultAmountMilli(snapshot, selection.unit) },
  );
  const draft = useAmountDraft(snapshot, prefill);
  const [addingConversion, setAddingConversion] = useState(false);
  // Die Quellenangabe nennt die Quelle schon (BLS, Open Food Facts); sonst die Art der Werte.
  const source = snapshot.attribution ?? sourceNames[snapshot.source];
  // Ändern lässt sich ein eigenes oder ein BLS-Lebensmittel; ein Barcode-Produkt erst mit #160.
  const base = editableBaseOf(selection.ref);
  const missing = (['stueck', 'portion'] as const).filter((candidate) => !snapshot.portions.some((portion) => portion.unit === candidate));

  if (addingConversion && base !== undefined) {
    return <ConversionStep snapshot={snapshot} own={base.type === 'eigen'} missing={missing} onBack={() => setAddingConversion(false)} onSave={onConversion} />;
  }

  return (
    <View style={styles.sheet}>
      <View style={styles.sheetHead}>
        <View style={styles.grow}>
          <Text variant="title" accessibilityRole="header">
            {snapshot.name}
          </Text>
          <Text variant="caption" tone="inkMuted">
            {target}
          </Text>
          <Text variant="caption" tone="inkMuted">
            {source}
          </Text>
        </View>
        <IconButton icon="close" accessibilityLabel={nutritionTexts.close} onPress={onClose} />
      </View>
      <AmountFields snapshot={snapshot} draft={draft} />
      <Button
        label={nutritionTexts.add}
        block
        onPress={() => {
          const checked = draft.submit();
          if (checked !== undefined) onAdd(draft.unit, checked.amount.displayAmountMilli);
        }}
      />
      {base === undefined ? null : (
        <View style={styles.foodActions}>
          {missing.length > 0 ? (
            <Button variant="text" icon="plus" label={nutritionTexts.addConversion(missing)} onPress={() => setAddingConversion(true)} />
          ) : null}
          <Button
            variant="text"
            icon="pencil"
            label={base.type === 'eigen' ? nutritionTexts.editFood : nutritionTexts.ownFood.correct}
            onPress={onEdit}
          />
        </View>
      )}
    </View>
  );
}

/**
 * Fehlende Umrechnung eintragen (Spezifikation 2, Abschnitt 2): wie viel g bzw. ml ein Stück oder eine
 * Portion hat, optional mit Bezeichnung. Bei einem eigenen Lebensmittel wird sie dort gespeichert, bei
 * einer externen Quelle entsteht ein eigenes Lebensmittel. Die App schätzt keine Umrechnung.
 */
function ConversionStep({
  snapshot,
  own,
  missing,
  onBack,
  onSave,
}: {
  snapshot: NutritionSnapshot;
  own: boolean;
  missing: readonly ConversionUnit[];
  onBack: () => void;
  onSave: (conversion: PortionConversion) => void;
}) {
  const texts = nutritionTexts.conversion;
  const [unit, setUnit] = useState(missing[0] ?? 'stueck');
  const [amount, setAmount] = useState('');
  const [label, setLabel] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const check = checkPortionDraft(unit, snapshot.baseUnit, { amount, label });
  const amountProblem = submitted && check.type === 'probleme' ? check.problems.amount : undefined;
  const labelProblem = submitted && check.type === 'probleme' ? check.problems.label : undefined;

  return (
    <View style={styles.sheet}>
      <View style={styles.sheetHead}>
        <View style={styles.grow}>
          <Text variant="title" accessibilityRole="header">
            {texts.title}
          </Text>
          <Text variant="caption" tone="inkMuted">
            {snapshot.name}
          </Text>
        </View>
        <IconButton icon="back" accessibilityLabel={texts.back} onPress={onBack} />
      </View>
      {missing.length > 1 ? (
        <View style={styles.units}>
          {missing.map((option) => (
            <Chip key={option} label={texts.unitName(option)} selection="single" selected={option === unit} onPress={() => setUnit(option)} />
          ))}
        </View>
      ) : null}
      <TextField
        kind="number"
        label={nutritionTexts.ownFood.conversionAmount(unit)}
        unit={snapshot.baseUnit}
        value={amount}
        onChangeText={setAmount}
        problem={amountProblem === undefined ? undefined : conversionProblemText(unit, amountProblem, snapshot.baseUnit)}
      />
      <TextField
        kind="text"
        label={nutritionTexts.ownFood.conversionLabel(unit)}
        placeholder={nutritionTexts.ownFood.conversionPlaceholder(unit)}
        value={label}
        onChangeText={setLabel}
        problem={labelProblem === undefined ? undefined : ownFoodProblemText(conversionFields[unit].label, labelProblem, snapshot.baseUnit)}
      />
      <Text variant="label" tone="inkMuted">
        {texts.hint(own)}
      </Text>
      <Button
        label={nutritionTexts.ownFood.save}
        block
        onPress={() => {
          setSubmitted(true);
          if (check.type === 'umrechnung') onSave(check.conversion);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { gap: space[4] },
  sheetHead: { flexDirection: 'row', alignItems: 'flex-start', gap: space[3] },
  grow: { flex: 1, gap: space[1] },
  units: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  foodActions: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], justifyContent: 'center' },
});
