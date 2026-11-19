import { randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { MealPhotoVariant, PhotoImageKey } from '@abnehm/contracts/nutrition';

/** Die beiden Fassungen eines Mahlzeitenfotos in der Fotoablage; ihre Größen stehen in `photo-image.ts`. */
export const mealPhotoVariants = MealPhotoVariant.options;
export type { MealPhotoVariant };

/**
 * Bilddateien auf dem Server (Spezifikation 2, Abschnitte 8 und 9; Spezifikation 0, Abschnitt 8): die
 * Bilder der Fotoentwürfe und die Fotoablage der bestätigten Mahlzeitenfotos. Beide liegen unter einem
 * eigenen Verzeichnis (`PHOTO_STORAGE_DIR`) außerhalb der App und jedes öffentlichen Pfads: Das Backend
 * liefert keine statischen Dateien aus, ein Bild erreicht man nur über die authentifizierte API. Der
 * Bildschlüssel ist zufällig (256 Bit) und nicht erratbar; die Zuordnung zur Person steht nur in
 * Postgres. Die Dateien sind von sharp neu kodierte JPEGs ohne Metadaten (`photo-image.ts`).
 *
 * Aufbau, auch für Backup und Restore (#115):
 * - `entwuerfe/<schlüssel>.jpg`: Bild eines Fotoentwurfs, spätestens nach 24 Stunden gelöscht.
 * - `fotos/<schlüssel>/vorschau.jpg` und `fotos/<schlüssel>/gross.jpg`: Fotoablage eines Mahlzeitenfotos.
 * - `*.teil`: ein Schreibvorgang, der noch nicht fertig ist; der Aufräumjob entfernt verwaiste.
 */
export type PhotoStorage = Readonly<{
  /** Neuer, zufälliger Bildschlüssel. */
  newImageKey(): string;
  saveDraft(imageKey: string, jpeg: Uint8Array): Promise<void>;
  /** Das Bild eines Entwurfs oder `null`, wenn es keines (mehr) gibt. */
  readDraft(imageKey: string): Promise<Uint8Array | null>;
  /** Löscht das Bild physisch; ein schon fehlendes Bild ist kein Fehler. */
  deleteDraft(imageKey: string): Promise<void>;
  /**
   * Legt beide Fassungen eines Mahlzeitenfotos ab. Sie erscheinen gemeinsam oder gar nicht; liegen sie
   * unter dem Schlüssel schon vor, bleibt alles, wie es ist (Retry derselben Bestätigung).
   */
  savePhoto(imageKey: string, variants: Readonly<Record<MealPhotoVariant, Uint8Array>>): Promise<void>;
  /** Eine Fassung eines Mahlzeitenfotos oder `null`, wenn es keine (mehr) gibt. */
  readPhoto(imageKey: string, variant: MealPhotoVariant): Promise<Uint8Array | null>;
  /** Löscht beide Fassungen physisch; ein schon fehlendes Foto ist kein Fehler. */
  deletePhoto(imageKey: string): Promise<void>;
  /** Die Schlüssel aller Dateien der Ablage, auch halb geschriebener. */
  storedKeys(): Promise<Readonly<{ drafts: readonly string[]; photos: readonly string[] }>>;
}>;

const partialSuffix = '.teil';

function checked(imageKey: string): string {
  // Bildschlüssel stammen aus Postgres; trotzdem wird nie ein fremder Pfad zusammengesetzt.
  if (!PhotoImageKey.safeParse(imageKey).success) throw new Error('Ungültiger Bildschlüssel');
  return imageKey;
}

const missing = (error: unknown) => error instanceof Error && 'code' in error && error.code === 'ENOENT';

async function readOrNull(path: string): Promise<Uint8Array | null> {
  try {
    return new Uint8Array(await readFile(path));
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (missing(error)) return false;
    throw error;
  }
}

/** Die Schlüssel der Einträge eines Verzeichnisses, deren Name `<schlüssel><endung>[.teil]` lautet. */
async function keysIn(directory: string, extension: string): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    if (missing(error)) return [];
    throw error;
  }
  const keys = new Set<string>();
  for (const name of names) {
    const complete = name.endsWith(partialSuffix) ? name.slice(0, -partialSuffix.length) : name;
    if (!complete.endsWith(extension)) continue;
    const key = complete.slice(0, complete.length - extension.length);
    if (PhotoImageKey.safeParse(key).success) keys.add(key);
  }
  return [...keys].sort();
}

export function createPhotoStorage({ directory }: { directory: string }): PhotoStorage {
  const drafts = join(directory, 'entwuerfe');
  const photos = join(directory, 'fotos');
  const draftPath = (imageKey: string) => join(drafts, `${checked(imageKey)}.jpg`);
  const photoPath = (imageKey: string) => join(photos, checked(imageKey));

  return {
    newImageKey: () => randomBytes(32).toString('base64url'),
    async saveDraft(imageKey, jpeg) {
      const path = draftPath(imageKey);
      await mkdir(drafts, { recursive: true, mode: 0o700 });
      // Erst vollständig schreiben, dann umbenennen: Ein Abbruch hinterlässt nie ein halbes Bild unter dem Schlüssel.
      const partial = `${path}${partialSuffix}`;
      await writeFile(partial, jpeg, { mode: 0o600, flag: 'wx' });
      await rename(partial, path);
    },
    readDraft: (imageKey) => readOrNull(draftPath(imageKey)),
    async deleteDraft(imageKey) {
      const path = draftPath(imageKey);
      await rm(path, { force: true });
      await rm(`${path}${partialSuffix}`, { force: true });
    },
    async savePhoto(imageKey, images) {
      const path = photoPath(imageKey);
      if (await exists(path)) return;
      // Beide Fassungen entstehen in einem Ordner neben dem Ziel, der dann als Ganzes umbenannt wird.
      const partial = `${path}${partialSuffix}`;
      await rm(partial, { recursive: true, force: true });
      await mkdir(partial, { recursive: true, mode: 0o700 });
      for (const variant of mealPhotoVariants) await writeFile(join(partial, `${variant}.jpg`), images[variant], { mode: 0o600, flag: 'wx' });
      await rename(partial, path);
    },
    readPhoto: (imageKey, variant) => readOrNull(join(photoPath(imageKey), `${variant}.jpg`)),
    async deletePhoto(imageKey) {
      const path = photoPath(imageKey);
      await rm(path, { recursive: true, force: true });
      await rm(`${path}${partialSuffix}`, { recursive: true, force: true });
    },
    async storedKeys() {
      return { drafts: await keysIn(drafts, '.jpg'), photos: await keysIn(photos, '') };
    },
  };
}
