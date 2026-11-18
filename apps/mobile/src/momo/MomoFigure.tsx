import type { MomoAppearance, MomoMood } from '@abnehm/contracts/island';
import { gameCatalog } from '@abnehm/game-rules/content';
import { Canvas, Group } from '@shopify/react-native-skia';
import { createContext, use, useMemo, type ReactNode } from 'react';
import { View } from 'react-native';

import { useReducedMotion } from '../design';
import { MomoRig } from './MomoRig';
import { momoVisual } from './visual';

// `MomoFigure` ist die einzige Momo-Komponente außerhalb der Insel (Spezifikation 0, Abschnitt 6;
// Spezifikation 4, Abschnitt 6). Aufrufer nennen nur Stimmung und Größe; Stufe, Form und Accessoires
// kommen aus der Erscheinung, die die Insel bereitstellt.

/** Die Quelle der Erscheinung gehört der Insel; Figure-Aufrufer geben nur Stimmung und Größe an. */
const Appearance = createContext<MomoAppearance | null>(null);
export function MomoAppearanceProvider({ appearance, children }: { appearance: MomoAppearance | null; children: ReactNode }) {
  return <Appearance value={appearance}>{children}</Appearance>;
}

/**
 * Rahmen der Figur in Rig-Einheiten: das Manifest steht in 100 × 100, darüber bleibt Platz für die
 * Zeichen über dem Kopf und den Sprung, links und rechts etwas Luft (Designwert aus #187, nicht belegt).
 */
const frame = { x: -5, y: -10, size: 110 } as const;

/** Momo als Skia-Rig in `size` × `size` dp: 104 dp auf „Heute“ (`momo-today`), 80–96 dp in Leerzuständen. */
export function MomoFigure({ mood, size }: { mood: MomoMood; size: number }) {
  const appearance = use(Appearance);
  const visual = useMemo(() => momoVisual(appearance, mood, gameCatalog), [appearance, mood]);
  const reduceMotion = useReducedMotion();
  const scale = size / frame.size;
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={visual.label} style={{ width: size, height: size }}>
      <Canvas style={{ width: size, height: size }} pointerEvents="none">
        <Group transform={[{ scale }, { translateX: -frame.x }, { translateY: -frame.y }]}>
          <MomoRig visual={visual} reduceMotion={reduceMotion} />
        </Group>
      </Canvas>
    </View>
  );
}
