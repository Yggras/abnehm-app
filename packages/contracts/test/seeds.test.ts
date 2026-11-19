import { describe, expect, it } from 'vitest';

import {
  buildSeedState,
  SeedManifest,
  seedClock,
  seedDays,
  seedIds,
  seedImageKeys,
  seedInviteCodes,
  seedManifests,
  seedPassword,
  type SeedPart,
} from '../seeds/index.ts';
import { soloParts } from '../seeds/solo.ts';
import { AreaKey, LocalDate, ServerVersion } from '../src/base.ts';
import { DailyGoalSnapshot } from '../src/daily-goals.ts';
import { EnergyBooking } from '../src/energy.ts';
import { EncouragementKey, PartnerSummaryEnvelope, partnerSummaryPeriodOf, revocationNoticeId } from '../src/partner.ts';
import { CreateGoalVersion } from '../src/plan.ts';
import { countedWaterMl, dayWeights, isWeighDay, showsTrend, trackerStatus, weekMinutes, weightChange, weightForecast, weightTrend } from '../src/tracker-rules.ts';

// Nachweis für #112, #116 und #117: Format der Seed-Manifeste, Baukasten der Bereichsbeiträge und die
// Partner-Szenarien `gekoppelt` und `nach_entkopplung`; für #171 die Wassereinträge von solo und seine
// Varianten je Status des Wasser-Mini-Trackers; für #173 die Sportwoche von solo und seine Varianten. Dass Server und Geräte die Manifeste tatsächlich so
// herstellen und erreichen, prüft `apps/backend/test/seed-partner-app.test.ts`.

const solo = seedManifests.solo;
const philipp = seedIds.person.philipp;

const orNull = (value: unknown) => (value === null || value === undefined ? null : String(value));

/** Was die Sport-Zählregel von einer Seed-Zeile braucht, samt Ausblendung und Ersetzung (#181). */
const sportFacts = (row: Record<string, unknown>) => ({
  id: String(row.id), origin: String(row.origin), durationMinutes: Number(row.duration_minutes), localDate: String(row.local_date),
  deletedAt: orNull(row.deleted_at), hiddenAt: orNull(row.hidden_at), replacedByEntryId: orNull(row.replaced_by_entry_id), reactivatedAt: orNull(row.reactivated_at),
});

/** Was die Gewichtsregeln von einer Seed-Zeile brauchen. */
const weightFacts = (row: Record<string, unknown>) => ({
  weightG: Number(row.weight_g), measuredAt: String(row.measured_at), localDate: String(row.local_date), deletedAt: orNull(row.deleted_at), hiddenAt: orNull(row.hidden_at),
});

