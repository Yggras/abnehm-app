import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { energyPath, iconShapes, type IconName, type IconShape } from './icon-shapes';
import type { TextTone } from './Text';
import { color, size as sizes } from './tokens';

export type { IconName } from './icon-shapes';

/** Farben für Icons: die Textfarben, dazu die Personfarben (als Grafik mindestens 3:1). */
export type IconTone = TextTone | 'self' | 'partner';

export type IconSize = 'sm' | 'md' | 'lg';

const iconSize: Record<IconSize, number> = { sm: sizes.iconSm, md: sizes.iconMd, lg: sizes.iconLg };

function Shape({ shape }: { shape: IconShape }) {
  switch (shape.type) {
    case 'path':
      return <Path d={shape.d} />;
    case 'circle':
      // Die Spur steht wie beim Fortschrittsbalken in `surface-sunken`.
      return <Circle cx={shape.cx} cy={shape.cy} r={shape.r} stroke={shape.track ? color.surfaceSunken : undefined} />;
    case 'rect':
      return <Rect x={shape.x} y={shape.y} width={shape.width} height={shape.height} rx={shape.rx} />;
  }
}

/**
 * Linien-Icon des Design-Systems, auf iOS und Android identisch. Icons sind Schmuck für
 * Screenreader; die Bedeutung trägt immer der Text daneben oder die Beschriftung des Bedienelements.
 */
export function Icon({ name, size = 'md', tone = 'ink' }: { name: IconName; size?: IconSize; tone?: IconTone }) {
  const length = iconSize[size];
  return (
    <Svg
      testID={`icon-${name}`}
      width={length}
      height={length}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color[tone]}
      strokeWidth={sizes.iconStroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      {iconShapes[name].map((shape, index) => (
        <Shape key={index} shape={shape} />
      ))}
    </Svg>
  );
}

/** Energie-Symbol (Funke). Energie hat nie eine Textfarbe; die Zahl daneben steht in `ink`. */
export function EnergySymbol({ size = 'md' }: { size?: IconSize }) {
  const length = iconSize[size];
  return (
    <Svg
      testID="icon-energy"
      width={length}
      height={length}
      viewBox="0 0 24 24"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      <Path d={energyPath} fill={color.energy} stroke={color.energyEdge} strokeWidth={1.4} strokeLinejoin="round" />
    </Svg>
  );
}
