import { StyleSheet, View, type DimensionValue } from 'react-native';

import { color, radius as radii, type } from './tokens';

export type SkeletonProps = {
  /** Höhe in der Form des erwarteten Inhalts, Standard eine Textzeile. */
  height?: number;
  width?: DimensionValue;
  radius?: keyof typeof radii;
};

/**
 * Ladezustand: Fläche in `surface-sunken` in der Form des Inhalts, keine Spinner über ganzen
 * Bildschirmen. Für Screenreader unsichtbar; den Ladezustand meldet das umgebende Element.
 */
export function Skeleton({ height = type.body.lineHeight, width = '100%', radius = 'xs' }: SkeletonProps) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.skeleton, { height, width, borderRadius: radii[radius] }]}
    />
  );
}

const styles = StyleSheet.create({
  skeleton: { backgroundColor: color.surfaceSunken },
});
