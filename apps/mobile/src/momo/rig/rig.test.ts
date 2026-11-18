import { accessoryArt } from './accessories';
import { keyMotion, motionInputs, poseOf, rigMoods } from './clips';
import { expression, effectsOf } from './face';
import { manifests, nodesOf, type RigManifest } from './manifest';

// Nachweis für #187: Regeln des Momo-Rigs als Daten (Spezifikation 4, Abschnitt 6; Recherche
// Produktionsstrategie, Abschnitt 7; Design-System › Momo).

const forms = Object.values(manifests);
const hatchedForms = forms.filter((manifest) => manifest.form !== 'laichkugel');

describe('Rig-Manifeste', () => {
  test('der vertikale Schnitt hat Form 1, Form 8 und die Laichkugel', () => {
    expect(forms.map((manifest) => manifest.form).sort()).toEqual(['kaulquappe', 'lagunendrache', 'laichkugel']);
  });

  test.each(forms.map((manifest) => [manifest.form, manifest] as const))('%s zeichnet nur flächig in Momos Token-Farben', (_, manifest) => {
    const tones = new Set(nodesOf(manifest).flatMap((node) => (node.type === 'flaeche' ? [node.shape.tone] : [])));
    for (const tone of tones) expect(['momoBody', 'momoBelly', 'momoFrond', 'momoCheek', 'ink', 'licht']).toContain(tone);
    expect(tones).toContain('momoBody');
  });

  test.each(hatchedForms.map((manifest) => [manifest.form, manifest] as const))(
    '%s trennt Form, Gesicht und Accessoires: ein Gesicht, vier Steckplätze',
    (_, manifest) => {
      const nodes = nodesOf(manifest);
      expect(nodes.filter((node) => node.type === 'gesicht')).toHaveLength(1);
      const slots = nodes.flatMap((node) => (node.type === 'steckplatz' ? [`${node.place}.${node.side}`] : []));
      expect(slots.sort()).toEqual(['hals.hinten', 'hals.vorn', 'kopf.hinten', 'kopf.vorn']);
    },
  );

  test.each(hatchedForms.map((manifest) => [manifest.form, manifest] as const))('%s hat Kiemenwedel an beiden Kopfseiten', (_, manifest) => {
    const joints = jointNames(manifest);
    expect(joints).toEqual(expect.arrayContaining(['figur', 'koerper', 'kopf', 'wedel_links', 'wedel_rechts', 'schwanz']));
  });

  test.each(forms.map((manifest) => [manifest.form, manifest] as const))('%s steht im Rahmen von 100 × 100 mit dem Bodenpunkt unten', (_, manifest) => {
    expect(manifest.ground.y).toBeGreaterThan(90);
    expect(manifest.ground.y).toBeLessThanOrEqual(100);
    expect(manifest.ground.x).toBe(50);
  });

  test('die Formen haben eigene Umrisse, nicht nur eine andere Größe', () => {
    const outline = (manifest: RigManifest) =>
      nodesOf(manifest)
        .flatMap((node) => (node.type === 'flaeche' ? [node.shape.path] : []))
        .join(' ');
    expect(outline(manifests.kaulquappe)).not.toEqual(outline(manifests.lagunendrache));
  });
});

describe('Gesicht', () => {
  test('jede Stimmung hat einen eigenen Ausdruck', () => {
    const faces = rigMoods.map((mood) => JSON.stringify(expression(mood)));
    // „wartet im Ei“ trägt das schlafende Gesicht; alle sechs Stimmungen unterscheiden sich.
    expect(new Set(faces.filter((_, index) => rigMoods[index] !== 'wartet_im_ei')).size).toBe(6);
  });

  test('ist flächig in `ink`, `licht` und `momoCheek`', () => {
    for (const mood of rigMoods) for (const shape of expression(mood)) expect(['ink', 'licht', 'momoCheek']).toContain(shape.tone);
  });

  test.each([
    ['begeistert', 'energy', 3],
    ['neugierig', 'hint', 3],
    ['doest', 'inkMuted', 2],
    ['schlaeft', 'islandLamp', 1],
  ] as const)('%s zeigt Zeichen in %s (Design-System › Momo)', (mood, tone, count) => {
    const effects = effectsOf(mood);
    expect(effects).toHaveLength(count);
    for (const effect of effects) expect(effect.tone).toBe(tone);
  });

  test.each(['zufrieden', 'freut_sich', 'wartet_im_ei'] as const)('%s zeigt keine Zeichen', (mood) => {
    expect(effectsOf(mood)).toEqual([]);
  });
});

