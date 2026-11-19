import { verifyPassword } from 'better-auth/crypto';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { seedManifests, type SeedScenarioKey } from '@abnehm/contracts/seeds';

import { sqliteOf } from '../../mobile/src/local-db/sqlite.ts';
import { account, user } from '../src/db/schema/index.ts';
import { canonical, expectProcessedOperations, reseed, runSteps, seeded, stateOf, type SeedWorld } from './support/seed-world.ts';

// Nachweis für #113: Jedes Seed-Manifest wird auf Postgres und auf jedem Gerät (better-sqlite3) gegen
// die echte Hono-App nur im Ausgangszustand hergestellt. Danach laufen die benannten Schritte des
// Manifests mit Sync-Engine und Persistenzdienst der Tagesziele (#105), und Postgres und alle
// SQLite-Datenbanken stimmen kanonisch mit dem Sollzustand überein. Wiederholtes Seeden ergibt für
// Fach- und Sync-Daten exakt denselben Stand, auch nach Änderungen und nach den Schritten; Konten werden
// semantisch geprüft (feste ID und E-Mail, Hash passt zum Testpasswort), weil ihr Hash gesalzen ist.
// Verarbeitete Operationen vergleicht die Suite ohne Hashes und gespeicherte Antwort und prüft diese
// semantisch (`expectProcessedOperations`, #116).
//
// Jedes Szenario steht hier ausdrücklich mit seinem Schlüssel; die Registry der Seed-Varianten
// (`test/seed-varianten.ts`) verweist darauf.

/** Fach- und Sync-Daten auf Server und Geräten verändern, damit das erneute Seeden etwas zurückzusetzen hat. */
async function disturb({ backend, phones }: SeedWorld) {
  await backend.database.db.execute(sql`update person set display_name = 'Geändert'`);
  await backend.database.db.execute(sql`update sync_clock set position = position + 7`);
  for (const { database } of Object.values(phones)) {
    database.transaction((tx) => sqliteOf(tx).run(sql`update person set display_name = 'Geändert'`));
  }
}

async function accountsMatch({ backend, manifest }: SeedWorld) {
  const users = await backend.database.db.select().from(user);
  const accounts = await backend.database.db.select().from(account);
  expect(users.map(({ id, email }) => ({ id, email })).sort((a, b) => a.id.localeCompare(b.id))).toEqual(
    manifest.accounts.map(({ accountId, email }) => ({ id: accountId, email })).sort((a, b) => a.id.localeCompare(b.id)),
  );
  for (const seedAccount of manifest.accounts) {
    const stored = accounts.find(({ userId }) => userId === seedAccount.accountId);
    expect(await verifyPassword({ hash: stored!.password!, password: seedAccount.password })).toBe(true);
  }
}

function manifestSuite(key: SeedScenarioKey) {
  const manifest = seedManifests[key];

  describe(`Seed-Manifest ${key}`, () => {
    it('stellt nur den Ausgangszustand her und ist beim wiederholten Seeden idempotent', async () => {
      const world = await seeded(manifest);
      expect(await stateOf(world)).toEqual(canonical(manifest.initial));
      await accountsMatch(world);

      await disturb(world);
      await runSteps(world);
      await reseed(world);

      expect(await stateOf(world)).toEqual(canonical(manifest.initial));
      await accountsMatch(world);
    });

    it('erreicht nach den benannten Schritten den Sollzustand in Postgres und SQLite', async () => {
      const world = await seeded(manifest);
      await runSteps(world);
      expect(await stateOf(world)).toEqual(canonical(manifest.target));
      await expectProcessedOperations(world);
    });
  });
}

manifestSuite('solo');
manifestSuite('solo-wasser-leer');
manifestSuite('solo-wasser-erreicht');
manifestSuite('solo-wasser-ueber-ziel');
manifestSuite('solo-sport-erreicht');
manifestSuite('solo-sport-ueber-ziel');
manifestSuite('solo-ohne-wiegetag');
manifestSuite('solo-gewicht-steigend');
manifestSuite('solo-gewicht-ohne-14-tage');
manifestSuite('solo-haltemodus');
manifestSuite('solo-haltemodus-schwanger');
manifestSuite('solo-haltemodus-essstoerung');
manifestSuite('solo-haltemodus-untergewicht');
manifestSuite('solo-budget-angehoben');
manifestSuite('solo-ziele-ab-morgen');
manifestSuite('gekoppelt');
manifestSuite('nach_entkopplung');
manifestSuite('frisches_konto');
manifestSuite('leer');
manifestSuite('teilweise');
manifestSuite('erfuellt');
manifestSuite('nach_erfuellung_korrigiert');
manifestSuite('tagesende_offen');
manifestSuite('tagesende_abgeschlossen');
manifestSuite('ernaehrung-offen');
manifestSuite('ernaehrung-teilweise');
manifestSuite('ernaehrung-erfuellt');
manifestSuite('ernaehrung-nach-erfuellung-korrigiert');
manifestSuite('kalorienbudget-unter-untergrenze');
manifestSuite('kalorienbudget-im-budget');
manifestSuite('kalorienbudget-ueber-budget');
manifestSuite('veralteter_partnerstand');
manifestSuite('einladung-nach-entkopplung');
manifestSuite('zwei_installationen');
manifestSuite('offline_sync');
manifestSuite('solo-energie');
manifestSuite('rollenwahl-offen');
manifestSuite('tage_ohne_app_oeffnung');
manifestSuite('zeitzonen_reisen');
manifestSuite('haelfte-voll');
manifestSuite('doppelausgabe');
manifestSuite('feldkonflikt');
manifestSuite('ereignisse-voll');
manifestSuite('levelaufstieg-ausstehend');
manifestSuite('challenge-vorgeschlagen');
manifestSuite('challenge-verfallen');
manifestSuite('challenge-passt-nicht');
