import { StyleSheet, View } from 'react-native';

import { Icon } from './Icon';
import { Text } from './Text';
import { color, radius, size, space } from './tokens';

export type ProgressBarProps = {
  /** Name für Screenreader, etwa „Wasser heute“ oder „Sport diese Woche“. */
  label: string;
  value: number;
  target: number;
  /** Wert und Ziel als deutscher Text, etwa „1,0 von 1,5 l“; über dem Ziel läuft er weiter. */
  valueText: string;
};

/**
 * Fortschrittsanzeige für eigene Werte (Füllung `self`). Ist das Ziel erreicht, sagen Häkchen und
 * „erreicht“ es zusätzlich zur vollen Spur; über dem Ziel bleibt der Balken voll.
 */
export function ProgressBar({ label, value, target, valueText }: ProgressBarProps) {
  const reached = target > 0 && value >= target;
  const share = target > 0 ? Math.min(Math.max(value / target, 0), 1) : 0;
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{
        min: 0,
        max: target,
        now: Math.min(Math.max(value, 0), target),
        text: reached ? `${valueText}, erreicht` : valueText,
      }}
      style={styles.progress}
    >
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${share * 100}%` }]} />
      </View>
      <View style={styles.legend}>
        {reached ? (
          <View style={styles.reached}>
            <Icon name="check" size="sm" tone="success" />
            <Text variant="label" tone="success">
              erreicht
            </Text>
          </View>
        ) : null}
        <Text variant="label" style={styles.value}>
          {valueText}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  progress: { gap: space[2] },
  track: { height: size.barHeight, borderRadius: radius.pill, backgroundColor: color.surfaceSunken, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radius.pill, backgroundColor: color.self },
  legend: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: space[2] },
  reached: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  value: { textAlign: 'right' },
});
