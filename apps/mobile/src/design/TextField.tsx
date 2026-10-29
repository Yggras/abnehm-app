import { useImperativeHandle, useRef, useState, type ComponentRef, type Ref } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { Icon } from './Icon';
import { Text } from './Text';
import { color, radius, size, space, textScale, type } from './tokens';

/** Zahl mit Einheit (Dezimaltastatur), freier Text oder Suche mit Lupe. */
export type TextFieldKind = 'number' | 'text' | 'search';

/** Tastatur und Autovervollständigung reichen an das native Feld und gehen den Vorgaben von `kind` vor. */
type KeyboardProps = Pick<
  TextInputProps,
  | 'keyboardType'
  | 'autoComplete'
  | 'textContentType'
  | 'autoCapitalize'
  | 'autoCorrect'
  | 'returnKeyType'
  | 'onSubmitEditing'
  | 'submitBehavior'
  | 'maxLength'
>;

/** Was ein Formular am Feld bedient, etwa „Weiter“ auf der Tastatur zum nächsten Feld. */
export type TextFieldHandle = { focus(): void };

export type TextFieldProps = KeyboardProps & {
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
  /** Kurzer Hinweis unter dem Feld, etwa „Mindestens 10 Zeichen“. */
  hint?: string;
  /** Ungültige Eingabe: Rahmen in `problem`; der Satz mit Lösungsweg ersetzt den Hinweis. */
  problem?: string;
  /** Verdeckte Eingabe für Passwörter. */
  secure?: boolean;
  disabled?: boolean;
  ref?: Ref<TextFieldHandle>;
};

const borderWidth = { resting: 1.5, focused: 2 };

/**
 * Eingabefeld nach dem Design-System (gebrandetes `TextInput`): Fläche `surface-card`, Rahmen
 * `line-strong`, fokussiert 2 dp in `primary`. Ein Fehler steht nie nur als Farbe da, sondern als
 * Satz mit Symbol unter dem Feld. Der Satz unter dem Feld ist zugleich der Hinweis für Screenreader.
 */
export function TextField({
  label,
  hideLabel = false,
  value,
  onChangeText,
  kind = 'text',
  unit,
  placeholder,
  hint,
  problem,
  secure = false,
  disabled = false,
  ref,
  ...keyboard
}: TextFieldProps) {
  const [focused, setFocused] = useState(false);
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  useImperativeHandle(ref, () => ({ focus: () => input.current?.focus() }), []);
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
          keyboardType={kind === 'number' ? 'decimal-pad' : 'default'}
          returnKeyType={kind === 'search' ? 'search' : 'done'}
          autoCorrect={kind === 'text'}
          autoCapitalize={kind === 'search' ? 'none' : 'sentences'}
          {...keyboard}
          ref={input}
          accessibilityLabel={label}
          accessibilityState={{ disabled }}
          accessibilityHint={problem ? `Fehler: ${problem}` : hint}
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={secure}
          editable={!disabled}
          placeholder={placeholder}
          placeholderTextColor={color.inkMuted}
          clearButtonMode={kind === 'search' ? 'while-editing' : 'never'}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          allowFontScaling
          maxFontSizeMultiplier={textScale.max}
          selectionColor={color.primary}
          cursorColor={color.primary}
          style={[styles.input, { color: color[disabled ? 'inkDisabled' : 'ink'] }]}
        />
        {unit ? (
          <Text variant="bodyStrong" tone={disabled ? 'inkDisabled' : 'inkMuted'}>
            {unit}
          </Text>
        ) : null}
      </View>
      {/* Screenreader hören den Satz als Hinweis des Felds, nicht ein zweites Mal als Text. */}
      {problem ? (
        <View style={styles.message} accessible={false} importantForAccessibility="no-hide-descendants">
          <Icon name="alert" size="sm" tone="problem" />
          <Text variant="label" tone="problem" style={styles.messageText}>
            {problem}
          </Text>
        </View>
      ) : hint ? (
        <View style={styles.message} accessible={false} importantForAccessibility="no-hide-descendants">
          <Text variant="caption" tone={disabled ? 'inkDisabled' : 'inkMuted'} style={styles.messageText}>
            {hint}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  field: { gap: space[1], alignSelf: 'stretch' },
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
