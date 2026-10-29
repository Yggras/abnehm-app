import { Pressable, StyleSheet, View } from 'react-native';

import { boxShadow, color, Icon, pressedEdge, radius, size, space, Text, textScale, type IconName } from '../design';
import { islandTexts } from './texts';

/** Ansichten des Tabs „Momo“, die die Leiste öffnet (Route `momo`, Parameter `view`). */
export type IslandEntry = 'lager' | 'projekt' | 'bauen' | 'ereignisse';

const entries: readonly { view: IslandEntry; icon: IconName }[] = [
  { view: 'lager', icon: 'box' },
  { view: 'projekt', icon: 'flag' },
  { view: 'bauen', icon: 'hammer' },
  { view: 'ereignisse', icon: 'star' },
];

export type IslandBarProps = {
  /** Für die Person neue Ereignisse; die Zahl steht am Einstieg „Ereignisse“. */
  newEvents: number;
  onOpen: (view: IslandEntry) => void;
};

/**
 * Leiste unten auf der Insel (Spezifikation 4, Abschnitt 7): Lager · Projekt · **Bauen** · Ereignisse.
 * „Bauen“ ist die einzige Primäraktion. Die Beschriftungen wachsen wie die der Tab-Leiste nur bis
 * Faktor 1,3, das Icon trägt die Bedeutung mit (Impeccable-Prüfung, B12).
 */
export function IslandBar({ newEvents, onOpen }: IslandBarProps) {
  return (
    <View style={styles.bar}>
      {entries.map(({ view, icon }) => {
        const primary = view === 'bauen';
        const count = view === 'ereignisse' && newEvents > 0 ? newEvents : 0;
        return (
          <Pressable
            key={view}
            accessibilityRole="button"
            accessibilityLabel={count > 0 ? islandTexts.newEvents(count) : islandTexts.entries[view]}
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
            {count > 0 ? (
              <View style={styles.count}>
                <Text variant="caption" tone="onPrimary" maxFontSizeMultiplier={textScale.limit.tabLabel}>
                  {String(count)}
                </Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const countSize = 20;

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
  count: {
    position: 'absolute',
    top: -space[2],
    right: -space[1],
    minWidth: countSize,
    height: countSize,
    borderRadius: countSize / 2,
    paddingHorizontal: space[1],
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.hint,
  },
});
