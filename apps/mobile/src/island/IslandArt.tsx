import type { MomoAppearance } from '@abnehm/contracts/island';
import type { ArtKey } from '@abnehm/game-rules/catalog';
import { gameCatalog } from '@abnehm/game-rules/content';
import { Circle, Group, Oval, Path } from '@shopify/react-native-skia';
import { useEffect, useMemo, type ReactNode } from 'react';
import { Easing, useDerivedValue, useSharedValue, withDelay, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';

import { color, size, useMotion, type ColorToken } from '../design';
import { MomoRig, momoVisual } from '../momo';
import { artOf, shadow, type ArtPrimitive } from './art';
import type { Point, Polygon } from './scene-model';
import { transformationMotion } from './transformation-motion';

// Skia-Zeichnungen der Inselansicht. Flächig ohne Konturen und Verläufe, zweitönig mit Licht von
// links oben: rechte Hälften `opacity-shade-right`, linke Flächen `opacity-shade-left`, Schlagschatten
// nach rechts unten (`opacity-cast-shadow`; Design-System › Insel). Abgedunkelt wird mit `ink`, der
// dunkelsten Farbe der Tokens. Maße in dp bei Zoom 1; ein Feld ist `island-tile` breit. Die Objekte
// zeichnen ihre Grundformen aus `art.ts` (#192), Momo zeichnet das Skia-Rig aus `src/momo` (#187).

const tile = size.islandTile;

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
 * Momos Rahmen auf der Insel: das Rig steht in 100 × 100 Einheiten, hier 40 dp groß; die Figur ist damit
 * etwa ein Feld hoch (Spezifikation 4, Abschnitt 6; 40 px als Annäherung aus prototypes/momo-lagunenling,
 * Designwert, nicht belegt).
 */
const momoOnIslandFrame = 40;

/**
 * Momo auf der Insel: das Skia-Rig (`src/momo`) mit dem Bodenpunkt auf der Feldmitte, darunter der
 * Schlagschatten. Momo steht in der Zeichenliste zwischen den Objekten, ein Objekt weiter vorn verdeckt
 * ihn also (Szenenmodell, Zeichenreihenfolge Zeile + Spalte).
 */
/**
 * Verwandlungsszene (#204): Die alte Form blendet aus, die neue ein, beide werden dabei kurz größer und wieder
 * kleiner, um Momos Bodenpunkt. Takt und Größe aus `transformationMotion`; mit „Bewegung reduzieren“ eine reine
 * Überblendung in `duration-fast`.
 */
export function MomoTransforming({ at, from, appearance, reduceMotion }: { at: Point; from: MomoAppearance; appearance: MomoAppearance; reduceMotion: boolean }) {
  const { morph, grow } = transformationMotion(reduceMotion);
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withTiming(1, { duration: morph, easing: Easing.inOut(Easing.quad) });
    // Die Szene gilt der einen Verwandlung; ein späterer Wechsel der Einstellung animiert nichts neu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const transform = useDerivedValue(() => {
    const scale = 1 + grow * Math.sin(Math.PI * progress.value);
    return [{ translateX: at.x }, { translateY: at.y }, { scale }, { translateX: -at.x }, { translateY: -at.y }];
  });
  const fadeOut = useDerivedValue(() => 1 - progress.value);
  return (
    <Group transform={transform}>
      <Group opacity={fadeOut}>
        <MomoOnIsland at={at} appearance={from} reduceMotion={reduceMotion} />
      </Group>
      <Group opacity={progress}>
        <MomoOnIsland at={at} appearance={appearance} reduceMotion={reduceMotion} />
      </Group>
    </Group>
  );
}

/** Nebel über einem eben freigeschalteten Gebiet: Er zieht nach der Verwandlung ab (#204). */
export function LiftingFog({ cells, tone, opacity, reduceMotion }: { cells: readonly Polygon[]; tone: ColorToken; opacity: number; reduceMotion: boolean }) {
  const { morph, lift } = transformationMotion(reduceMotion);
  const fade = useSharedValue(opacity);
  useEffect(() => {
    fade.value = withDelay(morph, withTiming(0, { duration: lift, easing: Easing.out(Easing.quad) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const path = useMemo(() => fogPath(cells), [cells]);
  return <Path path={path} color={color[tone]} opacity={fade} />;
}

export function MomoOnIsland({ at, appearance, reduceMotion }: { at: Point; appearance: MomoAppearance; reduceMotion: boolean }) {
  const visual = useMemo(() => momoVisual(appearance, appearance.moodKey ?? 'zufrieden', gameCatalog), [appearance]);
  const k = momoOnIslandFrame / 100;
  const { ground } = visual.manifest;
  return (
    <Group>
      <Group transform={[{ translateX: at.x }, { translateY: at.y }]}>
        <Primitive primitive={shadow(tile * 0.45)} foliage="islandFoliage" />
      </Group>
      <Group transform={[{ translateX: at.x - ground.x * k }, { translateY: at.y - ground.y * k }, { scale: k }]}>
        <MomoRig visual={visual} reduceMotion={reduceMotion} />
      </Group>
    </Group>
  );
}
