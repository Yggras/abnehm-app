import { randomUUID } from 'node:crypto';

import { and, eq, isNotNull, sql } from 'drizzle-orm';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { AreaKey, EntityId, LocalDate, ServerVersion } from '@abnehm/contracts/base';
import { partnerSummaryPeriodOf, revocationNoticeId } from '@abnehm/contracts/partner';
import {
  buildSeedState,
  gekoppeltParts,
  SeedManifest,
  seedIds,
  seedInviteCodes,
  seedManifests,
  uncoupledState,
  type SeedKey,
  type SeedPart,
  uncouplingRequestOf,
} from '@abnehm/contracts/seeds';

import { couplingMember as localMember } from '../../mobile/src/local-db/schema/index.ts';
import { sqliteOf } from '../../mobile/src/local-db/sqlite.ts';
import { canonicalDevice, dumpLocalDatabase } from '../../mobile/src/test-capabilities/seed/local-seed.ts';
import { policies } from '../src/authorization/authorization.ts';
import { mealPhoto, photoDraft, revocationNotice } from '../src/db/schema/index.ts';
import type { PartnerSummaryProjector } from '../src/partner-projections/projector.ts';
import { postgresPlanReader } from '../src/plan/plan-reader.ts';
import { trackerPartnerSummaryProjectors } from '../src/trackers/partner-summaries.ts';
import type { TestBackend } from './support/app.ts';
import { call, type Device } from './support/auth-client.ts';
import { httpOutcome, resourceProbe } from './support/authorization.ts';
import { coupleByInvitation } from './support/coupled-world.ts';
import { completeOp } from './support/daily-goals.ts';
import { canonical, runSteps, seeded, seedPhone as phone, stateOf } from './support/seed-world.ts';
import { push, upsertOp } from './support/sync.ts';

// Nachweis für #117: die Partner-Szenarien `gekoppelt` und `nach_entkopplung` (Spezifikation 0,
// Abschnitt 12), dazu `einladung-nach-entkopplung` aus #120, auf Postgres und auf beiden Geräten, deren Engine und Adapter auf echtem SQLite
// (better-sqlite3) gegen die echte Hono-App laufen. Ausgangszustand, Idempotenz und Sollzustand nach
// den Schritten prüft für jedes Manifest `seed-manifeste-app.test.ts` (#113). Hier führen die Tests
// Kopplungs-, Projektions- und Entkopplungsübergänge aus und prüfen die widerrufbaren Daten auf beiden
// Geräten.

const gekoppelt = seedManifests.gekoppelt;
const nachEntkopplung = seedManifests.nach_entkopplung;

const probe = (backend: TestBackend, entity: 'meal_photo' | 'partner_photo_list', device: Device, id?: string) =>
  resourceProbe(backend, policies.resource(entity, 'lesen'))(device, id === undefined ? {} : { id }).then(httpOutcome);

