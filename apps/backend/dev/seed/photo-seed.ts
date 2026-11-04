import sharp from 'sharp';

import type { SeedManifest } from '@abnehm/contracts/seeds';

import { mealPhotoImages } from '../../src/nutrition/photo-image.ts';
import type { PhotoStorage } from '../../src/nutrition/photo-storage.ts';

// Bilddaten der Seeds (#162): Seeden setzt wie Postgres auch die Fotoablage auf den Ausgangszustand. Sie
// enthält danach genau die synthetischen Bilder des Erweiterungspunkts `mealPhotos` (Fassung 2): je
// Mahlzeitenfoto Vorschau und vergrößerte Fassung, je abgelaufenem Fotoentwurf sein Bild. Die Bilder sind
// einfarbige Flächen, die sharp erzeugt; so liegen keine Bilddateien im Repo.

type SyntheticImage = Readonly<{ width: number; height: number; rgb: readonly [number, number, number] }>;

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
  for (const photo of photos.photos) await storage.savePhoto(photo.imageKey, await mealPhotoImages(await jpegOf(photo.image)));
  for (const draft of photos.expiredDrafts) await storage.saveDraft(draft.imageKey, await jpegOf(draft.image));
}
