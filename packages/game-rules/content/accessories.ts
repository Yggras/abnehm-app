import type { Accessory, AccessoryFit } from '../src/catalog.ts';

// Momo-Accessoires (Spezifikation 4, Abschnitte 4 und 6). Der vertikale Schnitt des Momo-Rigs (#187)
// bringt je ein Stück für Kopf und Hals; die übrigen zehn des V1-Katalogs folgen mit #213
// (Design-System › Momo-Accessoires). Die Passung je Form gilt relativ zum Steckplatz der Form im
// Momo-Rig. Kaulquappe und Lagunendrache sind am Rig eingepasst (Designwerte aus #187, nicht belegt);
// die Formen 2–7 haben noch kein Manifest und stehen bis #213 neutral.

const neutral: AccessoryFit = { x: 0, y: 0, rotation: 0, scale: 1 };

export const accessories: readonly Accessory[] = [
  {
    key: 'strohhuetchen',
    name: 'Strohhütchen',
    slot: 'kopf',
    art: 'strohhuetchen',
    fit: {
      kaulquappe: { x: 3, y: 1, rotation: 8, scale: 1 },
      huepfer: neutral,
      krabbler: neutral,
      aufrechter: neutral,
      springer: neutral,
      spirale: neutral,
      fluegling: neutral,
      lagunendrache: { x: 1, y: 2, rotation: -6, scale: 0.8 },
    },
  },
  {
    key: 'muschelkette',
    name: 'Muschelkette',
    slot: 'hals',
    art: 'muschelkette',
    fit: {
      kaulquappe: neutral,
      huepfer: neutral,
      krabbler: neutral,
      aufrechter: neutral,
      springer: neutral,
      spirale: neutral,
      fluegling: neutral,
      lagunendrache: { x: 0, y: 0, rotation: -4, scale: 0.85 },
    },
  },
];