describe('Seed-Manifest', () => {
  it('enthält feste Uhr, Zone, lokale Tage, Katalogversion, Konten, Installationen, Ausgangs- und Sollzustand', () => {
    expect(solo.formatVersion).toBe(1);
    expect(solo.clock).toEqual({ instant: '2026-10-14T12:00:00.000Z', timeZone: 'Europe/Berlin' });
    expect(solo.localDates.heute).toBe('2026-10-14');
    expect(solo).toHaveProperty('catalogVersion', null);
    expect(solo.accounts.map(({ email }) => email)).toEqual(['philipp@example.test']);
    expect(solo.installations).toEqual([expect.objectContaining({ key: 'philipp-iphone', platform: 'ios' })]);
    expect(solo.initial.devices['philipp-iphone']).toEqual(expect.objectContaining({ cursor: expect.any(String), outbox: [] }));
    expect(solo.steps).toEqual([{ type: 'sync', installation: 'philipp-iphone' }]);
    expect(solo.target).toEqual(solo.initial);
  });

  it('vergibt Serverversionen lückenlos, führt Sync-Clock und Cursor auf die letzte Position', () => {
    const versioned = Object.entries(solo.initial.server)
      .filter(([table]) => table !== 'change_log' && table !== 'sync_clock')
      .flatMap(([, rows]) => rows.map((row) => row.server_version))
      .filter((version) => version !== undefined)
      .map(Number)
      .sort((a, b) => a - b);
    expect(versioned).toEqual(versioned.map((_, index) => index + 1));
    expect(solo.initial.server.sync_clock).toEqual([{ id: 1, position: String(versioned.length) }]);
    expect(solo.initial.devices['philipp-iphone']!.cursor).toBe(String(versioned.length));
  });

  it('schreibt das Änderungsprotokoll nur für beim Sync angemeldete Entitäten', () => {
    expect(solo.initial.server.change_log).toEqual([
      expect.objectContaining({ entity_type: 'person', entity_id: philipp, owner_person_id: philipp, operation: 'upsert' }),
      expect.objectContaining({ entity_type: 'goal_version', entity_id: seedIds.goalVersion.philipp, owner_person_id: philipp, operation: 'upsert' }),
      expect.objectContaining({ entity_type: 'weekly_plan_version', entity_id: seedIds.weeklyPlanVersion.philipp, owner_person_id: philipp, operation: 'upsert' }),
      ...seedIds.waterEntry.philippHeute.slice(0, 2).map((id) =>
        expect.objectContaining({ entity_type: 'water_entry', entity_id: id, owner_person_id: philipp, operation: 'upsert' })),
      ...[seedIds.sportEntry.philippVorgestern, seedIds.sportEntry.philippGestern].map((id) =>
        expect.objectContaining({ entity_type: 'sport_entry', entity_id: id, owner_person_id: philipp, operation: 'upsert' })),
      ...[seedIds.weightEntry.philippVorgestern, seedIds.weightEntry.philippGestern].map((id) =>
        expect.objectContaining({ entity_type: 'weight_entry', entity_id: id, owner_person_id: philipp, operation: 'upsert' })),
      ...[...seedIds.nutritionEntry.philippFruehstueck, ...seedIds.nutritionEntry.philippVortag].map((id) =>
        expect.objectContaining({ entity_type: 'nutrition_entry', entity_id: id, owner_person_id: philipp, operation: 'upsert' })),
      ...[seedIds.ownFood.philippBircher, seedIds.ownFood.philippApfel].map((id) =>
        expect.objectContaining({ entity_type: 'own_food', entity_id: id, owner_person_id: philipp, operation: 'upsert' })),
      ...seedIds.sportEntry.philippVorwoche.map((id) =>
        expect.objectContaining({ entity_type: 'sport_entry', entity_id: id, owner_person_id: philipp, operation: 'upsert' })),
    ]);
  });

  it('enthält Ernährungseinträge am Vortag ohne Abendessen und ohne Mahlzeitenfoto (#156)', () => {
    const yesterday = solo.initial.devices['philipp-iphone']!.rows.nutrition_entry!.filter((row) => row.local_date === seedDays.gestern);

    expect(yesterday.map(({ id, meal, meal_photo_id }) => ({ id, meal, meal_photo_id }))).toEqual([
      { id: seedIds.nutritionEntry.philippVortag[0], meal: 'fruehstueck', meal_photo_id: null },
      { id: seedIds.nutritionEntry.philippVortag[1], meal: 'mittagessen', meal_photo_id: null },
      { id: seedIds.nutritionEntry.philippVortag[2], meal: 'snacks', meal_photo_id: null },
    ]);
    // 219,6 + 124 + 79 kcal: unter der Untergrenze von 1.882 kcal, „Im Kalorienbudget“ von gestern bliebe offen.
    expect(yesterday.reduce((sum, row) => sum + Number(row.total_milli_kcal), 0)).toBe(422_600);
  });

  it('enthält ein eigenes Lebensmittel mit Portionsumrechnung und eine Korrektur eines BLS-Lebensmittels (#157)', () => {
    const ownFoods = solo.initial.devices['philipp-iphone']!.rows.own_food;

    expect(ownFoods).toEqual([
      expect.objectContaining({ id: seedIds.ownFood.philippBircher, portions: [{ unit: 'portion', label: '1 Glas', baseAmount: 250_000 }], origin_type: null }),
      expect.objectContaining({ id: seedIds.ownFood.philippApfel, name: 'Apfel roh', origin_type: 'bls', origin_key: 'F110100' }),
    ]);
    expect(solo.initial.server.own_food).toEqual(ownFoods);
  });

  describe('Gewicht (#175)', () => {
    const weighings = (scenario: keyof typeof seedManifests, personId: string = philipp) =>
      (seedManifests[scenario].initial.server.weight_entry ?? [])
        .filter((row) => row.person_id === personId)
        .map((row) => ({ weightG: Number(row.weight_g), measuredAt: String(row.measured_at), localDate: String(row.local_date), deletedAt: null, hiddenAt: null }));
    /** Bausteine des Wochenplantags der Person am Wochentag. */
    const planDay = (scenario: keyof typeof seedManifests, weekday: string, personId: string = philipp) => {
      const day = seedManifests[scenario].initial.server.weekly_plan_day?.find((row) => row.person_id === personId && row.weekday === weekday);
      return [day?.baustein_1, day?.baustein_2, day?.baustein_3].map(String);
    };

    it.each(['solo', 'gekoppelt'] as const)('%s: Philipp hat Gewichtseinträge bis gestern, heute (Mittwoch) ist sein Wiegetag noch offen', (scenario) => {
      const days = dayWeights(weighings(scenario));

      expect(days.length).toBeGreaterThan(0);
      expect(days.at(-1)!.localDate < seedDays.heute).toBe(true);
      expect(isWeighDay(planDay(scenario, 'mittwoch'))).toBe(true);
    });

    it('solo: Philipps Gewichtseinträge sind ohne Importe; den Waagenimport gibt es nur in den Partner-Szenarien (#181)', () => {
      expect((solo.initial.server.weight_entry ?? []).every((row) => row.origin === 'manuell')).toBe(true);
    });

    it('solo-ohne-wiegetag: Der Wochenplan hat keinen Wiegetag, sonst gleicht das Szenario solo', () => {
      const variant = seedManifests['solo-ohne-wiegetag'].initial.server;
      const weekdays = ['montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag', 'sonntag'];

      for (const weekday of weekdays) expect(isWeighDay(planDay('solo-ohne-wiegetag', weekday))).toBe(false);
      // Dieselbe Wochenplanversion wie in solo (ID aus Person und valid_from, #128), nur andere Tage.
      expect(variant.weekly_plan_version?.map((row) => row.id)).toEqual(solo.initial.server.weekly_plan_version?.map((row) => row.id));
      // Die Tagesziele von heute folgen dem Mittwoch dieses Plans.
      expect(variant.daily_goal?.map((goal) => goal.baustein)).toEqual(planDay('solo-ohne-wiegetag', 'mittwoch'));
      expect(variant.weight_entry).toEqual(solo.initial.server.weight_entry);
      expect(variant.water_entry).toEqual(solo.initial.server.water_entry);
      expect(variant.goal_version).toEqual(solo.initial.server.goal_version);
    });
  });

  describe('Gewichtstrend (#176)', () => {
    const points = (scenario: keyof typeof seedManifests) =>
      weightTrend(
        dayWeights(
          (seedManifests[scenario].initial.server.weight_entry ?? []).map((row) => ({
            weightG: Number(row.weight_g), measuredAt: String(row.measured_at), localDate: String(row.local_date), deletedAt: null, hiddenAt: null,
          })),
        ),
      );
    const goal = (scenario: keyof typeof seedManifests) => seedManifests[scenario].initial.server.goal_version?.[0];

    it('solo: unter drei Tagesgewichten, noch ohne Trend', () => {
      expect(showsTrend(points('solo').length)).toBe(false);
    });

    it('solo-gewicht-steigend: steigender Trend', () => {
      expect(showsTrend(points('solo-gewicht-steigend').length)).toBe(true);
      expect(weightChange(points('solo-gewicht-steigend'), seedDays.heute)).toEqual({ changeKg: 0.2, direction: 'steigend' });
    });

    it('solo-gewicht-ohne-14-tage: Trend, aber kein Tagesgewicht in den letzten 14 Tagen', () => {
      expect(showsTrend(points('solo-gewicht-ohne-14-tage').length)).toBe(true);
      expect(weightChange(points('solo-gewicht-ohne-14-tage'), seedDays.heute)).toEqual({ changeKg: null, direction: 'noch_nicht_verfuegbar' });
    });

    it('solo-haltemodus: Trend über dem Zielgewicht, die Prognose entfällt nur wegen des Haltemodus', () => {
      const trendG = points('solo-haltemodus').at(-1)!.trendG;
      const { goal_weight_g: goalWeightG, pace, maintenance_reason: reason } = goal('solo-haltemodus')!;
      expect(showsTrend(points('solo-haltemodus').length)).toBe(true);
      expect({ pace, reason }).toEqual({ pace: null, reason: 'gewaehlt' });
      expect(weightForecast({ today: seedDays.heute, trendG, goalWeightG: Number(goalWeightG), pace: null })).toBeNull();
      expect(weightForecast({ today: seedDays.heute, trendG, goalWeightG: Number(goalWeightG), pace: 'entspannt' })).not.toBeNull();
    });

    it('solo-haltemodus: Die Zielversion passt zu ihren Eingaben im Zielrechner', () => {
      const row = goal('solo-haltemodus')!;
      const version = CreateGoalVersion.safeParse({
        validFrom: row.valid_from, calorieBudgetMilliKcal: row.calorie_budget_milli_kcal, basalMetabolicRateMilliKcal: row.basal_metabolic_rate_milli_kcal,
        totalEnergyExpenditureMilliKcal: row.total_energy_expenditure_milli_kcal, lowerBoundMilliKcal: row.lower_bound_milli_kcal,
        deficitMilliKcal: row.deficit_milli_kcal, budgetSource: row.budget_source, calculationSex: row.calculation_sex, ageYears: row.age_years,
        heightCm: row.height_cm, weightG: row.weight_g, activityLevel: row.activity_level, maintenanceReason: row.maintenance_reason, pace: row.pace,
        goalWeightG: row.goal_weight_g, waterTargetMl: row.water_target_ml, weeklySportTargetMinutes: row.weekly_sport_target_minutes,
      });
      expect(version.error?.issues ?? []).toEqual([]);
    });
  });

  it.each([
    ['solo', 1250, 'teil'],
    ['solo-wasser-leer', 0, 'leer'],
    ['solo-wasser-erreicht', 2500, 'erreicht'],
    ['solo-wasser-ueber-ziel', 2750, 'ueber_ziel'],
  ] as const)('%s: heute %s ml Wasser ohne Importe, Mini-Tracker %s', (scenario, ml, status) => {
    const { server, devices } = seedManifests[scenario].initial;
    const entries = (server.water_entry ?? []).map((row) => ({ amountMl: Number(row.amount_ml), localDate: String(row.local_date), deletedAt: null }));
    const target = Number(server.goal_version?.[0]?.water_target_ml);

    expect(countedWaterMl(entries, seedDays.heute)).toBe(ml);
    expect(trackerStatus(ml, target)).toBe(status);
    expect((server.water_entry ?? []).every((row) => row.origin === 'manuell')).toBe(true);
    expect(devices['philipp-iphone']!.rows.water_entry ?? []).toEqual(server.water_entry ?? []);
    // Nur das Wasser unterscheidet die Varianten von solo.
    const tablesBesideWater = (rows: object) => Object.keys(rows).filter((table) => !['water_entry', 'change_log', 'sync_clock'].includes(table)).sort();
    expect(tablesBesideWater(server)).toEqual(tablesBesideWater(solo.initial.server));
    expect(server.goal_version).toEqual(solo.initial.server.goal_version);
  });

  it.each([
    ['solo', 75, 'teil'],
    ['solo-sport-erreicht', 150, 'erreicht'],
    ['solo-sport-ueber-ziel', 170, 'ueber_ziel'],
  ] as const)('%s: %s Wochenminuten aus manuellen Einheiten über die Woche, Mini-Tracker %s', (scenario, minutes, status) => {
    const { server, devices } = seedManifests[scenario].initial;
    const all = server.sport_entry ?? [];
    // Die Vorwoche (#174) zählt nicht zu dieser Woche; sie steht in allen Varianten gleich.
    const rows = all.filter((row) => String(row.local_date) >= seedDays.vorgestern);
    const entries = all.map(sportFacts);
    const target = Number(server.goal_version?.[0]?.weekly_sport_target_minutes);

    expect(target).toBe(150);
    expect(weekMinutes(entries, seedDays.heute)).toBe(minutes);
    expect(trackerStatus(minutes, target)).toBe(status);
    expect(rows.every((row) => row.origin === 'manuell')).toBe(true);
    // Über die Woche: Montag und Dienstag, heute noch keine Einheit, damit die Sporteinheit von heute offen bleibt.
    expect([...new Set(rows.map((row) => row.local_date))].sort()).toEqual([seedDays.vorgestern, seedDays.gestern]);
    expect(devices['philipp-iphone']!.rows.sport_entry).toEqual(all);
    // Nur die Sportwoche unterscheidet die Varianten von solo.
    const tablesBesideSport = (all: Record<string, unknown>) => Object.fromEntries(Object.entries(all).filter(([table]) => !['sport_entry', 'change_log', 'sync_clock'].includes(table)));
    expect(Object.keys(tablesBesideSport(server)).sort()).toEqual(Object.keys(tablesBesideSport(solo.initial.server)).sort());
    // Die Serverversionen verschieben sich mit den zusätzlichen Einheiten; die Zeilen selbst bleiben gleich.
    const unversioned = (rows: readonly Record<string, unknown>[] = []) => rows.map((row) => ({ ...row, server_version: undefined }));
    for (const table of ['water_entry', 'weight_entry', 'goal_version', 'daily_goal']) expect(unversioned(server[table])).toEqual(unversioned(solo.initial.server[table]));
  });

  it('solo und seine Varianten: Vorwoche mit 80 Minuten und einem Tag mit zwei Einheiten (#174)', () => {
    for (const scenario of ['solo', 'solo-sport-erreicht', 'solo-wasser-leer'] as const) {
      const rows = seedManifests[scenario].initial.server.sport_entry ?? [];
      const entries = rows.map(sportFacts);
      const previous = rows.filter((row) => String(row.local_date) < seedDays.vorgestern);

      expect(weekMinutes(entries, '2026-10-08')).toBe(80);
      expect(previous.map((row) => [row.local_date, row.activity_type])).toEqual([
        ['2026-10-05', 'laufen'],
        ['2026-10-08', 'krafttraining'],
        ['2026-10-08', 'yoga_dehnen'],
      ]);
    }
  });

  it('solo: fertige Person ohne Kopplung und ohne Insel, mit Zielen, Wochenplan, drei Tageszielen und eigenen Daten', () => {
    const { server } = solo.initial;
    expect(server.person).toEqual([expect.objectContaining({ onboarding_status: 'abgeschlossen', display_name: 'Philipp' })]);
    for (const table of ['coupling', 'coupling_member', 'island']) expect(server[table]).toBeUndefined();
    expect(server.goal_version).toHaveLength(1);
    expect(server.weekly_plan_day).toHaveLength(7);
    expect(server.daily_goal?.map((goal) => [goal.local_date, goal.slot])).toEqual([
      ['2026-10-14', 1],
      ['2026-10-14', 2],
      ['2026-10-14', 3],
    ]);
    for (const goal of server.daily_goal ?? []) expect(DailyGoalSnapshot.safeParse(goal.snapshot).success).toBe(true);
    for (const table of ['water_entry', 'sport_entry', 'weight_entry']) expect(server[table]?.length).toBeGreaterThan(0);
    // Das iPhone spiegelt alle eigenen Zeilen.
    const device = solo.initial.devices['philipp-iphone']!.rows;
    expect(Object.keys(device).sort()).toEqual(Object.keys(server).filter((table) => !['change_log', 'sync_clock'].includes(table)).sort());
  });

  it('lässt nur synthetische .test-Konten zu', () => {
    const account = { ...solo.accounts[0]!, email: 'philipp@example.com' };
    expect(SeedManifest.safeParse({ ...solo, accounts: [account] }).success).toBe(false);
  });

  it('lehnt E-Mails außerhalb der Konten ab, auch in Gerätezeilen', () => {
    const person = { ...solo.initial.server.person![0]!, display_name: 'philipp@example.test' };
    const server = { ...solo.initial.server, person: [person] };
    expect(SeedManifest.safeParse({ ...solo, initial: { ...solo.initial, server } }).error?.issues[0]?.message).toBe(
      'initial: E-Mail-Adresse außerhalb der Konten',
    );
    const devices = { 'philipp-iphone': { ...solo.target.devices['philipp-iphone']!, rows: { person: [person] } } };
    expect(SeedManifest.safeParse({ ...solo, target: { ...solo.target, devices } }).success).toBe(false);
  });

  it('lehnt Better-Auth-Zeilen, unbekannte Installationen und doppelte Konten ab', () => {
    const issues = (manifest: unknown) => SeedManifest.safeParse(manifest).error?.issues.map(({ message }) => message);
    expect(issues({ ...solo, initial: { ...solo.initial, server: { ...solo.initial.server, session: [] } } })).toEqual([
      'initial: session entsteht aus den Konten, nicht aus Zeilen',
    ]);
    expect(issues({ ...solo, steps: [{ type: 'sync', installation: 'anna-android' }] })).toEqual([
      'Schritt sync: unbekannte Installation anna-android',
    ]);
    expect(issues({ ...solo, accounts: [solo.accounts[0], solo.accounts[0]] })).toContain(`Konto doppelt: key philipp`);
  });

  it('lehnt eine Operations-ID ab, die schon in einer Outbox des Ausgangszustands steht', () => {
    const zwei = seedManifests.zwei_installationen;
    const [first] = zwei.initial.devices['philipp-iphone']!.outbox;
    const step = { type: 'tagesziele_auswerten', installation: 'philipp-ipad', localDates: [seedDays.heute], cause: 'app_oeffnung', operationIds: [first!.operationId] };
    expect(SeedManifest.safeParse({ ...zwei, steps: [step] }).error?.issues.map(({ message }) => message)).toEqual([
      `Operations-ID doppelt: ${first!.operationId}`,
    ]);
  });

  it('Einladungen (#120): Klartext-Code in `inviteCodes`, nie der HMAC in der Zeile', () => {
    const manifest = seedManifests['einladung-nach-entkopplung'];
    const id = seedIds.invitation.annasEinladung;
    const messages = (changed: object) => SeedManifest.safeParse({ ...manifest, ...changed }).error?.issues.map(({ message }) => message);
    const [row] = manifest.initial.server.invitation!;
    const withHmac = { ...manifest.initial, server: { ...manifest.initial.server, invitation: [{ ...row, code_hmac: 'abc' }] } };

    expect(manifest.extensions?.inviteCodes).toEqual({ version: 1, codes: [{ invitationId: id, code: seedInviteCodes.annasEinladung }] });
    expect(messages({ extensions: { ...manifest.extensions, inviteCodes: undefined } })).toEqual([
      `initial: Einladung ${id} ohne Code in \`inviteCodes\``,
      `target: Einladung ${id} ohne Code in \`inviteCodes\``,
    ]);
    expect(messages({ initial: withHmac })).toEqual([`initial: Einladung ${id} nennt ihren HMAC; der Seeder bildet ihn aus \`inviteCodes\``]);
    const stray = { invitationId: seedIds.sharedAction.dekoGeschenk, code: '123456' };
    expect(messages({ extensions: { ...manifest.extensions, inviteCodes: { version: 1, codes: [...manifest.extensions!.inviteCodes!.codes, stray] } } })).toEqual([
      `Einladungscode ${stray.invitationId}: Einladung fehlt im Ausgangszustand`,
    ]);
  });
});

