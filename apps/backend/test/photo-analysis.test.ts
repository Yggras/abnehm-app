import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTestClock } from '@abnehm/clock/testing';
import { Instant, TimeZone } from '@abnehm/contracts/base';
import { PhotoAnalysisError, PhotoAnalysisResult, photoUploadMaxBytes } from '@abnehm/contracts/nutrition';

import { fakeMealVisionAnalysis, type FakeMealVisionBehavior } from '../dev/meal-vision/fake-analyzer.ts';
import { policies } from '../src/authorization/authorization.ts';
import { photoDraft } from '../src/db/schema/index.ts';
import type { MealVisionAnalyzer, MealVisionOutcome } from '../src/nutrition/meal-vision.ts';
import { createPhotoStorage } from '../src/nutrition/photo-storage.ts';
import { createTestBackend, type TestAppOptions, type TestBackend } from './support/app.ts';
import { call, signUp, type Device } from './support/auth-client.ts';
import { authorizationCases, httpOutcome, personWithSession } from './support/authorization.ts';

// Fotoanalyse und Fotoentwurf auf dem Server (Spezifikation 2, Abschnitt 8; #161) über HTTP gegen die
// echte Hono-App mit isoliertem Postgres und dem Fake des `MealVisionAnalyzer`.

const analysisPath = '/v1/nutrition/photo-analysis';
const draftPath = (id: string) => `/v1/nutrition/photo-drafts/${id}`;

/** 12:00 UTC ist 14:00 in Berlin; der lokale Tag der Person endet um 22:00 UTC. */
const start = { instant: Instant.parse('2026-10-14T12:00:00.000Z'), timeZone: TimeZone.parse('UTC') };
const HOUR = 60 * 60_000;

afterEach(() => vi.restoreAllMocks());

/** Ein Foto, wie es eine Kamera liefert: 40 × 20 px, um 90° gedreht gespeichert, mit EXIF samt GPS. */
async function cameraPhoto(format: 'jpeg' | 'png' | 'webp' = 'jpeg') {
  return sharp({ create: { width: 40, height: 20, channels: 3, background: { r: 200, g: 100, b: 50 } } })
    .withExif({ IFD0: { Make: 'Testkamera', Copyright: 'Anna Beispiel' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '52/1 31/1 0/1' } })
    .withMetadata({ orientation: 6 })
    .toFormat(format)
    .toBuffer();
}

function form(bytes: Uint8Array, type: string, field = 'photo') {
  const body = new FormData();
  // Kopie mit eigenem ArrayBuffer; `Blob` nimmt keine Ansicht auf einen SharedArrayBuffer.
  body.append(field, new Blob([new Uint8Array(bytes)], { type }), 'teller.jpg');
  return body;
}

async function world(options: TestAppOptions = {}) {
  const backend = await createTestBackend(options);
  const anna = await personWithSession(backend, 'anna@example.test');
  return { backend, anna };
}

const analyze = async (backend: TestBackend, device: Device, body: unknown) => call(backend, 'POST', analysisPath, device, body);

async function drafts(backend: TestBackend) {
  return backend.database.db.select().from(photoDraft);
}

function expectError(reply: { status: number; body: unknown }, status: number, code: PhotoAnalysisError['code']) {
  expect(reply.status).toBe(status);
  expect(PhotoAnalysisError.parse(reply.body)).toEqual({ code, retryable: code === 'photo_analysis_unavailable' });
}

/** Ein Analyzer, der hängt, bis der Test ihn freigibt; `entered` zählt die begonnenen Analysen. */
function heldAnalyzer(outcome: MealVisionOutcome) {
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  const state = { entered: 0 };
  const analyzer: MealVisionAnalyzer = {
    async analyze() {
      state.entered++;
      await held;
      return outcome;
    },
  };
  return { analyzer, state, release: () => release() };
}

