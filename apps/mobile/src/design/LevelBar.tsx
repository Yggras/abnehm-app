import { Pressable, StyleSheet, View } from 'react-native';

import { boxShadow } from './elevation';
import { Icon } from './Icon';
import { Text } from './Text';
import { color, radius, size, space } from './tokens';

export type LevelBarProps = {
  level: number;
  /** Eigene Hälfte in Prozent, abgerundet (`halfPercent`). */
  ownPercent: number;
  partnerPercent: number;
  partnerName: string;
  /**
   * Macht den Balken antippbar, etwa um zu erklären, wie das Level wächst. `actionLabel` steht dann
   * sichtbar zwischen den Namen, damit man sieht, dass der Balken etwas öffnet; Screenreader hören es als Hinweis.
   */
  action?: Readonly<{ label: string; onPress: () => void }>;
};

const badgeSize = 32;

/**
 * Levelbalken 50/50 (Design-System, Komponente „Levelbalken“): links die eigene Hälfte „Du“ in
 * `self`, rechts die des Partners in `partner`, beide füllen sich von außen zur Mitte, das Level steht
 * als Abzeichen in der Mitte. Keine Prozentzahlen nebeneinander, keine Rückstandsanzeige; den
 * eigenen Stand hören Screenreader.
 */
export function LevelBar({ level, ownPercent, partnerPercent, partnerName, action }: LevelBarProps) {
  const Root = action === undefined ? View : Pressable;
  return (
    <Root
      onPress={action?.onPress}
      accessibilityHint={action?.label}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`Level ${level}`}
      accessibilityValue={{
        min: 0,
        max: 100,
        now: ownPercent,
        text: ownPercent === 100 ? 'Deine Hälfte ist voll' : `Deine Hälfte zu ${ownPercent} Prozent gefüllt`,
      }}
      style={styles.levelBar}
    >
      <View style={styles.track}>
        <View style={styles.half}>
          <View testID="levelbar-eigen" style={[styles.fill, styles.own, { width: `${ownPercent}%` }]} />
        </View>
        <View style={styles.badge}>
          <Text variant="headline">{level}</Text>
        </View>
        <View style={styles.half}>
          <View testID="levelbar-partner" style={[styles.fill, styles.partner, { width: `${partnerPercent}%` }]} />
        </View>
      </View>
      <View style={styles.names}>
        <Text variant="label">Du</Text>
        {action !== undefined && (
          <View style={styles.action}>
            <Icon name="info" size="sm" tone="primary" />
            <Text variant="label" tone="primary" numberOfLines={1}>
              {action.label}
            </Text>
          </View>
        )}
        <Text variant="label" numberOfLines={1} style={styles.partnerName}>
          {partnerName}
        </Text>
      </View>
    </Root>
  );
}

const styles = StyleSheet.create({
  levelBar: { gap: space[1] },
  track: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  half: { flex: 1, height: size.levelbarHeight, borderRadius: radius.pill, backgroundColor: color.surfaceSunken, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radius.pill },
  own: { backgroundColor: color.self },
  // Die Hälfte des Partners füllt sich von rechts zur Mitte.
  partner: { alignSelf: 'flex-end', backgroundColor: color.partner },
  badge: {
    minWidth: badgeSize,
    height: badgeSize,
    borderRadius: badgeSize / 2,
    paddingHorizontal: space[1],
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.surfaceCard,
    boxShadow: boxShadow.buttonSoft,
  },
  names: { flexDirection: 'row', justifyContent: 'space-between', gap: space[2] },
  partnerName: { flexShrink: 1, textAlign: 'right' },
  action: { flexDirection: 'row', alignItems: 'center', gap: space[1], flexShrink: 1 },
});