describe('Szenario gekoppelt', () => {
  it('der Sync ändert nichts: Der Sollzustand ist der Ausgangszustand', () => {
    expect(gekoppelt.steps.map(({ type }) => type)).toEqual(['sync', 'sync']);
    expect(gekoppelt.target).toEqual(gekoppelt.initial);
  });

  it('ein vollständiger Pull ergibt genau den geseedeten Gerätezustand: Sichtbarkeit und Partnercache passen zum Server', async () => {
    const world = await seeded(gekoppelt);
    // Was der Sync heute überträgt: Entitäten mit Eintrag im Änderungsprotokoll, seit #171 auch Wassereinträge,
    // seit #128 Ziel- und Wochenplanversionen; die Wochenplantage reisen mit ihrer Version. Tagesziele, Sport-,
    // Gewichts- und Ernährungseinträge sowie Fotos melden erst die Spezifikationen 1–3 an; die behält das Gerät
    // samt eigener Person, an der sie hängen.
    const synced = new Set(gekoppelt.initial.server.change_log!.map((entry) => String(entry.entity_type)));
    if (synced.has('weekly_plan_version')) synced.add('weekly_plan_day');
    synced.delete('person');

    for (const key of ['philipp-iphone', 'anna-android']) {
      const seededDevice = gekoppelt.initial.devices[key]!;
      const unsynced = Object.fromEntries(Object.entries(seededDevice.rows).filter(([table]) => !synced.has(table)));
      const withoutPull = SeedManifest.parse({ ...gekoppelt, initial: { ...gekoppelt.initial, devices: { [key]: { rows: unsynced, cursor: null, outbox: [] } } } });
      const fresh = await phone(world.backend, withoutPull, key);

      await fresh.sync();

      expect(dumpLocalDatabase(fresh.database)).toEqual(canonicalDevice(seededDevice));
    }
  });

  it('jedes Gerät zeigt vom Partner nur die freigegebenen Zusammenfassungen und den groben Tageszielstand', async () => {
    const { phones } = await seeded(gekoppelt);
    const philipp = phones['philipp-iphone']!;
    const anna = phones['anna-android']!;

    // Den Partnernamen liefert nur das Kopplungsmitglied (#121).
    expect(philipp.partner()).toEqual({
      partner: { personId: anna.personId, displayName: 'Anna' },
      dailyGoalStatus: expect.objectContaining({ ownerPersonId: anna.personId, stage: 'fast_geschafft' }),
      summaries: [
        expect.objectContaining({ type: 'wasser', ownerPersonId: anna.personId, content: { progressPercent: 100 } }),
        expect.objectContaining({ type: 'sport', content: { countedMinutes: 125, weeklyTargetMinutes: 120 } }),
        expect.objectContaining({ type: 'gewicht', content: { changeKg: -0.2, direction: 'sinkend' } }),
      ],
    });
    expect(anna.partner()).toEqual({
      partner: { personId: philipp.personId, displayName: 'Philipp' },
      dailyGoalStatus: expect.objectContaining({ ownerPersonId: philipp.personId, stage: 'unterwegs' }),
      summaries: [
        expect.objectContaining({ type: 'ernaehrung', ownerPersonId: philipp.personId, content: { recordedMealCategories: 2 } }),
        expect.objectContaining({ type: 'wasser', content: { progressPercent: 50 } }),
        expect.objectContaining({ type: 'sport', content: { countedMinutes: 105, weeklyTargetMinutes: 150 } }),
        expect.objectContaining({ type: 'gewicht', content: { changeKg: -0.6, direction: 'sinkend' } }),
      ],
    });
  });

  it('die geseedeten Zusammenfassungen Wasser, Sport und Gewicht rechnen die Projectors aus #181 zur Uhr des Seeds genauso', async () => {
    const { backend } = await seeded(gekoppelt);
    const projectors: Partial<Record<AreaKey, PartnerSummaryProjector>> = trackerPartnerSummaryProjectors({ planReader: postgresPlanReader });
    const rows = (gekoppelt.initial.server.partner_summary ?? []).filter((row) => projectors[AreaKey.parse(row.area)] !== undefined);
    expect(rows).toHaveLength(6);

    for (const row of rows) {
      const area = AreaKey.parse(row.area);
      const projector = projectors[area]!;
      const content = await backend.database.db.transaction((tx) => projector.project(tx, {
        ownerPersonId: EntityId.parse(row.owner_person_id),
        period: partnerSummaryPeriodOf(area, LocalDate.parse(row.period_from), LocalDate.parse(row.period_to)),
        today: LocalDate.parse(gekoppelt.localDates.heute),
      }));
      expect(content, `${row.owner_person_id} ${area}`).toEqual(row.content);
    }
  });

  it('Mahlzeitenfotos: Online-Sichtbarkeit wie im Erweiterungspunkt, ohne Bereichsfreigabe Ernährung', async () => {
    const { backend, phones } = await seeded(gekoppelt);
    const photos = gekoppelt.extensions?.mealPhotos;
    expect(photos?.version).toBe(2);
    const deviceOf = (account: SeedKey) => Object.values(phones).find(({ personId }) => personId === seedIds.person[account as 'philipp' | 'anna'])!.device;

    for (const photo of photos!.photos) {
      expect(await probe(backend, 'meal_photo', deviceOf(photo.account), photo.id)).toBe('erlaubt');
      for (const viewer of photo.visibleTo) {
        // Annas Ernährung ist privat; ihr Foto sieht Philipp trotzdem (Fotofreigabe `geteilt`).
        expect(await probe(backend, 'meal_photo', deviceOf(viewer), photo.id)).toBe('erlaubt');
        expect(await probe(backend, 'partner_photo_list', deviceOf(viewer))).toBe('erlaubt');
      }
      // Philipps vom Teilen ausgenommenes und sein verwaistes Foto (#164) sieht Anna nicht.
      for (const other of (['philipp', 'anna'] as const).filter((account) => account !== photo.account && !photo.visibleTo.includes(account))) {
        expect(await probe(backend, 'meal_photo', deviceOf(other), photo.id), `${other} ${photo.id}`).toBe('verweigert');
      }
    }
  });

  it('Mahlzeitenfotos (#162): synthetische Bilder in der Fotoablage, ein abgelaufener Entwurf, Fotos auf dem eigenen Gerät', async () => {
    const { backend, phones } = await seeded(gekoppelt);
    const photos = gekoppelt.extensions?.mealPhotos;
    if (photos?.version !== 2) throw new Error('Fassung 2 erwartet');

    for (const photo of photos.photos) {
      const large = await backend.photoStorage.readPhoto(photo.imageKey, 'gross');
      const preview = await backend.photoStorage.readPhoto(photo.imageKey, 'vorschau');
      expect([large, preview].every((image) => image !== null)).toBe(true);
      const [largeMeta, previewMeta] = await Promise.all([sharp(large!).metadata(), sharp(preview!).metadata()]);
      expect([largeMeta.width, largeMeta.height]).toEqual([photo.image.width, photo.image.height]);
      expect(Math.max(previewMeta.width!, previewMeta.height!)).toBe(400);
      // Das Foto liegt mit seinem Bildschlüssel auf dem Gerät seiner Eigentümerin, nicht beim Partner.
      for (const phone of Object.values(phones)) {
        const local = dumpLocalDatabase(phone.database).rows.meal_photo?.map((row) => [row.id, row.image_key]) ?? [];
        if (phone.personId === seedIds.person[photo.account as 'philipp' | 'anna']) expect(local).toContainEqual([photo.id, photo.imageKey]);
        else expect(local.map(([id]) => id)).not.toContain(photo.id);
      }
    }
    const [draft] = photos.expiredDrafts;
    expect(await backend.photoStorage.readDraft(draft!.imageKey)).not.toBeNull();
    expect((await backend.database.db.select().from(photoDraft)).map((row) => row.id)).toEqual([draft!.id]);

    // Die Aufräumjobs entfernen den abgelaufenen Entwurf samt Bild und setzen das seit gestern verwaiste Foto
    // auf Tombstone samt Dateien (#164); die übrigen Fotos bleiben.
    await backend.jobs.runDue();
    expect(await backend.database.db.select().from(photoDraft)).toEqual([]);
    expect((await backend.photoStorage.storedKeys()).drafts).toEqual([]);
    const orphan = photos.photos.find(({ id }) => id === seedIds.mealPhoto.philippVerwaist)!;
    expect((await backend.photoStorage.storedKeys()).photos).toEqual(photos.photos.filter((photo) => photo !== orphan).map(({ imageKey }) => imageKey).sort());
    const tombstoned = await backend.database.db.select({ id: mealPhoto.id }).from(mealPhoto).where(isNotNull(mealPhoto.deletedAt));
    expect(tombstoned.map(({ id }) => id)).toEqual([orphan.id]);
  });

  it('Projektionsübergang: Anna stellt Wasser auf privat; Philipps Gerät verliert genau diese Zusammenfassung', async () => {
    const { backend, phones } = await seeded(gekoppelt);
    const philipp = phones['philipp-iphone']!;
    const anna = phones['anna-android']!;
    expect(philipp.partner().summaries.map(({ type }) => type)).toEqual(['wasser', 'sport', 'gewicht']);

    anna.setSharing('wasser', 'privat');
    await anna.sync();
    await philipp.sync();

    expect(philipp.partner().summaries.map(({ type }) => type)).toEqual(['sport', 'gewicht']);
    expect(philipp.partner().dailyGoalStatus).toMatchObject({ stage: 'fast_geschafft' });
    const [notice] = await backend.database.db
      .select()
      .from(revocationNotice)
      .where(and(eq(revocationNotice.recipientPersonId, philipp.personId), eq(revocationNotice.projectionId, seedIds.partnerSummary.anna.wasser)));
    expect(notice).toMatchObject({ reason: 'freigabe_entzogen', id: revocationNoticeId(ServerVersion.parse(notice!.serverVersion.toString())) });
  });

  it('Projektionsübergang: Philipp trinkt sein Wasserziel voll und erfüllt es; Annas Gerät zeigt „fast geschafft“', async () => {
    const { backend, phones } = await seeded(gekoppelt);
    const anna = phones['anna-android']!;
    const philipp = EntityId.parse(seedIds.person.philipp);
    const heute = LocalDate.parse('2026-10-14');
    // 1250 ml zu den geseedeten 1250 ml, per Push wie vom Gerät (Wassereintrag seit #171 beim Sync angemeldet).
    const drink = { amountMl: 1_250, origin: 'manuell', loggedAt: '2026-10-14T11:45:00.000Z', localDate: heute, timeZone: 'Europe/Berlin', utcOffsetMinutes: 120 };
    const water = { id: EntityId.parse(seedIds.dailyGoal.philippHeute[1]), personId: philipp, localDate: heute, slot: 2, baustein: 'wasserziel' } as const;

    const results = await push(backend, phones['philipp-iphone']!.device, [
      upsertOp(randomUUID(), drink, { entityType: 'water_entry' }),
      completeOp(water, { completedAt: '2026-10-14T11:50:00.000Z' }),
    ]);
    expect(results.map(({ type }) => type)).toEqual(['applied', 'applied']);
    await anna.sync();

    expect(anna.partner().dailyGoalStatus).toMatchObject({ id: seedIds.partnerDailyGoalStatus.philipp, stage: 'fast_geschafft' });
  });
});