describe('Fotoanalyse: Erfolg', () => {
  it('legt einen Fotoentwurf an und liefert Entwurfs-ID, Ablauf und Bestandteile in Vertragseinheiten', async () => {
    const clock = createTestClock(start);
    const { backend, anna } = await world({ clock });

    const reply = await analyze(backend, anna.device, form(await cameraPhoto(), 'image/jpeg'));

    expect(reply.status).toBe(201);
    const result = PhotoAnalysisResult.parse(reply.body);
    // 24 Stunden abzüglich Intervall (5 min) und Prüftakt (1 min) des Aufräumjobs.
    expect(result.expiresAt).toBe('2026-10-15T11:54:00.000Z');
    expect(result.components).toEqual([
      { name: 'Bratkartoffeln', baseUnit: 'g', baseAmount: 180_000, milliKcal: 270_000, proteinMg: 4_000, carbsMg: 32_000, fatMg: 13_000 },
      { name: 'Spiegelei', baseUnit: 'g', baseAmount: 60_000, milliKcal: 110_000, proteinMg: 7_500, carbsMg: 400, fatMg: 8_800 },
      { name: 'Apfelschorle', baseUnit: 'ml', baseAmount: 330, milliKcal: 82_500, proteinMg: 0, carbsMg: 19_800, fatMg: 0 },
    ]);
    const [draft] = await drafts(backend);
    expect(draft).toMatchObject({ id: result.draftId, personId: anna.personId, analysisState: 'analysiert', components: result.components, errorCode: null });
    expect(draft!.expiresAt.toISOString()).toBe(result.expiresAt);
  });

  it('richtet das Bild aus, kodiert es als JPEG neu und speichert es ohne EXIF; der Analyzer erhält genau dieses Bild', async () => {
    const { backend, anna } = await world();
    const original = await cameraPhoto();
    const before = await sharp(original).metadata();
    expect(before.exif).toBeDefined();
    expect(before.orientation).toBe(6);

    expect((await analyze(backend, anna.device, form(original, 'image/jpeg'))).status).toBe(201);

    const [draft] = await drafts(backend);
    const stored = await createPhotoStorage({ directory: backend.photoStorageDirectory }).readDraft(draft!.imageKey);
    expect(stored).not.toBeNull();
    const after = await sharp(stored!).metadata();
    expect(after.format).toBe('jpeg');
    expect(after.exif).toBeUndefined();
    expect(after.xmp).toBeUndefined();
    expect(after.orientation).toBeUndefined();
    // Um 90° gedreht: aus 40 × 20 wird 20 × 40.
    expect([after.width, after.height]).toEqual([20, 40]);
    expect(Buffer.from(stored!).includes('Anna Beispiel')).toBe(false);
    expect(backend.fakeMealVision.received.map(({ jpeg }) => Buffer.from(jpeg))).toEqual([Buffer.from(stored!)]);
  });

  it('der Bildschlüssel ist zufällig und nicht erratbar, unabhängig von Person und Entwurf', async () => {
    const { backend, anna } = await world();
    await analyze(backend, anna.device, form(await cameraPhoto(), 'image/jpeg'));
    await analyze(backend, anna.device, form(await cameraPhoto(), 'image/jpeg'));
    const keys = (await drafts(backend)).map(({ imageKey }) => imageKey);
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
    for (const key of keys) {
      expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(key).not.toContain(anna.personId);
    }
  });

  it.each(['png', 'webp'] as const)('nimmt %s an', async (format) => {
    const { backend, anna } = await world();
    expect((await analyze(backend, anna.device, form(await cameraPhoto(format), `image/${format}`))).status).toBe(201);
  });
});

describe('Fotoanalyse: Format und Größe', () => {
  it.each([
    ['GIF', async () => form(await sharp({ create: { width: 4, height: 4, channels: 3, background: 'white' } }).gif().toBuffer(), 'image/gif')],
    ['GIF als JPEG ausgegeben', async () => form(await sharp({ create: { width: 4, height: 4, channels: 3, background: 'white' } }).gif().toBuffer(), 'image/jpeg')],
    ['Text als JPEG ausgegeben', async () => form(new TextEncoder().encode('kein Bild'), 'image/jpeg')],
    ['abgeschnittenes JPEG', async () => form((await cameraPhoto()).subarray(0, 200), 'image/jpeg')],
    ['leere Datei', async () => form(new Uint8Array(), 'image/jpeg')],
    ['falsches Feld', async () => form(await cameraPhoto(), 'image/jpeg', 'bild')],
    ['über 8 MB', async () => form(new Uint8Array(photoUploadMaxBytes + 1), 'image/jpeg')],
    ['JSON statt Formular', async () => ({ photo: 'abc' })],
  ])('%s → photo_invalid_image, ohne Analyse und ohne Entwurf', async (_, body) => {
    const { backend, anna } = await world();
    expectError(await analyze(backend, anna.device, await body()), 400, 'photo_invalid_image');
    expect(backend.fakeMealVision.received).toHaveLength(0);
    expect(await drafts(backend)).toEqual([]);
  });

  it('nimmt genau 8 MB noch an', async () => {
    const { backend, anna } = await world();
    const photo = await cameraPhoto();
    const padded = new Uint8Array(photoUploadMaxBytes);
    padded.set(photo);
    // JPEG endet am EOI-Marker; sharp ignoriert Bytes danach.
    expect((await analyze(backend, anna.device, form(padded, 'image/jpeg'))).status).toBe(201);
  });
});

