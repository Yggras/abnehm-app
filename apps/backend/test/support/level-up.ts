import { randomUUID } from 'node:crypto';

import { and, eq, like } from 'drizzle-orm';

import { EntityId, Instant, LocalDate } from '@abnehm/contracts/base';
import { energyBookingId } from '@abnehm/contracts/energy';

import { changeWriter } from '../../src/coupling/change-writer.ts';
import { blueprintUnlock, islandEvent, islandObject, notificationIntent } from '../../src/db/schema/index.ts';
import { insertBooking } from '../../src/energy/bookings.ts';
import { buildAs, builtWorld, earnEnergy, type BuildWorld } from './building.ts';
import { worldToday, type WorldPerson } from './coupled-world.ts';

// Levelaufstieg in Server-Tests (#200). Schwelle(2) = 11: Wer 11 Energie auf der Insel verbaut hat, hat
// seine Hälfte auf Level 1 gefüllt.

/** Annas Ecke (Seite b) und Philipps Ecke (Seite a) der Grundinsel, je vier Felder. */
const annasFelder = ['grundinsel:12:0', 'grundinsel:13:0', 'grundinsel:14:0', 'grundinsel:15:0'] as const;
const philippsFelder = ['grundinsel:0:0', 'grundinsel:1:0', 'grundinsel:2:0', 'grundinsel:3:0'] as const;

/** Das Feld, auf das Philipp mit seiner letzten Laterne die Lücke schließt. */
export const closingField = philippsFelder[3];

/**
 * `builtWorld`, in der Annas Hälfte auf Level 1 voll ist (3 Apfelbäume und ein Beerenstrauch, 11 verbaut)
 * und Philipp mit 8 verbaut eine Laterne fehlt (oder die Aufwertung seiner Sitzbank auf Stufe 2 für 4).
 * Philipp hat 12 Energie gesammelt, also noch 4.
 */
export async function levelUpWorld() {
  const world = await builtWorld();
  await earnEnergy(world.backend, world.anna, [worldToday, '2026-10-13', '2026-10-12']);
  await earnEnergy(world.backend, world.philipp, ['2026-10-13', '2026-10-12']);
  const annas = ['apfelbaum', 'apfelbaum', 'apfelbaum', 'beerenstrauch'] as const;
  for (const [index, blueprintKey] of annas.entries()) {
    await buildAs(world, world.anna.device, { fieldId: world.fieldId(annasFelder[index]!), blueprintKey });
  }
  const philipps = ['laterne', 'laterne', 'sitzbank'] as const;
  const objects: EntityId[] = [];
  for (const [index, blueprintKey] of philipps.entries()) {
    objects.push(await buildAs(world, world.actor, { fieldId: world.fieldId(philippsFelder[index]!), blueprintKey }));
  }
  return { ...world, philippsSitzbank: objects[2]! };
}

export type LevelUpWorld = Awaited<ReturnType<typeof levelUpWorld>>;

/** Die Levelaufstiegs-Ereignisse der Insel, nach Level. */
export async function levelEventsOf(world: Pick<BuildWorld, 'backend' | 'islandId'>) {
  const rows = await world.backend.database.db
    .select()
    .from(islandEvent)
    .where(and(eq(islandEvent.islandId, world.islandId), like(islandEvent.occasionKey, 'level:%')));
  return rows.sort((a, b) => a.occasionKey.localeCompare(b.occasionKey, 'de', { numeric: true }));
}

/** Alle `levelaufstieg`-Intents. */
export async function levelIntents(world: Pick<BuildWorld, 'backend'>) {
  return world.backend.database.db.select().from(notificationIntent).where(eq(notificationIntent.type, 'levelaufstieg'));
}

/** Die Bauplan-Freischaltungen der Insel mit ihrem Grund. */
export async function unlocksOf(world: Pick<BuildWorld, 'backend' | 'islandId'>) {
  const rows = await world.backend.database.db
    .select({ key: blueprintUnlock.catalogKey, reason: blueprintUnlock.reason })
    .from(blueprintUnlock)
    .where(eq(blueprintUnlock.islandId, world.islandId));
  return rows.sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Verbaut Energie, ohne den Inselfortschritt neu zu berechnen: ein Objekt in der eigenen Ecke und eine
 * Ausgabe in beliebiger Höhe. So entsteht der Stand, den sonst erst viele Bauten ergeben; den Levelaufstieg
 * prüft der Test danach selbst (`progressChanges`).
 */
export async function spendWithoutProjection(
  world: Pick<BuildWorld, 'backend' | 'clock' | 'couplingId' | 'islandId' | 'fieldId'>,
  person: Pick<WorldPerson, 'personId'>,
  { fieldKey, amount }: Readonly<{ fieldKey: string; amount: number }>,
) {
  const at = new Date(world.clock.read().instant);
  const objectId = EntityId.parse(randomUUID());
  const commandId = EntityId.parse(randomUUID());
  await world.backend.database.db.transaction(async (tx) => {
    await changeWriter(tx, at)({ entityType: 'island_object', couplingId: world.couplingId }, async (stamp) => {
      await tx.insert(islandObject).values({
        id: objectId,
        islandId: world.islandId,
        couplingId: world.couplingId,
        ownerPersonId: person.personId,
        catalogKey: 'laterne',
        origin: 'gebaut',
        level: 1,
        fieldId: world.fieldId(fieldKey),
        ...stamp,
      });
      return objectId;
    });
    await insertBooking(tx, {
      type: 'build_debit',
      id: energyBookingId(commandId),
      personId: EntityId.parse(person.personId),
      amount: -amount,
      localDate: LocalDate.parse(worldToday),
      bookingKey: commandId,
      createdAt: Instant.parse(at.toISOString()),
      trigger: { commandId, islandObjectId: objectId },
    });
  });
}
