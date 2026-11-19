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
  /**
   * Beschriftung über der Bedienung, „−“ und „+“ an den Rändern: für Beschriftungen, die neben der
   * Bedienung im Wort umbrächen, etwa „Kalorienbudget pro Tag“ auf dem iPhone SE (Impeccable-critique, #143).
   */
  stacked?: boolean;
};

/**
 * Stepper aus den Tokens und `IconButton` des Design-Systems. `research/design-system.md` kennt keinen
 * Stepper; Aufbau und Verhalten sind Designwerte ohne Beleg (#147). Beschriftung, daneben, bei großer
 * Schrift oder mit `stacked` darunter, die Bedienung aus „−“, Wert und „+“ als runde 48-dp-Buttons; ein Hinweis steht darunter. An einer Grenze ist
 * die Richtung gesperrt, statt den Wert zu beschneiden. Die Buttons heißen „<Beschriftung> verringern“ und „<Beschriftung> erhöhen“; der Wert
 * trägt Beschriftung und Wert als Namen.
 */
export function Stepper({ label, value, valueText, min, max, step, onChange, hint, stacked = false }: StepperProps) {
  const large = useLargeTextLayout();
  return (
    <View style={styles.container}>
      <View style={[styles.row, (large || stacked) && styles.stacked]}>
        <Text style={styles.label}>{label}</Text>
        <View style={[styles.controls, stacked && styles.spread]}>
          <IconButton icon="minus" accessibilityLabel={`${label} verringern`} disabled={value - step < min} onPress={() => onChange(value - step)} />
          <Text variant={stacked ? 'title' : 'bodyStrong'} style={styles.value} accessibilityLabel={`${label}: ${valueText}`} accessibilityLiveRegion="polite">
            {valueText}
          </Text>
          <IconButton icon="plus" accessibilityLabel={`${label} erhöhen`} disabled={value + step > max} onPress={() => onChange(value + step)} />
        </View>
      </View>
      {/* Der Hinweis steht unter der ganzen Zeile; neben den Buttons bräche er auf schmalen Geräten vielfach um (iPhone SE, #147). */}
      {hint ? (
        <Text variant="label" tone="inkMuted">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

/** Platz für den Wert, damit die Buttons beim Zählen nicht springen (Designwert, nicht belegt). */
const valueMinWidth = 88;

const styles = StyleSheet.create({
  container: { gap: space[1], paddingVertical: space[2], paddingHorizontal: space[4], backgroundColor: color.surfaceCard },
  row: { minHeight: size.rowMin, flexDirection: 'row', alignItems: 'center', gap: space[3] },
  stacked: { flexDirection: 'column', alignItems: 'stretch' },
  label: { flex: 1 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: space[2] },
  spread: { justifyContent: 'space-between' },
  value: { minWidth: valueMinWidth, textAlign: 'center' },
});
