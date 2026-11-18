import type { MomoAppearance, MomoForm, MomoMood } from '@abnehm/contracts/island';
import type { AccessoryFit, GameCatalog } from '@abnehm/game-rules/catalog';

import { accessoryArt, type AccessoryArt } from './rig/accessories';
import type { RigMood } from './rig/clips';
import { manifests } from './rig/manifest';
import type { RigForm, RigManifest } from './rig/types';
import { eggLabel, momoLabel } from './texts';

// Vom fachlichen Zustand zum Rig (Recherche Produktionsstrategie, Abschnitt 7.1): Fachcode nennt nur
// Erscheinung und Stimmung; welches Manifest, welcher Ausdruck und welche Accessoire-Grafik mit welcher
// Passung gezeichnet werden, entscheidet allein dieses Modul.

export type WornAccessory = Readonly<{ name: string; art: AccessoryArt; fit: AccessoryFit }>;

export type MomoVisual = Readonly<{
  manifest: RigManifest;
  mood: RigMood;
  accessories: Readonly<{ kopf: WornAccessory | null; hals: WornAccessory | null }>;
  label: string;
}>;

/**
 * Formen mit eigenem Manifest. Die übrigen zeichnet das Rig bis „Momo-Rig: Formen 2–7“ (#213) als
 * Kaulquappe; der zugängliche Name nennt trotzdem die echte Form.
 */
const drawnAs: Readonly<Record<MomoForm, RigForm>> = {
  kaulquappe: 'kaulquappe',
  huepfer: 'kaulquappe',
  krabbler: 'kaulquappe',
  aufrechter: 'kaulquappe',
  springer: 'kaulquappe',
  spirale: 'kaulquappe',
  fluegling: 'kaulquappe',
  lagunendrache: 'lagunendrache',
};

const nothingWorn = { kopf: null, hals: null } as const;

/** Was das Rig zeichnet. Ohne Erscheinung, etwa ohne Kopplung, wartet Momo im Ei. */
export function momoVisual(appearance: MomoAppearance | null, mood: MomoMood, catalog: GameCatalog): MomoVisual {
  if (appearance?.stage !== 'geschluepft' || appearance.formKey === null) {
    return { manifest: manifests.laichkugel, mood: 'wartet_im_ei', accessories: nothingWorn, label: eggLabel };
  }
  const form = appearance.formKey;
  const worn = (slot: 'kopf' | 'hals'): WornAccessory | null => {
    const key = appearance.accessories[slot];
    const accessory = key === null ? undefined : catalog.accessories.find((entry) => entry.key === key && entry.slot === slot);
    const art = accessory === undefined ? undefined : accessoryArt[accessory.art];
    return accessory === undefined || art === undefined ? null : { name: accessory.name, art, fit: accessory.fit[form] };
  };
  const accessories = { kopf: worn('kopf'), hals: worn('hals') };
  const names = [accessories.kopf, accessories.hals].flatMap((accessory) => (accessory === null ? [] : [accessory.name]));
  return { manifest: manifests[drawnAs[form]], mood, accessories, label: momoLabel(form, mood, names) };
}
