import { View } from 'react-native';

import type { SheetProps } from '../native/Sheet';

/**
 * Test-Adapter für `Sheet`: zeigt den Inhalt direkt im Baum. Im Test liegt das native Sheet in
 * einem Host mit `pointerEvents="none"`, weil SwiftUI es auf dem Gerät separat präsentiert;
 * Tipps im Inhalt kämen dort nicht an. Einbinden mit
 * `jest.mock('…/design/native/Sheet', () => jest.requireActual('…/design/testing/inline-sheet'))`.
 */
export function Sheet({ visible, children }: SheetProps) {
  return visible ? <View testID="sheet">{children}</View> : null;
}
