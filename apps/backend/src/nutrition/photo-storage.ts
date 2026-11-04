import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Bilddateien der Fotoentwürfe auf dem Server (Spezifikation 2, Abschnitt 8; Spezifikation 0, Abschnitt 8).
 * Sie liegen unter einem eigenen Verzeichnis außerhalb der App und jedes öffentlichen Pfads: Das
 * Backend liefert keine statischen Dateien aus, ein Bild erreicht man nur über die authentifizierte
 * API. Der Bildschlüssel ist zufällig (256 Bit) und nicht erratbar; die Zuordnung zur Person steht nur
 * in Postgres. Die Fotoablage bestätigter Mahlzeitenfotos ergänzt #162 hier.
 */
export type PhotoStorage = Readonly<{
  /** Neuer, zufälliger Bildschlüssel. */
  newImageKey(): string;
  saveDraft(imageKey: string, jpeg: Uint8Array): Promise<void>;
  /** Das Bild eines Entwurfs oder `null`, wenn es keines (mehr) gibt. */
  readDraft(imageKey: string): Promise<Uint8Array | null>;
  /** Löscht das Bild physisch; ein schon fehlendes Bild ist kein Fehler. */
  deleteDraft(imageKey: string): Promise<void>;
}>;

/** 32 Zufallsbytes in base64url: 43 Zeichen, keine Pfadtrenner. */
const imageKeyPattern = /^[A-Za-z0-9_-]{43}$/;

export function createPhotoStorage({ directory }: { directory: string }): PhotoStorage {
  const drafts = join(directory, 'entwuerfe');

  function draftPath(imageKey: string) {
    // Bildschlüssel stammen aus Postgres; trotzdem wird nie ein fremder Pfad zusammengesetzt.
    if (!imageKeyPattern.test(imageKey)) throw new Error('Ungültiger Bildschlüssel');
    return join(drafts, `${imageKey}.jpg`);
  }

  return {
    newImageKey: () => randomBytes(32).toString('base64url'),
    async saveDraft(imageKey, jpeg) {
      const path = draftPath(imageKey);
      await mkdir(drafts, { recursive: true, mode: 0o700 });
      // Erst vollständig schreiben, dann umbenennen: Ein Abbruch hinterlässt nie ein halbes Bild unter dem Schlüssel.
      const partial = `${path}.teil`;
      await writeFile(partial, jpeg, { mode: 0o600, flag: 'wx' });
      await rename(partial, path);
    },
    async readDraft(imageKey) {
      try {
        return new Uint8Array(await readFile(draftPath(imageKey)));
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
        throw error;
      }
    },
    async deleteDraft(imageKey) {
      await rm(draftPath(imageKey), { force: true });
    },
  };
}
