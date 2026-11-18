import { Group, Path, type Transforms3d } from '@shopify/react-native-skia';
import { createContext, use } from 'react';
import { useDerivedValue } from 'react-native-reanimated';

import { color } from '../design';
import type { AccessoryShape } from './rig/accessories';
import { keyMotion, poseOf, type JointPose, type PoseTarget, type RigMood } from './rig/clips';
import { effectsOf, expression } from './rig/face';
import type { Point } from './rig/geometry';
import type { Anchor, Joint, RigNode, RigShape, SlotName } from './rig/types';
import { shadeOf } from './shade';
import { useMomoMotion, type MomoDrive } from './use-momo-motion';
import type { MomoVisual, WornAccessory } from './visual';

// Zeichnet das Momo-Rig mit Skia: Gelenke als verschachtelte Gruppen mit Ursprung, die Reanimated über
// die Clips dreht, hebt und atmen lässt ([Skia-Doku: Group](https://shopify.github.io/react-native-skia/docs/group),
// [Animationen](https://shopify.github.io/react-native-skia/docs/animations/animations)). Flächig ohne
// Konturen und Verläufe; schattierte Flächen dunkelt rechts unten eine Sichel in `ink` mit 10 % ab
// (Design-System › Momo, Zeichenstil; `shade.ts`). Gezeichnet wird im Rahmen 100 × 100 des Manifests; Größe und Ort
// setzt der Aufrufer: `MomoFigure` außerhalb der Insel, `IslandArt` im Insel-Canvas.

/** Schattenseite „10 % Schwarz“ (Design-System › Momo, Zeichenstil). */
const shadeOpacity = 0.1;

type Rig = Readonly<{ visual: MomoVisual; drive: MomoDrive | null }>;
const RigContext = createContext<Rig | null>(null);
const useRig = (): Rig => {
  const rig = use(RigContext);
  if (rig === null) throw new Error('Rig-Knoten außerhalb von MomoRig');
  return rig;
};

export function MomoRig({ visual, reduceMotion }: { visual: MomoVisual; reduceMotion: boolean }) {
  const drive = useMomoMotion(visual.mood, reduceMotion);
  return (
    <RigContext value={{ visual, drive: reduceMotion ? null : drive }}>
      <JointView joint={visual.manifest.root} />
    </RigContext>
  );
}

function toTransform(pose: JointPose): Transforms3d {
  'worklet';
  return [
    { translateX: pose.x },
    { translateY: pose.y },
    { rotate: (pose.rotation * Math.PI) / 180 },
    { scaleX: pose.scale },
    { scaleY: pose.scale * pose.scaleY },
  ];
}

/** Transformation eines Gelenks: bei erlaubter Bewegung ein abgeleiteter Wert, sonst die feste Schlüsselpose. */
function usePose(target: PoseTarget, amplitude: number) {
  const { visual, drive } = useRig();
  const mood: RigMood = visual.mood;
  const key = poseOf(mood, target, keyMotion(mood), amplitude);
  const moving = useDerivedValue(() =>
    drive === null ? toTransform(key) : toTransform(poseOf(mood, target, { phase: drive.phase.value, lift: drive.lift.value, burst: drive.burst.value }, amplitude)),
  );
  const fade = useDerivedValue(() =>
    drive === null ? key.opacity : poseOf(mood, target, { phase: drive.phase.value, lift: drive.lift.value, burst: drive.burst.value }, amplitude).opacity,
  );
  return drive === null ? { transform: toTransform(key), opacity: key.opacity } : { transform: moving, opacity: fade };
}

function JointView({ joint }: { joint: Joint }) {
  const { visual } = useRig();
  const { transform } = usePose(joint.name, visual.manifest.amplitude?.[joint.name] ?? 1);
  return (
    <Group origin={joint.origin} transform={transform}>
      {joint.children.map((node, index) => (
        <NodeView key={index} node={node} />
      ))}
      {joint.name === 'figur' ? <Effects /> : null}
    </Group>
  );
}

function NodeView({ node }: { node: RigNode }) {
  switch (node.type) {
    case 'flaeche':
      return <Shape shape={node.shape} />;
    case 'gelenk':
      return <JointView joint={node.joint} />;
    case 'gesicht':
      return <Face />;
    case 'steckplatz':
      return <Slot slot={node.slot} />;
  }
}

function fillOf(tone: RigShape['tone'] | AccessoryShape['tone']): string {
  return tone === 'licht' ? color.surfaceCard : color[tone];
}

/** Fläche; mit `shade` liegt eine Sichel an ihrer rechten und unteren Kante im Schatten. */
function Shape({ shape }: { shape: RigShape | AccessoryShape }) {
  const shade = shape.shade ? shadeOf(shape.path) : null;
  return (
    <Group>
      <Path path={shape.path} color={fillOf(shape.tone)} opacity={'opacity' in shape ? shape.opacity : undefined} />
      {shade === null ? null : <Path path={shade} color={color.ink} opacity={shadeOpacity} />}
    </Group>
  );
}

function anchored(anchor: Anchor, fit?: WornAccessory['fit']): Transforms3d {
  return [
    { translateX: anchor.x + (fit?.x ?? 0) },
    { translateY: anchor.y + (fit?.y ?? 0) },
    { rotate: ((anchor.rotation + (fit?.rotation ?? 0)) * Math.PI) / 180 },
    { scale: anchor.scale * (fit?.scale ?? 1) },
  ];
}

/** Das gemeinsame Gesicht am Anker der Form. */
function Face() {
  const { visual } = useRig();
  return (
    <Group transform={anchored(visual.manifest.face)}>
      {expression(visual.mood).map((shape, index) => (
        <Path key={index} path={shape.path} color={fillOf(shape.tone)} opacity={shape.opacity} />
      ))}
    </Group>
  );
}

/** Hinter- oder Vorderteil eines getragenen Accessoires am Steckplatz, eingepasst mit der Passung der Form. */
function Slot({ slot }: { slot: SlotName }) {
  const { visual } = useRig();
  const [place, side] = slot.split('.') as ['kopf' | 'hals', 'hinten' | 'vorn'];
  const worn = visual.accessories[place];
  const shapes = worn === null ? [] : (worn.art[side] ?? []);
  if (worn === null || shapes.length === 0) return null;
  return (
    <Group transform={anchored(visual.manifest.slots[place], worn.fit)}>
      {shapes.map((shape, index) => (
        <Shape key={index} shape={shape} />
      ))}
    </Group>
  );
}

/** Zeichen über dem Kopf: Funken, Fragezeichen, „z z“ oder Mond. */
function Effects() {
  const { visual } = useRig();
  const shapes = effectsOf(visual.mood);
  const { transform, opacity } = usePose('effekt', 1);
  if (shapes.length === 0) return null;
  const at: Point = visual.manifest.effects;
  return (
    <Group transform={[{ translateX: at.x }, { translateY: at.y }]}>
      <Group transform={transform} opacity={opacity}>
        {shapes.map((shape, index) => (
          <Path key={index} path={shape.path} color={color[shape.tone]} />
        ))}
      </Group>
    </Group>
  );
}
