import { and, asc, eq, isNull } from 'drizzle-orm';
import { Hono, type Context } from 'hono';

import type { Clock } from '@abnehm/clock';
import { EntityId, MealKey, TimeZone } from '@abnehm/contracts/base';
import { MealPhotoVariant } from '@abnehm/contracts/nutrition';

import { guard, partnerResponse, policies } from '../authorization/authorization.ts';
import type { Database } from '../database.ts';
import { mealPhoto, nutritionEntry, person } from '../db/schema/index.ts';
import { createPartnerPhotoHandles, type PartnerPhotoHandles } from './partner-photo-handles.ts';
import { invalidVariant, servePhoto } from './photo-response.ts';
import type { PhotoStorage } from './photo-storage.ts';

// Geteilte Mahlzeitenfotos für den Partner (Spezifikation 2, Abschnitt 9; #165): die beiden reinen
// Online-Abläufe „Fotoliste“ und „Bildabruf“ aus Spezifikation 0, Abschnitt 5. Es gibt keine Projektion,
// nichts davon geht in den Partner-Pull. Beide prüfen die Sichtbarkeitsregeln bei jedem Aufruf über die
// zentrale Autorisierung: die Liste über `partner_photo_list` (aktive Kopplung, Fotofreigabe `geteilt`),
// jedes Bild über `meal_photo` (zusätzlich Schalter des Fotos, nicht gelöscht, ein nicht gelöschter Eintrag
// am aktuellen lokalen Tag der Eigentümerin). Ein entzogenes, gelöschtes oder verwaistes Foto ist damit
// sofort nicht mehr abrufbar, auch mit einem schon ausgegebenen Handle.

/** Höchstens so viele Fotos je Tag (Spezifikation 0, Abschnitt 5; Designwert, nicht belegt). */
export const PARTNER_PHOTO_LIST_MAX = 12;

/** Steht für ein Handle, das zu keinem Foto führt; die Regel findet damit nichts und verweigert. */
const NO_PHOTO = 'ungueltiges-handle';

export function createPartnerPhotos({
  database,
  clock,
  storage,
  handles = createPartnerPhotoHandles({ clock }),
}: {
  database: Database;
  clock: Clock;
  storage: PhotoStorage;
  handles?: PartnerPhotoHandles;
}) {
  /**
   * Die heute geteilten Fotos der Eigentümerin nach Aufnahmezeit, je mit der Mahlzeit ihres ersten Eintrags
   * von heute. Den Tag bestimmt die Zeitzone ihrer Person, nicht die App.
   */
  async function sharedToday(ownerPersonId: EntityId) {
    const [owner] = await database.db.select({ timeZone: person.timeZone }).from(person).where(eq(person.id, ownerPersonId));
    if (owner === undefined) return [];
    const today = clock.read(TimeZone.parse(owner.timeZone)).localDate;
    const rows = await database.db
      .select({ id: mealPhoto.id, meal: nutritionEntry.meal })
      .from(mealPhoto)
      .innerJoin(nutritionEntry, eq(nutritionEntry.mealPhotoId, mealPhoto.id))
      .where(
        and(
          eq(mealPhoto.personId, ownerPersonId),
          isNull(mealPhoto.deletedAt),
          eq(mealPhoto.sharedWithPartner, true),
          eq(nutritionEntry.personId, ownerPersonId),
          eq(nutritionEntry.localDate, today),
          isNull(nutritionEntry.deletedAt),
        ),
      )
      .orderBy(asc(mealPhoto.capturedAt), asc(mealPhoto.id), asc(nutritionEntry.consumedAt), asc(nutritionEntry.id));
    const photos = new Map<string, MealKey>();
    for (const row of rows) if (!photos.has(row.id)) photos.set(row.id, MealKey.parse(row.meal));
    return [...photos].slice(0, PARTNER_PHOTO_LIST_MAX).map(([id, meal]) => ({ id: EntityId.parse(id), meal }));
  }

  /** Die Foto-ID, die der Guard zum Handle einer Anfrage gefunden hat; ein zweites Auflösen könnte inzwischen abgelaufen sein. */
  const resolved = new WeakMap<Request, EntityId>();
  const locatePhoto = (c: Context) => {
    const photoId = handles.resolve(c.req.param('handle') ?? '');
    if (photoId === null) return { id: NO_PHOTO };
    resolved.set(c.req.raw, photoId);
    return { id: photoId };
  };

  const routes = new Hono()
    /**
     * `GET /v1/nutrition/partner-photos`: die Fotoliste „Fotos von heute“ ohne Parameter. Die Eigentümerin ist
     * die Partnerin aus der aktiven Kopplung; die Antwort läuft durch ihr geschlossenes Vertragsschema.
     */
    .get('/nutrition/partner-photos', guard(policies.resource('partner_photo_list', 'lesen'), () => ({})), async (c) => {
      const owner = c.var.resource.ownerPersonId;
      const photos = owner === null ? [] : await sharedToday(owner);
      const list = partnerResponse('partner_photo_list', {
        photos: photos.map(({ id, meal }) => ({ handle: handles.issue(id), meal })),
        dataAsOf: clock.read().instant,
      });
      return c.json(list, 200, { 'cache-control': 'no-store' });
    })
    /**
     * `GET /v1/nutrition/partner-photos/:handle/:variant`: ein Bild der Fotoliste als Vorschau oder vergrößert
     * (`PartnerPhotoRequest`), als JPEG und nicht cachebar. Ein verändertes, fremdes oder abgelaufenes Handle
     * verweigert der Guard generisch wie ein Foto, das nicht (mehr) sichtbar ist.
     */
    .get(
      '/nutrition/partner-photos/:handle/:variant',
      guard(policies.resource('meal_photo', 'lesen'), locatePhoto),
      async (c) => {
        const variant = MealPhotoVariant.safeParse(c.req.param('variant'));
        if (!variant.success) return c.json(invalidVariant, 400);
        const photoId = resolved.get(c.req.raw);
        if (photoId === undefined) return c.body(null, 404, { 'cache-control': 'no-store' });
        return servePhoto(c, { database, storage }, photoId, variant.data);
      },
    );

  return { routes };
}

export type PartnerPhotos = ReturnType<typeof createPartnerPhotos>;
