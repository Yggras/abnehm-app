import { Pressable, StyleSheet, View, type PressableProps, type ViewStyle } from 'react-native';

import { boxShadow } from './elevation';
import { Icon, type IconName } from './Icon';
import { pressedEdge, touchSlop } from './press';
import { Text, type TextTone } from './Text';
import { color, radius, size, space } from './tokens';

type ButtonVariant = 'primary' | 'secondary' | 'text';

type Look = {
  surface: keyof typeof color | 'transparent';
  label: TextTone;
  /** Sockelkante in Ruhe bzw. gedrückt samt Einsinken. */
  edge?: ViewStyle;
};

// Fläche, Beschriftung und Sockelkante je Variante in Ruhe und gedrückt (Komponente „Button“).
const looks: Record<ButtonVariant, { resting: Look; pressed: Look }> = {
  primary: {
    resting: { surface: 'primary', label: 'onPrimary', edge: { boxShadow: boxShadow.button } },
    pressed: { surface: 'primaryPressed', label: 'onPrimary', edge: pressedEdge('button', 'buttonPressed') },
  },
  secondary: {
    resting: { surface: 'primarySoft', label: 'primary', edge: { boxShadow: boxShadow.buttonSoft } },
    pressed: { surface: 'primarySoftPressed', label: 'primaryPressed', edge: pressedEdge('buttonSoft', 'buttonSoftPressed') },
  },
  text: {
    resting: { surface: 'transparent', label: 'primary' },
    pressed: { surface: 'primarySoft', label: 'primaryPressed' },
  },
};

const disabledLook = (variant: ButtonVariant): Look => ({
  surface: variant === 'text' ? 'transparent' : 'fillDisabled',
  label: 'inkDisabled',
});

function lookStyle(look: Look): ViewStyle {
  return { backgroundColor: look.surface === 'transparent' ? 'transparent' : color[look.surface], ...look.edge };
}

type PressState = Pick<PressableProps, 'testOnly_pressed'>;

export type ButtonProps = PressState & {
  label: string;
  onPress: () => void;
  /** Primär (höchstens eine je Bildschirm), Sekundär für Direktaktionen, Text für Nebenaktionen. */
  variant?: ButtonVariant;
  /** Kompakt (44 dp) in Mini-Trackern und Karten; die Trefferfläche bleibt 48 dp. */
  compact?: boolean;
  icon?: IconName;
  /** Deaktiviert nur, wenn der Grund daneben steht („Braucht Internet“); lieber ausblenden. */
  disabled?: boolean;
  /** Drei Punkte statt Beschriftung; die Breite bleibt, Screenreader hören weiter die Beschriftung. */
  loading?: boolean;
  /** Volle Breite. */
  block?: boolean;
  /**
   * Schmaler Seitenabstand für die schmalen Spalten der Mini-Tracker: So passt „+250 ml“ auf dem
   * iPhone SE einzeilig, wenn drei nebeneinander stehen (#171). Nur zusammen mit `block` sinnvoll.
   */
  dense?: boolean;
  /** Ausführlicher Name für Screenreader, wenn die Beschriftung allein nicht reicht. */
  accessibilityLabel?: string;
};

/** Button nach dem Design-System: Pille mit Sockelkante, beim Drücken sinkt er ein. */
export function Button({
  label,
  onPress,
  variant = 'primary',
  compact = false,
  icon,
  disabled = false,
  loading = false,
  block = false,
  dense = false,
  accessibilityLabel,
  testOnly_pressed,
}: ButtonProps) {
  const visibleHeight = compact ? size.buttonHeightCompact : size.buttonHeight;
  const lookFor = (pressed: boolean) =>
    disabled ? disabledLook(variant) : looks[variant][pressed ? 'pressed' : 'resting'];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled, busy: loading }}
      disabled={disabled || loading}
      onPress={onPress}
      hitSlop={touchSlop(visibleHeight)}
      testOnly_pressed={testOnly_pressed}
      style={({ pressed }) => [
        styles.button,
        { minHeight: visibleHeight },
        compact ? styles.compact : variant === 'text' ? styles.textPadding : styles.regularPadding,
        block && styles.block,
        dense && styles.dense,
        lookStyle(lookFor(pressed)),
      ]}
    >
      {({ pressed }) => {
        const look = lookFor(pressed);
        return (
          <>
            <View style={[styles.content, loading && styles.hidden]}>
              {icon ? <Icon name={icon} tone={look.label} /> : null}
              <Text variant="button" tone={look.label} style={styles.label}>
                {label}
              </Text>
            </View>
            {loading ? <LoadingDots tone={look.label} /> : null}
          </>
        );
      }}
    </Pressable>
  );
}

function LoadingDots({ tone }: { tone: TextTone }) {
  return (
    <View style={styles.dots}>
      {[0, 1, 2].map((dot) => (
        <View key={dot} style={[styles.dot, { backgroundColor: color[tone] }]} />
      ))}
    </View>
  );
}

export type IconButtonProps = PressState & {
  icon: IconName;
  /** Pflicht: Icon-Buttons haben keine sichtbare Beschriftung („Einstellungen“, „Schließen“). */
  accessibilityLabel: string;
  onPress: () => void;
  disabled?: boolean;
  /** Macht den Button zum Schalter wie „Bereiche“: eingeschaltet in `primary-soft` mit Icon in `primary`. */
  checked?: boolean;
};

/** Runder 48-dp-Button nur mit Icon, für Zahnrad, Schließen und Bereiche. */
export function IconButton({ icon, accessibilityLabel, onPress, disabled = false, checked, testOnly_pressed }: IconButtonProps) {
  const surface = checked ? color.primarySoft : color.surfaceCard;
  return (
    <Pressable
      accessibilityRole={checked === undefined ? 'button' : 'switch'}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled, checked }}
      disabled={disabled}
      onPress={onPress}
      testOnly_pressed={testOnly_pressed}
      style={({ pressed }) => [
        styles.iconButton,
        disabled
          ? styles.iconButtonDisabled
          : pressed
            ? { backgroundColor: checked ? color.primarySoftPressed : color.surfaceSunken, ...pressedEdge('buttonSoft', 'buttonSoftPressed') }
            : { backgroundColor: surface, boxShadow: boxShadow.buttonSoft },
      ]}
    >
      <Icon name={icon} size="lg" tone={disabled ? 'inkDisabled' : checked ? 'primary' : 'ink'} />
    </Pressable>
  );
}

const dotSize = 6;

const styles = StyleSheet.create({
  button: {
    minWidth: size.touchMin,
    alignSelf: 'flex-start',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    paddingVertical: space[2],
  },
  regularPadding: { paddingHorizontal: space[5] },
  compact: { paddingHorizontal: space[4] },
  textPadding: { paddingHorizontal: space[3] },
  block: { alignSelf: 'stretch' },
  dense: { paddingHorizontal: space[1] },
  content: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  label: { textAlign: 'center', flexShrink: 1 },
  hidden: { opacity: 0 },
  dots: { ...StyleSheet.absoluteFill, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space[1] },
  dot: { width: dotSize, height: dotSize, borderRadius: dotSize / 2 },
  iconButton: {
    width: size.touchMin,
    height: size.touchMin,
    borderRadius: size.touchMin / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButtonDisabled: { backgroundColor: color.fillDisabled },
});
