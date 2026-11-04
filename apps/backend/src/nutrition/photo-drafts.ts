import { randomUUID } from 'node:crypto';

import { eq, lte } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { createMiddleware } from 'hono/factory';
import { validator } from 'hono/validator';

import type { Clock } from '@abnehm/clock';
import { TimeZone } from '@abnehm/contracts/base';
import {
  PhotoAnalysisResult,
  PhotoAnalysisUpload,
  photoDraftComponentOf,
  photoUploadMaxBytes,
  type PhotoAnalysisError,
  type PhotoAnalysisErrorCode,
  type PhotoDraftComponent,
} from '@abnehm/contracts/nutrition';

import { forbiddenError, guard, policies, type Actor } from '../authorization/authorization.ts';
import type { Database } from '../database.ts';
import { person, photoDraft } from '../db/schema/index.ts';
import type { Job } from '../jobs/job-registry.ts';
import { createAnalysisLimiter, MAX_ANALYSES_PER_DAY } from './analysis-limiter.ts';
import type { MealVisionAnalyzer, MealVisionOutcome } from './meal-vision.ts';
import { sanitizedJpeg } from './photo-image.ts';
import type { PhotoStorage } from './photo-storage.ts';

// Fotoanalyse und Fotoentwurf auf dem Server (Spezifikation 2, Abschnitt 8; #161). Ein Foto wird
// geprüft, bereinigt und über `MealVisionAnalyzer` in Bestandteile zerlegt. Daraus entsteht ein
// Fotoentwurf, den die App bestätigt (#162) oder verwirft. Nicht bestätigte Entwürfe löscht ein Job
// samt Bild spätestens nach 24 Stunden.


/** Spielraum für Feldnamen, Dateinamen und Grenzen eines `multipart/form-data`-Bodys um das Bild. */
const FORM_OVERHEAD_BYTES = 64 * 1024;

/** Abstand der Aufräumläufe (Designwert, nicht belegt). */
const CLEANUP_INTERVAL_MS = 5 * 60_000;

/**
 * Längste Zeit zwischen Ablauf und physischem Löschen: das Intervall des Aufräumjobs plus der Takt, in
 * dem der Backend-Prozess fällige Jobs prüft (eine Minute, `job-registry.ts`).
 */
const CLEANUP_DELAY_MS = CLEANUP_INTERVAL_MS + 60_000;

/**
 * Gültigkeit eines Fotoentwurfs: 24 Stunden abzüglich der Verzögerung des Aufräumjobs. So ist jeder
 * nicht bestätigte Entwurf samt Bild spätestens nach 24 Stunden physisch gelöscht (#22), und die App
 * sieht in `expiresAt` den Zeitpunkt, ab dem der Server ihn nicht mehr annimmt (Designwert, nicht belegt).
 */
const DRAFT_LIFETIME_MS = 24 * 60 * 60_000 - CLEANUP_DELAY_MS;

const httpStatus = {
  photo_invalid_image: 400,
  photo_no_food_detected: 422,
  photo_analysis_failed: 422,
  photo_analysis_limit_reached: 429,
  photo_analysis_unavailable: 503,
} as const satisfies Record<PhotoAnalysisErrorCode, number>;

function failure(c: Context, code: PhotoAnalysisErrorCode) {
  const error: PhotoAnalysisError = { code, retryable: code === 'photo_analysis_unavailable' };
  return c.json(error, httpStatus[code]);
}

type AnalysisResult = Readonly<{ type: 'entwurf'; result: PhotoAnalysisResult }> | Readonly<{ type: 'fehler'; code: PhotoAnalysisErrorCode }>;

/** Was aus dem Ergebnis des Analyzers wird: die Bestandteile des Entwurfs oder ein Fehlercode. */
function verdictOf(outcome: MealVisionOutcome): { components: PhotoDraftComponent[] } | { code: PhotoAnalysisErrorCode } {
  if (outcome.type === 'nicht_erreichbar') return { code: 'photo_analysis_unavailable' };
  if (outcome.type === 'fehlgeschlagen') return { code: 'photo_analysis_failed' };
  if (outcome.analysis.components.length === 0) return { code: 'photo_no_food_detected' };
  // Das Schema `MealPhotoAnalysis` hat die Umrechnung schon beim Parsen geprüft.
  const components = outcome.analysis.components.map(photoDraftComponentOf);
  return components.every((component): component is PhotoDraftComponent => component !== null) ? { components } : { code: 'photo_analysis_failed' };
}

