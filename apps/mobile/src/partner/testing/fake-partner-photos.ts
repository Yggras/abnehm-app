import { Instant, type MealKey } from '@abnehm/contracts/base';
import type { PartnerPhotoList } from '@abnehm/contracts/partner';

import type { MemoryImage } from '../../online/memory-image';
import type { OnlineResult } from '../../online/online-result';
import type { PartnerDependencies } from '../partner';
import type { PartnerPhotos, PartnerPhotoVariant } from '../partner-photos';

/**
 * Online-Test-Adapter für „Fotos von heute“ (#122): Die Liste und jedes Bild antworten, wie der Test es
 * festlegt; jede Liste vergibt neue Handles wie der Server. Ohne Netz ist alles `offline`. `calls`
 * protokolliert jeden Abruf.
 */
export function fakePartnerPhotos(meals: readonly MealKey[] = []) {
  const state = {
    online: true,
    meals: [...meals],
    list: null as OnlineResult<PartnerPhotoList, 'forbidden'> | null,
    /** Abweichender Ausgang eines Bildabrufs, etwa `failed` für einen Bildfehler. */
    image: null as ((handle: string, variant: PartnerPhotoVariant) => OnlineResult<MemoryImage, 'forbidden'> | null) | null,
  };
  const calls: (readonly ['liste'] | readonly ['bild', string, PartnerPhotoVariant])[] = [];
  let lists = 0;
  const photos: PartnerPhotos = {
    async list() {
      calls.push(['liste']);
      if (!state.online) return { type: 'offline' };
      if (state.list !== null) return state.list;
      lists += 1;
      return {
        type: 'ok',
        value: {
          photos: state.meals.map((meal, index) => ({ handle: `handle_${String(lists).padStart(4, '0')}_${String(index).padStart(8, '0')}`, meal })),
          dataAsOf: Instant.parse('2026-10-14T12:00:00.000Z'),
        },
      };
    },
    async image(handle, variant) {
      calls.push(['bild', handle, variant]);
      if (!state.online) return { type: 'offline' };
      return state.image?.(handle, variant) ?? { type: 'ok', value: { uri: `data:image/jpeg;base64,${handle}_${variant}` } };
    },
  };
  return { photos, state, calls };
}

/** Für Tests ohne „Fotos von heute“: Jeder Abruf ist `offline`, „Wir“ zeigt dann keine Fotozeile. */
export const withoutPartnerPhotos: Pick<PartnerDependencies, 'photos'> = {
  photos: { list: async () => ({ type: 'offline' }), image: async () => ({ type: 'offline' }) },
};
