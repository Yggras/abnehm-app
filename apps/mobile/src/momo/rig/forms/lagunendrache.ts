import { capsule, ellipse, petal, smooth, type Point } from '../geometry';
import { face, fill, joint, slot, type RigManifest } from '../types';

// Form 8, Lagunendrache (Level 43): sitzt wie eine Katze, Flügelfächer hinter dem Rücken, Schwanz um
// die Füße, Kiemenwedel zur Krone gewachsen (Design-System › Momo; Nutzerentscheidung 43b in #69).
// Vorlage: prototypes/momo-lagunenling/images/f8b.webp. Der Kopf ist größer als auf der Vorlage, damit
// das Gesicht bei 104 dp lesbar bleibt (README des Prototyps: „wird ab Level 26 aber klein“). Maße sind
// Designwerte aus #187, nicht belegt.

const lobe = (base: Point, tip: Point, r: number) => fill(petal(base, tip, r), 'momoFrond');
const frill = (centers: readonly Point[]) => centers.map(({ x, y }) => fill(ellipse(x, y, 3.6, 3.6), 'momoFrond'));

export const lagunendrache: RigManifest = {
  form: 'lagunendrache',
  ground: { x: 50, y: 98 },
  face: { x: 44, y: 28, rotation: 0, scale: 0.66 },
  slots: {
    kopf: { x: 45, y: 11, rotation: 0, scale: 1 },
    hals: { x: 41, y: 45, rotation: 0, scale: 0.75 },
  },
  effects: { x: 76, y: 6 },
  // Der schwere Körper springt weniger hoch als die Kaulquappe.
  amplitude: { figur: 0.6 },
  root: {
    name: 'figur',
    origin: { x: 50, y: 98 },
    children: [
      // Flügelfächer hinter dem Rücken, der hintere Flügel lugt links hervor.
      joint('fluegel', { x: 60, y: 52 }, [
        lobe({ x: 42, y: 52 }, { x: 27, y: 40 }, 6),
        lobe({ x: 58, y: 52 }, { x: 78, y: 30 }, 8.5),
        lobe({ x: 60, y: 55 }, { x: 88, y: 45 }, 8),
        lobe({ x: 61, y: 59 }, { x: 84, y: 63 }, 6.5),
      ]),
      joint('koerper', { x: 50, y: 98 }, [
        // Rückensaum vom Nacken bis zum Schwanzansatz.
        ...frill([
          { x: 55, y: 42 },
          { x: 60, y: 50 },
          { x: 66, y: 57 },
          { x: 73, y: 63 },
          { x: 79, y: 71 },
          { x: 82, y: 80 },
        ]),
        fill(
          smooth([
            { x: 36, y: 38 },
            { x: 50, y: 36 },
            { x: 56, y: 46 },
            { x: 62, y: 56 },
            { x: 72, y: 64 },
            { x: 80, y: 74 },
            { x: 80, y: 86 },
            { x: 72, y: 94 },
            { x: 50, y: 96 },
            { x: 34, y: 95 },
            { x: 29, y: 86 },
            { x: 31, y: 70 },
            { x: 33, y: 56 },
            { x: 34, y: 46 },
          ]),
          'momoBody',
          { shade: true },
        ),
        // Bauchstreifen vom Kinn die Brust hinab.
        fill(
          smooth([
            { x: 38, y: 42 },
            { x: 45, y: 44 },
            { x: 45, y: 58 },
            { x: 43, y: 74 },
            { x: 42, y: 89 },
            { x: 37, y: 89 },
            { x: 34.5, y: 74 },
            { x: 35, y: 58 },
            { x: 36, y: 48 },
          ]),
          'momoBelly',
        ),
        // Vorderbeine und Hinterfuß.
        fill(capsule({ x: 36, y: 83 }, { x: 35, y: 94 }, 4.2), 'momoBody'),
        fill(capsule({ x: 44, y: 84 }, { x: 44, y: 95 }, 4.2), 'momoBody'),
        fill(ellipse(62, 94.5, 7, 3.5), 'momoBody'),
        joint('schwanz', { x: 76, y: 88 }, [
          fill(
            smooth([
              { x: 70, y: 86 },
              { x: 86, y: 82 },
              { x: 95, y: 88 },
              { x: 90, y: 96 },
              { x: 70, y: 99 },
              { x: 40, y: 99 },
              { x: 22, y: 98 },
              { x: 13, y: 93 },
              { x: 12, y: 85 },
              { x: 17, y: 80 },
              { x: 23, y: 82 },
              { x: 21, y: 88 },
              { x: 30, y: 92 },
              { x: 50, y: 93 },
              { x: 72, y: 92 },
            ]),
            'momoBody',
            { shade: true },
          ),
        ]),
        slot('hals', 'hinten'),
        joint('kopf', { x: 44, y: 42 }, [
          slot('kopf', 'hinten'),
          joint('wedel_links', { x: 27, y: 22 }, [
            lobe({ x: 28, y: 19 }, { x: 17, y: 11 }, 3.8),
            lobe({ x: 27, y: 25 }, { x: 13, y: 24 }, 3.8),
            lobe({ x: 28, y: 31 }, { x: 17, y: 36 }, 3.4),
          ]),
          joint('wedel_rechts', { x: 61, y: 22 }, [
            lobe({ x: 60, y: 19 }, { x: 71, y: 11 }, 3.8),
            lobe({ x: 61, y: 25 }, { x: 75, y: 24 }, 3.8),
            lobe({ x: 60, y: 31 }, { x: 71, y: 36 }, 3.4),
          ]),
          // Krone: die Kiemenwedel sind über dem Scheitel zusammengewachsen.
          lobe({ x: 39, y: 14 }, { x: 33, y: 4 }, 3.6),
          lobe({ x: 45, y: 13 }, { x: 45, y: 1 }, 3.8),
          lobe({ x: 51, y: 14 }, { x: 57, y: 4 }, 3.6),
          fill(ellipse(44, 26, 19, 16), 'momoBody', { shade: true }),
          fill(ellipse(34, 17, 4.5, 2.6), 'licht', { opacity: 0.45 }),
          face,
          slot('kopf', 'vorn'),
        ]),
        slot('hals', 'vorn'),
      ]),
    ],
  },
};
