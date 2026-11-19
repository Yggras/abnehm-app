import { MealKey, type LocalDate } from '@abnehm/contracts/base';
import { roundKcal } from '@abnehm/contracts/nutrition';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Button, Chip, IconButton, ListGroup, ListRow, space, Text } from '../design';
import { AmountFields, useAmountDraft } from './AmountFields';
import type { EntryDetail } from './day-log';
import type { EntryChange } from './entries';
import {
  captureMethodNames,
  captureTargetText,
  kcalText,
  logDayText,
  macrosText,
  mealNames,
  nutritionTexts,
  referenceText,
  sourceNames,
  timeText,
} from './texts';

// Mengenansicht eines bestehenden Eintrags (Spezifikation 2, Abschnitt 6): dieselbe Mengenansicht wie beim
// Hinzufügen, dazu Mahlzeit, aufklappbare Details und „Löschen“. Der Tag eines bestehenden Eintrags ist
// nicht änderbar: Kopf und Details nennen ihn nur; Duplizieren gibt es nicht. Eine neue Menge rechnet das Modul
// aus demselben Snapshot.

const texts = nutritionTexts.edit;

export function EntryEditor({
  entry,
  today,
  onClose,
  onSave,
  onDelete,
}: {
  entry: EntryDetail;
  today: LocalDate;
  onClose: () => void;
  /** Nur mit einer Änderung; ohne Änderung schließt „Speichern“ das Sheet. */
  onSave: (change: EntryChange) => void;
  onDelete: () => void;
}) {
  const { snapshot } = entry;
  const draft = useAmountDraft(snapshot, entry);
  const [meal, setMeal] = useState<MealKey>(entry.meal);
  const [detailsShown, setDetailsShown] = useState(false);

  const save = () => {
    const checked = draft.submit();
    if (checked === undefined) return;
    const change: EntryChange = { meal, displayUnit: draft.unit, displayAmountMilli: checked.amount.displayAmountMilli };
    if (change.meal === entry.meal && change.displayUnit === entry.displayUnit && change.displayAmountMilli === entry.displayAmountMilli) onClose();
    else onSave(change);
  };

  // Der Inhalt scrollt, „Speichern“ und „Löschen“ stehen als Fuß darunter: Mit aufgeklappten Details,
  // offener Tastatur oder Schriftfaktor 2,0 bleiben sie so auf dem iPhone SE erreichbar (wie `SheetLayout`
  // im Tracker-Bereich).
  return (
    <View style={styles.sheet}>
      <ScrollView testID="sheet-scroll" style={styles.fill} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.head}>
          <View style={styles.grow}>
            <Text variant="title" accessibilityRole="header">
              {snapshot.name}
            </Text>
            <Text variant="caption" tone="inkMuted">
              {captureTargetText(entry.meal, entry.localDate, today)}
            </Text>
          </View>
          <IconButton icon="close" accessibilityLabel={nutritionTexts.close} onPress={onClose} />
        </View>
        <AmountFields snapshot={snapshot} draft={draft} />
        <View style={styles.group}>
          <Text variant="label" tone="inkMuted" importantForAccessibility="no">
            {texts.meal}
          </Text>
          <View testID="mahlzeiten" accessibilityRole="radiogroup" accessibilityLabel={texts.meal} style={styles.chips}>
            {MealKey.options.map((option) => (
              <Chip key={option} label={mealNames[option]} selection="single" selected={option === meal} onPress={() => setMeal(option)} />
            ))}
          </View>
        </View>
        <View style={styles.group}>
          <View style={styles.start}>
            <Button
              variant="text"
              label={detailsShown ? texts.hideDetails : texts.showDetails}
              onPress={() => setDetailsShown((shown) => !shown)}
            />
          </View>
          {detailsShown ? <Details entry={entry} today={today} /> : null}
        </View>
      </ScrollView>
      <View style={styles.footer}>
        <Button label={texts.save} block onPress={save} />
        <Button variant="text" label={texts.delete} block onPress={onDelete} />
      </View>
    </View>
  );
}

/** Tag, Erfassungszeitpunkt und -art, Quelle und Nährwerte je Bezugsmenge des gespeicherten Snapshots. */
function Details({ entry, today }: { entry: EntryDetail; today: LocalDate }) {
  const { snapshot } = entry;
  const per = texts.per(referenceText(snapshot));
  const rows = [
    { key: 'tag', title: texts.day, value: logDayText(entry.localDate, today) },
    { key: 'zeit', title: texts.capturedAt, value: timeText(entry.consumedAt, entry.timeZone) },
    { key: 'art', title: texts.captureMethod, value: captureMethodNames[entry.captureMethod] },
    { key: 'quelle', title: texts.source, value: snapshot.attribution ?? sourceNames[snapshot.source] },
    { key: 'werte', title: per, value: `${kcalText(roundKcal(snapshot.milliKcal))} · ${macrosText(snapshot)}` },
  ];
  return (
    <ListGroup>
      {rows.map(({ key, title, value }) => (
        <ListRow key={key} title={title} subtitle={value} accessibilityLabel={`${title}: ${value}`} />
      ))}
    </ListGroup>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  fill: { flex: 1 },
  content: { gap: space[4] },
  footer: { gap: space[2], paddingTop: space[3] },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: space[3] },
  grow: { flex: 1, gap: space[1] },
  group: { gap: space[2] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  start: { alignItems: 'flex-start' },
});
