import sharp from 'sharp';

import type { SeedManifest, SyntheticImage } from '@abnehm/contracts/seeds';

import { mealPhotoImages } from '../../src/nutrition/photo-image.ts';
import type { PhotoStorage } from '../../src/nutrition/photo-storage.ts';

// Bilddaten der Seeds (#162): Seeden setzt wie Postgres auch die Fotoablage auf den Ausgangszustand. Sie
// enthält danach genau die synthetischen Bilder des Erweiterungspunkts `mealPhotos` (Fassung 2): je
// Mahlzeitenfoto Vorschau und vergrößerte Fassung, je abgelaufenem Fotoentwurf sein Bild. Die Bilder sind
// einfarbige Flächen, die sharp erzeugt; so liegen keine Bilddateien im Repo.

async function jpegOf({ width, height, rgb: [r, g, b] }: SyntheticImage): Promise<Uint8Array> {
  return new Uint8Array(await sharp({ create: { width, height, channels: 3, background: { r, g, b } } }).jpeg({ quality: 80 }).toBuffer());
}

/** Leert die Fotoablage und legt die Bilder des Manifests hinein. Ohne Fassung 2 bleibt sie leer. */
export async function seedPhotoFiles(storage: PhotoStorage, manifest: SeedManifest): Promise<void> {
  const stored = await storage.storedKeys();
  for (const imageKey of stored.drafts) await storage.deleteDraft(imageKey);
  for (const imageKey of stored.photos) await storage.deletePhoto(imageKey);

  const photos = manifest.extensions?.mealPhotos;
  if (photos?.version !== 2) return;
  // Parallel: Jedes Seeden erzeugt alle Bilder neu, und sharp arbeitet ohnehin in seinem eigenen Threadpool.
  await Promise.all([
    ...photos.photos.map(async (photo) => storage.savePhoto(photo.imageKey, await mealPhotoImages(await jpegOf(photo.image)))),
    ...photos.expiredDrafts.map(async (draft) => storage.saveDraft(draft.imageKey, await jpegOf(draft.image))),
  ]);
}