describe('Szenarien von Spezifikation 4 (#180)', () => {
  const gekoppelt = seedManifests.gekoppelt;

  it('solo-energie: solo ohne Kopplung, dazu zwei Gutschriften aus Tageszielen von vorgestern und gestern', () => {
    const { initial, target, clock } = seedManifests['solo-energie'];
    const { server, devices } = initial;
    expect(clock).toEqual(seedClock);
    for (const table of ['coupling', 'coupling_member', 'island', 'shared_action']) expect(server[table]).toBeUndefined();
    const bookings = (server.energy_booking ?? []).map((row) =>
      EnergyBooking.parse({
        type: row.type, id: row.id, personId: row.person_id, localDate: row.local_date, bookingKey: row.booking_key,
        amount: row.amount, trigger: row.trigger, createdAt: row.created_at,
      }),
    );
    expect(bookings.map((booking) => [booking.localDate, booking.amount])).toEqual([[seedDays.vorgestern, 1], [seedDays.gestern, 1]]);
    expect(server.daily_goal?.map((goal) => [goal.local_date, goal.baustein])).toEqual([
      ...solo.initial.server.daily_goal!.map((goal) => [goal.local_date, goal.baustein]),
      [seedDays.vorgestern, 'ernaehrung_erfasst'], [seedDays.vorgestern, 'wasserziel'], [seedDays.vorgestern, 'gewogen'],
      [seedDays.gestern, 'im_kalorienbudget'], [seedDays.gestern, 'wasserziel'], [seedDays.gestern, 'sporteinheit'],
    ]);
    for (const goal of server.daily_goal ?? []) expect(DailyGoalSnapshot.safeParse(goal.snapshot).success).toBe(true);
    // Dieselben IDs wie in solo; das iPhone kennt die Gutschriften.
    expect(server.person).toEqual(solo.initial.server.person);
    expect(devices['philipp-iphone']!.rows.energy_booking).toEqual(server.energy_booking);
    expect(target).toEqual(initial);
  });

  it('rollenwahl-offen: gekoppelt vor dem Schlüpfen, Annas Vorschlag ist offen und auf beiden Geräten', () => {
    const { initial, target, clock, accounts, installations } = seedManifests['rollenwahl-offen'];
    const { server, devices } = initial;
    expect({ clock, accounts, installations }).toEqual({ clock: gekoppelt.clock, accounts: gekoppelt.accounts, installations: gekoppelt.installations });
    expect(server.island).toEqual([expect.objectContaining({ id: seedIds.island.philippAnna, state: 'wartet_auf_rollen', hatched_at: null, time_zone: null })]);
    expect(server.coupling_member?.map((member) => member.role)).toEqual([null, null]);
    const [action] = server.shared_action ?? [];
    expect(server.shared_action).toHaveLength(1);
    expect(action).toMatchObject({
      id: seedIds.sharedAction.annasRollenwahl,
      kind: 'rollenwahl',
      requester_person_id: seedIds.person.anna,
      payload: { proposerRole: 'natur' },
      status: 'offen',
      decided_at: null,
    });
    for (const key of ['philipp-iphone', 'anna-android']) expect(devices[key]!.rows.shared_action).toEqual(server.shared_action);
    // Sonst wie gekoppelt: dieselben Personen, Kopplung und Projektionen.
    expect(server.person).toEqual(gekoppelt.initial.server.person);
    expect(server.coupling).toEqual(gekoppelt.initial.server.coupling);
    expect(target).toEqual(initial);
  });
});

