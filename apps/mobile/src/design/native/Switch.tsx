import { Switch as NativeSwitch } from '@expo/ui';
import { semantics } from '@expo/ui/jetpack-compose/modifiers';
import { labelsHidden } from '@expo/ui/swift-ui/modifiers';
import { Platform } from 'react-native';

import { NativeHost } from './NativeHost';

export type SwitchProps = {
  value: boolean;
  onValueChange: (value: boolean) => void;
  /** Name für Screenreader; sichtbar steht er als Titel der Listenzeile daneben. */
  label: string;
  disabled?: boolean;
};

// Die sichtbare Beschriftung zeichnet die gebrandete Listenzeile in Rubik. Der native Schalter
// bekommt seinen Namen deshalb nur für Screenreader: SwiftUI blendet das Label aus, Compose liest
// die Inhaltsbeschreibung vor (https://docs.expo.dev/versions/v58.0.0/sdk/ui/swift-ui/modifiers/).
const accessibleName = (label: string) =>
  Platform.OS === 'ios' ? { label, modifiers: [labelsHidden()] } : { modifiers: [semantics({ contentDescription: label })] };

/** Nativer Schalter über `@expo/ui` (SwiftUI-Toggle bzw. Compose-Switch). */
export function Switch({ value, onValueChange, label, disabled = false }: SwitchProps) {
  return (
    <NativeHost matchContents>
      <NativeSwitch value={value} onValueChange={onValueChange} disabled={disabled} {...accessibleName(label)} />
    </NativeHost>
  );
}
