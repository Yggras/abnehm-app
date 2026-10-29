import { useState, type ComponentRef, type Ref } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { Text } from './Text';
import { color, radius, size, space, textScale, type } from './tokens';

/** Das Eingabeelement eines `TextField`, etwa um es nach „Korrigieren“ zu fokussieren. */
export type TextFieldInput = ComponentRef<typeof TextInput>;

export type TextFieldProps = {
  /** Beschriftung über dem Feld; zusammen mit der Einheit der zugängliche Name. */
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  /** Einheit rechts im Feld, etwa „kg“. */
  unit?: string;
  keyboardType?: TextInputProps['keyboardType'];
  /** Ungültige Eingabe: Satz mit Lösungsweg unter dem Feld, Rahmen in `problem`. */
  error?: string;
  autoFocus?: boolean;
  selectTextOnFocus?: boolean;
  inputRef?: Ref<TextFieldInput>;
};

/**
 * Eingabefeld des Design-Systems (Komponente „Eingabefeld“, research/design-system.md): gebrandetes
 * `TextInput` auf `surface-card` mit Rahmen in `line-strong`, fokussiert in `focus`, bei ungültiger
 * Eingabe in `problem` samt Satz darunter. `problem` gilt nur für die Eingabe, nie für den Wert selbst.
 */
export function TextField({ label, value, onChangeText, unit, keyboardType, error, autoFocus, selectTextOnFocus, inputRef }: TextFieldProps) {
  const [focused, setFocused] = useState(false);
  const borderColor = error ? color.problem : focused ? color.focus : color.lineStrong;
  return (
    <View style={styles.group}>
      <Text variant="label">{label}</Text>
      <View testID="text-field-frame" style={[styles.frame, { borderColor }, focused && styles.focused]}>
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={onChangeText}
          keyboardType={keyboardType}
          autoFocus={autoFocus}
          selectTextOnFocus={selectTextOnFocus}
          accessibilityLabel={unit ? `${label} in ${unit}` : label}
          accessibilityHint={error}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          maxFontSizeMultiplier={textScale.max}
          cursorColor={color.primary}
          selectionColor={color.primarySoftPressed}
          style={[styles.input, numeric.has(keyboardType) ? type.numberM : type.body]}
        />
        {unit ? <Text tone="inkMuted" importantForAccessibility="no">{unit}</Text> : null}
      </View>
      {error ? <Text variant="label" tone="problem">{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: space[1] },
  frame: {
    minHeight: size.fieldHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    paddingHorizontal: space[3],
    borderWidth: 1,
    borderRadius: radius.md,
    backgroundColor: color.surfaceCard,
  },
  // Fokus mit kräftigerem Rahmen statt Ring; der Rahmen bleibt innerhalb der Feldhöhe.
  focused: { borderWidth: 2 },
  input: { flex: 1, color: color.ink, paddingVertical: space[2] },
});

/** Zahlenfelder zeigen ihren Wert im Zahlenstil mit gleich breiten Ziffern. */
const numeric = new Set<TextInputProps['keyboardType']>(['decimal-pad', 'number-pad', 'numeric']);