describe('Bereichsbeiträge', () => {
  const extra: SeedPart = {
    area: 'ernaehrung',
    entities: [
      {
        table: 'own_food',
        ownerPersonId: philipp,
        row: { id: '5eed0030-0000-4000-8000-000000000001', person_id: philipp },
      },
    ],
  };
  const build = (parts: readonly SeedPart[]) =>
    buildSeedState({ parts, createdAt: seedClock.instant, devices: { 'philipp-iphone': { personId: philipp, cursor: 'latest' } } });

  it('ergänzen ein Szenario unter Wiederverwendung der gemeinsamen IDs, ohne bestehende Versionen zu verschieben', () => {
    const base = build(soloParts);
    const extended = build([...soloParts, extra]);
    expect(extended.server.own_food).toEqual([expect.objectContaining({ person_id: philipp, server_version: String(Number(base.server.sync_clock![0]!.position) + 1) })]);
    expect(extended.server.person).toEqual(base.server.person);
    expect(extended.devices['philipp-iphone']!.rows.own_food).toEqual(extended.server.own_food);
  });

  it('dürfen keine belegte ID überschreiben', () => {
    const duplicate: SeedPart = { area: 'ernaehrung', entities: [{ table: 'person', ownerPersonId: philipp, row: { id: philipp } }] };
    expect(() => build([...soloParts, duplicate])).toThrow(`ernaehrung: person ${philipp} ist schon belegt`);
  });

  it('spiegeln fremde Entitäten nicht auf ein Gerät', () => {
    const foreign: SeedPart = { area: 'tracker', entities: [{ table: 'water_entry', ownerPersonId: seedIds.person.anna, row: { id: '5eed0020-0000-4000-8000-000000000099' } }] };
    expect(build([foreign]).devices['philipp-iphone']!.rows).toEqual({});
  });

  it('spiegeln Kopplungsdaten nur auf Geräte aktiver Mitglieder, Adressiertes nur auf das des Empfängers', () => {
    const couplingId = '5eed0040-0000-4000-8000-000000000099';
    const member = (id: string, personId: string, status: string) => ({
      table: 'coupling_member',
      couplingId,
      row: { id, coupling_id: couplingId, person_id: personId, coupling_status: status },
    });
    const parts = (status: string): SeedPart[] => [
      {
        area: 'fundament',
        entities: [
          { table: 'coupling', entityType: 'coupling', couplingId, row: { id: couplingId } },
          member('5eed0041-0000-4000-8000-000000000091', philipp, status),
          member('5eed0041-0000-4000-8000-000000000092', seedIds.person.anna, status),
          { table: 'island', couplingId, row: { id: '5eed0042-0000-4000-8000-000000000099' } },
          { table: 'partner_summary', recipientPersonId: seedIds.person.anna, row: { id: '5eed0050-0000-4000-8000-000000000099' } },
        ],
      },
    ];
    const devices = { 'philipp-iphone': { personId: philipp, cursor: 'latest' }, 'anna-android': { personId: seedIds.person.anna, cursor: 'latest' } } as const;
    const tables = (state: ReturnType<typeof buildSeedState>, key: string) => Object.keys(state.devices[key]!.rows).sort();

    const active = buildSeedState({ parts: parts('aktiv'), createdAt: seedClock.instant, devices });
    expect(tables(active, 'philipp-iphone')).toEqual(['coupling', 'coupling_member', 'island']);
    expect(tables(active, 'anna-android')).toEqual(['coupling', 'coupling_member', 'island', 'partner_summary']);
    expect(active.server.change_log).toEqual([expect.objectContaining({ entity_type: 'coupling', coupling_id: couplingId, owner_person_id: null })]);
    // Nach dem Entkoppeln bleibt nur der Archivstatus, also die Kopplung selbst, sichtbar.
    const archived = buildSeedState({ parts: parts('archiviert'), createdAt: seedClock.instant, devices });
    expect(tables(archived, 'philipp-iphone')).toEqual(['coupling']);
  });
});

const gekoppelt = seedManifests.gekoppelt;
const nachEntkopplung = seedManifests.nach_entkopplung;
const anna = seedIds.person.anna;

