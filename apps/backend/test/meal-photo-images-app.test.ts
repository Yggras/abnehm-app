import { describe, expect, it } from 'vitest';

import { createHttpMealPhotoImages } from '../../mobile/src/nutrition/photo-images.ts';
import { createPhotoStorage } from '../src/nutrition/photo-storage.ts';
import { testBaseUrl, type TestBackend } from './support/app.ts';
import type { Device } from './support/auth-client.ts';
import { coupledWorld } from './support/coupled-world.ts';
import { analyzedDraft, confirmation, confirmOp } from './support/meal-photos.ts';
import { deleteOp, push } from './support/sync.ts';

// Bildabruf der App (`createHttpMealPhotoImages`, #164) gegen die echte Hono-App mit Postgres: Das Bild
// kommt nur als `data:`-URI in den Speicher; fremde und gelöschte Fotos sind generisch verweigert, ohne
// Netz ist das Ergebnis `offline`.

/** `fetch` eines Geräts über `app.request`, wie das Auth-Modul es mit der Sitzung versieht. */
function deviceFetch(backend: TestBackend, device: Device, network = { online: true }): typeof globalThis.fetch {
  return async (input, init) => {
    if (!network.online) throw new TypeError('Network request failed');
    const headers = new Headers(init?.headers);
    headers.set('authorization', `Bearer ${device.token ?? ''}`);
    headers.set('x-forwarded-for', device.ip);
    return backend.app.request(String(input), { ...init, headers });
  };
}

async function confirmedPhoto(backend: TestBackend, device: Device) {
  const draft = await analyzedDraft(backend, device);
  const payload = confirmation(draft.result);
  await push(backend, device, [confirmOp(payload)]);
  return { photoId: payload.photoId, imageKey: draft.imageKey };
}

describe('Bildabruf eigener Mahlzeitenfotos in der App', () => {
  it('liefert Vorschau und vergrößerte Fassung als data:-URI mit den Bytes der Fotoablage', async () => {
    const { backend, anna } = await coupledWorld();
    const { photoId, imageKey } = await confirmedPhoto(backend, anna.device);
    const images = createHttpMealPhotoImages({ baseUrl: testBaseUrl, fetch: deviceFetch(backend, anna.device) });
    const storage = createPhotoStorage({ directory: backend.photoStorageDirectory });

    for (const variant of ['vorschau', 'gross'] as const) {
      const result = await images(photoId, variant);

      if (result.type !== 'ok') throw new Error(`Bild erwartet: ${JSON.stringify(result)}`);
      const [prefix, base64] = result.value.uri.split(',');
      expect(prefix).toBe('data:image/jpeg;base64');
      expect(new Uint8Array(Buffer.from(base64!, 'base64'))).toEqual(await storage.readPhoto(imageKey, variant));
    }
  });

  it('ein fremdes oder gelöschtes Foto ist verweigert', async () => {
    const { backend, anna, philipp } = await coupledWorld();
    const annas = await confirmedPhoto(backend, anna.device);
    const own = await confirmedPhoto(backend, philipp.device);
    const images = createHttpMealPhotoImages({ baseUrl: testBaseUrl, fetch: deviceFetch(backend, philipp.device) });

    expect(await images(annas.photoId, 'vorschau')).toEqual({ type: 'rejected', code: 'forbidden' });

    await push(backend, philipp.device, [deleteOp(own.photoId, { entityType: 'meal_photo' })]);
    expect(await images(own.photoId, 'gross')).toEqual({ type: 'rejected', code: 'forbidden' });
  });

  it('ohne Netz ist das Ergebnis offline, ohne Sitzung unauthorized', async () => {
    const { backend, anna } = await coupledWorld();
    const { photoId } = await confirmedPhoto(backend, anna.device);

    const offline = createHttpMealPhotoImages({ baseUrl: testBaseUrl, fetch: deviceFetch(backend, anna.device, { online: false }) });
    expect(await offline(photoId, 'vorschau')).toEqual({ type: 'offline' });

    const signedOut = createHttpMealPhotoImages({ baseUrl: testBaseUrl, fetch: deviceFetch(backend, { ip: anna.device.ip }) });
    expect(await signedOut(photoId, 'vorschau')).toEqual({ type: 'unauthorized' });
  });
});
