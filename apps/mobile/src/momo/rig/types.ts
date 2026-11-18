import type { Accessory } from '@abnehm/game-rules/catalog';

import type { ColorToken } from '../../design';
import type { Point } from './geometry';

// Rig-Manifest je Entwicklungsform (Recherche Produktionsstrategie, Abschnitt 7.2): normiertes
// Koordinatensystem mit Bodenpunkt, verschachtelte Gelenke mit Ursprung, darin flächige Pfade, das
// Gesicht und die Steckplätze `kopf.hinten`, `kopf.vorn`, `hals.hinten`, `hals.vorn` in ihrer
// Zeichenreihenfolge. Fachcode kennt nichts davon; er nennt nur Erscheinung und Stimmung.

/**
 * Farbe einer Fläche. `licht` ist der Glanz oben links und der Lichtpunkt im Auge: Weiß, im Design-
 * System „45 % Weiß“ bzw. „weißer Lichtpunkt“, gezeichnet in `surface-card`.
 */
export type RigTone = Extract<ColorToken, 'momoBody' | 'momoBelly' | 'momoFrond' | 'momoCheek' | 'ink'> | 'licht';

/**
 * Fläche ohne Kontur und Verlauf, gemeinsam für Form, Gesicht, Accessoires und Zeichen. `shade`: Eine
 * Sichel an der rechten und unteren Kante liegt im Schatten (`shade.ts`).
 */
export type Flat<Tone extends ColorToken | 'licht' = ColorToken | 'licht'> = Readonly<{ path: string; tone: Tone; opacity?: number; shade?: boolean }>;

/** Fläche der Form und des Gesichts, nur in Momos Token-Farben. */
export type RigShape = Flat<RigTone>;

/** Gelenke, die die Clips antreiben; eine Form hat nur die, die ihr Körperbau braucht. */
export type JointName = 'figur' | 'koerper' | 'kopf' | 'wedel_links' | 'wedel_rechts' | 'schwanz' | 'fluegel';

/** Stelle eines Accessoires und Teil davor oder dahinter: `kopf.hinten`, `kopf.vorn`, `hals.hinten`, `hals.vorn`. */
export type SlotPlace = Accessory['slot'];
export type SlotSide = 'hinten' | 'vorn';

export type RigNode =
  | Readonly<{ type: 'flaeche'; shape: RigShape }>
  | Readonly<{ type: 'gelenk'; joint: Joint }>
  | Readonly<{ type: 'gesicht' }>
  | Readonly<{ type: 'steckplatz'; place: SlotPlace; side: SlotSide }>;

export type Joint = Readonly<{ name: JointName; origin: Point; children: readonly RigNode[] }>;

/** Lage, Drehung (Grad, im Uhrzeigersinn) und Größe eines Ankers in Rig-Einheiten. */
export type Anchor = Readonly<{ x: number; y: number; rotation: number; scale: number }>;

export type RigForm = 'kaulquappe' | 'lagunendrache' | 'laichkugel';

export type RigManifest = Readonly<{
  form: RigForm;
  /** Bodenpunkt im Rahmen 100 × 100: Hier steht die Figur auf dem Inselfeld. */
  ground: Point;
  root: Joint;
  /** Wo das gemeinsame Gesicht sitzt und wie groß es ist. */
  face: Anchor;
  /** Steckplätze für Kopf- und Hals-Accessoires; die Passung des Accessoires gilt relativ dazu. Die Laichkugel hat keine. */
  slots?: Readonly<Record<SlotPlace, Anchor>>;
  /** Ort der Zeichen über dem Kopf: Funken, Fragezeichen, „z z“, Mond. */
  effects: Point;
  /** Formspezifische Korrektur der gemeinsamen Clips: Faktor auf den Ausschlag je Gelenk. */
  amplitude?: Partial<Record<JointName, number>>;
}>;

/** Kurzschreibweisen für die Manifeste. */
export const fill = (path: string, tone: RigTone, options: Omit<RigShape, 'path' | 'tone'> = {}): RigNode => ({
  type: 'flaeche',
  shape: { path, tone, ...options },
});
export const joint = (name: JointName, origin: Point, children: readonly RigNode[]): RigNode => ({ type: 'gelenk', joint: { name, origin, children } });
export const slot = (place: SlotPlace, side: SlotSide): RigNode => ({ type: 'steckplatz', place, side });
export const face: RigNode = { type: 'gesicht' };
