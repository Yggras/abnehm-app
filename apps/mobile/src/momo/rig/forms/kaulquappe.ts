import { capsule, ellipse, smooth } from '../geometry';
import { face, fill, joint, slot, type RigManifest } from '../types';

// Form 1, Kaulquappe (Level 1): großer runder Kopf, kurzer Flossenschwanz, keine Gliedmaßen; schwebt
// (Design-System › Momo). Vorlage: prototypes/momo-lagunenling/images/f1.webp. Maße sind Designwerte
// aus #187, nicht belegt.

const frond = (from: { x: number; y: number }, to: { x: number; y: number }) => fill(capsule(from, to, 4.2), 'momoFrond');

export const kaulquappe: RigManifest = {
  form: 'kaulquappe',
  ground: { x: 50, y: 98 },
  lightAxis: 50,
  face: { x: 48, y: 39, rotation: 0, scale: 1 },
  slots: {
    kopf: { x: 48, y: 12, rotation: 0, scale: 1 },
    hals: { x: 50, y: 60, rotation: 0, scale: 1 },
  },
  effects: { x: 82, y: 10 },
  root: {
    name: 'figur',
    origin: { x: 50, y: 98 },
    children: [
      joint('koerper', { x: 50, y: 98 }, [
        slot('hals.hinten'),
        joint('schwanz', { x: 56, y: 58 }, [
          fill(
            smooth([
              { x: 42, y: 52 },
              { x: 60, y: 50 },
              { x: 70, y: 58 },
              { x: 70, y: 70 },
              { x: 64, y: 80 },
              { x: 60, y: 88 },
              { x: 63, y: 97 },
              { x: 55, y: 94 },
              { x: 51, y: 86 },
              { x: 50, y: 76 },
              { x: 47, y: 66 },
              { x: 40, y: 60 },
            ]),
            'momoBody',
            { shade: true },
          ),
          // Bauchstreifen vom Kinn bis zur Schwanzspitze.
          fill(
            smooth([
              { x: 45, y: 61 },
              { x: 53, y: 61 },
              { x: 55, y: 70 },
              { x: 55, y: 80 },
              { x: 58, y: 90 },
              { x: 59, y: 95 },
              { x: 55, y: 92 },
              { x: 52, y: 82 },
              { x: 50, y: 72 },
            ]),
            'momoBelly',
          ),
        ]),
        joint('kopf', { x: 48, y: 58 }, [
          slot('kopf.hinten'),
          joint('wedel_links', { x: 22, y: 31 }, [
            frond({ x: 22, y: 26 }, { x: 9, y: 15 }),
            frond({ x: 20, y: 31 }, { x: 5, y: 30 }),
            frond({ x: 22, y: 36 }, { x: 9, y: 45 }),
          ]),
          joint('wedel_rechts', { x: 74, y: 31 }, [
            frond({ x: 74, y: 26 }, { x: 87, y: 15 }),
            frond({ x: 76, y: 31 }, { x: 91, y: 30 }),
            frond({ x: 74, y: 36 }, { x: 87, y: 45 }),
          ]),
          fill(ellipse(48, 36, 30, 25), 'momoBody', { shade: true }),
          fill(ellipse(32, 22, 6, 3.5), 'licht', { opacity: 0.45 }),
          face,
          slot('kopf.vorn'),
        ]),
        slot('hals.vorn'),
      ]),
    ],
  },
};
