import type { MomoAppearance, MomoMood } from '@abnehm/contracts/island';
import { createContext, use, type ReactNode } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Ellipse, Path } from 'react-native-svg';

import { color } from '../design';

/** Die Quelle der Erscheinung gehört der Insel; Figure-Aufrufer geben nur Stimmung und Größe an. */
const Appearance = createContext<MomoAppearance | null>(null);
export function MomoAppearanceProvider({ appearance, children }: { appearance: MomoAppearance | null; children: ReactNode }) {
  return <Appearance value={appearance}>{children}</Appearance>;
}

const moodLabel: Record<MomoMood, string> = {
  zufrieden: 'zufrieden', freut_sich: 'freut sich', begeistert: 'begeistert',
  neugierig: 'neugierig', doest: 'döst', schlaeft: 'schläft',
};

/** Zugängliche flächige Vorzeichnung; Spezifikation 4 ersetzt die Grafik durch die endgültigen Skia-Formen. */
export function MomoFigure({ mood, size }: { mood: MomoMood; size: number }) {
  const appearance = use(Appearance);
  const hatched = appearance?.stage === 'geschluepft';
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={hatched ? `Momo, ${moodLabel[mood]}` : 'Momo wartet im Ei'}>
      <Svg width={size} height={size} viewBox="0 0 104 104" accessible={false} importantForAccessibility="no-hide-descendants">
        {hatched ? (
          <>
            <Ellipse cx="52" cy="57" rx="38" ry="35" fill={color.momoBody} />
            <Ellipse cx="51" cy="66" rx="27" ry="18" fill={color.momoBelly} />
            <Path d="M18 50 Q5 38 14 22 Q29 26 34 34" fill={color.momoFrond} />
            <Path d="M69 34 Q81 23 91 26 Q96 43 84 50" fill={color.momoFrond} />
            <Circle cx="37" cy="53" r="3" fill={color.ink} /><Circle cx="67" cy="53" r="3" fill={color.ink} />
            <Path d="M46 65 Q52 70 58 65" fill="none" stroke={color.ink} strokeWidth="2" />
          </>
        ) : (
          <>
            <Ellipse cx="52" cy="57" rx="36" ry="40" fill={color.momoBody} />
            <Ellipse cx="52" cy="67" rx="28" ry="22" fill={color.momoBelly} />
            <Path d="M27 37 Q52 16 76 37" fill="none" stroke={color.momoFrond} strokeWidth="3" />
            <Circle cx="42" cy="55" r="3" fill={color.ink} /><Circle cx="62" cy="55" r="3" fill={color.ink} />
            <Path d="M47 65 Q52 68 57 65" fill="none" stroke={color.ink} strokeWidth="2" />
          </>
        )}
      </Svg>
    </View>
  );
}
