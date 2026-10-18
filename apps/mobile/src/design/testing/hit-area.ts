import { StyleSheet, type Insets, type ViewStyle } from 'react-native';

type Element = { props: { style?: unknown; hitSlop?: unknown } };

function length(value: ViewStyle['height']): number {
  return typeof value === 'number' ? value : 0;
}

function slop(hitSlop: unknown): Required<Insets> {
  if (typeof hitSlop === 'number') return { top: hitSlop, bottom: hitSlop, left: hitSlop, right: hitSlop };
  const insets = (hitSlop ?? {}) as Insets;
  return { top: insets.top ?? 0, bottom: insets.bottom ?? 0, left: insets.left ?? 0, right: insets.right ?? 0 };
}

/**
 * Zugesicherte Trefferfläche eines Bedienelements: festgelegte Mindest- bzw. feste Größe plus
 * `hitSlop`. Ohne Layout-Engine im Test zählt nur, was der Stil garantiert, nicht der Inhalt.
 */
export function hitArea(element: Element): { width: number; height: number } {
  const style = (StyleSheet.flatten(element.props.style as ViewStyle) ?? {}) as ViewStyle;
  const insets = slop(element.props.hitSlop);
  return {
    height: Math.max(length(style.height), length(style.minHeight)) + insets.top + insets.bottom,
    width: Math.max(length(style.width), length(style.minWidth)) + insets.left + insets.right,
  };
}