describe('Szenario nach_entkopplung', () => {
  it('startet im Zustand von gekoppelt: Beide Geräte zeigen den Partner, bis der Entkopplungs-Kern läuft', async () => {
    expect(nachEntkopplung.initial).toEqual(gekoppelt.initial);
    expect(nachEntkopplung.steps.map(({ type }) => type)).toEqual(['entkoppeln', 'sync', 'sync']);
    const world = await seeded(nachEntkopplung);
    for (const { partner } of Object.values(world.phones)) {
      expect(partner().dailyGoalStatus).not.toBeNull();
      expect(partner().summaries.length).toBeGreaterThan(0);
    }
  });

  it('widerruft tatsächlich: Kopplung und Insel archiviert, Notices an beide, Partnercaches leer, Namen bleiben', async () => {
    const world = await seeded(nachEntkopplung);
    await runSteps(world);
    const { server } = await stateOf(world);
    const couplingId = seedIds.coupling.philippAnna;

    expect(server.coupling).toEqual([expect.objectContaining({ id: couplingId, status: 'archiviert', ended_at: '2026-10-14T12:00:00.000Z' })]);
    expect(server.island).toEqual([expect.objectContaining({ state: 'archiviert' })]);
    expect(server.shared_action).toEqual([
      expect.objectContaining({ id: seedIds.sharedAction.annasEntkopplung, kind: 'entkoppeln', status: 'angenommen', requester_person_id: seedIds.person.anna }),
    ]);
    expect(server.revocation_notice?.map(({ recipient_person_id, target_type, reason }) => [recipient_person_id, target_type, reason]).sort()).toEqual([
      [seedIds.person.philipp, 'kopplung', 'entkopplung'],
      [seedIds.person.anna, 'kopplung', 'entkopplung'],
    ]);
    for (const table of ['partner_summary', 'partner_daily_goal_status']) {
      expect(server[table]?.every(({ deleted_at }) => deleted_at !== null)).toBe(true);
    }
    for (const { database, partner } of Object.values(world.phones)) {
      expect(partner()).toEqual({ partner: null, dailyGoalStatus: null, summaries: [] });
      const members = database.read((tx) => sqliteOf(tx).select({ name: localMember.displayName, status: localMember.couplingStatus }).from(localMember).all());
      expect(members.sort((a, b) => a.name.localeCompare(b.name))).toEqual([
        { name: 'Anna', status: 'archiviert' },
        { name: 'Philipp', status: 'archiviert' },
      ]);
    }
  });

  it('beendet offene gemeinsame Aktionen der Kopplung; der Sollzustand sagt das voraus', async () => {
    // Bis Spezifikation 4 das Deko-Geschenk liefert (#198), steht hier eine offene Aktion der Test-Art `rollentausch`.
    const open: SeedPart = {
      area: 'spiel',
      entities: [
        {
          table: 'shared_action',
          entityType: 'shared_action',
          couplingId: seedIds.coupling.philippAnna,
          row: {
            id: '5eed0045-0000-4000-8000-0000000000f1',
            coupling_id: seedIds.coupling.philippAnna,
            kind: 'rollentausch',
            requester_person_id: seedIds.person.philipp,
            payload: {},
            status: 'offen',
            decided_at: null,
            created_at: '2026-10-14T11:00:00.000Z',
            updated_at: '2026-10-14T11:00:00.000Z',
            deleted_at: null,
          },
        },
      ],
    };
    const initial = buildSeedState({
      parts: [...gekoppeltParts, open],
      createdAt: gekoppelt.clock.instant,
      devices: {
        'philipp-iphone': { personId: seedIds.person.philipp, cursor: 'latest' },
        'anna-android': { personId: seedIds.person.anna, cursor: 'latest' },
      },
    });
    const [step] = nachEntkopplung.steps;
    if (step?.type !== 'entkoppeln') throw new Error('Erster Schritt ist die Entkopplung');
    const manifest = SeedManifest.parse({
      ...nachEntkopplung,
      initial,
      target: uncoupledState(initial, uncouplingRequestOf(step, nachEntkopplung.accounts)),
    });
    const world = await seeded(manifest);

    await runSteps(world);

    const state = await stateOf(world);
    expect(state).toEqual(canonical(manifest.target));
    expect(state.server.shared_action?.find(({ id }) => id === open.entities[0]!.row.id)).toMatchObject({ status: 'zurueckgezogen' });
  });

  it('nach der Entkopplung sieht der frühere Partner die Mahlzeitenfotos nicht mehr', async () => {
    const world = await seeded(nachEntkopplung);
    await runSteps(world);
    const philipp = world.phones['philipp-iphone']!.device;
    const anna = world.phones['anna-android']!.device;

    expect(await probe(world.backend, 'meal_photo', philipp, seedIds.mealPhoto.annaHeute)).toBe('verweigert');
    expect(await probe(world.backend, 'meal_photo', anna, seedIds.mealPhoto.philippHeute)).toBe('verweigert');
    expect(await probe(world.backend, 'partner_photo_list', philipp)).toBe('verweigert');
    expect(await probe(world.backend, 'meal_photo', anna, seedIds.mealPhoto.annaHeute)).toBe('erlaubt');
  });

  it('Kopplungsübergang: Dasselbe Paar koppelt erneut; Rollen und Freigaben kehren zurück, Projektionen entstehen neu', async () => {
    const world = await seeded(nachEntkopplung);
    await runSteps(world);
    const philipp = world.phones['philipp-iphone']!;
    const anna = world.phones['anna-android']!;

    expect(await coupleByInvitation(world.backend, philipp.device, anna.device)).toEqual({ couplingId: seedIds.coupling.philippAnna, reactivated: true });
    await philipp.sync();
    await anna.sync();

    const { server } = await stateOf(world);
    expect(server.coupling).toEqual([expect.objectContaining({ status: 'aktiv', reactivated_at: '2026-10-14T12:00:00.000Z' })]);
    expect(server.coupling_member?.map(({ person_id, role }) => [person_id, role]).sort()).toEqual([
      [seedIds.person.philipp, 'bauen'],
      [seedIds.person.anna, 'natur'],
    ]);
    expect(server.partner_sharing?.find(({ id }) => id === seedIds.partnerSharing.anna.ernaehrung)).toMatchObject({ level: 'privat' });
    // Gelöschtes wird nicht wiederbelebt: Der Tageszielstand kommt mit neuer ID.
    expect(philipp.partner().dailyGoalStatus).toMatchObject({ stage: 'fast_geschafft' });
    expect(philipp.partner().dailyGoalStatus?.id).not.toBe(seedIds.partnerDailyGoalStatus.anna);
    expect(anna.partner().dailyGoalStatus).toMatchObject({ stage: 'unterwegs' });
    expect(anna.partner().dailyGoalStatus?.id).not.toBe(seedIds.partnerDailyGoalStatus.philipp);
  });
});

