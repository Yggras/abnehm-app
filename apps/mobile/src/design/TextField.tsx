import { useState } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { boxShadow } from './elevation';
import { Icon } from './Icon';
import { Text } from './Text';
import { color, radius, size, space, textScale, type } from './tokens';

/** Tastatur und Autovervollständigung reichen unverändert an das native Feld. */
type KeyboardProps = Pick<
  TextInputProps,
  'keyboardType' | 'autoComplete' | 'textContentType' | 'autoCapitalize' | 'autoCorrect' | 'returnKeyType' | 'onSubmitEditing' | 'maxLength'
>;

export type TextFieldProps = KeyboardProps & {
  /** Sichtbare Beschriftung über dem Feld; zugleich der Name für Screenreader. */
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  /** Kurzer Hinweis unter dem Feld, etwa „Mindestens 10 Zeichen“. */
  hint?: string;
  /** Ungültige Eingabe: ersetzt den Hinweis, immer mit Lösungsweg im Satz. */
  error?: string;
  /** Verdeckte Eingabe für Passwörter. */
  secure?: boolean;
  disabled?: boolean;
};

/**
 * Eingabefeld nach dem Design-System (Komponente „Eingabefeld“, Variante Text): Beschriftung darüber,
 * 52 dp hohes Feld auf `surface-card` mit Rahmen in `line-strong`, fokussiert mit Fokusring, bei
 * ungültiger Eingabe Rahmen und Satz in `problem` samt Symbol. Der Satz unter dem Feld ist zugleich
 * der Hinweis für Screenreader.
 */
export function TextField({ label, value, onChangeText, hint, error, secure = false, disabled = false, ...keyboard }: TextFieldProps) {
  const [focused, setFocused] = useState(false);
  const note = error ?? hint;
  return (
    <View style={styles.field}>
      <Text variant="label" tone={disabled ? 'inkDisabled' : 'ink'} accessible={false} importantForAccessibility="no">
        {label}
      </Text>
      <TextInput
        {...keyboard}
        accessibilityLabel={label}
        accessibilityHint={error === undefined ? hint : `Fehler: ${error}`}
        accessibilityState={{ disabled }}
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={secure}
        editable={!disabled}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        allowFontScaling
        maxFontSizeMultiplier={textScale.max}
        selectionColor={color.primary}
        cursorColor={color.primary}
        style={[
          styles.input,
          error !== undefined && styles.invalid,
          focused && styles.focused,
          disabled && styles.disabled,
        ]}
      />
      {note === undefined ? null : (
        <View style={styles.note} accessible={false} importantForAccessibility="no-hide-descendants">
          {error === undefined ? null : <Icon name="alert" size="sm" tone="problem" />}
          <Text variant="caption" tone={error === undefined ? 'inkMuted' : 'problem'} style={styles.noteText}>
            {note}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: space[1], alignSelf: 'stretch' },
  input: {
    ...type.body,
    color: color.ink,
    minHeight: size.fieldHeight,
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.lineStrong,
    backgroundColor: color.surfaceCard,
  },
  invalid: { borderColor: color.problem, borderWidth: 2 },
  focused: { borderColor: color.focus, boxShadow: boxShadow.focusRing },
  disabled: { backgroundColor: color.fillDisabled, borderColor: color.fillDisabled, color: color.inkDisabled },
  note: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  noteText: { flexShrink: 1 },
});
