import { StyleSheet, View } from 'react-native';

import { IconButton } from './Button';
import { Text } from './Text';
import { useLargeTextLayout } from './text-scale';
import { color, size, space } from './tokens';

export type StepperProps = {
  /** Sichtbare Beschriftung links; zugleich Anfang der zugänglichen Namen. */
  label: string;
  value: number;
  /** Der Wert, wie er dasteht, etwa „1,5 l“. */
  valueText: string;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  /** Kurzer Hinweis unter der Beschriftung, etwa zum Mehrbedarf. */
  hint?: string;
};

/**
 * Stepper aus den Tokens und `IconButton` des Design-Systems. `research/design-system.md` kennt keinen
 * Stepper; Aufbau und Verhalten sind Designwerte ohne Beleg (#147). Beschriftung, daneben, bei großer
 * Schrift darunter, die Bedienung aus „−“, Wert und „+“ als runde 48-dp-Buttons. An einer Grenze ist
 * die Richtung gesperrt, statt den Wert zu beschneiden. Die Buttons heißen „<Beschriftung> verringern“ und „<Beschriftung> erhöhen“; der Wert
 * trägt Beschriftung und Wert als Namen.
 */
export function Stepper({ label, value, valueText, min, max, step, onChange, hint }: StepperProps) {
  const large = useLargeTextLayout();
  return (
    <View style={[styles.row, large && styles.stacked]}>
      <View style={styles.main}>
        <Text>{label}</Text>
        {hint ? (
          <Text variant="label" tone="inkMuted">
            {hint}
          </Text>
        ) : null}
      </View>
      <View style={styles.controls}>
        <IconButton icon="minus" accessibilityLabel={`${label} verringern`} disabled={value - step < min} onPress={() => onChange(value - step)} />
        <Text variant="bodyStrong" style={styles.value} accessibilityLabel={`${label}: ${valueText}`} accessibilityLiveRegion="polite">
          {valueText}
        </Text>
        <IconButton icon="plus" accessibilityLabel={`${label} erhöhen`} disabled={value + step > max} onPress={() => onChange(value + step)} />
      </View>
    </View>
  );
}

/** Platz für den Wert, damit die Buttons beim Zählen nicht springen (Designwert, nicht belegt). */
const valueMinWidth = 88;

const styles = StyleSheet.create({
  row: {
    minHeight: size.rowMin,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingVertical: space[2],
    paddingHorizontal: space[4],
    backgroundColor: color.surfaceCard,
  },
  stacked: { flexDirection: 'column', alignItems: 'stretch' },
  main: { flex: 1, gap: space[1] },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: space[2] },
  value: { minWidth: valueMinWidth, textAlign: 'center' },
});
