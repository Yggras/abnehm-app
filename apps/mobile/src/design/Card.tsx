import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type PressableProps } from 'react-native';

import { boxShadow } from './elevation';
import { Icon } from './Icon';
import { pressedEdge } from './press';
import { color, radius, size, space } from './tokens';

/**
 * - `standard`: Fläche mit Sockelkante;
 * - `response`: antwortbedürftig, 2-dp-Rahmen in `partner` – nur ganz oben auf „Wir“;
 * - `empty`: leerer Zustand, 2-dp-Rahmen in `line` ohne Fläche, mit einem Satz und einer Aktion.
 */
export type CardVariant = 'standard' | 'response' | 'empty';

export type CardProps = Pick<PressableProps, 'testOnly_pressed'> & {
  children: ReactNode;
  variant?: CardVariant;
  /** Macht die Karte antippbar: Pfeil rechts, öffnet Details. */
  onPress?: () => void;
  /** Name der antippbaren Karte für Screenreader; ohne Angabe lesen sie den Inhalt vor. */
  accessibilityLabel?: string;
};

const outlineWidth = 2;

/** Karte nach dem Design-System. Keine Karten in Karten, keine farbigen Randstreifen. */
export function Card({ children, variant = 'standard', onPress, accessibilityLabel, testOnly_pressed }: CardProps) {
  const surface = styles[variant];
  if (!onPress) return <View style={[styles.card, surface]}>{children}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      testOnly_pressed={testOnly_pressed}
      style={({ pressed }) => [
        styles.card,
        styles.tappable,
        surface,
        pressed && variant !== 'empty' && pressedEdge('card', 'cardPressed'),
      ]}
    >
      <View style={styles.content}>{children}</View>
      <Icon name="chevron" tone="inkMuted" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, padding: space[4], gap: space[3] },
  tappable: { minHeight: size.touchMin, minWidth: size.touchMin, flexDirection: 'row', alignItems: 'center' },
  content: { flex: 1, gap: space[3] },
  standard: { backgroundColor: color.surfaceCard, boxShadow: boxShadow.card },
  response: { backgroundColor: color.surfaceCard, boxShadow: boxShadow.card, borderWidth: outlineWidth, borderColor: color.partner },
  empty: { borderWidth: outlineWidth, borderColor: color.line },
});
