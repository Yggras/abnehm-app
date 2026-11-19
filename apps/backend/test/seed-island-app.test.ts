import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import { createTestClock } from '@abnehm/clock/testing';
import { EntityId } from '@abnehm/contracts/base';
import { canonicalRows, seedIds, seedManifests, type SeedKey, type SeedManifest, type SeedState } from '@abnehm/contracts/seeds';
import { InstallationId } from '@abnehm/contracts/sync';

import { islandSyncEntities } from '../../mobile/src/island/island-entities.ts';
import { dailyGoalCompletionEntity } from '../../mobile/src/daily-goals/index.ts';
import { energyBookingEntity } from '../../mobile/src/energy/index.ts';
import { islandEventCommands } from '../../mobile/src/island/island-events.ts';
import { islandObjectCommands } from '../../mobile/src/island/object-commands.ts';
import { createGameService, type GameService } from '../../mobile/src/island/game-service.ts';
import type { MomoReaction } from '../../mobile/src/island/momo-reactions.ts';
import type { IslandStage } from '../../mobile/src/island/role-choice.ts';
import { sharedActionCommands } from '../../mobile/src/island/shared-action-commands.ts';
import { quietGameDependencies } from '../../mobile/src/island/testing/quiet-game.ts';
import type { LocalDatabase } from '../../mobile/src/local-db/index.ts';
import { createLocalDatabases } from '../../mobile/src/local-db/local-databases.ts';
import { createBetterSqliteFiles } from '../../mobile/src/local-db/testing/better-sqlite.ts';
import { foodFavoriteEntity, mealPhotoEntity, nutritionEntryEntity, ownFoodEntity } from '../../mobile/src/nutrition/index.ts';
import { goalVersionEntity, weeklyPlanVersionEntity } from '../../mobile/src/plan/index.ts';
import {
  createHttpSyncTransport,
  createLocalCommandRegistry,
  createSyncEngine,
  createSyncRegistry,
  createSyncWriter,
  foundationLocalCommands,
  foundationSyncEntities,
} from '../../mobile/src/sync/index.ts';
import { canonicalDevice, dumpLocalDatabase, seedLocalDatabase } from '../../mobile/src/test-capabilities/seed/local-seed.ts';
import { waterEntryEntity, weightEntryEntity } from '../../mobile/src/trackers/index.ts';
import { dumpServer, seedServer } from '../dev/seed/server-seed.ts';
import { createTestBackend, testBaseUrl, type TestBackend } from './support/app.ts';
import { signIn } from './support/auth-client.ts';
import { notificationSettingEntity } from '../../mobile/src/notifications/notification-setting-entity.ts';
import { encouragementEntity } from '../../mobile/src/partner/encouragement.ts';
import { planReaderOf } from '../../mobile/src/plan/plan-reader.ts';
import { pendingOperations } from '../../mobile/src/sync/outbox.ts';
import { challengeLocalCommands, challengeSyncEntities, type ChallengeStage } from '../../mobile/src/island/challenges.ts';

// Nachweis für #180: die Szenarien `solo-energie` und `rollenwahl-offen` (Spezifikation 4, Abschnitt 13)
// auf Postgres und den Geräten, deren Engine, Adapter und Spieldienst auf echtem SQLite (better-sqlite3)
// gegen die echte Hono-App laufen. Ausgangszustand exakt und wiederholbar, nach den benannten Schritten
// der Sollzustand; dazu zeigt der Spieldienst Laichkugel bzw. Rollenwahl, und die Rollenwahl lässt sich
// vom geseedeten Stand aus beantworten.

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** Alle Sync-Entitäten der App, wie im Composition Root (`src/session/device-session.ts`). */
const registry = createSyncRegistry([
  ...foundationSyncEntities, ...islandSyncEntities, ...challengeSyncEntities, goalVersionEntity, weeklyPlanVersionEntity, dailyGoalCompletionEntity, energyBookingEntity, waterEntryEntity, weightEntryEntity, nutritionEntryEntity, mealPhotoEntity, ownFoodEntity, foodFavoriteEntity, notificationSettingEntity, encouragementEntity,
]);

type Phone = Readonly<{ database: LocalDatabase; game: GameService; stage(): IslandStage; challenges(): ChallengeStage; outbox(): number; sync(): Promise<void> }>;

