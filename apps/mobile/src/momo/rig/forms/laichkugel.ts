import { arcBand, capsule, ellipse } from '../geometry';
import { face, fill, type RigManifest } from '../types';

// Laichkugel („wartet im Ei“): runde Gallertkugel in `momo-belly`, darin die schlafende Kaulquappe in
// `momo-body` mit `momo-frond`-Kiemenwedeln; leichtes Wippen (Design-System › Momo). Vorlage:
// prototypes/momo-lagunenling/images/egg-b.webp. Maße sind Designwerte aus #187, nicht belegt.

export const laichkugel: RigManifest = {
  form: 'laichkugel',
  ground: { x: 50, y: 98 },
  lightAxis: 50,
  face: { x: 44, y: 57, rotation: 0, scale: 0.45 },
  // Die Laichkugel trägt keine Accessoires; die Anker bleiben ungenutzt.
  slots: {
    kopf: { x: 44, y: 41, rotation: 0, scale: 0.45 },
    hals: { x: 44, y: 67, rotation: 0, scale: 0.45 },
  },
  effects: { x: 80, y: 18 },
  root: {
    name: 'figur',
    origin: { x: 50, y: 98 },
    children: [
      fill(ellipse(50, 58, 38, 38), 'momoBelly', { shade: true }),
      // Der eingerollte Schwanz der schlafenden Kaulquappe.
      fill(arcBand(50, 60, 24, 15, -30, 120), 'momoBody', { shade: true }),
      fill(capsule({ x: 33, y: 49 }, { x: 25, y: 41 }, 3), 'momoFrond'),
      fill(capsule({ x: 32, y: 55 }, { x: 23, y: 55 }, 3), 'momoFrond'),
      fill(capsule({ x: 55, y: 48 }, { x: 62, y: 40 }, 3), 'momoFrond'),
      fill(ellipse(44, 55, 14, 13), 'momoBody'),
      face,
      fill(ellipse(34, 32, 8, 4.5), 'licht', { opacity: 0.45 }),
    ],
  },
};
