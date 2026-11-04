import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import sharp from 'sharp';

import { EntityId, Instant, LocalDate, MealKey, TimeZone } from '@abnehm/contracts/base';
import {
  ConfirmPhotoDraft,
  confirmPhotoDraftKey,
  entryAmount,
  entryTotals,
  PhotoAnalysisResult,
  photoDraftSnapshot,
  type NutritionEntryUpsert,
  type PhotoDraftComponent,
} from '@abnehm/contracts/nutrition';
import { currentSyncSchemaVersion, type OutboxOperation } from '@abnehm/contracts/sync';

import { policies } from '../../src/authorization/authorization.ts';
import { photoDraft } from '../../src/db/schema/index.ts';
import { createTestBackend, type TestAppOptions, type TestBackend } from './app.ts';
import { call, type Device } from './auth-client.ts';
import { personWithSession, type AuthorizationScenario } from './authorization.ts';
import { pushOutcome } from './sync.ts';

// Fotoentwurf bestätigen (#162): Entwurf über die echte Fotoanalyse mit dem Fake-Analyzer, Operation
// `confirmPhotoDraft` und das Negativtest-Szenario für `registeredCommandCases`.

/** Ein Teller, wie ihn die App hochlädt: 1.600 × 1.200 px mit EXIF samt GPS. */
export async function plate(): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({ create: { width: 1_600, height: 1_200, channels: 3, background: { r: 210, g: 160, b: 90 } } })
      .withExif({ IFD0: { Make: 'Testkamera', Copyright: 'Anna Beispiel' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '52/1 31/1 0/1' } })
      .jpeg()
      .toBuffer(),
  );
}

/** Fotoanalyse über HTTP; liefert das Ergebnis und den Bildschlüssel aus Postgres. */
export async function analyzedDraft(backend: TestBackend, device: Device) {
  const body = new FormData();
  body.append('photo', new Blob([new Uint8Array(await plate())], { type: 'image/jpeg' }), 'teller.jpg');
  const reply = await call(backend, 'POST', '/v1/nutrition/photo-analysis', device, body);
  if (reply.status !== 201) throw new Error(`Fotoanalyse fehlgeschlagen: ${reply.status} ${JSON.stringify(reply.body)}`);
  const result = PhotoAnalysisResult.parse(reply.body);
  const [row] = await backend.database.db.select().from(photoDraft).where(eq(photoDraft.id, result.draftId));
  return { result, imageKey: row!.imageKey, createdAt: row!.createdAt };
}

export type PhotoMeal = Readonly<{ localDate?: LocalDate; meal?: MealKey; consumedAt?: Instant }>;

/** Ein Eintrag aus einem Bestandteil, unverändert übernommen, wie ihn die App beim Bestätigen bildet. */
export function photoEntry(component: PhotoDraftComponent, photoId: string, meal: PhotoMeal = {}): NutritionEntryUpsert {
  const snapshot = photoDraftSnapshot(component);
  const amount = entryAmount(snapshot, component.baseUnit, component.baseUnit === 'g' ? component.baseAmount : component.baseAmount * 1_000);
  if (amount.type !== 'menge') throw new Error(`Menge erwartet: ${amount.problem}`);
  return {
    consumedAt: meal.consumedAt ?? Instant.parse('2026-10-14T10:00:00.000Z'),
    localDate: meal.localDate ?? LocalDate.parse('2026-10-14'),
    timeZone: TimeZone.parse('Europe/Berlin'),
    utcOffsetMinutes: 120,
    meal: meal.meal ?? 'mittagessen',
    captureMethod: 'foto',
    foodRef: null,
    snapshot,
    amount: amount.amount,
    totals: entryTotals(snapshot, amount.amount),
    mealPhotoId: EntityId.parse(photoId),
  };
}

/** Die Nutzlast einer Bestätigung aller Bestandteile, mit neuen IDs für Foto und Einträge. */
export function confirmation(
  draft: PhotoAnalysisResult,
  options: { photoId?: string; sharedWithPartner?: boolean; meal?: PhotoMeal } = {},
): ConfirmPhotoDraft {
  const photoId = options.photoId ?? randomUUID();
  return ConfirmPhotoDraft.parse({
    draftId: draft.draftId,
    photoId,
    sharedWithPartner: options.sharedWithPartner ?? true,
    entries: draft.components.map((component) => ({ id: randomUUID(), entry: photoEntry(component, photoId, options.meal) })),
  });
}

/** Die Operation `confirmPhotoDraft`; ohne `operationId` mit frischer ID. */
export function confirmOp(payload: ConfirmPhotoDraft, options: { operationId?: string; businessKey?: string } = {}): Extract<OutboxOperation, { businessKey: string }> {
  return {
    type: 'confirmPhotoDraft',
    operationId: EntityId.parse(options.operationId ?? randomUUID()),
    businessKey: options.businessKey ?? confirmPhotoDraftKey(payload.photoId),
    payload,
    knownServerVersion: null,
    schemaVersion: currentSyncSchemaVersion,
    createdAt: Instant.parse('2026-10-14T10:00:00.000Z'),
  };
}

/** Berlin, Mittwoch 14.10.2026, 12:00 Uhr (UTC+2). */
export const lunchtime = { instant: Instant.parse('2026-10-14T10:00:00.000Z'), timeZone: TimeZone.parse('Europe/Berlin') };

/** Backend und Anna mit Sitzung; die Fotoanalyse läuft über den Fake. */
export async function photoWorld(options: TestAppOptions = {}) {
  const backend = await createTestBackend(options);
  const anna = await personWithSession(backend, 'anna@example.test', 'Anna');
  return { backend, anna };
}

type World = { backend: TestBackend; actor: Device; payload: ConfirmPhotoDraft; foreignPhotoId: string };

/**
 * `confirmPhotoDraft` im Negativtest-Gerüst. Ziel ist das neue Mahlzeitenfoto: Die Gegenprobe legt es
 * an; eine fremde Person, die dieselbe Foto-ID nennt, und eine manipulierte Foto-ID (das Foto einer
 * anderen Person) sind generisch verweigert.
 */
export const confirmPhotoDraftScenario = {
  policy: policies.resource('meal_photo', 'befehl'),
  arrange: async () => {
    const { backend, anna } = await photoWorld();
    const philipp = await personWithSession(backend, 'philipp@example.test', 'Philipp');
    const philippsDraft = await analyzedDraft(backend, philipp.device);
    const philippsPhoto = confirmation(philippsDraft.result);
    if ((await pushOutcome(backend, philipp.device, confirmOp(philippsPhoto))) !== 'erlaubt') throw new Error('Philipps Foto fehlt');
    const annasDraft = await analyzedDraft(backend, anna.device);
    return { backend, actor: anna.device, payload: confirmation(annasDraft.result), foreignPhotoId: philippsPhoto.photoId };
  },
  attempt: (world, device) => pushOutcome(world.backend, device, confirmOp(world.payload)),
  manipulierte_id: (world) => {
    const payload = ConfirmPhotoDraft.parse({
      ...world.payload,
      photoId: world.foreignPhotoId,
      entries: world.payload.entries.map(({ entry }) => ({ id: randomUUID(), entry: { ...entry, mealPhotoId: world.foreignPhotoId } })),
    });
    return pushOutcome(world.backend, world.actor, confirmOp(payload));
  },
} satisfies AuthorizationScenario<World, 'ohne_sitzung' | 'fremde_person' | 'manipulierte_id'>;
