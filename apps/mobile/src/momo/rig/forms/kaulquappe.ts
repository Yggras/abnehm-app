import { ellipse, petal, smooth, type Point } from '../geometry';
import { face, fill, joint, slot, type RigManifest } from '../types';

// Form 1, Kaulquappe (Level 1): großer runder Kopf, kurzer Flossenschwanz, keine Gliedmaßen; schwebt
// (Design-System › Momo). Vorlage: prototypes/momo-lagunenling/images/f1.webp. Maße sind Designwerte
// aus #187, nicht belegt.

const frond = (base: Point, tip: Point) => fill(petal(base, tip, 5.4), 'momoFrond');

export const kaulquappe: RigManifest = {
  form: 'kaulquappe',
  ground: { x: 50, y: 98 },
  face: { x: 48, y: 39, rotation: 0, scale: 1 },
  slots: {
    kopf: { x: 48, y: 12, rotation: 0, scale: 1 },
    hals: { x: 50, y: 60, rotation: 0, scale: 1 },
  },
  effects: { x: 84, y: 8 },
  root: {
    name: 'figur',
    origin: { x: 50, y: 98 },
    children: [
      joint('koerper', { x: 50, y: 98 }, [
        slot('hals', 'hinten'),
        joint('schwanz', { x: 56, y: 58 }, [
          fill(
            smooth([
              { x: 42, y: 52 },
              { x: 62, y: 50 },
              { x: 72, y: 60 },
              { x: 71, y: 72 },
              { x: 64, y: 82 },
              { x: 60, y: 89 },
              { x: 64, y: 97 },
              { x: 55, y: 95 },
              { x: 50, y: 87 },
              { x: 49, y: 76 },
              { x: 46, y: 66 },
              { x: 39, y: 60 },
            ]),
            'momoBody',
            { shade: true },
          ),
          // Bauchstreifen vom Kinn bis zur Schwanzspitze, an der Lichtseite des Schwanzes.
          fill(
            smooth([
              { x: 43, y: 59 },
              { x: 52, y: 60 },
              { x: 55, y: 68 },
              { x: 55, y: 78 },
              { x: 57, y: 88 },
              { x: 60, y: 95 },
              { x: 55, y: 93 },
              { x: 51.5, y: 85 },
              { x: 50.5, y: 75 },
              { x: 48, y: 66 },
            ]),
            'momoBelly',
          ),
        ]),
        joint('kopf', { x: 48, y: 58 }, [
          slot('kopf', 'hinten'),
          joint('wedel_links', { x: 22, y: 31 }, [
            frond({ x: 23, y: 27 }, { x: 11, y: 15 }),
            frond({ x: 21, y: 32 }, { x: 6, y: 30 }),
            frond({ x: 23, y: 37 }, { x: 11, y: 46 }),
          ]),
          joint('wedel_rechts', { x: 74, y: 31 }, [
            frond({ x: 73, y: 27 }, { x: 85, y: 15 }),
            frond({ x: 75, y: 32 }, { x: 90, y: 30 }),
            frond({ x: 73, y: 37 }, { x: 85, y: 46 }),
          ]),
          fill(ellipse(48, 36, 30, 25), 'momoBody', { shade: true }),
          fill(ellipse(34, 21, 7, 4), 'licht', { opacity: 0.45 }),
          face,
          slot('kopf', 'vorn'),
        ]),
        slot('hals', 'vorn'),
      ]),
    ],
  },
};