describe('Szenario gekoppelt', () => {
  const { server } = gekoppelt.initial;
  const byId = (table: string, id: string) => server[table]?.find((row) => row.id === id);

  it('Philipp (iPhone) und Anna (Android) mit dokumentiertem Testpasswort, beide Geräte auf dem Stand des Servers', () => {
    expect(gekoppelt.accounts.map(({ email, password }) => [email, password])).toEqual([
      ['philipp@example.test', seedPassword],
      ['anna@example.test', seedPassword],
    ]);
    expect(gekoppelt.installations.map(({ key, account, platform }) => [key, account, platform])).toEqual([
      ['philipp-iphone', 'philipp', 'ios'],
      ['anna-android', 'anna', 'android'],
    ]);
    for (const device of Object.values(gekoppelt.initial.devices)) expect(device).toMatchObject({ cursor: server.sync_clock![0]!.position, outbox: [] });
    expect(gekoppelt.steps).toEqual([
      { type: 'sync', installation: 'philipp-iphone' },
      { type: 'sync', installation: 'anna-android' },
    ]);
    expect(gekoppelt.target).toEqual(gekoppelt.initial);
  });

  it('Philipp hat Anna heute dreimal angefeuert; beide Geräte haben die Anfeuerungen (#123)', () => {
    const sent = server.encouragement ?? [];
    expect(sent.map((row) => [row.id, row.sender_person_id, row.recipient_person_id, row.local_date, row.push_status])).toEqual(
      seedIds.encouragement.philippHeute.map((id) => [id, philipp, anna, seedDays.heute, 'zugestellt']),
    );
    expect(EncouragementKey.array().parse(sent.map((row) => row.message_key))).toHaveLength(3);
    for (const device of Object.values(gekoppelt.initial.devices)) expect(device.rows.encouragement).toEqual(sent);
  });

  it('fertiges Onboarding, Ziel- und Wochenplanversionen und je drei Tagesziele von heute', () => {
    const today = (row: { local_date?: unknown }) => row.local_date === seedDays.heute;
    expect(server.person?.map(({ display_name, onboarding_status }) => [display_name, onboarding_status])).toEqual([
      ['Philipp', 'abgeschlossen'],
      ['Anna', 'abgeschlossen'],
    ]);
    for (const personId of [philipp, anna]) {
      expect(server.goal_version?.filter((row) => row.person_id === personId)).toHaveLength(1);
      expect(server.weekly_plan_day?.filter((row) => row.person_id === personId)).toHaveLength(7);
      const goals = server.daily_goal?.filter((row) => row.person_id === personId) ?? [];
      // Dazu die Tage des Energieverlaufs seit dem Zielstart (#191), 13 Tage zu je drei Tageszielen.
      expect(goals.filter((row) => !today(row))).toHaveLength(13 * 3);
      expect(goals.filter(today).map(({ local_date, slot }) => [local_date, slot])).toEqual([
        ['2026-10-14', 1],
        ['2026-10-14', 2],
        ['2026-10-14', 3],
      ]);
      for (const goal of goals) expect(DailyGoalSnapshot.safeParse(goal.snapshot).success).toBe(true);
    }
  });

  it('teilweise erfüllte Tracker: Philipp eine, Anna zwei Tageszielerfüllungen, jede mit +1-Gutschrift', () => {
    const completions = (personId: string) => server.daily_goal_completion?.filter((row) => row.person_id === personId && row.local_date === seedDays.heute) ?? [];
    expect(completions(philipp).map(({ baustein }) => baustein)).toEqual(['sporteinheit']);
    expect(completions(anna).map(({ baustein }) => baustein).sort()).toEqual(['sporteinheit', 'wasserziel']);
    for (const completion of server.daily_goal_completion ?? []) {
      const bookings = server.energy_booking?.filter((row) => row.daily_goal_completion_id === completion.id) ?? [];
      expect(bookings).toHaveLength(1);
      const { id, person_id, type, amount, local_date, booking_key, trigger, created_at } = bookings[0]!;
      const booking = { id, personId: person_id, type, amount, localDate: local_date, bookingKey: booking_key, trigger, createdAt: created_at };
      expect(EnergyBooking.safeParse(booking).success).toBe(true);
    }
  });

  it('aktive Kopplung, Philipp baut, Anna ist Natur, die Insel ist geschlüpft', () => {
    expect(server.coupling).toEqual([expect.objectContaining({ id: seedIds.coupling.philippAnna, status: 'aktiv', ended_at: null })]);
    expect(server.coupling_member?.map(({ person_id, role, display_name }) => [person_id, role, display_name])).toEqual([
      [philipp, 'bauen', 'Philipp'],
      [anna, 'natur', 'Anna'],
    ]);
    expect(server.island).toEqual([expect.objectContaining({ state: 'aktiv', hatched_at: expect.any(String), time_zone: 'Europe/Berlin' })]);
  });

  it('Philipp teilt alle vier Bereiche, Anna hält Ernährung privat; beide teilen ihre Fotos', () => {
    const levels = (personId: string) =>
      Object.fromEntries((server.partner_sharing ?? []).filter((row) => row.owner_person_id === personId).map((row) => [row.area, row.level]));
    expect(levels(philipp)).toEqual({ ernaehrung: 'zusammengefasst', wasser: 'zusammengefasst', sport: 'zusammengefasst', gewicht: 'zusammengefasst' });
    expect(levels(anna)).toEqual({ ernaehrung: 'privat', wasser: 'zusammengefasst', sport: 'zusammengefasst', gewicht: 'zusammengefasst' });
    expect(server.photo_sharing?.map(({ owner_person_id, level }) => [owner_person_id, level])).toEqual([
      [philipp, 'geteilt'],
      [anna, 'geteilt'],
    ]);
  });

  it('Zusammenfassungen nur für freigegebene Bereiche, grober Tageszielstand passend zu den Erfüllungen, alles gültig für den Partner', () => {
    const areas = (ownerId: string) => (server.partner_summary ?? []).filter((row) => row.owner_person_id === ownerId).map((row) => row.area);
    expect(areas(philipp)).toEqual(['ernaehrung', 'wasser', 'sport', 'gewicht']);
    expect(areas(anna)).toEqual(['wasser', 'sport', 'gewicht']);
    for (const row of server.partner_summary ?? []) {
      const envelope = {
        type: row.area,
        id: row.id,
        generation: row.generation,
        ownerPersonId: row.owner_person_id,
        recipientPersonId: row.recipient_person_id,
        couplingId: row.coupling_id,
        period: partnerSummaryPeriodOf(AreaKey.parse(row.area), LocalDate.parse(row.period_from), LocalDate.parse(row.period_to)),
        dataAsOf: row.data_as_of,
        serverVersion: row.server_version,
        content: row.content,
      };
      expect(PartnerSummaryEnvelope.safeParse(envelope).success, String(row.area)).toBe(true);
    }
    expect(byId('partner_daily_goal_status', seedIds.partnerDailyGoalStatus.philipp)).toMatchObject({ recipient_person_id: anna, stage: 'unterwegs' });
    expect(byId('partner_daily_goal_status', seedIds.partnerDailyGoalStatus.anna)).toMatchObject({ recipient_person_id: philipp, stage: 'fast_geschafft' });
  });

  it('Tracker-Daten aus Spezifikation 3, Abschnitt 9 (#181): Importe, Ersetzung und Ausblendung entstehen als Daten', () => {
    const own = (table: string, personId: string) => (server[table] ?? []).filter((row) => row.person_id === personId);
    const sport = (personId: string) => own('sport_entry', personId);

    // Philipp (Apple Health): Montag manuell 30 min, Dienstag ein Import (45 min) samt der davon ersetzten
    // manuellen Einheit, heute ein ausgeblendeter Import und sein Krafttraining.
    const philippSport = sport(philipp);
    const ids = seedIds.sportEntry.philippPartner;
    expect(byId('sport_entry', ids.montag)).toMatchObject({ origin: 'manuell', local_date: seedDays.vorgestern, duration_minutes: 30 });
    expect(byId('sport_entry', ids.dienstagImport)).toMatchObject({ origin: 'apple_health', local_date: seedDays.gestern, duration_minutes: 45, hidden_at: null });
    expect(byId('sport_entry', ids.dienstagErsetzt)).toMatchObject({ origin: 'manuell', local_date: seedDays.gestern, replaced_by_entry_id: ids.dienstagImport, reactivated_at: null });
    expect(byId('sport_entry', ids.heuteAusgeblendet)).toMatchObject({ origin: 'apple_health', local_date: seedDays.heute, hidden_at: expect.any(String) });
    expect(weekMinutes(philippSport.map(sportFacts), seedDays.heute)).toBe(105);

    // Gewicht über 30 Tage mit Lücken, einem Tag mit zwei Messungen und einem importierten Waagenwert; heute ist Wiegetag und offen.
    const philippWeights = own('weight_entry', philipp);
    const days = [...new Set(philippWeights.map((row) => String(row.local_date)))].sort();
    expect([days[0], days.at(-1)]).toEqual(['2026-09-15', seedDays.gestern]);
    expect(days.length).toBeLessThan(30);
    expect(philippWeights.filter((row) => row.local_date === '2026-09-24')).toHaveLength(2);
    expect(philippWeights.filter((row) => row.origin === 'apple_health')).toHaveLength(1);
    expect(days).not.toContain(seedDays.heute);
    const wednesday = server.weekly_plan_day?.find((row) => row.weekly_plan_version_id === seedIds.weeklyPlanVersion.philipp && row.weekday === 'mittwoch');
    expect(isWeighDay([wednesday?.baustein_1, wednesday?.baustein_2, wednesday?.baustein_3].map(String))).toBe(true);

    // Anna (Health Connect): Wasser über dem Ziel, Sportwoche erreicht, sinkender Trend.
    const annaGoal = byId('goal_version', seedIds.goalVersion.anna)!;
    const annaWater = countedWaterMl(own('water_entry', anna).map((row) => ({ amountMl: Number(row.amount_ml), localDate: String(row.local_date), deletedAt: null })), seedDays.heute);
    expect(trackerStatus(annaWater, Number(annaGoal.water_target_ml))).toBe('ueber_ziel');
    const annaMinutes = weekMinutes(sport(anna).map(sportFacts), seedDays.heute);
    expect(annaMinutes).toBeGreaterThanOrEqual(Number(annaGoal.weekly_sport_target_minutes));
    expect(sport(anna).filter((row) => row.origin === 'health_connect')).toHaveLength(2);
    expect(weightChange(weightTrend(dayWeights(own('weight_entry', anna).map(weightFacts))), seedDays.heute).direction).toBe('sinkend');
  });

  it('die Zusammenfassungen folgen aus den Tracker-Daten nach den Tracker-Regeln (#181)', () => {
    const content = (ownerId: string, area: string) => server.partner_summary?.find((row) => row.owner_person_id === ownerId && row.area === area)?.content;
    for (const personId of [philipp, anna]) {
      const goal = (server.goal_version ?? []).find((row) => row.person_id === personId)!;
      const water = countedWaterMl(
        (server.water_entry ?? []).filter((row) => row.person_id === personId).map((row) => ({ amountMl: Number(row.amount_ml), localDate: String(row.local_date), deletedAt: null })),
        seedDays.heute,
      );
      expect(content(personId, 'wasser')).toEqual({ progressPercent: Math.min(100, Math.round((100 * water) / Number(goal.water_target_ml))) });
      expect(content(personId, 'sport')).toEqual({
        countedMinutes: weekMinutes((server.sport_entry ?? []).filter((row) => row.person_id === personId).map(sportFacts), seedDays.heute),
        weeklyTargetMinutes: Number(goal.weekly_sport_target_minutes),
      });
      expect(content(personId, 'gewicht')).toEqual(
        weightChange(weightTrend(dayWeights((server.weight_entry ?? []).filter((row) => row.person_id === personId).map(weightFacts))), seedDays.heute),
      );
    }
  });

  it('kein Gerät erhält fremde Gesundheits-Rohdaten, Freigaben oder Fotos des Partners', () => {
    const ownerColumns = ['person_id', 'owner_person_id', 'recipient_person_id'];
    for (const [key, own] of [['philipp-iphone', philipp], ['anna-android', anna]] as const) {
      const { rows } = gekoppelt.initial.devices[key]!;
      for (const [table, tableRows] of Object.entries(rows)) {
        // Kopplungsinhalte mit Personenspalte: Mitglieder, Inselfelder und Inselobjekte sehen beide
        // (Spezifikation 4, Abschnitt 7: Felder und Objekte des Partners sind sichtbar, nur nicht bebaubar; #184, #191).
        // Anfeuerungen lesen beide aktiven Mitglieder (Spezifikation 5, Abschnitt 11; #123).
        if (['coupling_member', 'island_field', 'island_object', 'partner_summary', 'partner_daily_goal_status', 'encouragement'].includes(table)) continue;
        for (const row of tableRows) {
          for (const column of ownerColumns) if (column in row) expect(row[column], `${key}: ${table}.${column}`).toBe(own);
        }
      }
      expect(rows.person?.map(({ id }) => id)).toEqual([own]);
      // Zusammenfassungen und Tageszielstand nur als an das Gerät adressierte Projektion.
      for (const table of ['partner_summary', 'partner_daily_goal_status']) {
        for (const row of rows[table] ?? []) expect(row.recipient_person_id).toBe(own);
      }
    }
  });

  it('füllt den Foto-Erweiterungspunkt in Fassung 2 (#162) und reserviert das Deko-Geschenk (#198)', () => {
    expect(gekoppelt.extensions?.mealPhotos).toMatchObject({
      version: 2,
      photos: [
        { id: seedIds.mealPhoto.philippHeute, account: 'philipp', nutritionEntryId: seedIds.nutritionEntry.philippMittag, visibleTo: ['anna'],
          imageKey: seedImageKeys.mealPhoto.philippHeute },
        { id: seedIds.mealPhoto.annaHeute, account: 'anna', nutritionEntryId: seedIds.nutritionEntry.annaMittag, visibleTo: ['philipp'],
          imageKey: seedImageKeys.mealPhoto.annaHeute },
        // Seit #164: Philipps einzeln vom Teilen ausgenommenes Foto und sein verwaistes Foto sieht nur er.
        { id: seedIds.mealPhoto.philippNichtGeteilt, account: 'philipp', nutritionEntryId: seedIds.nutritionEntry.philippNichtGeteilt, visibleTo: [],
          imageKey: seedImageKeys.mealPhoto.philippNichtGeteilt },
        { id: seedIds.mealPhoto.philippVerwaist, account: 'philipp', nutritionEntryId: seedIds.nutritionEntry.philippVerwaist, visibleTo: [],
          imageKey: seedImageKeys.mealPhoto.philippVerwaist },
      ],
      expiredDrafts: [{ id: seedIds.photoDraft.philippAbgelaufen, account: 'philipp', imageKey: seedImageKeys.photoDraft.philippAbgelaufen }],
    });
    const sharing = Object.fromEntries((server.meal_photo ?? []).map((photo) => [photo.id, photo.shared_with_partner]));
    expect(sharing).toEqual({
      [seedIds.mealPhoto.philippHeute]: true,
      [seedIds.mealPhoto.annaHeute]: true,
      [seedIds.mealPhoto.philippNichtGeteilt]: false,
      [seedIds.mealPhoto.philippVerwaist]: true,
    });
    for (const photo of server.meal_photo ?? []) expect(photo).toMatchObject({ deleted_at: null });
    // Das verwaiste Foto: Sein einziger Eintrag ist seit gestern gelöscht, länger als 24 Stunden vor der Uhr des Seeds.
    const orphanEntries = (server.nutrition_entry ?? []).filter((entry) => entry.meal_photo_id === seedIds.mealPhoto.philippVerwaist);
    expect(orphanEntries.map((entry) => entry.deleted_at)).toEqual(['2026-10-13T10:45:00.000Z']);
    expect(Date.parse(seedClock.instant) - Date.parse(String(orphanEntries[0]!.deleted_at))).toBeGreaterThan(24 * 60 * 60_000);
    // Die Fotos stehen seit #162 im Änderungsprotokoll und auf dem Gerät ihres Eigentümers; der Entwurf nur auf dem Server.
    expect(server.change_log?.filter((entry) => entry.entity_type === 'meal_photo').map((entry) => entry.entity_id).sort()).toEqual(
      [seedIds.mealPhoto.philippHeute, seedIds.mealPhoto.annaHeute, seedIds.mealPhoto.philippNichtGeteilt, seedIds.mealPhoto.philippVerwaist].sort(),
    );
    expect(server.photo_draft).toEqual([expect.objectContaining({ id: seedIds.photoDraft.philippAbgelaufen, person_id: seedIds.person.philipp })]);
    expect(server.photo_draft?.[0]).not.toHaveProperty('server_version');
    for (const device of Object.values(gekoppelt.initial.devices)) expect(device.rows.photo_draft).toBeUndefined();
    expect(gekoppelt.extensions?.decoGift).toEqual({ version: 1, state: 'reserviert', actionId: seedIds.sharedAction.dekoGeschenk, from: 'anna', to: 'philipp' });
    expect(server.shared_action).toBeUndefined();
  });

  it('prüft die Erweiterungspunkte: Fotos müssen samt Eintrag existieren, eine reservierte ID bleibt frei', () => {
    const issues = (manifest: unknown) => SeedManifest.safeParse(manifest).error?.issues.map(({ message }) => message);
    const unknownPhoto = '5eed0032-0000-4000-8000-000000000099';
    const photos = { version: 1, photos: [{ id: unknownPhoto, account: 'anna', nutritionEntryId: seedIds.nutritionEntry.annaMittag, visibleTo: ['niemand'] }] };
    expect(issues({ ...gekoppelt, extensions: { mealPhotos: photos } })).toEqual([
      `Mahlzeitenfoto ${unknownPhoto}: unbekanntes Konto niemand`,
      `Mahlzeitenfoto ${unknownPhoto} fehlt im Ausgangszustand`,
      `Mahlzeitenfoto ${unknownPhoto}: Ernährungseintrag ${seedIds.nutritionEntry.annaMittag} fehlt`,
    ]);
    const current = gekoppelt.extensions?.mealPhotos;
    if (current?.version !== 2) throw new Error('Fassung 2 erwartet');
    const wrongKey = { ...current, photos: [{ ...current.photos[0]!, imageKey: seedImageKeys.mealPhoto.annaHeute }] };
    const unknownDraft = { ...current, expiredDrafts: [{ ...current.expiredDrafts[0]!, id: '5eed0033-0000-4000-8000-000000000099' }] };
    expect(issues({ ...gekoppelt, extensions: { mealPhotos: wrongKey } })).toEqual([`Mahlzeitenfoto ${seedIds.mealPhoto.philippHeute}: Bildschlüssel passt nicht zur Zeile`]);
    expect(issues({ ...gekoppelt, extensions: { mealPhotos: unknownDraft } })).toEqual(['Fotoentwurf 5eed0033-0000-4000-8000-000000000099 fehlt im Ausgangszustand']);
    expect(issues({ ...gekoppelt, clock: { ...gekoppelt.clock, instant: '2026-10-14T08:00:00.000Z' } })).toContain(
      `Fotoentwurf ${seedIds.photoDraft.philippAbgelaufen} ist nicht abgelaufen`,
    );
    const used = { ...gekoppelt.extensions?.decoGift, actionId: seedIds.coupling.philippAnna };
    expect(issues({ ...gekoppelt, extensions: { decoGift: used } })).toEqual([
      'initial: reservierte ID des Deko-Geschenks ist belegt',
      'target: reservierte ID des Deko-Geschenks ist belegt',
    ]);
  });
});

