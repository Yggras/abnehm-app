import { StyleSheet, View } from 'react-native';

import { Button, EnergySymbol, space, Text } from '../design';
import type { ObjectSheetContent } from './object-options';
import { ObjectPreview } from './ObjectPreview';
import { objectTexts } from './texts';

// Inhalt des Objekt-Sheets (Spezifikation 4, Abschnitt 7; #194): Ein eigenes Objekt bietet Aufwerten mit
// Preis, Umstellen und Einlagern; ein Objekt des Partners zeigt nur, wer es gebaut hat, und die Stufe.
// Was nicht geht, steht neutral da, statt eines deaktivierten Knopfs (Design-System › Button): zu wenig
// Energie als „Noch ‹n› Energie“, kein freies Feld als Satz.

export type ObjectSheetProps = Readonly<{
  sheet: ObjectSheetContent;
  onUpgrade(): void;
  onMove(): void;
  onStore(): void;
}>;

export function ObjectSheet({ sheet, onUpgrade, onMove, onStore }: ObjectSheetProps) {
  return (
    <View style={styles.sheet}>
      <View style={styles.header}>
        <ObjectPreview art={sheet.art} />
        <View style={styles.title}>
          <Text variant="title" accessibilityRole="header">
            {sheet.name}
          </Text>
          <Text tone="inkMuted">{subtitleOf(sheet)}</Text>
        </View>
      </View>
      {sheet.type === 'eigen' && (
        <View style={styles.actions}>
          {sheet.upgrade.type === 'moeglich' && (
            <Button block label={objectTexts.upgrade(sheet.upgrade.toLevel, sheet.upgrade.price)} onPress={onUpgrade} />
          )}
          {sheet.upgrade.type === 'zu_teuer' && (
            <View style={styles.note}>
              <EnergySymbol size="sm" />
              <Text variant="label" tone="inkMuted" style={styles.noteText}>
                {objectTexts.upgradeTooExpensive(sheet.upgrade.toLevel, sheet.upgrade.price, sheet.upgrade.missing)}
              </Text>
            </View>
          )}
          {sheet.upgrade.type === 'hoechste_stufe' && (
            <Text variant="label" tone="inkMuted">
              {objectTexts.highestLevel}
            </Text>
          )}
          {sheet.canMove ? (
            <Button block variant="secondary" label={objectTexts.move} onPress={onMove} />
          ) : (
            <Text variant="label" tone="inkMuted">
              {objectTexts.noFreeField}
            </Text>
          )}
          <Button block variant="secondary" label={objectTexts.store} onPress={onStore} />
        </View>
      )}
    </View>
  );
}

function subtitleOf(sheet: ObjectSheetContent): string {
  if (sheet.type === 'partner') return sheet.origin === 'gebaut' ? objectTexts.builtBy(sheet.partnerName, sheet.level) : objectTexts.dekoFrom(sheet.partnerName);
  return sheet.origin === 'gebaut' ? objectTexts.level(sheet.level) : objectTexts.kind.deko;
}

const styles = StyleSheet.create({
  sheet: { gap: space[4] },
  header: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  title: { flex: 1, gap: space[1] },
  actions: { gap: space[3] },
  note: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  noteText: { flexShrink: 1 },
});
