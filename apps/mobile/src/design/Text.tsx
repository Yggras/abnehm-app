import { Text as NativeText, type TextProps as NativeTextProps } from 'react-native';

import { color, textScale, type, type TypeToken } from './tokens';

/**
 * Farben, die als Text taugen (mindestens 4,5:1 auf ihren Flächen, research/design-system.md).
 * Personfarben, Energie und Skia-Farben fehlen bewusst: Energie ist ein Symbol, nie eine Textfarbe.
 */
export type TextTone =
  | 'ink'
  | 'inkMuted'
  | 'inkDisabled'
  | 'primary'
  | 'primaryPressed'
  | 'onPrimary'
  | 'onInverse'
  | 'success'
  | 'hint'
  | 'neutral'
  | 'problem';

export type TextProps = NativeTextProps & {
  /** Textstil des Design-Systems; Standard `body`. */
  variant?: TypeToken;
  /** Textfarbe; Standard `ink`. */
  tone?: TextTone;
};

const scaleLimit: Partial<Record<TypeToken, number>> = textScale.limit;

/** Text in Rubik. Skaliert mit der Systemschrift bis Faktor 2,0, `numberXl` und `tabLabel` enger. */
export function Text({ variant = 'body', tone = 'ink', style, ...props }: TextProps) {
  return (
    <NativeText
      maxFontSizeMultiplier={scaleLimit[variant] ?? textScale.max}
      {...props}
      allowFontScaling
      style={[type[variant], { color: color[tone] }, style]}
    />
  );
}