describe('Fotoanalyse: Fehlercodes', () => {
  it.each([
    ['leer', 422, 'photo_no_food_detected'],
    ['refusal', 422, 'photo_analysis_failed'],
    ['schemaverstoss', 422, 'photo_analysis_failed'],
    ['zeitueberschreitung', 503, 'photo_analysis_unavailable'],
  ] as const satisfies readonly (readonly [FakeMealVisionBehavior, number, PhotoAnalysisError['code']])[])(
    '%s → %i %s; der Entwurf ist fehlgeschlagen und hat kein Bild',
    async (behavior, status, code) => {
      const { backend, anna } = await world();
      backend.fakeMealVision.behave(behavior);

      expectError(await analyze(backend, anna.device, form(await cameraPhoto(), 'image/jpeg')), status, code);

      const [draft] = await drafts(backend);
      expect(draft).toMatchObject({ analysisState: 'fehlgeschlagen', components: null, errorCode: code });
      expect(await createPhotoStorage({ directory: backend.photoStorageDirectory }).readDraft(draft!.imageKey)).toBeNull();
    },
  );

  it('ohne Person (vor dem Bootstrap) verweigert', async () => {
    const backend = await createTestBackend();
    const { device } = await signUp(backend, 'anna@example.test');
    expect(httpOutcome(await analyze(backend, device, form(await cameraPhoto(), 'image/jpeg')))).toBe('verweigert');
  });
});

describe('Fotoanalyse: Kostenschutz und Protokoll', () => {
  it('erlaubt 20 Analysen je Person und lokalem Tag, die 21. erst am nächsten lokalen Tag', async () => {
    const clock = createTestClock(start);
    const { backend, anna } = await world({ clock });
    const photo = await cameraPhoto();

    for (let n = 1; n <= 20; n++) expect((await analyze(backend, anna.device, form(photo, 'image/jpeg'))).status, `Analyse ${n}`).toBe(201);
    expectError(await analyze(backend, anna.device, form(photo, 'image/jpeg')), 429, 'photo_analysis_limit_reached');
    expect(backend.fakeMealVision.received).toHaveLength(20);

    // Eine andere Person hat ihr eigenes Limit.
    const bernd = await personWithSession(backend, 'bernd@example.test');
    expect((await analyze(backend, bernd.device, form(photo, 'image/jpeg'))).status).toBe(201);

    // 21:59 UTC ist noch derselbe Tag in Berlin, 22:00 UTC schon der nächste.
    clock.set(Instant.parse('2026-10-14T21:59:00.000Z'));
    expectError(await analyze(backend, anna.device, form(photo, 'image/jpeg')), 429, 'photo_analysis_limit_reached');
    clock.set(Instant.parse('2026-10-14T22:00:00.000Z'));
    expect((await analyze(backend, anna.device, form(photo, 'image/jpeg'))).status).toBe(201);
  });

  it('ungültige Bilder zählen nicht zum Tageslimit', async () => {
    const { backend, anna } = await world();
    for (let n = 0; n < 25; n++) await analyze(backend, anna.device, form(new TextEncoder().encode('kein Bild'), 'image/jpeg'));
    expect((await analyze(backend, anna.device, form(await cameraPhoto(), 'image/jpeg'))).status).toBe(201);
  });

  it('lässt je Person nur eine laufende Analyse zu', async () => {
    const held = heldAnalyzer({ type: 'analysiert', analysis: { components: fakeMealVisionAnalysis.components.map((component) => ({ ...component })) }, usage: { inputTokens: 1, outputTokens: 1 } });
    const { backend, anna } = await world({ mealVisionAnalyzer: held.analyzer });
    const bernd = await personWithSession(backend, 'bernd@example.test');
    const photo = await cameraPhoto();

    const first = analyze(backend, anna.device, form(photo, 'image/jpeg'));
    // Erst wenn Annas erste Analyse im Analyzer steckt, ist ihr Platz sicher belegt.
    await vi.waitFor(() => expect(held.state.entered).toBe(1), { timeout: 10_000 });
    expectError(await analyze(backend, anna.device, form(photo, 'image/jpeg')), 429, 'photo_analysis_limit_reached');
    // Andere Personen warten nicht auf Anna.
    const parallel = analyze(backend, bernd.device, form(photo, 'image/jpeg'));
    held.release();
    expect((await first).status).toBe(201);
    expect((await parallel).status).toBe(201);
    expect((await analyze(backend, anna.device, form(photo, 'image/jpeg'))).status).toBe(201);
  });

  it('gibt den Platz auch nach einem Fehler des Analyzers frei', async () => {
    const { backend, anna } = await world();
    backend.fakeMealVision.behave('zeitueberschreitung');
    expectError(await analyze(backend, anna.device, form(await cameraPhoto(), 'image/jpeg')), 503, 'photo_analysis_unavailable');
    backend.fakeMealVision.behave('erfolg');
    expect((await analyze(backend, anna.device, form(await cameraPhoto(), 'image/jpeg'))).status).toBe(201);
  });

  it('protokolliert nur Anzahl, Tokens, Dauer und Fehlercode, nie Bild oder Modellantwort', async () => {
    const clock = createTestClock(start);
    const { backend, anna } = await world({ clock });
    const logged: unknown[][] = [];
    vi.spyOn(console, 'info').mockImplementation((...args: unknown[]) => void logged.push(args));
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => void logged.push(args));

    await analyze(backend, anna.device, form(await cameraPhoto(), 'image/jpeg'));
    backend.fakeMealVision.behave('refusal');
    await analyze(backend, anna.device, form(await cameraPhoto(), 'image/jpeg'));

    const entries = logged.filter(([prefix]) => prefix === '[fotoanalyse]').map(([, json]) => JSON.parse(String(json)) as Record<string, unknown>);
    expect(entries).toEqual([
      { analysenHeute: 1, eingabeTokens: 1_250, ausgabeTokens: 420, dauerMs: 0, fehlercode: null },
      { analysenHeute: 2, eingabeTokens: 1_250, ausgabeTokens: 420, dauerMs: 0, fehlercode: 'photo_analysis_failed' },
    ]);
    const everything = JSON.stringify(logged);
    for (const forbidden of ['Bratkartoffeln', 'Spiegelei', anna.personId, 'Anna Beispiel', '/9j/']) expect(everything).not.toContain(forbidden);
  });
});

