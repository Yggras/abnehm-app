import { Switch as NativeSwitch } from '@expo/ui';
import { Pressable, StyleSheet, View } from 'react-native';

import { size } from '../tokens';
import { NativeHost } from './NativeHost';

export type SwitchProps = {
  value: boolean;
  onValueChange: (value: boolean) => void;
  /** Name für Screenreader; sichtbar steht er als Titel der Listenzeile daneben. */
  label: string;
  disabled?: boolean;
  /** Kennung für Maestro, etwa `freigabe-wasser`; Screenreader nutzen `label`. */
  testID?: string;
};

/**
 * Schalter: zeichnet den nativen Schalter aus `@expo/ui` (SwiftUI-Toggle bzw. Compose-Switch),
 * bedient wird er über eine 48 × 48 dp große Fläche darum. Der native Schalter selbst ist nur
 * 31 pt hoch und kennt keine eigene Trefferfläche; außerdem zeichnet die gebrandete Listenzeile die
 * Beschriftung in Rubik. Deshalb tragen Rolle, Zustand und Name das `Pressable`, und der native
 * Schalter ist für Screenreader und Berührung ausgeblendet.
 */
export function Switch({ value, onValueChange, label, disabled = false, testID }: SwitchProps) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => onValueChange(!value)}
      style={styles.target}
    >
      <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <NativeHost matchContents>
          <NativeSwitch value={value} onValueChange={onValueChange} disabled={disabled} />
        </NativeHost>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  target: { minWidth: size.touchMin, minHeight: size.touchMin, alignItems: 'center', justifyContent: 'center' },
});
