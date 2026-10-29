import { useRef, useState, type ComponentRef, type RefObject } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Icon } from './Icon';
import { Text } from './Text';
import { color, radius, size, space, textScale, type } from './tokens';

/** Das Eingabeelement eines `TextField`, etwa um es nach „Korrigieren“ zu fokussieren (#175). */
export type TextFieldInput = ComponentRef<typeof TextInput>;

/** Zahl mit Einheit (Dezimaltastatur), freier Text oder Suche mit Lupe. */
export type TextFieldKind = 'number' | 'text' | 'search';

export type TextFieldProps = {
  /** Sichtbare Beschriftung über dem Feld; zugleich der zugängliche Name. */
  label: string;
  /** Beschriftung nur für Screenreader, etwa beim Suchfeld mit Platzhalter. */
  hideLabel?: boolean;
  value: string;
  onChangeText: (text: string) => void;
  kind?: TextFieldKind;
  /** Einheit rechts im Feld, etwa „g“. */
  unit?: string;
  placeholder?: string;
  /** Ungültige Eingabe: Rahmen in `problem` und darunter der Satz mit Lösungsweg. */
  problem?: string;
  disabled?: boolean;
  /** Zugriff auf das Eingabeelement, etwa um es nach einer Rückfrage wieder zu fokussieren. */
  inputRef?: RefObject<TextFieldInput | null>;
};

const borderWidth = { resting: 1.5, focused: 2 };

/**
 * Eingabefeld nach dem Design-System (gebrandetes `TextInput`): Fläche `surface-card`, Rahmen
 * `line-strong`, fokussiert 2 dp in `primary`. Ein Fehler steht nie nur als Farbe da, sondern als
 * Satz mit Symbol unter dem Feld.
 */
export function TextField({
  label,
  hideLabel = false,
  value,
  onChangeText,
  kind = 'text',
  unit,
  placeholder,
  problem,
  disabled = false,
  inputRef,
}: TextFieldProps) {
  const [focused, setFocused] = useState(false);
  const ownInput = useRef<TextFieldInput>(null);
  const input = inputRef ?? ownInput;
  // Ein Tipp auf Beschriftung, Lupe oder Einheit setzt den Fokus ins Feld; zugänglich ist nur das Feld selbst.
  return (
    <Pressable accessible={false} disabled={disabled} onPress={() => input.current?.focus()} style={styles.field}>
      {hideLabel ? null : (
        <Text variant="label" tone={disabled ? 'inkDisabled' : 'ink'}>
          {label}
        </Text>
      )}
      <View
        style={[
          styles.box,
          disabled ? styles.disabled : problem ? styles.problem : focused ? styles.focused : styles.resting,
        ]}
      >
        {kind === 'search' ? <Icon name="search" tone={disabled ? 'inkDisabled' : 'inkMuted'} /> : null}
        <TextInput
          ref={input}
          accessibilityLabel={label}
          accessibilityState={{ disabled }}
          accessibilityHint={problem}
          value={value}
          onChangeText={onChangeText}
          editable={!disabled}
          placeholder={placeholder}
          placeholderTextColor={color.inkMuted}
          keyboardType={kind === 'number' ? 'decimal-pad' : 'default'}
          returnKeyType={kind === 'search' ? 'search' : 'done'}
          autoCorrect={kind === 'text'}
          autoCapitalize={kind === 'search' ? 'none' : 'sentences'}
          clearButtonMode={kind === 'search' ? 'while-editing' : 'never'}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          allowFontScaling
          maxFontSizeMultiplier={textScale.max}
          style={[styles.input, { color: color[disabled ? 'inkDisabled' : 'ink'] }]}
        />
        {unit ? (
          <Text variant="bodyStrong" tone={disabled ? 'inkDisabled' : 'inkMuted'}>
            {unit}
          </Text>
        ) : null}
      </View>
      {problem ? (
        <View style={styles.message}>
          <Icon name="alert" size="sm" tone="problem" />
          <Text variant="label" tone="problem" style={styles.messageText}>
            {problem}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  field: { gap: space[1] },
  box: {
    minHeight: size.fieldHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    paddingHorizontal: space[4],
    borderRadius: radius.md,
    backgroundColor: color.surfaceCard,
  },
  resting: { borderWidth: borderWidth.resting, borderColor: color.lineStrong },
  focused: { borderWidth: borderWidth.focused, borderColor: color.primary },
  problem: { borderWidth: borderWidth.focused, borderColor: color.problem },
  disabled: { backgroundColor: color.fillDisabled },
  input: { ...type.body, flex: 1, minHeight: size.touchMin, paddingVertical: space[2] },
  message: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  messageText: { flex: 1 },
});