async function phone(backend: TestBackend, manifest: SeedManifest, key: SeedKey): Promise<Phone> {
  const installation = manifest.installations.find((candidate) => candidate.key === key)!;
  const account = manifest.accounts.find((candidate) => candidate.key === installation.account)!;
  const { reply, device } = await signIn(backend, account.email, account.password);
  if (reply.status !== 200) throw new Error(`Anmeldung fehlgeschlagen: ${reply.status}`);
  const files = createBetterSqliteFiles();
  const databases = createLocalDatabases({ openSqlite: files.openSqlite, onError: (error) => { throw error; } });
  cleanups.push(() => {
    databases.lock();
    files.remove();
  });
  const database = await databases.open(account.accountId);
  seedLocalDatabase(database, manifest, key);
  const clock = createTestClock(manifest.clock);
  const newId = () => EntityId.parse(randomUUID());
  const writer = createSyncWriter({ registry, clock, newId });
  const engine = createSyncEngine({
    database,
    registry,
    transport: createHttpSyncTransport({
      baseUrl: testBaseUrl,
      fetch: async (input, init) => {
        const headers = new Headers(init?.headers);
        headers.set('authorization', `Bearer ${device.token ?? ''}`);
        headers.set('x-forwarded-for', device.ip);
        return backend.app.request(String(input), { ...init, headers });
      },
    }),
    clock,
    installationId: InstallationId.parse(installation.installationId),
    commands: createLocalCommandRegistry({ database, writer, commands: [...foundationLocalCommands, ...sharedActionCommands, ...challengeLocalCommands, ...islandObjectCommands, ...islandEventCommands] }),
  });
  // Die Vorschau der Challenge-Anteile liest den Wochenplan des Seeds aus der Gerätedatenbank (#210).
  const game = createGameService({ database, writer, clock, newId, ...quietGameDependencies, planReader: planReaderOf(database) });
  let stage: IslandStage | null = null;
  cleanups.push(game.observeStage((next) => (stage = next)));
  let challenges: ChallengeStage | null = null;
  cleanups.push(game.observeChallenges((next) => (challenges = next)));
  return {
    database,
    game,
    stage: () => stage!,
    challenges: () => challenges!,
    outbox: () => database.read((tx) => pendingOperations(tx, 100)).length,
    async sync() {
      expect(await engine.sync()).toEqual({ push: expect.stringMatching(/^(done|nothing_to_do)$/), pull: 'done' });
    },
  };
}

type World = Readonly<{ backend: TestBackend; phones: Readonly<Record<SeedKey, Phone>> }>;

async function seeded(manifest: SeedManifest): Promise<World> {
  const backend = await createTestBackend({ clock: createTestClock(manifest.clock) });
  await seedServer(backend.database, manifest, backend.inviteCodes);
  const phones: Record<SeedKey, Phone> = {};
  for (const { key } of manifest.installations) phones[key] = await phone(backend, manifest, key);
  return { backend, phones };
}

async function stateOf({ backend, phones }: World): Promise<SeedState> {
  return {
    server: await dumpServer(backend.database.db),
    devices: Object.fromEntries(Object.entries(phones).map(([key, { database }]) => [key, dumpLocalDatabase(database)])),
  };
}

const canonical = (state: SeedState): SeedState => ({
  server: canonicalRows(state.server),
  devices: Object.fromEntries(Object.entries(state.devices).map(([key, device]) => [key, canonicalDevice(device)])),
});

async function runSyncSteps(manifest: SeedManifest, { phones }: World) {
  for (const step of manifest.steps) {
    if (step.type !== 'sync') throw new Error(`Unerwarteter Schritt ${step.type}`);
    await phones[step.installation]!.sync();
  }
}

describe.each(['solo-energie', 'rollenwahl-offen', 'haelfte-voll', 'challenge-vorgeschlagen', 'challenge-verfallen', 'challenge-passt-nicht'] as const)('Szenario %s', { timeout: 30_000 }, (scenario) => {
  const manifest = seedManifests[scenario];

  it('stellt Postgres und die Geräte exakt her, wiederholbar; nach den benannten Schritten gilt der Sollzustand', async () => {
    const world = await seeded(manifest);
    expect(await stateOf(world)).toEqual(canonical(manifest.initial));

    await runSyncSteps(manifest, world);
    expect(await stateOf(world)).toEqual(canonical(manifest.target));

    await seedServer(world.backend.database, manifest, world.backend.inviteCodes);
    for (const [key, { database }] of Object.entries(world.phones)) seedLocalDatabase(database, manifest, key);
    expect(await stateOf(world)).toEqual(canonical(manifest.initial));
  });
});

