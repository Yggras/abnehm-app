import { eq } from 'drizzle-orm';

import type { Clock } from '@abnehm/clock';
import { LocalDate, TimeZone } from '@abnehm/contracts/base';
import { latestAcceptedEntryDate, NutritionEntryRecord, NutritionEntryUpsert } from '@abnehm/contracts/nutrition';

import { nutritionEntry, person } from '../db/schema/index.ts';
import { ownedEntity, type ServerSyncEntity } from '../sync/registry.ts';

// Der Ernährungseintrag im Sync (Spezifikation 0, Abschnitt 10; Spezifikation 2, Abschnitt 11):
// generisches Upsert/Delete, Last-Write-Wins pro Zeile, Löschen gewinnt. Eigentum, Lesen, Upsert und
// Löschen entscheidet die Regel der Ressource `nutrition_entry`. Das Transport-Schema prüft Snapshot,
// Menge und Summen; Fotoverweise auf fremde Fotos verhindert der Fremdschlüssel
// `nutrition_entry_photo_fk` über (Foto, Person). Den lokalen Tag prüft `validate` gegen den
// aktuellen lokalen Tag der Person.

export function nutritionEntryEntity({ clock }: { clock: Clock }): ServerSyncEntity {
  return ownedEntity({
    entityType: 'nutrition_entry',
    resource: 'nutrition_entry',
    table: nutritionEntry,
    upsert: NutritionEntryUpsert,
    deletable: true,
    columns: ({ snapshot, amount, totals, ...entry }) => ({
      consumedAt: new Date(entry.consumedAt),
      localDate: entry.localDate,
      timeZone: entry.timeZone,
      utcOffsetMinutes: entry.utcOffsetMinutes,
      meal: entry.meal,
      captureMethod: entry.captureMethod,
      foodRefType: entry.foodRef?.type ?? null,
      foodRefKey: entry.foodRef?.key ?? null,
      baseAmount: amount.baseAmount,
      displayUnit: amount.displayUnit,
      displayAmountMilli: amount.displayAmountMilli,
      snapshotName: snapshot.name,
      snapshotBaseUnit: snapshot.baseUnit,
      snapshotReferenceAmount: snapshot.referenceAmount,
      snapshotMilliKcal: snapshot.milliKcal,
      snapshotProteinMg: snapshot.proteinMg,
      snapshotCarbsMg: snapshot.carbsMg,
      snapshotFatMg: snapshot.fatMg,
      snapshotPortions: snapshot.portions,
      snapshotSource: snapshot.source,
      snapshotAttribution: snapshot.attribution,
      totalMilliKcal: totals.milliKcal,
      totalProteinMg: totals.proteinMg,
      totalCarbsMg: totals.carbsMg,
      totalFatMg: totals.fatMg,
      mealPhotoId: entry.mealPhotoId,
    }),
    record: (row): NutritionEntryRecord =>
      NutritionEntryRecord.parse({
        consumedAt: row.consumedAt.toISOString(),
        localDate: row.localDate,
        timeZone: row.timeZone,
        utcOffsetMinutes: row.utcOffsetMinutes,
        meal: row.meal,
        captureMethod: row.captureMethod,
        foodRef: row.foodRefType === null ? null : { type: row.foodRefType, key: row.foodRefKey },
        snapshot: {
          name: row.snapshotName,
          baseUnit: row.snapshotBaseUnit,
          referenceAmount: row.snapshotReferenceAmount,
          milliKcal: row.snapshotMilliKcal,
          proteinMg: row.snapshotProteinMg,
          carbsMg: row.snapshotCarbsMg,
          fatMg: row.snapshotFatMg,
          portions: row.snapshotPortions,
          source: row.snapshotSource,
          attribution: row.snapshotAttribution,
        },
        amount: { baseAmount: row.baseAmount, displayUnit: row.displayUnit, displayAmountMilli: row.displayAmountMilli },
        totals: { milliKcal: row.totalMilliKcal, proteinMg: row.totalProteinMg, carbsMg: row.totalCarbsMg, fatMg: row.totalFatMg },
        mealPhotoId: row.mealPhotoId,
        personId: row.personId,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      }),
    // Der Tag gilt in der `time_zone` der Person, auch direkt nach einem Wechsel (Spezifikation 0, Abschnitt 8).
    async validate(tx, { payload, ownerPersonId }) {
      const [owner] = await tx.select({ timeZone: person.timeZone }).from(person).where(eq(person.id, ownerPersonId));
      if (owner === undefined) throw new Error('Person der Sitzung fehlt');
      const today = LocalDate.parse(clock.read(TimeZone.parse(owner.timeZone)).localDate);
      return payload.localDate <= latestAcceptedEntryDate(today) ? null : 'invalid_payload';
    },
  });
}