describe('Szenario nach_entkopplung', () => {
  const step = nachEntkopplung.steps[0];
  const before = gekoppelt.initial.server;
  const { server, devices } = nachEntkopplung.target;
  const last = Number(before.sync_clock![0]!.position);

  it('startet im Zustand von gekoppelt; Anna entkoppelt über den Kern, danach synchronisieren beide Geräte', () => {
    expect(nachEntkopplung.initial).toEqual(gekoppelt.initial);
    expect(nachEntkopplung.steps).toEqual([
      { type: 'entkoppeln', account: 'anna', couplingId: seedIds.coupling.philippAnna, actionId: seedIds.sharedAction.annasEntkopplung, at: seedClock.instant },
      { type: 'sync', installation: 'philipp-iphone' },
      { type: 'sync', installation: 'anna-android' },
    ]);
    expect(SeedManifest.safeParse({ ...nachEntkopplung, steps: [{ ...step, account: 'niemand' }] }).error?.issues[0]?.message).toBe(
      'Schritt entkoppeln: unbekanntes Konto niemand',
    );
  });

  it('Sollzustand in Postgres: Kopplung und Insel archiviert, Projektionen gelöscht, Notices an beide früheren Empfänger', () => {
    expect(server.coupling).toEqual([expect.objectContaining({ status: 'archiviert', ended_at: seedClock.instant, server_version: String(last + 1) })]);
    expect(server.coupling_member?.map(({ coupling_status }) => coupling_status)).toEqual(['archiviert', 'archiviert']);
    expect(server.island).toEqual([expect.objectContaining({ state: 'archiviert', server_version: String(last + 2) })]);
    expect(server.shared_action).toEqual([expect.objectContaining({ kind: 'entkoppeln', status: 'angenommen', requester_person_id: anna })]);
    for (const table of ['partner_summary', 'partner_daily_goal_status']) {
      expect(server[table]?.every(({ deleted_at }) => deleted_at === seedClock.instant)).toBe(true);
    }
    expect(server.revocation_notice?.map(({ id, recipient_person_id, server_version }) => [recipient_person_id, id === revocationNoticeId(ServerVersion.parse(server_version))])).toEqual([
      [philipp, true],
      [anna, true],
    ]);
    // Lückenlose Positionen: jede neue Version genau einmal im Änderungsprotokoll.
    const added = server.change_log!.slice(before.change_log!.length).map(({ position }) => Number(position));
    expect(added).toEqual(added.map((_, index) => last + index + 1));
    expect(server.sync_clock).toEqual([{ id: 1, position: String(last + added.length) }]);
  });

  it('Sollzustand der Geräte: archivierte Kopplung, Partnercache leer, eigene Daten unverändert', () => {
    for (const [key, device] of Object.entries(devices)) {
      const initial = gekoppelt.initial.devices[key]!;
      expect(device.cursor).toBe(server.sync_clock![0]!.position);
      expect(device.rows.coupling).toEqual(server.coupling);
      expect(device.rows.partner_summary).toEqual([]);
      expect(device.rows.partner_daily_goal_status).toEqual([]);
      // Insel und Freigaben kommen nach dem Entkoppeln nicht mehr an; das Gerät behält seinen Stand.
      for (const table of ['person', 'island', 'partner_sharing', 'daily_goal_completion', 'energy_booking']) expect(device.rows[table]).toEqual(initial.rows[table]);
    }
  });
});