describe('Spieldienst auf den geseedeten Geräten', () => {
  it('solo-energie: Momo wartet als Laichkugel, die zwei Energie aus den Tageszielen bleiben', async () => {
    const { phones } = await seeded(seedManifests['solo-energie']);
    expect(phones['philipp-iphone']!.stage()).toEqual({ type: 'laichkugel', energy: 2 });
  });

  it('rollenwahl-offen: Philipp sieht Annas Vorschlag, Anna „Vorschlag gesendet“; Philipp lehnt ab, und Anna sieht es nach dem Sync', async () => {
    const { phones } = await seeded(seedManifests['rollenwahl-offen']);
    const [philipp, anna] = [phones['philipp-iphone']!, phones['anna-android']!];
    const actionId = seedIds.sharedAction.annasRollenwahl;
    expect(philipp.stage()).toMatchObject({ type: 'rollenwahl', partnerDisplayName: 'Anna', proposal: { actionId, by: 'partner', proposerRole: 'natur' } });
    expect(anna.stage()).toMatchObject({ type: 'rollenwahl', partnerDisplayName: 'Philipp', proposal: { actionId, by: 'self' } });

    expect(philipp.game.declineRoles(EntityId.parse(actionId))).toBe('vorgemerkt');
    await philipp.sync();
    await anna.sync();

    expect(anna.stage()).toMatchObject({ type: 'rollenwahl', proposal: null });
  });

  it('gekoppelt: Level 3, Philipp hat 23 Energie und seine Hälfte zu 53 %, Anna zu 46 % (#191)', { timeout: 30_000 }, async () => {
    const { phones } = await seeded(seedManifests.gekoppelt);
    expect(islandOf(phones['philipp-iphone']!)).toMatchObject({ energy: 23, halves: { level: 3, own: { halfPercent: 53 }, partner: { halfPercent: 46 }, waitingForPartner: false } });
    expect(islandOf(phones['philipp-iphone']!).objects).toHaveLength(20);
    expect(islandOf(phones['anna-android']!)).toMatchObject({ energy: 25, halves: { own: { halfPercent: 46 }, partner: { halfPercent: 53 } } });
  });

  it('haelfte-voll: Philipps Hälfte ist voll, Momo wartet auf Anna; Anna sieht nur die volle Partnerhälfte (#191)', { timeout: 30_000 }, async () => {
    const { phones } = await seeded(seedManifests['haelfte-voll']);
    expect(islandOf(phones['philipp-iphone']!)).toMatchObject({ energy: 17, halves: { level: 3, own: { halfPercent: 100, halfFull: true }, waitingForPartner: true } });
    expect(islandOf(phones['anna-android']!)).toMatchObject({ halves: { level: 3, partner: { halfFull: true }, waitingForPartner: false } });
  });

  it('doppelausgabe: Beide Geräte bauen offline mit derselben Energie; nach dem Sync stehen alle acht Bauten, und beide zeigen 0 Energie (#191)', { timeout: 30_000 }, async () => {
    const world = await seeded(seedManifests.doppelausgabe);
    const [iphone, ipad] = [world.phones['philipp-iphone']!, world.phones['philipp-ipad']!];
    // Offline sieht jedes Gerät nur die eigenen vier Laternen: 23 − 12 = 11.
    expect(islandOf(iphone)).toMatchObject({ energy: 11, halves: { own: { halfPercent: 100 } } });
    expect(islandOf(ipad)).toMatchObject({ energy: 11 });

    await runSyncSteps(seedManifests.doppelausgabe, world);

    for (const phone of [iphone, ipad]) {
      expect(islandOf(phone)).toMatchObject({ energy: 0, halves: { level: 3, own: { halfPercent: 100 } } });
      expect(islandOf(phone).objects).toHaveLength(20 + 8);
    }
  });

  it('feldkonflikt: Beide Geräte stellen offline auf dasselbe Feld; nach dem Sync liegt die zuerst platzierte Laterne auf beiden im Lager (#194)', { timeout: 30_000 }, async () => {
    const world = await seeded(seedManifests.feldkonflikt);
    const [iphone, ipad] = [world.phones['philipp-iphone']!, world.phones['philipp-ipad']!];
    const [first, second] = [seedIds.islandObject(1), seedIds.islandObject(2)];
    const at = (phone: Phone, id: string) => islandOf(phone).objects.find((object) => object.id === id)?.fieldKey;
    // Offline steht auf jedem Gerät die eigene Laterne auf `grundinsel:2:2`.
    expect(at(iphone, first)).toBe('grundinsel:2:2');
    expect(at(ipad, second)).toBe('grundinsel:2:2');

    await runSyncSteps(seedManifests.feldkonflikt, world);

    for (const phone of [iphone, ipad]) {
      expect(at(phone, second)).toBe('grundinsel:2:2');
      expect(islandOf(phone).storage.map((object) => object.id)).toEqual([first]);
      expect(islandOf(phone).energy).toBe(23);
    }
  });

  it('ereignisse-voll: Philipp sieht seine 4 offenen Wünsche; der Pull bringt ihm keinen neuen Besuch (#202)', { timeout: 30_000 }, async () => {
    const world = await seeded(seedManifests['ereignisse-voll']);
    const iphone = world.phones['philipp-iphone']!;
    expect(islandOf(iphone).events.open).toHaveLength(4);

    await runSyncSteps(seedManifests['ereignisse-voll'], world);

    expect(islandOf(iphone).events.open.map((event) => (event.kind === 'besuch' ? event.visitor.name : event.area.name))).toEqual(['Eule Otto', 'Schwan Selma', 'Fuchs Fridolin', 'Igel Ilse']);
  });

  it('levelaufstieg-ausstehend: Vor dem Pull wartet Momo auf Anna; danach feiern beide Geräte Level 4 genau einmal, Philipp beim nächsten sichtbaren Moment (#200)', { timeout: 30_000 }, async () => {
    const manifest = seedManifests['levelaufstieg-ausstehend'];
    const world = await seeded(manifest);
    const [iphone, android] = [world.phones['philipp-iphone']!, world.phones['anna-android']!];
    const levelUps = (phone: Phone) => {
      const reactions: MomoReaction[] = [];
      cleanups.push(phone.game.observeReactions((reaction) => reactions.push(reaction)));
      return () => reactions.flatMap((reaction) => (reaction.level === null ? [] : [reaction.level]));
    };
    // Anna sieht ihre Insel beim Sync; Philipps Oberfläche erscheint erst nach seinem Pull. Beide Geräte haben
    // Level 3 schon gefeiert (Seed), die Feier hängt also nicht daran, ob die Oberfläche vor dem Pull steht.
    const annasFeiern = levelUps(android);
    expect(islandOf(iphone)).toMatchObject({ halves: { level: 3, own: { halfFull: true }, waitingForPartner: true } });
    // Offline wirken Annas Bauten sofort auf ihre eigene Hälfte, das Level kommt erst über den Sync.
    expect(islandOf(android)).toMatchObject({ halves: { level: 3, own: { halfFull: true }, partner: { halfFull: true }, waitingForPartner: false } });

    await runSyncSteps(manifest, world);
    const philippsFeiern = levelUps(iphone);

    for (const phone of [iphone, android]) {
      expect(islandOf(phone)).toMatchObject({ halves: { level: 4, waitingForPartner: false } });
      // Level 4 ist ein Formlevel: Dazu kommen Hüpfer, Schilfwiese und Entdeckung (#204).
      expect(islandOf(phone).sharedEvents.map((event) => event.type).sort()).toEqual(['gebiet', 'levelaufstieg', 'momo_geschluepft']);
      expect(islandOf(phone)).toMatchObject({ appearance: { formKey: 'huepfer' }, unlockedAreas: ['schilfwiese'] });
    }
    expect(philippsFeiern()).toEqual([4]);
    expect(annasFeiern()).toEqual([4]);
  });

  it('formwechsel: Beim nächsten Öffnen des Tabs „Momo“ verwandelt sich Momo in den Hüpfer, und beide sehen die Entdeckung (#204)', { timeout: 30_000 }, async () => {
    const manifest = seedManifests.formwechsel;
    const world = await seeded(manifest);
    await runSyncSteps(manifest, world);

    for (const phone of [world.phones['philipp-iphone']!, world.phones['anna-android']!]) {
      expect(islandOf(phone)).toMatchObject({ appearance: { formKey: 'huepfer' }, unlockedAreas: ['schilfwiese'] });
      // Neben den Besuchen von heute aus `gekoppelt` wartet die Entdeckung.
      expect(islandOf(phone).events.open.filter((event) => event.kind === 'entdeckung')).toEqual([
        expect.objectContaining({ area: { key: 'schilfwiese', name: 'Schilfwiese' }, seen: false, claimable: true }),
      ]);
      expect(phone.game.takeTransformation()).toEqual({ from: 'kaulquappe', areas: ['schilfwiese'] });
      expect(phone.game.takeTransformation()).toBeNull();
    }
  });
});

