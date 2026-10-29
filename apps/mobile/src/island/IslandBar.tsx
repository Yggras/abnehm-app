import { Pressable, StyleSheet, View } from 'react-native';

import { boxShadow, color, Icon, pressedEdge, radius, size, space, Text, textScale, type IconName } from '../design';
import type { TargetOf } from '../navigation';
import { islandTexts } from './texts';

/** Ansichten des Tabs „Momo“, die die Leiste öffnet: Werte des Parameters `view` der Route `momo`. */
export type IslandEntry = Extract<NonNullable<TargetOf<'momo'>['view']>, 'lager' | 'projekt' | 'bauen' | 'ereignisse'>;

const entries: readonly { view: IslandEntry; icon: IconName }[] = [
  { view: 'lager', icon: 'box' },
  { view: 'projekt', icon: 'flag' },
  { view: 'bauen', icon: 'hammer' },
  { view: 'ereignisse', icon: 'star' },
];

export type IslandBarProps = {
  onOpen: (view: IslandEntry) => void;
};

/**
 * Leiste unten auf der Insel (Spezifikation 4, Abschnitt 7): Lager · Projekt · **Bauen** · Ereignisse.
 * „Bauen“ ist die einzige Primäraktion. Die Beschriftungen wachsen wie die der Tab-Leiste nur bis
 * Faktor 1,3, das Icon trägt die Bedeutung mit (Impeccable-Prüfung, B12). Hinweise auf neue
 * Ereignisse liefert #203.
 */
export function IslandBar({ onOpen }: IslandBarProps) {
  return (
    <View style={styles.bar}>
      {entries.map(({ view, icon }) => {
        const primary = view === 'bauen';
        return (
          <Pressable
            key={view}
            accessibilityRole="button"
            accessibilityLabel={islandTexts.entries[view]}
            onPress={() => onOpen(view)}
            style={({ pressed }) => [
              styles.entry,
              primary && styles.primaryEntry,
              primary
                ? pressed
                  ? { backgroundColor: color.primaryPressed, ...pressedEdge('button', 'buttonPressed') }
                  : { backgroundColor: color.primary, boxShadow: boxShadow.button }
                : pressed
                  ? { backgroundColor: color.surfaceSunken, ...pressedEdge('card', 'cardPressed') }
                  : { backgroundColor: color.surfaceCard, boxShadow: boxShadow.card },
            ]}
          >
            <Icon name={icon} size="md" tone={primary ? 'onPrimary' : 'ink'} />
            <Text
              variant="label"
              tone={primary ? 'onPrimary' : 'ink'}
              numberOfLines={1}
              adjustsFontSizeToFit
              maxFontSizeMultiplier={textScale.limit.tabLabel}
            >
              {islandTexts.entries[view]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'flex-end', gap: space[2] },
  entry: {
    flex: 1,
    minWidth: size.touchMin,
    minHeight: size.touchMin + space[4],
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[1],
    paddingHorizontal: space[1],
    paddingVertical: space[2],
    borderRadius: radius.md,
  },
  primaryEntry: { flex: 1.3, minHeight: size.touchMin + space[6] },
});