const frischesKonto = seedManifests.frisches_konto;

describe('Szenario frisches_konto (#138)', () => {
  it('Philipp direkt nach dem Bootstrap: Person mit Anzeigename, Onboarding begonnen, ohne Bestätigung und ohne weitere Daten', () => {
    const { server, devices } = frischesKonto.initial;
    expect(frischesKonto.clock).toEqual(seedClock);
    expect(frischesKonto.accounts).toEqual([expect.objectContaining({ key: 'philipp', accountId: seedIds.account.philipp, personId: philipp })]);
    expect(server.person).toEqual([
      expect.objectContaining({
        id: philipp,
        display_name: 'Philipp',
        onboarding_status: 'begonnen',
        onboarding_completed_at: null,
        disclaimer_accepted_at: null,
        calculation_sex: null,
        birth_date: null,
      }),
    ]);
    expect(Object.keys(server).sort()).toEqual(['change_log', 'person', 'sync_clock']);
    expect(devices['philipp-iphone']).toEqual({ rows: { person: server.person }, cursor: '1', outbox: [] });
  });

  it('ein Sync ändert nichts: Ausgangs- und Sollzustand sind gleich', () => {
    expect(frischesKonto.steps).toEqual([{ type: 'sync', installation: 'philipp-iphone' }]);
    expect(frischesKonto.target).toEqual(frischesKonto.initial);
  });
});

