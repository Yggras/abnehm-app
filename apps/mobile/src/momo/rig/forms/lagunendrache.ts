import { capsule, ellipse, smooth, type Point } from '../geometry';
import { face, fill, joint, slot, type RigManifest } from '../types';

// Form 8, Lagunendrache (Level 43): sitzt wie eine Katze, Flügelfächer hinter dem Rücken, Schwanz um
// die Füße, Kiemenwedel zur Krone gewachsen (Design-System › Momo; Nutzerentscheidung 43b in #69).
// Vorlage: prototypes/momo-lagunenling/images/f8b.webp. Der Kopf ist größer als auf der Vorlage, damit
// das Gesicht bei 104 dp lesbar bleibt (README des Prototyps: „wird ab Level 26 aber klein“). Maße sind
// Designwerte aus #187, nicht belegt.

const lobe = (from: Point, to: Point, r: number) => fill(capsule(from, to, r), 'momoFrond');
const frill = (centers: readonly Point[]) => centers.map(({ x, y }) => fill(ellipse(x, y, 4, 4), 'momoFrond'));

export const lagunendrache: RigManifest = {
  form: 'lagunendrache',
  ground: { x: 50, y: 98 },
  lightAxis: 50,
  face: { x: 44, y: 29, rotation: 0, scale: 0.62 },
  slots: {
    kopf: { x: 44, y: 13, rotation: 0, scale: 0.9 },
    hals: { x: 42, y: 45, rotation: 0, scale: 0.75 },
  },
  effects: { x: 72, y: 6 },
  // Der schwere Körper springt weniger hoch als die Kaulquappe.
  amplitude: { figur: 0.8 },
  root: {
    name: 'figur',
    origin: { x: 50, y: 98 },
    children: [
      joint('fluegel', { x: 58, y: 52 }, [
        lobe({ x: 40, y: 50 }, { x: 20, y: 34 }, 6.5),
        lobe({ x: 40, y: 54 }, { x: 14, y: 48 }, 5.5),
        lobe({ x: 58, y: 52 }, { x: 78, y: 24 }, 9),
        lobe({ x: 60, y: 54 }, { x: 92, y: 34 }, 8.5),
        lobe({ x: 62, y: 58 }, { x: 92, y: 52 }, 7.5),
        fill(
          smooth([
            { x: 54, y: 48 },
            { x: 70, y: 36 },
            { x: 84, y: 40 },
            { x: 86, y: 56 },
            { x: 66, y: 64 },
          ]),
          'momoFrond',
        ),
      ]),
      joint('koerper', { x: 50, y: 98 }, [
        // Rückensaum vom Nacken bis zum Ansatz des Schwanzes.
        ...frill([
          { x: 56, y: 40 },
          { x: 62, y: 48 },
          { x: 68, y: 56 },
          { x: 73, y: 64 },
          { x: 77, y: 72 },
          { x: 80, y: 80 },
        ]),
        fill(
          smooth([
            { x: 38, y: 36 },
            { x: 50, y: 34 },
            { x: 58, y: 44 },
            { x: 66, y: 58 },
            { x: 76, y: 72 },
            { x: 77, y: 86 },
            { x: 68, y: 95 },
            { x: 46, y: 96 },
            { x: 32, y: 93 },
            { x: 30, y: 80 },
            { x: 32, y: 64 },
            { x: 35, y: 50 },
          ]),
          'momoBody',
          { shade: true },
        ),
        fill(ellipse(64, 84, 13, 11), 'momoBody', { shade: true }),
        // Bauchstreifen vom Kinn die Brust hinab.
        fill(
          smooth([
            { x: 39, y: 40 },
            { x: 46, y: 42 },
            { x: 46, y: 58 },
            { x: 44, y: 76 },
            { x: 43, y: 92 },
            { x: 36, y: 92 },
            { x: 34, y: 76 },
            { x: 35, y: 58 },
            { x: 36, y: 46 },
          ]),
          'momoBelly',
        ),
        fill(capsule({ x: 36, y: 80 }, { x: 35, y: 94 }, 4.6), 'momoBody', { shade: true }),
        fill(capsule({ x: 46, y: 81 }, { x: 47, y: 95 }, 4.6), 'momoBody', { shade: true }),
        joint('schwanz', { x: 72, y: 88 }, [
          fill(
            smooth([
              { x: 66, y: 86 },
              { x: 84, y: 84 },
              { x: 92, y: 90 },
              { x: 86, y: 97 },
              { x: 60, y: 98 },
              { x: 30, y: 98 },
              { x: 18, y: 95 },
              { x: 12, y: 88 },
              { x: 16, y: 82 },
              { x: 22, y: 84 },
              { x: 24, y: 90 },
              { x: 40, y: 92 },
              { x: 62, y: 92 },
            ]),
            'momoBody',
            { shade: true },
          ),
          fill(
            smooth([
              { x: 28, y: 95.5 },
              { x: 60, y: 95.5 },
              { x: 84, y: 94 },
              { x: 62, y: 97.5 },
              { x: 30, y: 97.5 },
            ]),
            'momoBelly',
          ),
        ]),
        slot('hals.hinten'),
        joint('kopf', { x: 44, y: 42 }, [
          slot('kopf.hinten'),
          joint('wedel_links', { x: 28, y: 22 }, [
            lobe({ x: 28, y: 20 }, { x: 17, y: 10 }, 3.6),
            lobe({ x: 27, y: 25 }, { x: 13, y: 23 }, 3.6),
            lobe({ x: 28, y: 30 }, { x: 17, y: 35 }, 3.4),
          ]),
          joint('wedel_rechts', { x: 60, y: 22 }, [
            lobe({ x: 60, y: 20 }, { x: 71, y: 10 }, 3.6),
            lobe({ x: 61, y: 25 }, { x: 75, y: 23 }, 3.6),
            lobe({ x: 60, y: 30 }, { x: 71, y: 35 }, 3.4),
          ]),
          // Krone: die Kiemenwedel sind über dem Scheitel zusammengewachsen.
          lobe({ x: 40, y: 14 }, { x: 34, y: 3 }, 3.2),
          lobe({ x: 44, y: 13 }, { x: 44, y: 1 }, 3.2),
          lobe({ x: 48, y: 14 }, { x: 54, y: 3 }, 3.2),
          fill(ellipse(44, 27, 18, 15), 'momoBody', { shade: true }),
          fill(ellipse(34, 19, 4.5, 2.6), 'licht', { opacity: 0.45 }),
          face,
          slot('kopf.vorn'),
        ]),
        slot('hals.vorn'),
      ]),
    ],
  },
};
