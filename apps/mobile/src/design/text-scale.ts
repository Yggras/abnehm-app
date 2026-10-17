import { useWindowDimensions } from 'react-native';

import { textScale } from './tokens';

/**
 * Layout-Hilfsmittel für große Schrift: `true` ab Schriftfaktor 1,3 (Spezifikation 0, Abschnitt 7).
 * Dann stapeln sich Momo-Bereich, Mini-Tracker und Partner-Zusammenfassungen. Eine Komponente darf
 * früher umbrechen, wenn sonst Inhalt abgeschnitten würde.
 */
export function useLargeTextLayout(): boolean {
  return useWindowDimensions().fontScale >= textScale.breakpoint;
}
