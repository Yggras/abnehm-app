import { StyleSheet, View } from 'react-native';

import { Icon } from './Icon';
import { Text } from './Text';
import { space } from './tokens';

export type ProblemMessageProps = {
  /** Der Satz mit Lösungsweg, etwa „Bitte eine Art wählen.“ */
  text: string;
  /**
   * Gehört der Satz zu einem Feld, das ihn schon als Hinweis vorliest (`TextField`), hören Screenreader ihn
   * nicht ein zweites Mal als Text.
   */
  hiddenFromScreenReader?: boolean;
};

/**
 * Ungültige Eingabe nach dem Design-System: Ausrufezeichen und Satz mit Lösungsweg in `problem`, nie nur
 * Farbe (research/design-system.md, Zustand „Problem“). Unter einem Feld oder unter einer Auswahl.
 */
export function ProblemMessage({ text, hiddenFromScreenReader = false }: ProblemMessageProps) {
  return (
    <View
      style={styles.message}
      accessible={!hiddenFromScreenReader}
      accessibilityLabel={hiddenFromScreenReader ? undefined : text}
      accessibilityElementsHidden={hiddenFromScreenReader}
      importantForAccessibility={hiddenFromScreenReader ? 'no-hide-descendants' : 'yes'}
    >
      <Icon name="alert" size="sm" tone="problem" />
      <Text variant="label" tone="problem" style={styles.text}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  message: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  text: { flex: 1 },
});
