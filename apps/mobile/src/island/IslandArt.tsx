import type { MomoAppearance } from '@abnehm/contracts/island';
import type { ArtKey } from '@abnehm/game-rules/catalog';
import { Circle, Group, Oval, Path } from '@shopify/react-native-skia';
import { useEffect, type ReactNode } from 'react';
import { useDerivedValue, useSharedValue, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';

import { color, opacity, size, useMotion, type ColorToken } from '../design';
import { artOf, type ArtPrimitive } from './art';
import type { Point, Polygon } from './scene-model';

// Skia-Zeichnungen der Inselansicht. Flächig ohne Konturen und Verläufe, zweitönig mit Licht von
// links oben: rechte Hälften `opacity-shade-right`, linke Flächen `opacity-shade-left`, Schlagschatten
// nach rechts unten (`opacity-cast-shadow`; Design-System › Insel). Abgedunkelt wird mit `ink`, der
// dunkelsten Farbe der Tokens. Maße in dp bei Zoom 1; ein Feld ist `island-tile` breit. Die Objekte
// zeichnen ihre Grundformen aus `art.ts` (#192); Momo ist eine Vorzeichnung, bis das Skia-Rig aus #187
// sie ersetzt.

const tile = size.islandTile;
const shade = color.ink;

/** Momos rechte Körperhälfte: „10 % Schwarz“ (Design-System › Momo, Zeichenstil). */
const momoShade = 0.1;
/** Schein einer Laterne am Abend und Deckkraft der Wellen (Designwerte aus #182, nicht belegt). */
const lampGlowOpacity = 0.35;
const waveOpacity = 0.7;

/** SVG-Pfad eines Polygons; Skias `Path` nimmt SVG-Zeichenketten direkt. */
export function polygonPath(polygon: Polygon): string {
  return `${polygon.map(({ x, y }, index) => `${index === 0 ? 'M' : 'L'}${x} ${y}`).join(' ')} Z`;
}

/**
 * Kreis im Uhrzeigersinn wie die Rauten: Skia füllt nach der Nonzero-Regel, gegenläufige Teilpfade
 * höben sich dort auf, wo sie sich überlagern.
 */
function circlePath(x: number, y: number, r: number): string {
  return `M${x - r} ${y} a${r} ${r} 0 1 1 ${2 * r} 0 a${r} ${r} 0 1 1 ${-2 * r} 0 Z`;
}

/** Rechte Hälfte eines Kreises: die Schattenseite bei Licht von links oben. */
function rightHalf(x: number, y: number, r: number): string {
  return `M${x} ${y - r} A${r} ${r} 0 0 1 ${x} ${y + r} Z`;
}

/** Nebel eines gesperrten Gebiets: die Rauten seiner Felder plus eine Wolke über jedem Feld. */
export function fogPath(cells: readonly Polygon[]): string {
  return cells
    .map((cell) => {
      const [top, right, , left] = cell as [Point, Point, Point, Point];
      const center = { x: top.x, y: right.y };
      const radius = (right.x - left.x) * 0.3;
      return `${polygonPath(cell)} ${circlePath(center.x, center.y - radius * 0.6, radius)}`;
    })
    .join(' ');
}

function CastShadow({ at, width }: { at: Point; width: number }) {
  return <Oval x={at.x - width / 2 + 4} y={at.y - 2} width={width} height={width / 2.4} color={shade} opacity={opacity.castShadow} />;
}

/**
 * Ein Inselobjekt aus seinen Grundformen (`art.ts`) auf der Feldmitte `at`. Ein eben gebautes Objekt
 * (`appearing`) erscheint mit Feder (`spring-bouncy`), bei „Bewegung reduzieren“ als Überblendung in
 * `duration-fast` (Spezifikation 4, Abschnitt 7; Design-System › Bewegung).
 */
export function ObjectArt({ at, art, foliage, appearing = false }: { at: Point; art: ArtKey; foliage: ColorToken; appearing?: boolean }) {
  const { drawing } = artOf(art);
  const shapes = drawing.map((primitive, index) => <Primitive key={index} primitive={primitive} foliage={foliage} />);
  if (!appearing) return <Group transform={[{ translateX: at.x }, { translateY: at.y }]}>{shapes}</Group>;
  return (
    <Appear at={at}>
      {shapes}
    </Appear>
  );
}

/** Erscheinen eines eben gebauten Objekts: wächst federnd aus dem Feld oder blendet über. */
function Appear({ at, children }: { at: Point; children: ReactNode }) {
  const motion = useMotion('bounce');
  const grown = useSharedValue(0);
  useEffect(() => {
    grown.value = motion.type === 'spring' ? withSpring(1, motion.config) : withTiming(1, { duration: motion.type === 'crossfade' ? motion.duration : 0 });
    // Das Erscheinen gilt dem Einbau; ein späterer Wechsel der Einstellung animiert nichts neu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const springs = motion.type === 'spring';
  const transform = useDerivedValue(() => [
    { translateX: at.x },
    { translateY: at.y },
    { scale: springs ? Math.max(grown.value, 0) : 1 },
  ]);
  const fade = useDerivedValue(() => (springs ? 1 : grown.value));
  return (
    <Group transform={transform} opacity={fade}>
      {children}
    </Group>
  );
}

function Primitive({ primitive, foliage }: { primitive: ArtPrimitive; foliage: ColorToken }) {
  const fill = color[primitive.tone === 'laub' ? foliage : primitive.tone];
  switch (primitive.type) {
    case 'flaeche':
      return <Path path={polygonPath(primitive.points)} color={fill} opacity={primitive.opacity} />;
    case 'kreis':
      return <Circle cx={primitive.x} cy={primitive.y} r={primitive.r} color={fill} opacity={primitive.opacity} />;
    case 'halbkreis':
      return <Path path={rightHalf(primitive.x, primitive.y, primitive.r)} color={fill} opacity={primitive.opacity} />;
    case 'oval':
      return <Oval x={primitive.x} y={primitive.y} width={primitive.width} height={primitive.height} color={fill} opacity={primitive.opacity} />;
  }
}

/** Abends: Schein einer Laterne über der Abend-Überlagerung; `at` ist das Licht ihrer Grafik. */
export function LampGlow({ at }: { at: Point }) {
  return (
    <Group>
      <Circle cx={at.x} cy={at.y} r={12} color={color.islandLamp} opacity={lampGlowOpacity} />
      <Circle cx={at.x} cy={at.y} r={4} color={color.islandLamp} />
    </Group>
  );
}

const fullCircle = 2 * Math.PI;

/** Kleine Welle; sie wiegt sich mit dem Takt hin und her. */
export function Wave({ at, phase, progress }: { at: Point; phase: number; progress: SharedValue<number> }) {
  const transform = useDerivedValue(() => [{ translateX: Math.sin((progress.value + phase) * fullCircle) * 5 }]);
  return (
    <Group transform={transform}>
      <Path
        path={`M${at.x - 9} ${at.y} Q${at.x - 4.5} ${at.y - 4} ${at.x} ${at.y} Q${at.x + 4.5} ${at.y - 4} ${at.x + 9} ${at.y}`}
        style="stroke"
        strokeWidth={2}
        strokeCap="round"
        color={color.surfaceCard}
        opacity={waveOpacity}
      />
    </Group>
  );
}

/** Teilchen, das über der Insel aufsteigt und wieder verblasst. */
export function Particle({ at, phase, tone, progress }: { at: Point; phase: number; tone: ColorToken; progress: SharedValue<number> }) {
  const t = useDerivedValue(() => (progress.value + phase) % 1);
  const transform = useDerivedValue(() => [{ translateX: Math.sin(t.value * fullCircle) * 4 }, { translateY: -t.value * tile * 0.5 }]);
  const fade = useDerivedValue(() => Math.sin(t.value * Math.PI));
  return (
    <Group transform={transform} opacity={fade}>
      <Circle cx={at.x} cy={at.y - tile * 0.25} r={2.5} color={color[tone]} />
    </Group>
  );
}

/**
 * Momo auf der Insel, etwa ein Feld hoch, mit Ruheatmung. Vorzeichnung der Kaulquappe nach
 * `MomoFigure`, bis das Skia-Rig aus #187 sie ersetzt.
 */
export function MomoOnIsland({ at, appearance, progress }: { at: Point; appearance: MomoAppearance; progress: SharedValue<number> }) {
  const breath = useDerivedValue(() => [
    { translateX: at.x },
    { translateY: at.y },
    { scaleY: 1 + Math.sin(progress.value * fullCircle) * 0.03 },
  ]);
  const asleep = appearance.moodKey === 'schlaeft';
  if (appearance.stage === 'laichkugel') {
    return (
      <Group transform={breath}>
        <CastShadow at={{ x: 0, y: 0 }} width={tile * 0.45} />
        <Circle cx={0} cy={-14} r={14} color={color.momoBelly} />
        <Oval x={-6} y={-19} width={12} height={9} color={color.momoBody} />
      </Group>
    );
  }
  return (
    <Group transform={breath}>
      <CastShadow at={{ x: 0, y: 0 }} width={tile * 0.45} />
      <Oval x={6} y={-12} width={14} height={8} color={color.momoBody} />
      {[-1, 1].map((side) => (
        <Group key={side}>
          <Circle cx={side * 13} cy={-24} r={3.5} color={color.momoFrond} />
          <Circle cx={side * 15} cy={-19} r={3.5} color={color.momoFrond} />
          <Circle cx={side * 14} cy={-14} r={3} color={color.momoFrond} />
        </Group>
      ))}
      <Oval x={-13} y={-28} width={26} height={26} color={color.momoBody} />
      <Path path={rightHalf(0, -15, 13)} color={shade} opacity={momoShade} />
      <Oval x={-8} y={-16} width={16} height={11} color={color.momoBelly} />
      {asleep ? (
        <>
          <Path path="M-6.5 -18 L-2.5 -18 M2.5 -18 L6.5 -18" style="stroke" strokeWidth={1.5} strokeCap="round" color={color.ink} />
        </>
      ) : (
        <>
          <Circle cx={-4.5} cy={-18} r={1.8} color={color.ink} />
          <Circle cx={4.5} cy={-18} r={1.8} color={color.ink} />
        </>
      )}
      <Circle cx={-8} cy={-14} r={2} color={color.momoCheek} opacity={opacity.cheek} />
      <Circle cx={8} cy={-14} r={2} color={color.momoCheek} opacity={opacity.cheek} />
    </Group>
  );
}
