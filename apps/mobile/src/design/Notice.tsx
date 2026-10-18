import { StyleSheet, View } from 'react-native';

import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { useLargeTextLayout } from './text-scale';
import { color, radius, space } from './tokens';

type NoticeAction = { label: string; onPress: () => void };

type Common = {
  /** Der Satz des Hinweises. Er trägt die Bedeutung; das Symbol verdoppelt sie nur. */
  text: string;
  /** Eigenes Symbol statt des Standards des Tons, etwa Mond für „Tagesende“ oder Insel für Neues. */
  icon?: IconName;
  /** Höchstens eine Aktion. */
  action?: NoticeAction;
};

/**
 * Hinweiszeile: Symbol, Satz und höchstens eine Aktion, ohne zu werten.
 * `problem` gilt nur für Technik und ungültige Eingaben, nie für Gesundheitswerte, Ziele, Gewicht
 * oder Kalorien; deshalb verlangt der Ton seinen Anlass. Der Satz nennt immer den Lösungsweg.
 */
export type NoticeProps = Common &
  (
    | { tone: 'partner' | 'hint' | 'neutral' | 'success' }
    | { tone: 'problem'; cause: 'technik' | 'ungueltige_eingabe' }
  );

type Tone = NoticeProps['tone'];

// Fläche und Standardsymbol je Ton; das Symbol steht in der Zustandsfarbe, der Text in `ink`.
const toneStyle: Record<Tone, { surface: keyof typeof color; icon: IconName }> = {
  partner: { surface: 'partnerSoft', icon: 'heart' },
  hint: { surface: 'hintSoft', icon: 'info' },
  neutral: { surface: 'neutralSoft', icon: 'info' },
  success: { surface: 'successSoft', icon: 'check' },
  problem: { surface: 'problemSoft', icon: 'alert' },
};

/** Hinweis nach dem Design-System; Bedeutung entsteht aus Symbol und Text, nie aus Farbe allein. */
export function Notice(props: NoticeProps) {
  const look = toneStyle[props.tone];
  // Ab Schriftfaktor 1,3 rückt die Aktion unter den Satz, sonst steht sie rechts daneben.
  const stacked = useLargeTextLayout();
  return (
    <View style={[styles.notice, stacked && styles.stacked, { backgroundColor: color[look.surface] }]}>
      <Icon name={props.icon ?? look.icon} tone={props.tone} />
      <Text variant="label" style={styles.text}>
        {props.text}
      </Text>
      {props.action ? <Button variant="text" compact label={props.action.label} onPress={props.action.onPress} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingVertical: space[3],
    paddingHorizontal: space[4],
    borderRadius: radius.md,
  },
  stacked: { flexWrap: 'wrap' },
  text: { flexShrink: 1, flexGrow: 1 },
});
