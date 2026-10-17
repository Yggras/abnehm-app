import { Children, Fragment, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type PressableProps } from 'react-native';

import { boxShadow } from './elevation';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { color, radius, size, space } from './tokens';

export type ListRowProps = Pick<PressableProps, 'testOnly_pressed'> & {
  title: string;
  /** Unterzeile, etwa Menge und Mahlzeit, Herkunft oder der Grund einer Deaktivierung. */
  subtitle?: string;
  icon?: IconName;
  /** Wert rechts, etwa „320 kcal“. */
  value?: string;
  /** Herkunfts-Etikett eines Imports, etwa „Apple Health“. */
  tag?: string;
  /** Ersetzter Eintrag: Titel durchgestrichen. Die Unterzeile sagt, wodurch („Ersetzt durch Import“). */
  replaced?: boolean;
  disabled?: boolean;
  /** Navigation: Pfeil rechts. */
  onPress?: () => void;
  /** Bedienelement rechts statt Wert oder Pfeil, etwa ein `Switch`. */
  accessory?: ReactNode;
};

/** Listenzeile nach dem Design-System; mehrere Zeilen gruppiert `ListGroup` in einer Karte. */
export function ListRow({
  title,
  subtitle,
  icon,
  value,
  tag,
  replaced = false,
  disabled = false,
  onPress,
  accessory,
  testOnly_pressed,
}: ListRowProps) {
  const content = (
    <>
      {icon ? (
        <View style={styles.lead}>
          <Icon name={icon} tone={disabled ? 'inkDisabled' : 'ink'} />
        </View>
      ) : null}
      <View style={styles.main}>
        <Text
          variant="body"
          tone={disabled ? 'inkDisabled' : replaced ? 'inkMuted' : 'ink'}
          style={replaced && styles.replaced}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text variant="label" tone="inkMuted">
            {subtitle}
          </Text>
        ) : null}
        {tag ? (
          <View style={styles.tag}>
            <Text variant="caption">{tag}</Text>
          </View>
        ) : null}
      </View>
      {value ? (
        <Text variant="bodyStrong" tone={disabled ? 'inkDisabled' : 'ink'} style={styles.value}>
          {value}
        </Text>
      ) : null}
      {accessory}
      {onPress ? <Icon name="chevron" tone={disabled ? 'inkDisabled' : 'inkMuted'} /> : null}
    </>
  );

  if (!onPress) return <View style={styles.row}>{content}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      testOnly_pressed={testOnly_pressed}
      style={({ pressed }) => [styles.row, pressed && !disabled && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

/** Zeilen in einer Karte, getrennt durch Linien in `line`. */
export function ListGroup({ children }: { children: ReactNode }) {
  const rows = Children.toArray(children);
  return (
    <View style={styles.group}>
      {rows.map((row, index) => (
        <Fragment key={index}>
          {index > 0 ? <View style={styles.divider} /> : null}
          {row}
        </Fragment>
      ))}
    </View>
  );
}

const leadSize = 36;

const styles = StyleSheet.create({
  row: {
    minHeight: size.rowMin,
    minWidth: size.touchMin,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingVertical: space[2],
    paddingHorizontal: space[4],
    backgroundColor: color.surfaceCard,
  },
  pressed: { backgroundColor: color.surfaceSunken },
  lead: {
    width: leadSize,
    height: leadSize,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.surfaceSunken,
  },
  main: { flex: 1, gap: space[1] },
  replaced: { textDecorationLine: 'line-through' },
  tag: {
    alignSelf: 'flex-start',
    paddingHorizontal: space[2],
    borderRadius: radius.sm,
    backgroundColor: color.neutralSoft,
  },
  value: { textAlign: 'right' },
  group: { borderRadius: radius.lg, overflow: 'hidden', backgroundColor: color.surfaceCard, boxShadow: boxShadow.card },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: color.line, marginHorizontal: space[4] },
});
