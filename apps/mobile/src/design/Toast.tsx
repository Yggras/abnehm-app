import { Pressable, StyleSheet, View, type PressableProps } from 'react-native';

import { boxShadow } from './elevation';
import { EnergySymbol, Icon } from './Icon';
import { touchSlop } from './press';
import { Text } from './Text';
import { useLargeTextLayout } from './text-scale';
import { color, radius, size, space } from './tokens';

/** Eine Zeile der Meldung; `energy` setzt das Energie-Symbol davor („Wasserziel erfüllt · +1 Energie“). */
export type ToastLine = { text: string; energy?: boolean };

export type ToastProps = Pick<PressableProps, 'testOnly_pressed'> & {
  line: ToastLine;
  /** Spielreaktion, die der Meldungs-Host an eine Meldung mit „Rückgängig“ anhängt. */
  secondLine?: ToastLine;
  /** „Rückgängig“ der bestätigten Buchung. */
  onUndo?: () => void;
};

function Line({ line }: { line: ToastLine }) {
  return (
    <View style={styles.line}>
      {line.energy ? <EnergySymbol /> : null}
      <Text variant="body" tone="onInverse" style={styles.lineText}>
        {line.text}
      </Text>
    </View>
  );
}

/**
 * Meldung („Toast“) nach dem Design-System: dunkle Fläche über der Tab-Leiste. Sie zeigt nur an;
 * Standzeit, Ansage und das Ersetzen mehrerer Meldungen besitzt der Meldungs-Host der App-Shell.
 */
export function Toast({ line, secondLine, onUndo, testOnly_pressed }: ToastProps) {
  // Ab Schriftfaktor 1,3 steht „Rückgängig“ unter dem Text, sonst rechts daneben.
  const stacked = useLargeTextLayout();
  return (
    <View style={[styles.toast, stacked && styles.stacked]}>
      <View style={styles.lines}>
        <Line line={line} />
        {secondLine ? <Line line={secondLine} /> : null}
      </View>
      {onUndo ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Rückgängig"
          onPress={onUndo}
          hitSlop={touchSlop(size.buttonHeightCompact)}
          testOnly_pressed={testOnly_pressed}
          style={({ pressed }) => [styles.undo, pressed && styles.undoPressed]}
        >
          <Icon name="undo" tone="onInverse" />
          <Text variant="button" tone="onInverse">
            Rückgängig
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  toast: {
    minHeight: size.buttonHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    paddingVertical: space[1],
    paddingLeft: space[4],
    paddingRight: space[2],
    borderRadius: radius.md,
    backgroundColor: color.surfaceInverse,
    boxShadow: boxShadow.toast,
  },
  stacked: { flexDirection: 'column', alignItems: 'flex-start' },
  lines: { flexShrink: 1, flexGrow: 1, gap: space[1], paddingVertical: space[2] },
  line: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  lineText: { flexShrink: 1 },
  undo: {
    minHeight: size.buttonHeightCompact,
    minWidth: size.touchMin,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    paddingHorizontal: space[3],
    borderRadius: radius.pill,
  },
  // Auf `surface-inverse` gibt es keinen dunkleren Ton; gedrückt zeigt die Fläche dunkles Lagunengrün.
  undoPressed: { backgroundColor: color.primaryPressed },
});
