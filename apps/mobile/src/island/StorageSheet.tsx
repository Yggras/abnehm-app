import { ScrollView, StyleSheet, View } from 'react-native';

import { boxShadow, Button, color, radius, size, space, Text } from '../design';
import type { StorageItem, StorageKind } from './object-options';
import { ObjectPreview } from './ObjectPreview';
import { objectTexts } from './texts';

// Inhalt des Lager-Sheets (Spezifikation 4, Abschnitt 7; #194), geöffnet über „Lager“ in der Leiste:
// eingelagerte und verdrängte Objekte, Geschenke, Challenge-Deko und Deko, jeweils mit „Platzieren“.
// Platzieren startet den Modus, in dem die passenden freien eigenen Felder leuchten; es ist kostenlos.
// Gibt es kein passendes freies Feld, steht das neutral in der Zeile. Wie das Bau-Sheet in voller Höhe mit
// scrollender Liste (#192).

export type StorageSheetProps = Readonly<{
  items: readonly StorageItem[];
  onPlace(item: StorageItem): void;
}>;

export function StorageSheet({ items, onPlace }: StorageSheetProps) {
  return (
    <View style={styles.sheet}>
      <Text variant="title" accessibilityRole="header">
        {objectTexts.storageTitle}
      </Text>
      {items.length === 0 ? (
        <Text tone="inkMuted">{objectTexts.storageEmpty}</Text>
      ) : (
        <ScrollView testID="lager" style={styles.scroll} contentContainerStyle={styles.list}>
          {items.map((item) => (
            <View key={item.id} style={styles.row}>
              <ObjectPreview art={item.art} />
              <View style={styles.text}>
                <Text variant="bodyStrong">{item.name}</Text>
                <Text variant="label" tone="inkMuted">
                  {kindText(item.kind)}
                </Text>
              </View>
              {item.canPlace ? (
                <Button compact variant="secondary" label={objectTexts.place} accessibilityLabel={objectTexts.placeItem(item.name)} onPress={() => onPlace(item)} />
              ) : (
                <Text variant="label" tone="inkMuted" style={styles.noField}>
                  {objectTexts.noFieldForItem}
                </Text>
              )}
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function kindText(kind: StorageKind): string {
  switch (kind.type) {
    case 'gebaut':
      return objectTexts.kind.gebaut(kind.level);
    case 'geschenk':
      return objectTexts.kind.geschenk(kind.from);
    case 'challenge':
      return objectTexts.kind.challenge;
    case 'deko':
      return objectTexts.kind.deko;
  }
}

const styles = StyleSheet.create({
  sheet: { flex: 1, gap: space[4] },
  scroll: { flex: 1 },
  // Platz unten für die Sockelkante der letzten Zeile (`boxShadow` zählt nicht zur Höhe).
  list: { gap: space[2], paddingBottom: size.plinthDepth },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space[3],
    minHeight: size.touchMin,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    borderRadius: radius.md,
    backgroundColor: color.surfaceCard,
    boxShadow: boxShadow.card,
  },
  text: { flexGrow: 1, flexShrink: 1, flexBasis: 120, gap: space[1] },
  noField: { textAlign: 'right' },
});
