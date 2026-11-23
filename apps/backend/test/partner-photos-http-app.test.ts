import { describe, expect, it } from 'vitest';

import { createHttpPartnerPhotos } from '../../mobile/src/partner/partner-photos.ts';
import { testBaseUrl, type TestBackend } from './support/app.ts';
import type { Device } from './support/auth-client.ts';
import { coupledWorld, setPhotoSharing } from './support/coupled-world.ts';
import { analyzedDraft, confirmation, confirmOp } from './support/meal-photos.ts';
import { push } from './support/sync.ts';

// Adapter der App für „Fotos von heute“ (`createHttpPartnerPhotos`, #122) gegen die echte Hono-App mit
// Postgres (#165): Liste und Bild kommen nur in den Speicher, eine Fotofreigabe `privat` ist `forbidden`,
// ohne Netz ist das Ergebnis `offline`.

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

describe('Partnerfotos in der App', () => {
  it('liefert die Liste und jedes Bild als data:-URI mit den Bytes der Fotoablage', async () => {
    const { backend, anna, philipp } = await coupledWorld();
    const draft = await analyzedDraft(backend, anna.device);
    await push(backend, anna.device, [confirmOp(confirmation(draft.result))]);
    const photos = createHttpPartnerPhotos({ baseUrl: testBaseUrl, fetch: deviceFetch(backend, philipp.device) });

    const list = await photos.list();

    if (list.type !== 'ok') throw new Error(`Liste erwartet: ${JSON.stringify(list)}`);
    expect(list.value.photos.map(({ meal }) => meal)).toEqual(['mittagessen']);
    for (const variant of ['vorschau', 'gross'] as const) {
      const image = await photos.image(list.value.photos[0]!.handle, variant);
      if (image.type !== 'ok') throw new Error(`Bild erwartet: ${JSON.stringify(image)}`);
      const [prefix, base64] = image.value.uri.split(',');
      expect(prefix).toBe('data:image/jpeg;base64');
      expect(new Uint8Array(Buffer.from(base64!, 'base64'))).toEqual(await backend.photoStorage.readPhoto(draft.imageKey, variant));
    }
  });

  it('Fotofreigabe privat und ein abgelaufenes Handle sind forbidden', async () => {
    const world = await coupledWorld();
    const draft = await analyzedDraft(world.backend, world.anna.device);
    await push(world.backend, world.anna.device, [confirmOp(confirmation(draft.result))]);
    const photos = createHttpPartnerPhotos({ baseUrl: testBaseUrl, fetch: deviceFetch(world.backend, world.philipp.device) });
    const list = await photos.list();
    if (list.type !== 'ok') throw new Error('Liste erwartet');

    world.clock.advanceBy(10 * 60_000);
    expect(await photos.image(list.value.photos[0]!.handle, 'vorschau')).toEqual({ type: 'rejected', code: 'forbidden' });

    await setPhotoSharing(world, world.anna, 'privat');
    expect(await photos.list()).toEqual({ type: 'rejected', code: 'forbidden' });
  });

  it('ohne Netz ist das Ergebnis offline, ohne Sitzung unauthorized', async () => {
    const { backend, philipp } = await coupledWorld();

    const offline = createHttpPartnerPhotos({ baseUrl: testBaseUrl, fetch: deviceFetch(backend, philipp.device, { online: false }) });
    expect(await offline.list()).toEqual({ type: 'offline' });
    expect(await offline.image('a'.repeat(70), 'vorschau')).toEqual({ type: 'offline' });

    const signedOut = createHttpPartnerPhotos({ baseUrl: testBaseUrl, fetch: deviceFetch(backend, { ip: philipp.device.ip }) });
    expect(await signedOut.list()).toEqual({ type: 'unauthorized' });
  });
});
