import { Canvas } from '@shopify/react-native-skia';
import { Pressable, StyleSheet, View } from 'react-native';

import { color, EnergySymbol, pressedEdge, radius, size, space, Text, boxShadow } from '../design';
import type { BlueprintOption } from './build-options';
import { ObjectArt } from './IslandArt';
import { buildTexts } from './texts';

// Inhalt des Bau-Sheets (Spezifikation 4, Abschnitt 7; #192): die passenden Baupläne mit Vorschau und
// Preis. Ist ein Bauplan zu teuer, steht dort neutral „Noch ‹n› Energie“, und er lässt sich nicht wählen.
// Der Container ist das gemeinsame Sheet des Tabs „Momo“ (`HatchedIslandScreen`).

export type BuildSheetProps = Readonly<{
  /** Nach Tipp auf ein freies eigenes Feld; sonst über „Bauen“. */
  onField: boolean;
  /** Angezeigte eigene Energie. */
  energy: number;
  options: readonly BlueprintOption[];
  onChoose(option: BlueprintOption): void;
}>;

export function BuildSheet({ onField, energy, options, onChoose }: BuildSheetProps) {
  return (
    <View style={styles.sheet}>
      <View style={styles.header}>
        <Text variant="title" accessibilityRole="header">
          {onField ? buildTexts.titleOnField : buildTexts.title}
        </Text>
        <View style={styles.energy}>
          <EnergySymbol size="sm" />
          <Text variant="label" tone="inkMuted">
            {buildTexts.energy(energy)}
          </Text>
        </View>
      </View>
      {options.length === 0 ? (
        <Text tone="inkMuted">{buildTexts.noFreeField}</Text>
      ) : (
        <View style={styles.list}>
          {options.map((option) => (
            <BlueprintRow key={option.key} option={option} onPress={() => onChoose(option)} />
          ))}
        </View>
      )}
    </View>
  );
}

/** Seitenlänge der Vorschau: ein Feld breit, damit die Grafik so groß wie auf der Insel bei Zoom 1 erscheint. */
const preview = size.islandTile;

function BlueprintRow({ option, onPress }: { option: BlueprintOption; onPress(): void }) {
  const affordable = option.missing === 0;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={buildTexts.option(option.name, option.price, option.missing)}
      accessibilityState={{ disabled: !affordable }}
      disabled={!affordable}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed ? { backgroundColor: color.surfaceSunken, ...pressedEdge('card', 'cardPressed') } : null]}
    >
      <View style={styles.preview}>
        <Canvas style={styles.previewCanvas}>
          {/* Der Fuß der Grafik steht auf der unteren Feldecke, damit auch hohe Objekte ganz zu sehen sind. */}
          <ObjectArt at={{ x: preview / 2, y: preview - space[3] }} art={option.art} foliage="islandFoliage" />
        </Canvas>
      </View>
      <Text variant="bodyStrong" style={styles.name}>
        {option.name}
      </Text>
      {affordable ? (
        <View style={styles.price}>
          <EnergySymbol size="sm" />
          <Text variant="label">{buildTexts.price(option.price)}</Text>
        </View>
      ) : (
        <Text variant="label" tone="inkMuted" style={styles.missing}>
          {buildTexts.missing(option.missing)}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sheet: { gap: space[4] },
  header: { gap: space[1] },
  energy: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  list: { gap: space[2] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space[3],
    minWidth: size.touchMin,
    minHeight: size.touchMin,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    borderRadius: radius.md,
    backgroundColor: color.surfaceCard,
    boxShadow: boxShadow.card,
  },
  preview: { width: preview, height: preview, borderRadius: radius.md, backgroundColor: color.islandGrass, overflow: 'hidden' },
  previewCanvas: { width: preview, height: preview },
  name: { flexGrow: 1, flexShrink: 1 },
  price: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  missing: { textAlign: 'right' },
});