describe('Fotoentwurf: Ablauf, Verwerfen und Aufräumen', () => {
  async function analyzed(backend: TestBackend, device: Device) {
    const reply = await analyze(backend, device, form(await cameraPhoto(), 'image/jpeg'));
    const result = PhotoAnalysisResult.parse(reply.body);
    const [row] = await backend.database.db.select().from(photoDraft).where(eq(photoDraft.id, result.draftId));
    return { result, imageKey: row!.imageKey };
  }
  const imageOf = (backend: TestBackend, imageKey: string) => createPhotoStorage({ directory: backend.photoStorageDirectory }).readDraft(imageKey);

  it('der Aufräumjob löscht nicht bestätigte Entwürfe samt Bild spätestens nach 24 Stunden physisch', async () => {
    const clock = createTestClock(start);
    const { backend, anna } = await world({ clock });
    const draft = await analyzed(backend, anna.device);
    backend.fakeMealVision.behave('leer');
    await analyze(backend, anna.device, form(await cameraPhoto(), 'image/jpeg'));
    backend.fakeMealVision.behave('erfolg');
    clock.advanceBy(HOUR);
    const younger = await analyzed(backend, anna.device);

    // Vor dem Ablauf bleibt alles.
    clock.set(Instant.parse('2026-10-15T11:45:00.000Z'));
    await backend.jobs.runDue();
    expect(await drafts(backend)).toHaveLength(3);
    expect(await imageOf(backend, draft.imageKey)).not.toBeNull();

    // Ab dem Ablauf löscht der Job den Entwurf samt Bild physisch, den fehlgeschlagenen ebenso.
    clock.set(draft.result.expiresAt);
    await backend.jobs.runDue();
    expect((await drafts(backend)).map(({ id }) => id)).toEqual([younger.result.draftId]);
    expect(await imageOf(backend, draft.imageKey)).toBeNull();
    expect(await imageOf(backend, younger.imageKey)).not.toBeNull();

    clock.set(younger.result.expiresAt);
    await backend.jobs.runDue();
    expect(await drafts(backend)).toEqual([]);
    expect(await imageOf(backend, younger.imageKey)).toBeNull();
  });

  it('im Takt des Backend-Prozesses ist ein Entwurf auch im ungünstigsten Fall spätestens 24 Stunden nach der Analyse gelöscht', async () => {
    const clock = createTestClock(start);
    const { backend, anna } = await world({ clock });
    const draft = await analyzed(backend, anna.device);
    const latest = Date.parse(start.instant) + 24 * HOUR;

    // Ungünstigster Fall: Der Job läuft eine Sekunde vor dem Ablauf, danach prüft der Prozess jede Minute.
    clock.set(Instant.parse(new Date(Date.parse(draft.result.expiresAt) - 1_000).toISOString()));
    await backend.jobs.runDue();
    expect(await drafts(backend)).toHaveLength(1);
    while ((await drafts(backend)).length > 0) {
      clock.advanceBy(60_000);
      expect(Date.parse(clock.read().instant)).toBeLessThanOrEqual(latest);
      await backend.jobs.runDue();
    }
    expect(await imageOf(backend, draft.imageKey)).toBeNull();
  });

  it('räumt eine Zeile ab, deren Bild fehlt', async () => {
    const clock = createTestClock(start);
    const { backend, anna } = await world({ clock });
    const draft = await analyzed(backend, anna.device);
    await createPhotoStorage({ directory: backend.photoStorageDirectory }).deleteDraft(draft.imageKey);
    clock.set(draft.result.expiresAt);
    await backend.jobs.runDue();
    expect(await drafts(backend)).toEqual([]);
  });

  it('„Verwerfen“ löscht den eigenen Entwurf samt Bild; danach gibt es ihn nicht mehr', async () => {
    const { backend, anna } = await world();
    const draft = await analyzed(backend, anna.device);
    const other = await analyzed(backend, anna.device);

    expect((await call(backend, 'DELETE', draftPath(draft.result.draftId), anna.device)).status).toBe(204);

    expect((await drafts(backend)).map(({ id }) => id)).toEqual([other.result.draftId]);
    expect(await imageOf(backend, draft.imageKey)).toBeNull();
    expect(await imageOf(backend, other.imageKey)).not.toBeNull();
    expect(httpOutcome(await call(backend, 'DELETE', draftPath(draft.result.draftId), anna.device))).toBe('verweigert');
  });
});

