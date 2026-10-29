import { useState } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { Icon } from './Icon';
import { Text } from './Text';
import { color, radius, size, space, textScale, type } from './tokens';

export type TextFieldProps = Pick<TextInputProps, 'autoComplete' | 'textContentType' | 'returnKeyType' | 'onSubmitEditing' | 'maxLength'> & {
  /** Sichtbare Beschriftung über dem Feld; zugleich der zugängliche Name. */
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  /** Satz unter dem Feld, etwa eine Regel („Mindestens 10 Zeichen.“). */
  hint?: string;
  /** Ungültige Eingabe: ersetzt den Hinweis, mit Symbol und Lösungsweg im Satz. */
  error?: string;
  /** Passwort: Zeichen verdeckt, ohne Autokorrektur. */
  secure?: boolean;
  disabled?: boolean;
};

/**
 * Eingabefeld nach dem Design-System (Komponente „Eingabefeld“, gebrandeter `TextInput`): 52 dp hoch,
 * Rahmen in `line-strong`, fokussiert in `focus`, bei ungültiger Eingabe in `problem`. Bedeutung
 * tragen Beschriftung, Hinweis und Fehlersatz, nie die Rahmenfarbe allein.
 */
export function TextField({ label, value, onChangeText, hint, error, secure = false, disabled = false, ...input }: TextFieldProps) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.field}>
      <Text variant="label" tone={disabled ? 'inkDisabled' : 'ink'}>
        {label}
      </Text>
      <TextInput
        {...input}
        accessibilityLabel={label}
        accessibilityHint={error ?? hint}
        accessibilityState={{ disabled }}
        value={value}
        onChangeText={onChangeText}
        editable={!disabled}
        secureTextEntry={secure}
        autoCorrect={!secure}
        autoCapitalize={secure ? 'none' : input.autoComplete === 'email' ? 'none' : 'sentences'}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        allowFontScaling
        maxFontSizeMultiplier={textScale.max}
        placeholderTextColor={color.inkMuted}
        selectionColor={color.primary}
        cursorColor={color.primary}
        style={[styles.input, focused && styles.focused, error !== undefined && styles.invalid, disabled && styles.disabled]}
      />
      {error !== undefined ? (
        <View style={styles.message} accessibilityLiveRegion="polite">
          <Icon name="alert" size="sm" tone="problem" />
          <Text variant="label" tone="problem" style={styles.messageText}>
            {error}
          </Text>
        </View>
      ) : hint !== undefined ? (
        <Text variant="label" tone="inkMuted">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: space[2] },
  input: {
    ...type.body,
    minHeight: size.fieldHeight,
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.lineStrong,
    backgroundColor: color.surfaceCard,
    color: color.ink,
  },
  // Der breitere Rahmen ersetzt den Fokusring; das Feld verschiebt sich dabei nicht spürbar.
  focused: { borderWidth: 2, borderColor: color.focus, paddingHorizontal: space[4] - 1 },
  invalid: { borderWidth: 2, borderColor: color.problem, paddingHorizontal: space[4] - 1 },
  disabled: { backgroundColor: color.fillDisabled, borderColor: color.fillDisabled, color: color.inkDisabled },
  message: { flexDirection: 'row', alignItems: 'flex-start', gap: space[2] },
  messageText: { flex: 1 },
});
