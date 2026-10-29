import type { MomoAppearance } from '@abnehm/contracts/island';
import type { ArtKey } from '@abnehm/game-rules/catalog';
import { Circle, Group, Oval, Path } from '@shopify/react-native-skia';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

import { color, opacity, size, type ColorToken } from '../design';
import { artOf, type ArtShape } from './art';
import type { Point, Polygon } from './scene-model';

// Skia-Zeichnungen der Inselansicht. Flächig ohne Konturen und Verläufe, zweitönig mit Licht von
// links oben: rechte Hälften `opacity-shade-right`, linke Flächen `opacity-shade-left`, Schlagschatten
// nach rechts unten (`opacity-cast-shadow`; Design-System › Insel). Abgedunkelt wird mit `ink`, der
// dunkelsten Farbe der Tokens. Maße in dp bei Zoom 1; ein Feld ist `island-tile` breit. Objekte und
// Momo sind Vorzeichnungen: Die endgültigen Grafiken der Start-Baupläne kommen mit dem Bau-Modus
// (#192), Momo als Skia-Rig mit #187.

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

/** Quader auf dem Boden, Grundriss eine Raute mit halber Breite `a`, Höhe `h`. */
function Box({ at, a, h, top, side }: { at: Point; a: number; h: number; top: ColorToken; side: ColorToken }) {
  const b = a / 2;
  const { x, y } = at;
  const left = polygonPath([{ x: x - a, y: y - h }, { x, y: y - h + b }, { x, y: y + b }, { x: x - a, y }]);
  const right = polygonPath([{ x, y: y - h + b }, { x: x + a, y: y - h }, { x: x + a, y }, { x, y: y + b }]);
  return (
    <Group>
      <Path path={left} color={color[side]} />
      <Path path={left} color={shade} opacity={opacity.shadeLeft} />
      <Path path={right} color={color[side]} />
      <Path path={right} color={shade} opacity={opacity.shadeRight} />
      <Path path={polygonPath([{ x, y: y - h - b }, { x: x + a, y: y - h }, { x, y: y - h + b }, { x: x - a, y: y - h }])} color={color[top]} />
    </Group>
  );
}

function CastShadow({ at, width }: { at: Point; width: number }) {
  return <Oval x={at.x - width / 2 + 4} y={at.y - 2} width={width} height={width / 2.4} color={shade} opacity={opacity.castShadow} />;
}

/** Wie hoch über der Feldmitte eine Laterne leuchtet. */
export const lampHeight = tile * 0.5;

/** Blüten der Blumenwiese, flach auf dem Feld. */
const flowers: readonly Readonly<{ x: number; y: number; tone: ColorToken }>[] = [
  { x: -10, y: 0, tone: 'islandLamp' },
  { x: -3, y: -4, tone: 'islandRoof' },
  { x: 5, y: -1, tone: 'surfaceCard' },
  { x: 11, y: 2, tone: 'islandLamp' },
  { x: 0, y: 4, tone: 'islandRoof' },
];

/** Ein Inselobjekt; jede Stufe ist etwas größer (Design-System › Insel). */
export function ObjectArt({ at, art, foliage }: { at: Point; art: ArtKey; foliage: ColorToken }) {
  const { shape, stage } = artOf(art);
  const scale = 1 + (stage - 1) * 0.15;
  return (
    <Group transform={[{ translateX: at.x }, { translateY: at.y }, { scale }]}>
      <Shape shape={shape} foliage={foliage} />
    </Group>
  );
}

/** Zeichnungen um den Ursprung, die Feldmitte. */
function Shape({ shape, foliage }: { shape: ArtShape; foliage: ColorToken }) {
  const origin = { x: 0, y: 0 };
  switch (shape) {
    case 'baum':
      return (
        <Group>
          <CastShadow at={origin} width={tile * 0.45} />
          <Path path={polygonPath([{ x: -2, y: -18 }, { x: 2, y: -18 }, { x: 2, y: 0 }, { x: -2, y: 0 }])} color={color.islandEarth} />
          <Circle cx={0} cy={-26} r={12} color={color[foliage]} />
          <Path path={rightHalf(0, -26, 12)} color={shade} opacity={opacity.shadeRight} />
          <Circle cx={-4} cy={-28} r={2} color={color.islandRoof} />
          <Circle cx={5} cy={-23} r={2} color={color.islandRoof} />
        </Group>
      );
    case 'busch':
      return (
        <Group>
          <CastShadow at={origin} width={tile * 0.4} />
          <Circle cx={-4} cy={-7} r={8} color={color[foliage]} />
          <Circle cx={5} cy={-6} r={7} color={color[foliage]} />
          <Path path={rightHalf(5, -6, 7)} color={shade} opacity={opacity.shadeRight} />
          <Circle cx={-6} cy={-9} r={1.8} color={color.islandRoofAlt} />
          <Circle cx={-1} cy={-5} r={1.8} color={color.islandRoofAlt} />
          <Circle cx={6} cy={-8} r={1.8} color={color.islandRoofAlt} />
        </Group>
      );
    case 'blumen':
      return (
        <Group>
          {flowers.map(({ x, y, tone }) => (
            <Circle key={`${x}:${y}`} cx={x} cy={y} r={2.5} color={color[tone]} />
          ))}
        </Group>
      );
    case 'weg':
      // Flach auf dem Feld: eine Holzfläche ohne Seiten, damit sie nicht wie ein Körper wirkt.
      return <Path path={polygonPath([{ x: 0, y: -11 }, { x: 22, y: 0 }, { x: 0, y: 11 }, { x: -22, y: 0 }])} color={color.islandWood} />;
    case 'bank':
      return (
        <Group>
          <CastShadow at={origin} width={tile * 0.4} />
          <Box at={{ x: 0, y: 2 }} a={11} h={6} top="islandWood" side="islandWood" />
          <Box at={{ x: -3, y: -2 }} a={9} h={12} top="islandWood" side="islandWood" />
        </Group>
      );
    case 'laterne':
      return (
        <Group>
          <CastShadow at={origin} width={tile * 0.25} />
          <Path path={polygonPath([{ x: -1.5, y: -lampHeight + 4 }, { x: 1.5, y: -lampHeight + 4 }, { x: 1.5, y: 0 }, { x: -1.5, y: 0 }])} color={color.islandWood} />
          <Box at={{ x: 0, y: -lampHeight + 5 }} a={5} h={8} top="islandRoofAlt" side="islandLamp" />
        </Group>
      );
    case 'block':
      return (
        <Group>
          <CastShadow at={origin} width={tile * 0.6} />
          <Box at={{ x: 0, y: 0 }} a={tile * 0.28} h={18} top="islandRoof" side="islandSand" />
        </Group>
      );
  }
}

/** Abends: Schein einer Laterne über der Abend-Überlagerung. */
export function LampGlow({ at }: { at: Point }) {
  return (
    <Group>
      <Circle cx={at.x} cy={at.y - lampHeight + 1} r={12} color={color.islandLamp} opacity={lampGlowOpacity} />
      <Circle cx={at.x} cy={at.y - lampHeight + 1} r={4} color={color.islandLamp} />
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