describe('Szenario einladung-nach-entkopplung (#120)', () => {
  const manifest = seedManifests['einladung-nach-entkopplung'];

  it('ist der Sollzustand von nach_entkopplung plus Annas offene Einladung', () => {
    const { invitation, ...rest } = manifest.initial.server;
    expect(rest).toEqual(nachEntkopplung.target.server);
    expect(manifest.initial.devices).toEqual(nachEntkopplung.target.devices);
    expect(invitation).toEqual([expect.objectContaining({ id: seedIds.invitation.annasEinladung, inviter_person_id: seedIds.person.anna, consumed_at: null })]);
  });

  it('Philipp prüft den geseedeten Code: Anna lädt ein, die Annahme reaktiviert; danach ist das Paar wieder gekoppelt', async () => {
    const world = await seeded(manifest);
    const philipp = world.phones['philipp-iphone']!;
    const code = seedInviteCodes.annasEinladung;

    const checked = await call(world.backend, 'POST', '/v1/invitations/check', philipp.device, { code });
    expect(checked).toMatchObject({ status: 200, body: { inviterDisplayName: 'Anna', reactivates: true } });

    const accepted = await call(world.backend, 'POST', '/v1/invitations/accept', philipp.device, { requestId: randomUUID(), code });
    expect(accepted).toMatchObject({ status: 200, body: { couplingId: seedIds.coupling.philippAnna, reactivated: true } });
    await philipp.sync();

    expect(philipp.partner().partner).toMatchObject({ personId: seedIds.person.anna, displayName: 'Anna' });
    const { server } = await stateOf(world);
    expect(server.coupling).toEqual([expect.objectContaining({ status: 'aktiv' })]);
    expect(server.invitation).toEqual([expect.objectContaining({ consumed_by_person_id: seedIds.person.philipp })]);
  });

  it('ein anderer Code passt nicht; der geseedete Code ist kein Klartext in Postgres', async () => {
    const world = await seeded(manifest);
    const philipp = world.phones['philipp-iphone']!;
    const other = '000000';

    expect(await call(world.backend, 'POST', '/v1/invitations/check', philipp.device, { code: other })).toMatchObject({
      status: 422,
      body: { code: 'invite_invalid' },
    });
    const rows = await world.backend.database.db.execute<{ code_hmac: string }>(sql`select code_hmac from invitation`);
    expect(rows.rows).toEqual([{ code_hmac: world.backend.inviteCodes.hmacOf(seedInviteCodes.annasEinladung) }]);
    expect(rows.rows[0]!.code_hmac).not.toContain(seedInviteCodes.annasEinladung);
  });
});
