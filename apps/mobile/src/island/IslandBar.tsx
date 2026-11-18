import { Pressable, StyleSheet, View } from 'react-native';

import { boxShadow, Button, color, Icon, pressedEdge, radius, size, space, Text, textScale, type IconName } from '../design';
import type { TargetOf } from '../navigation';
import { buildTexts, islandTexts } from './texts';

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

export type BuildModeBarProps = {
  /** Was gerade gesetzt wird, etwa „Laterne bauen“ oder „Laterne umstellen“. */
  title: string;
  onCancel: () => void;
};

/**
 * Leiste im Bau-Modus anstelle der Einstiege (#192): was gebaut oder umgestellt wird (#194), wie es geht,
 * und „Abbrechen“, das jederzeit erreichbar ist (Spezifikation 4, Abschnitt 7). Der Hinweis wird angesagt,
 * sobald der Modus beginnt.
 */
export function BuildModeBar({ title, onCancel }: BuildModeBarProps) {
  return (
    <View style={styles.building}>
      <View style={styles.buildingText} accessible accessibilityLiveRegion="polite" accessibilityLabel={`${title}. ${buildTexts.placingHint}`}>
        <Text variant="headline">{title}</Text>
        <Text variant="label" tone="inkMuted">
          {buildTexts.placingHint}
        </Text>
      </View>
      <Button variant="secondary" label={buildTexts.cancel} onPress={onCancel} />
    </View>
  );
}

const styles = StyleSheet.create({
  building: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space[3],
    padding: space[3],
    borderRadius: radius.md,
    backgroundColor: color.surfaceCard,
    boxShadow: boxShadow.card,
  },
  buildingText: { flexGrow: 1, flexShrink: 1, flexBasis: 160, gap: space[1] },
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