describe('Autorisierung', () => {
  const photoWorld = async () => {
    const { backend, anna } = await world();
    return { backend, actor: anna.device, photo: await cameraPhoto() };
  };

  for (const { name, run } of authorizationCases({
    policy: policies.authenticated(),
    route: { method: 'POST', path: analysisPath },
    arrange: photoWorld,
    attempt: async ({ backend, photo }, device) => httpOutcome(await analyze(backend, device, form(photo, 'image/jpeg'))),
  })) {
    it(`Fotoanalyse – ${name}`, run);
  }

  /** Jede Gegenprobe verwirft einen frisch angelegten eigenen Entwurf. */
  const draftWorld = async () => {
    const base = await photoWorld();
    const drafted = async () => {
      const reply = await analyze(base.backend, base.actor, form(base.photo, 'image/jpeg'));
      return PhotoAnalysisResult.parse(reply.body).draftId;
    };
    return { ...base, drafted };
  };

  for (const { name, run } of authorizationCases({
    policy: policies.resource('photo_draft', 'loeschen'),
    route: { method: 'DELETE', path: '/v1/nutrition/photo-drafts/:id' },
    arrange: draftWorld,
    attempt: async ({ backend, drafted }, device) => httpOutcome(await call(backend, 'DELETE', draftPath(await drafted()), device)),
    manipulierte_id: async ({ backend, actor }) => {
      // Der Entwurf einer anderen Person bleibt unberührt.
      const bernd = await personWithSession(backend, 'bernd@example.test');
      const reply = await analyze(backend, bernd.device, form(await cameraPhoto(), 'image/jpeg'));
      const foreign = PhotoAnalysisResult.parse(reply.body).draftId;
      const outcome = httpOutcome(await call(backend, 'DELETE', draftPath(foreign), actor));
      expect((await drafts(backend)).some(({ id }) => id === foreign)).toBe(true);
      return outcome === 'verweigert' && httpOutcome(await call(backend, 'DELETE', draftPath(randomUUID()), actor)) === 'verweigert' ? 'verweigert' : outcome;
    },
  })) {
    it(`Verwerfen – ${name}`, run);
  }
});