describe('Challenges auf den geseedeten Geräten (#210)', () => {
  it('challenge-vorgeschlagen: Anna muss auf Philipps Vorschlag antworten, Philipp sieht „Vorschlag gesendet“', { timeout: 30_000 }, async () => {
    const { phones } = await seeded(seedManifests['challenge-vorgeschlagen']);
    const [philipp, anna] = [phones['philipp-iphone']!, phones['anna-android']!];
    const challengeId = seedIds.challenge.philippsVorschlag;

    expect(anna.challenges()).toMatchObject({ type: 'vorschlag', partnerDisplayName: 'Philipp', proposal: { challengeId, by: 'partner', templateKey: 'gut_getrunken', expiresAt: '2026-10-16T07:00:00.000Z' } });
    expect(philipp.challenges()).toMatchObject({ type: 'vorschlag', proposal: { challengeId, by: 'self' } });

    // Vom geseedeten Stand aus lässt sich annehmen; der echte `PlanReader` über Postgres schreibt die Anteile fest.
    expect(anna.game.acceptChallenge(EntityId.parse(challengeId))).toBe('vorgemerkt');
    await anna.sync();
    await philipp.sync();
    // Philipp plant jeden Tag das Wasserziel (6), Anna ebenso.
    expect(anna.challenges()).toMatchObject({ type: 'aktiv', challengeId, ownRequired: 6 });
    expect(philipp.challenges()).toMatchObject({ type: 'aktiv', challengeId, ownRequired: 6 });
  });

  it('challenge-verfallen: lokal ab der Frist nicht mehr offen; der Pull schreibt den Verfall fest', { timeout: 30_000 }, async () => {
    const manifest = seedManifests['challenge-verfallen'];
    const world = await seeded(manifest);
    const [philipp, anna] = [world.phones['philipp-iphone']!, world.phones['anna-android']!];
    expect(anna.challenges()).toMatchObject({ type: 'frei' });

    await runSyncSteps(manifest, world);

    expect(anna.challenges()).toMatchObject({ type: 'frei' });
    expect(philipp.game.proposeChallenge('gut_getrunken')).toBe('vorgemerkt');
  });

  it('challenge-passt-nicht: Anna sieht „Ernährung im Blick“ als unpassend; Philipps Vorschlag lehnt der Server ab', { timeout: 30_000 }, async () => {
    const { phones } = await seeded(seedManifests['challenge-passt-nicht']);
    const [philipp, anna] = [phones['philipp-iphone']!, phones['anna-android']!];

    expect((await anna.game.challengeShares()).ernaehrung_im_blick).toEqual({ type: 'passt_nicht' });
    // Philipp plant „Ernährung erfasst“ montags, freitags und sonntags: ceil(6/7 × 3) = 3.
    expect((await philipp.game.challengeShares()).ernaehrung_im_blick).toEqual({ type: 'passt', required: 3, planned: 3, possible: 3 });

    expect(philipp.game.proposeChallenge('ernaehrung_im_blick')).toBe('vorgemerkt');
    await philipp.sync();
    expect(philipp.outbox()).toBe(0);
    expect(philipp.challenges()).toMatchObject({ type: 'frei', unfitToday: ['ernaehrung_im_blick'] });
  });
});

function islandOf(phone: Phone) {
  const stage = phone.stage();
  if (stage.type !== 'geschluepft' || stage.island === null) throw new Error(`Nicht geschlüpft: ${JSON.stringify(stage)}`);
  return stage.island;
}