/**
 * Protokoll einer Analyse: nur Anzahl, Tokens, Dauer und Fehlercode, nie Bild, Modellantwort oder eine
 * Kennung der Person (#22).
 */
function logAnalysis(entry: { analysesToday: number; usage: { inputTokens: number; outputTokens: number } | null; durationMs: number | null; errorCode: string | null }) {
  console.info(
    '[fotoanalyse]',
    JSON.stringify({
      analysenHeute: entry.analysesToday,
      eingabeTokens: entry.usage?.inputTokens ?? null,
      ausgabeTokens: entry.usage?.outputTokens ?? null,
      dauerMs: entry.durationMs,
      fehlercode: entry.errorCode,
    }),
  );
}

export type PhotoDrafts = ReturnType<typeof createPhotoDrafts>;

export function createPhotoDrafts({
  database,
  clock,
  analyzer,
  storage,
}: {
  database: Database;
  clock: Clock;
  analyzer: MealVisionAnalyzer;
  storage: PhotoStorage;
}) {
  const limiter = createAnalysisLimiter();
  const nowMs = () => Date.parse(clock.read().instant);

  async function localDateOf(personId: string) {
    const [row] = await database.db.select({ timeZone: person.timeZone }).from(person).where(eq(person.id, personId));
    if (row === undefined) throw new Error('Person der Sitzung nicht gefunden');
    return clock.read(TimeZone.parse(row.timeZone)).localDate;
  }

  async function analyze(personId: string, upload: Uint8Array): Promise<AnalysisResult> {
    const jpeg = await sanitizedJpeg(upload);
    if (jpeg === null) return { type: 'fehler', code: 'photo_invalid_image' };

    const slot = limiter.start(personId, await localDateOf(personId));
    if (slot === null) {
      logAnalysis({ analysesToday: MAX_ANALYSES_PER_DAY, usage: null, durationMs: null, errorCode: 'photo_analysis_limit_reached' });
      return { type: 'fehler', code: 'photo_analysis_limit_reached' };
    }
    try {
      const startedAt = nowMs();
      const outcome = await analyzer.analyze({ jpeg });
      const verdict = verdictOf(outcome);
      const result = await storeDraft(personId, jpeg, verdict);
      logAnalysis({
        analysesToday: slot.count,
        usage: outcome.type === 'nicht_erreichbar' ? null : outcome.usage,
        durationMs: nowMs() - startedAt,
        errorCode: result.type === 'fehler' ? result.code : null,
      });
      return result;
    } finally {
      slot.end();
    }
  }

  /**
   * Legt den Fotoentwurf an. Das Bild speichert nur ein analysierter Entwurf; ein fehlgeschlagener hält
   * nur Zustand und Fehlercode, denn niemand kann ihn bestätigen. Die Zeile entsteht vor der Datei: Bricht
   * das Schreiben ab, räumt der Job eine Zeile ohne Bild ab, aber nie ein Bild ohne Zeile.
   */
  async function storeDraft(personId: string, jpeg: Uint8Array, verdict: ReturnType<typeof verdictOf>): Promise<AnalysisResult> {
    const createdAt = new Date(nowMs());
    const expiresAt = new Date(createdAt.getTime() + DRAFT_LIFETIME_MS);
    const draft = { id: randomUUID(), personId, imageKey: storage.newImageKey(), createdAt, expiresAt };
    if ('code' in verdict) {
      await database.db.insert(photoDraft).values({ ...draft, analysisState: 'fehlgeschlagen', components: null, errorCode: verdict.code });
      return { type: 'fehler', code: verdict.code };
    }
    await database.db.insert(photoDraft).values({ ...draft, analysisState: 'analysiert', components: verdict.components, errorCode: null });
    try {
      await storage.saveDraft(draft.imageKey, jpeg);
    } catch {
      await database.db.delete(photoDraft).where(eq(photoDraft.id, draft.id));
      return { type: 'fehler', code: 'photo_analysis_unavailable' };
    }
    // Die Antwort durchläuft den Vertrag, bevor sie den Server verlässt.
    return { type: 'entwurf', result: PhotoAnalysisResult.parse({ draftId: draft.id, expiresAt: expiresAt.toISOString(), components: verdict.components }) };
  }

  /** Löscht einen Entwurf samt Bild physisch; erst das Bild, damit kein Bild ohne Zeile zurückbleibt. */
  async function remove(draftId: string) {
    const [draft] = await database.db.select({ imageKey: photoDraft.imageKey }).from(photoDraft).where(eq(photoDraft.id, draftId));
    if (draft === undefined) return;
    await storage.deleteDraft(draft.imageKey);
    await database.db.delete(photoDraft).where(eq(photoDraft.id, draftId));
  }

  /** Liest das Formular selbst, damit ein kaputter Body `photo_invalid_image` ergibt statt eines allgemeinen 400. */
  const readForm = createMiddleware(async (c, next) => {
    if (!/^multipart\/form-data/i.test(c.req.header('content-type') ?? '')) return failure(c, 'photo_invalid_image');
    try {
      await c.req.formData();
    } catch {
      return failure(c, 'photo_invalid_image');
    }
    return next();
  });

  const routes = new Hono()
    /**
     * `POST /v1/nutrition/photo-analysis`: ein Foto als Feld `photo` (`multipart/form-data`). Antwortet mit
     * `201` und `PhotoAnalysisResult` oder mit `PhotoAnalysisError`. Ein Online-Ablauf ohne `requestId`:
     * Jeder Aufruf ist eine neue Analyse.
     */
    .post(
      '/nutrition/photo-analysis',
      guard(policies.authenticated()),
      // Ohne Person (vor dem Bootstrap) gibt es niemanden, dem ein Entwurf gehören könnte; entschieden
      // wird das wie jede Autorisierung vor dem Body.
      createMiddleware<{ Variables: { actor: Actor } }>(async (c, next) => (c.var.actor.personId === null ? c.json(forbiddenError, 403) : next())),
      bodyLimit({ maxSize: photoUploadMaxBytes + FORM_OVERHEAD_BYTES, onError: (c) => failure(c, 'photo_invalid_image') }),
      readForm,
      validator('form', (form, c) => {
        const photo = form.photo;
        if (!(photo instanceof File)) return failure(c, 'photo_invalid_image');
        if (!PhotoAnalysisUpload.safeParse({ mediaType: photo.type, byteSize: photo.size }).success) return failure(c, 'photo_invalid_image');
        return { photo };
      }),
      async (c) => {
        const { personId } = c.var.actor;
        if (personId === null) return c.json(forbiddenError, 403);
        const outcome = await analyze(personId, new Uint8Array(await c.req.valid('form').photo.arrayBuffer()));
        return outcome.type === 'entwurf' ? c.json(outcome.result, 201) : failure(c, outcome.code);
      },
    )
    /** `DELETE /v1/nutrition/photo-drafts/:id`: „Verwerfen“ löscht den eigenen Entwurf samt Bild (Best Effort). */
    .delete('/nutrition/photo-drafts/:id', guard(policies.resource('photo_draft', 'loeschen'), (c) => ({ id: c.req.param('id') })), async (c) => {
      await remove(c.req.param('id'));
      return c.body(null, 204);
    });

  /** Löscht abgelaufene, nicht bestätigte Entwürfe samt Bild; idempotent. */
  const cleanupJob: Job = {
    name: 'fotoentwuerfe_aufraeumen',
    intervalMs: CLEANUP_INTERVAL_MS,
    async run() {
      const due = await database.db.select({ id: photoDraft.id }).from(photoDraft).where(lte(photoDraft.expiresAt, new Date(nowMs())));
      for (const { id } of due) await remove(id);
    },
  };

  return { routes, cleanupJob };
}
