import { Pressable, StyleSheet, type PressableProps } from 'react-native';

import { Icon } from './Icon';
import { touchSlop } from './press';
import { Text } from './Text';
import { color, radius, size, space } from './tokens';

/**
 * - `single`: eine Option aus wenigen (Zeitraum 4 Wochen · 3 Monate · Alles), ausgewählt mit Häkchen;
 * - `multiple`: Mehrfachauswahl wie Sporttage;
 * - `action`: Schnellwahl oder Kurzbotschaft, löst direkt etwas aus.
 */
export type ChipSelection = 'single' | 'multiple' | 'action';

export type ChipProps = Pick<PressableProps, 'testOnly_pressed'> & {
  label: string;
  onPress: () => void;
  selection?: ChipSelection;
  /** Nur bei `single` und `multiple`. */
  selected?: boolean;
  disabled?: boolean;
  /** Quadratisch (44 dp breit) für Wochentage. */
  square?: boolean;
  /** Ausführlicher Name für Screenreader, etwa „Montag“ zum Chip „Mo“. */
  accessibilityLabel?: string;
};

const roles = { single: 'radio', multiple: 'checkbox', action: 'button' } as const;
const borderWidth = { resting: 1.5, selected: 2 };
const squareWidth = size.buttonHeightCompact;

/**
 * Chip nach dem Design-System. Ausgewählt heißt immer Fläche, 2-dp-Rahmen und – außer bei
 * quadratischen Chips – Häkchen, nie nur Farbe.
 */
export function Chip({
  label,
  onPress,
  selection = 'action',
  selected = false,
  disabled = false,
  square = false,
  accessibilityLabel,
  testOnly_pressed,
}: ChipProps) {
  const isSelected = selection !== 'action' && selected;
  return (
    <Pressable
      accessibilityRole={roles[selection]}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled, ...(selection === 'action' ? {} : { checked: isSelected }) }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={touchSlop(size.chipHeight, square ? squareWidth : size.touchMin)}
      testOnly_pressed={testOnly_pressed}
      style={({ pressed }) => [
        styles.chip,
        square ? styles.square : styles.pill,
        disabled
          ? styles.disabled
          : isSelected
            ? styles.selected
            : [styles.resting, pressed && { backgroundColor: color.surfaceSunken }],
      ]}
    >
      {isSelected && !square ? <Icon name="check" size="sm" tone="primary" /> : null}
      <Text variant="label" tone={disabled ? 'inkDisabled' : isSelected ? 'primary' : 'ink'} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: size.chipHeight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[1],
    borderRadius: radius.pill,
  },
  pill: { minWidth: size.touchMin, paddingHorizontal: space[3] },
  square: { width: squareWidth, minWidth: squareWidth },
  resting: { backgroundColor: color.surfaceCard, borderWidth: borderWidth.resting, borderColor: color.lineStrong },
  selected: { backgroundColor: color.primarySoft, borderWidth: borderWidth.selected, borderColor: color.primary },
  disabled: { backgroundColor: color.fillDisabled },
});