describe('Accessoires', () => {
  test('Kopf-Accessoires sind nie in `momo-frond` und nicht in derselben Farbe', () => {
    const head = accessoryArt.strohhuetchen!;
    for (const shape of [...(head.hinten ?? []), ...head.vorn]) expect(['momoFrond', 'momoCheek']).not.toContain(shape.tone);
  });

  test('jedes Accessoire ist einmal gezeichnet, für alle Formen', () => {
    expect(Object.keys(accessoryArt).sort()).toEqual(['muschelkette', 'strohhuetchen']);
  });
});

describe('Clips', () => {
  const joints = ['figur', 'koerper', 'kopf', 'wedel_links', 'wedel_rechts', 'schwanz', 'fluegel', 'effekt'] as const;

  test.each(rigMoods)('%s bewegt sich bei erlaubter Bewegung', (mood) => {
    const poses = [0, 0.25, 0.5, 0.75].map((phase) => joints.map((joint) => poseOf(mood, joint, { phase, lift: 0, burst: 0.5 }, 1)));
    expect(new Set(poses.map((pose) => JSON.stringify(pose))).size).toBeGreaterThan(1);
  });

  test.each(rigMoods)('%s hat bei reduzierter Bewegung eine feste Schlüsselpose', (mood) => {
    const key = keyMotion(mood);
    expect(motionInputs(mood, { reduceMotion: true })).toEqual(key);
    const pose = joints.map((joint) => poseOf(mood, joint, key, 1));
    expect(pose.every((p) => [p.x, p.y, p.rotation, p.scale, p.scaleY, p.opacity].every(Number.isFinite))).toBe(true);
  });

  test('die Schlüsselposen der Stimmungen unterscheiden sich', () => {
    const keyPoses = rigMoods.map((mood) => JSON.stringify(joints.map((joint) => poseOf(mood, joint, keyMotion(mood), 1))));
    expect(new Set(keyPoses).size).toBe(rigMoods.length);
  });

  test('freut sich: Kiemenwedel hoch, links im und rechts gegen den Uhrzeigersinn', () => {
    const key = keyMotion('freut_sich');
    expect(poseOf('freut_sich', 'wedel_links', key, 1).rotation).toBeGreaterThan(10);
    expect(poseOf('freut_sich', 'wedel_rechts', key, 1).rotation).toBeLessThan(-10);
  });

  test('Hüpfer und Sprung heben die Figur, der Sprung höher', () => {
    const lifted = { phase: 0, lift: 1, burst: 0.5 };
    const hop = poseOf('freut_sich', 'figur', lifted, 1).y;
    const jump = poseOf('begeistert', 'figur', lifted, 1).y;
    expect(hop).toBeLessThan(0);
    expect(jump).toBeLessThan(hop);
  });

  test('die Funken des Sprungs leuchten auf und verglühen', () => {
    const at = (burst: number) => poseOf('begeistert', 'effekt', { phase: 0, lift: 0, burst }, 1).opacity;
    expect(at(0)).toBeCloseTo(0);
    expect(at(0.5)).toBeCloseTo(1);
    expect(at(1)).toBeCloseTo(0);
  });

  test('die Laichkugel wippt um ihren Bodenpunkt', () => {
    const tilt = (phase: number) => poseOf('wartet_im_ei', 'figur', { phase, lift: 0, burst: 0 }, 1).rotation;
    expect(tilt(0.25)).toBeGreaterThan(0);
    expect(tilt(0.75)).toBeLessThan(0);
  });

  test('formspezifische Korrekturen skalieren den Ausschlag', () => {
    const at = { phase: 0.25, lift: 0, burst: 0 };
    expect(poseOf('zufrieden', 'schwanz', at, 0.5).rotation).toBeCloseTo(poseOf('zufrieden', 'schwanz', at, 1).rotation / 2);
  });
});

function jointNames(manifest: RigManifest): string[] {
  return [manifest.root.name, ...nodesOf(manifest).flatMap((node) => (node.type === 'gelenk' ? [node.joint.name] : []))];
}
