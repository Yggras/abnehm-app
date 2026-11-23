import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import type { Clock } from '@abnehm/clock';
import { EntityId } from '@abnehm/contracts/base';

// Foto-Handles der Fotoliste (Spezifikation 0, Abschnitt 5): kurzlebig, opak und ausdrücklich keine
// Mahlzeitenfoto-ID. Ein Handle ist die Foto-ID samt Ablaufzeitpunkt, mit AES-256-GCM verschlüsselt und
// authentifiziert. GCM erkennt jede Veränderung am Handle über sein Authentifizierungs-Tag (NIST SP 800-38D,
// Abschnitt 7.2, https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-38d.pdf); ohne den
// Schlüssel verrät es die Foto-ID nicht. So braucht der Server weder eine Tabelle noch einen Aufräumjob.
//
// Der Schlüssel entsteht zufällig beim Start des Backends und liegt nur im Speicher. Nach einem Neustart
// sind ausgegebene Handles daher ungültig; das ist höchstens 10 Minuten früher als ohnehin, und die App
// holt mit der nächsten Fotoliste neue. Das Backend läuft als ein einziger Container (docs/betrieb.md, Aufbau).
//
// Ein gültiges Handle berechtigt zu nichts: Der Bildabruf prüft die Sichtbarkeitsregeln bei jedem Aufruf
// über die zentrale Autorisierung (Regel `meal_photo`).

/** Gültigkeit eines Handles (Spezifikation 0, Abschnitt 5; Designwert, nicht belegt). */
export const PARTNER_PHOTO_HANDLE_TTL_MS = 10 * 60_000;

/** 96-Bit-Nonce, die für GCM empfohlene Länge (NIST SP 800-38D, Abschnitt 5.2.1.1). */
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
/** Klartext: 16 Bytes Foto-UUID und 8 Bytes Ablaufzeitpunkt in Millisekunden. */
const PLAIN_BYTES = 24;
const HANDLE_BYTES = NONCE_BYTES + PLAIN_BYTES + TAG_BYTES;

export type PartnerPhotoHandles = Readonly<{
  /** Ein neues Handle für das Foto, gültig ab jetzt für 10 Minuten. */
  issue(photoId: EntityId): string;
  /** Die Foto-ID eines unveränderten, nicht abgelaufenen Handles, sonst `null`. */
  resolve(handle: string): EntityId | null;
}>;

const uuidBytes = (id: EntityId) => Buffer.from(id.replaceAll('-', ''), 'hex');

function uuidOf(bytes: Buffer): EntityId | null {
  const hex = bytes.toString('hex');
  const parsed = EntityId.safeParse(`${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`);
  return parsed.success ? parsed.data : null;
}

export function createPartnerPhotoHandles({ clock, key = randomBytes(32) }: { clock: Clock; key?: Buffer }): PartnerPhotoHandles {
  const now = () => Date.parse(clock.read().instant);
  return {
    issue(photoId) {
      const nonce = randomBytes(NONCE_BYTES);
      const plain = Buffer.alloc(PLAIN_BYTES);
      uuidBytes(photoId).copy(plain, 0);
      plain.writeBigUInt64BE(BigInt(now() + PARTNER_PHOTO_HANDLE_TTL_MS), 16);
      const cipher = createCipheriv('aes-256-gcm', key, nonce);
      const sealed = Buffer.concat([cipher.update(plain), cipher.final()]);
      return Buffer.concat([nonce, sealed, cipher.getAuthTag()]).toString('base64url');
    },
    resolve(handle) {
      if (!/^[A-Za-z0-9_-]+$/.test(handle)) return null;
      const bytes = Buffer.from(handle, 'base64url');
      // Kanonische Kodierung: Kein zweites Handle für dasselbe Foto durch andere Füllbits.
      if (bytes.length !== HANDLE_BYTES || bytes.toString('base64url') !== handle) return null;
      let plain: Buffer;
      try {
        const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, NONCE_BYTES), { authTagLength: TAG_BYTES });
        decipher.setAuthTag(bytes.subarray(NONCE_BYTES + PLAIN_BYTES));
        plain = Buffer.concat([decipher.update(bytes.subarray(NONCE_BYTES, NONCE_BYTES + PLAIN_BYTES)), decipher.final()]);
      } catch {
        // Verändert oder mit einem anderen Schlüssel ausgegeben.
        return null;
      }
      if (Number(plain.readBigUInt64BE(16)) <= now()) return null;
      return uuidOf(plain.subarray(0, 16));
    },
  };
}