describe('Spielverlauf der Partner-Szenarien (#191)', () => {
  const balanceOf = (rows: readonly Record<string, unknown>[] = [], personId: string) =>
    rows.filter((row) => row.person_id === personId).reduce((sum, row) => sum + Number(row.amount), 0);
  const progressOf = (rows: readonly Record<string, unknown>[] = []) => rows[0] as { level: number; level_need: number; content: { members: { personId: string; halfPercent: number; halfFull: boolean }[] } };

  it('gekoppelt: Level 3, Philipp mit 23 Energie, beide Hälften aus ihren Bauten', () => {
    const { server } = gekoppelt.initial;
    expect(balanceOf(server.energy_booking, philipp)).toBe(23);
    expect(balanceOf(server.energy_booking, anna)).toBe(25);
    const progress = progressOf(server.island_progress);
    expect(progress).toMatchObject({ level: 3, level_need: 13 });
    expect(progress.content.members).toEqual([
      { personId: philipp, halfPercent: 53, halfFull: false },
      { personId: anna, halfPercent: 46, halfFull: false },
    ]);
    // Jede Ausgabe gehört zu einem Objekt der Insel, auf einem eigenen Feld.
    const objects = server.island_object ?? [];
    const fields = new Map((server.island_field ?? []).map((field) => [field.id, field]));
    for (const debit of (server.energy_booking ?? []).filter((row) => row.type === 'build_debit')) {
      const object = objects.find((row) => row.id === debit.island_object_id);
      expect(object?.owner_person_id).toBe(debit.person_id);
      expect(fields.get(String(object?.field_id))?.owner_person_id).toBe(debit.person_id);
    }
    expect(objects).toHaveLength(20);
  });

  it('haelfte-voll: Philipps Hälfte voll, Annas nicht, Philipp mit 17 Energie', () => {
    const { server } = seedManifests['haelfte-voll'].initial;
    expect(balanceOf(server.energy_booking, philipp)).toBe(17);
    expect(progressOf(server.island_progress).content.members.map(({ halfFull }) => halfFull)).toEqual([true, false]);
    expect(seedManifests['haelfte-voll'].target).toEqual(seedManifests['haelfte-voll'].initial);
  });

  it('doppelausgabe: je Gerät vier offene Bauten; danach nimmt der Server alle acht an, und Philipp steht bei −1', () => {
    const manifest = seedManifests.doppelausgabe;
    for (const key of ['philipp-iphone', 'philipp-ipad']) {
      const device = manifest.initial.devices[key]!;
      expect(device.outbox.map(({ type }) => type)).toEqual(Array(4).fill('buildObject'));
      expect(balanceOf(device.rows.energy_booking, philipp)).toBe(11);
    }
    const { server, devices } = manifest.target;
    expect(balanceOf(server.energy_booking, philipp)).toBe(-1);
    expect(server.processed_operation?.map(({ outcome }) => outcome)).toEqual(Array(8).fill('applied'));
    expect(progressOf(server.island_progress)).toMatchObject({ level: 3 });
    for (const device of Object.values(devices)) {
      expect(device.outbox).toEqual([]);
      expect(balanceOf(device.rows.energy_booking, philipp)).toBe(-1);
      expect(device.rows.island_object).toHaveLength(28);
    }
  });

  it('feldkonflikt: je Gerät eine offene Platzierung auf dasselbe Feld; danach liegt die zuerst platzierte Laterne im Lager', () => {
    const manifest = seedManifests.feldkonflikt;
    const [first, second] = [seedIds.islandObject(1), seedIds.islandObject(2)];
    const fieldOf = (rows: readonly Record<string, unknown>[] | undefined, id: string) => rows?.find((row) => row.id === id)?.field_id;
    const iphone = manifest.initial.devices['philipp-iphone']!;
    const ipad = manifest.initial.devices['philipp-ipad']!;
    expect(iphone.outbox.map(({ type }) => type)).toEqual(['placeObject']);
    expect(ipad.outbox.map(({ type }) => type)).toEqual(['placeObject']);
    // Offline steht auf jedem Gerät die eigene Laterne auf dem Feld.
    expect(fieldOf(iphone.rows.island_object, first)).toBe(fieldOf(ipad.rows.island_object, second));

    const { server, devices } = manifest.target;
    const field = fieldOf(ipad.rows.island_object, second);
    expect(fieldOf(server.island_object, first)).toBeNull();
    expect(fieldOf(server.island_object, second)).toBe(field);
    expect(server.processed_operation?.map(({ outcome }) => outcome)).toEqual(['applied', 'applied']);
    // Keine Energie geht verloren: Platzieren ist kostenlos.
    expect(balanceOf(server.energy_booking, philipp)).toBe(23);
    for (const device of Object.values(devices)) {
      expect(device.outbox).toEqual([]);
      expect(fieldOf(device.rows.island_object, first)).toBeNull();
      expect(fieldOf(device.rows.island_object, second)).toBe(field);
    }
  });

  it('ereignisse-voll: Philipp hat 4 offene Besuche und bekommt keinen neuen, Anna einen; ihren Stand sieht Philipps Gerät nicht (#202)', () => {
    const manifest = seedManifests['ereignisse-voll'];
    const visits = (rows: readonly Record<string, unknown>[] | undefined) => (rows ?? []).filter((row) => row.type === 'besuch');
    const open = (rows: readonly Record<string, unknown>[] | undefined, personId: string) =>
      visits(rows).filter((row) => row.responsible_person_id === personId && row.status === 'offen');
    expect(open(manifest.initial.server.island_event, philipp)).toHaveLength(4);
    expect(open(manifest.initial.server.island_event, anna)).toHaveLength(1);
    expect(visits(manifest.initial.server.island_event).some((row) => String(row.occasion_key).startsWith('tag:2026-10-14:'))).toBe(false);

    const { server, devices } = manifest.target;
    const today = visits(server.island_event).filter((row) => String(row.occasion_key).startsWith('tag:2026-10-14:'));
    expect(today).toEqual([expect.objectContaining({ occasion_key: 'tag:2026-10-14:1', responsible_person_id: anna, status: 'offen' })]);
    expect(open(server.island_event, philipp)).toHaveLength(4);
    const iphone = devices['philipp-iphone']!;
    expect(visits(iphone.rows.island_event).map((row) => row.id)).toContain(today[0]!.id);
    expect((iphone.rows.island_event_state ?? []).every((row) => row.person_id === philipp)).toBe(true);
    expect(iphone.rows.island_event_state).toHaveLength(4);
  });

  it('levelaufstieg-ausstehend: Annas drei Offline-Bauten heben die Insel auf Level 4; danach haben beide Geräte Level 4 und das Ereignis (#200)', () => {
    const manifest = seedManifests['levelaufstieg-ausstehend'];
    const levelEvents = (rows: readonly Record<string, unknown>[] | undefined) => (rows ?? []).filter((row) => row.type === 'levelaufstieg');
    const android = manifest.initial.devices['anna-android']!;
    expect(android.outbox.map(({ type }) => type)).toEqual(Array(3).fill('buildObject'));
    expect(progressOf(manifest.initial.server.island_progress)).toMatchObject({ level: 3 });
    expect(levelEvents(manifest.initial.server.island_event)).toEqual([]);
    expect(manifest.initial.server.notification_intent ?? []).toEqual([]);

    const { server, devices } = manifest.target;
    expect(progressOf(server.island_progress)).toMatchObject({ level: 4 });
    const islandId = seedIds.island.philippAnna;
    expect(levelEvents(server.island_event)).toEqual([expect.objectContaining({ occasion_key: `level:${islandId}:4`, status: 'abgeschlossen' })]);
    expect((server.notification_intent ?? []).map((row) => [row.recipient_person_id, row.payload])).toEqual(
      expect.arrayContaining([[philipp, { level: 4 }], [anna, { level: 4 }]]),
    );
    // Level 4 ist ein Formlevel: dazu je ein `gebiet`-Push an beide (#204).
    expect((server.notification_intent ?? []).map((row) => [row.type, row.recipient_person_id]).sort()).toEqual(
      [['gebiet', anna], ['gebiet', philipp], ['levelaufstieg', anna], ['levelaufstieg', philipp]].sort(),
    );
    expect(server.processed_operation?.map(({ outcome, person_id }) => [outcome, person_id])).toEqual(Array(3).fill(['applied', anna]));
    for (const device of Object.values(devices)) {
      expect(device.outbox).toEqual([]);
      expect(progressOf(device.rows.island_progress)).toMatchObject({ level: 4 });
      expect(levelEvents(device.rows.island_event)).toHaveLength(1);
    }
  });

  it('levelaufstieg-ausstehend und formwechsel: Mit Level 4 kommen Schilfwiese, Entdeckung und je Gerät nur der eigene Ereignisstand (#204)', () => {
    const { server, devices } = seedManifests['levelaufstieg-ausstehend'].target;
    expect(server.area_unlock).toEqual([expect.objectContaining({ area_key: 'schilfwiese', level: 4 })]);
    expect((server.island_field ?? []).filter((row) => String(row.field_key).startsWith('schilfwiese:'))).toHaveLength(80);
    const discovery = (server.island_event ?? []).filter((row) => row.type === 'entdeckung');
    expect(discovery).toEqual([expect.objectContaining({ occasion_key: `gebiet:${seedIds.island.philippAnna}:schilfwiese`, status: 'erfuellbar' })]);
    expect(server.island_event_state?.filter((row) => row.island_event_id === discovery[0]!.id)).toHaveLength(2);
    for (const [key, person] of [['philipp-iphone', philipp], ['anna-android', anna]] as const) {
      const states = (devices[key]!.rows.island_event_state ?? []).filter((row) => row.island_event_id === discovery[0]!.id);
      expect(states.map((row) => row.person_id)).toEqual([person]);
    }

    const formwechsel = seedManifests.formwechsel;
    expect(formwechsel.target).toEqual(formwechsel.initial);
    for (const device of Object.values(formwechsel.initial.devices)) {
      expect(device.rows.device_state).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ key: 'momo_levelfeier', value: { islandId: seedIds.island.philippAnna, level: 4 } }),
          expect.objectContaining({ key: 'momo_verwandlung', value: { islandId: seedIds.island.philippAnna, level: 3 } }),
        ]),
      );
    }
  });
});
