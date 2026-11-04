import { AreaKey, LocalDate, type BausteinKey } from '../src/base.ts';
import type { PartnerSharingLevel } from '../src/coupling.ts';
import type { DailyGoalSlot } from '../src/daily-goals.ts';
import { partnerSummaryBounds, partnerSummaryPeriod, type PartnerDailyGoalStage } from '../src/partner.ts';
import { buildSeedState, type SeedEntity, type SeedPart } from './build.ts';
import { seedAccounts, seedClock, seedDayEnds, seedDays, seedIds, seedInstallations } from './ids.ts';
import { SeedExtensions, SeedManifest, type SeedRow } from './manifest.ts';
import {
  seedCompletion,
  seedCreated as created,
  seedDailyGoals,
  seedDay as day,
  seedManualOrigin,
  seedSportEntry,
  seedWaterEntry,
  seedWeeklyPlan,
  type SeedWeeklyPlan,
} from './rows.ts';
import { soloParts } from './solo.ts';

// Szenario `gekoppelt` (Spezifikation 0, Abschnitt 12; #117): Philipp (iPhone, Rolle Bauen) und Anna
// (Android, Rolle Natur) haben das Onboarding abgeschlossen und sind gekoppelt, die Insel ist
// geschlüpft. Beide haben Ziele, Wochenplan, drei Tagesziele von heute und teilweise erfüllte Tracker:
// Philipp hat ein Tagesziel erfüllt, Anna zwei, jeweils mit `+1`-Gutschrift. Philipp teilt alle vier
// Bereiche, Anna hält Ernährung privat und teilt die übrigen drei. Beide teilen ihre Mahlzeitenfotos;
// jede Person hat heute ein geteiltes Foto zum Mittagessen. Der Server hat die Zusammenfassungen und den
// groben Tageszielstand für den jeweiligen Partner zur festen Uhr berechnet; beide Geräte sind auf dem
// Stand des Servers. Philipps eigene Daten sind die aus `solo`, ergänzt um eine Sporteinheit heute.
// Alle Werte sind erfunden; die Zielwerte sind plausibel, aber nicht mit dem Zielrechner berechnet.
//
// Zwei Inhalte reserviert das Manifest als versionierte Erweiterungspunkte (`extensions`): die
// Bilddaten der Fotos (Spezifikation 2, #162) und das offene Deko-Geschenk von Anna an Philipp als
// antwortbedürftigen Vorgang (Spezifikation 4, #198). Weitere Bereiche ergänzen ihren Beitrag hier,
// etwa Level 6 und die aktive Challenge (Spezifikation 4).

const philipp = seedIds.person.philipp;
const anna = seedIds.person.anna;
const couplingId = seedIds.coupling.philippAnna;
const heute = LocalDate.parse(seedDays.heute);
/** Zeitpunkt, zu dem der Server die Projektionen berechnet hat; so sind sie zur festen Uhr frisch. */
const projectedAt = seedClock.instant;

type Partner = 'philipp' | 'anna';
const partnerOf = (owner: Partner): Partner => (owner === 'philipp' ? 'anna' : 'philipp');

/** Fundament: Anna, fertig mit dem Onboarding am Abend des Zielstarts. */
const annaPerson: SeedPart = {
  area: 'fundament',
  entities: [
    {
      table: 'person',
      entityType: 'person',
      ownerPersonId: anna,
      row: {
        id: anna,
        account_id: seedIds.account.anna,
        display_name: 'Anna',
        calculation_sex: 'weiblich',
        birth_date: '1992-03-08',
        height_cm: 168,
        activity_level: 'aktiv',
        pregnant_or_breastfeeding: false,
        known_eating_disorder: false,
        disclaimer_accepted_at: '2026-10-01T18:00:00.000Z',
        onboarding_status: 'abgeschlossen',
        onboarding_completed_at: '2026-10-01T18:10:00.000Z',
        goal_weight_reached_g: null,
        goal_weight_reached_at: null,
        time_zone: seedClock.timeZone,
        created_at: '2026-10-01T18:00:00.000Z',
        updated_at: '2026-10-01T18:10:00.000Z',
        deleted_at: null,
      },
    },
  ],
};

/** Annas Wochenplan; heute (Mittwoch) Wasserziel, Sporteinheit und Kalorienbudget. */
const annaWeeklyPlan = {
  montag: ['wasserziel', 'sporteinheit', 'gewogen'],
  dienstag: ['wasserziel', 'im_kalorienbudget', 'ernaehrung_erfasst'],
  mittwoch: ['wasserziel', 'sporteinheit', 'im_kalorienbudget'],
  donnerstag: ['wasserziel', 'im_kalorienbudget', 'gewogen'],
  freitag: ['wasserziel', 'sporteinheit', 'ernaehrung_erfasst'],
  samstag: ['wasserziel', 'sporteinheit', 'im_kalorienbudget'],
  sonntag: ['wasserziel', 'ernaehrung_erfasst', 'gewogen'],
} as const satisfies SeedWeeklyPlan;

/** Ziele (Spezifikation 1): Annas Zielversion, Wochenplan und ihre drei Tagesziele von heute. */
const annaZiele: SeedPart = {
  area: 'ziele',
  entities: [
    {
      table: 'goal_version',
      // Seit #128 beim Sync angemeldet: Die Fassung steht im Änderungsprotokoll.
      entityType: 'goal_version',
      ownerPersonId: anna,
      row: {
        id: seedIds.goalVersion.anna,
        person_id: anna,
        valid_from: seedDays.zielstart,
        calorie_budget_milli_kcal: 1_930_000,
        basal_metabolic_rate_milli_kcal: 1_459_000,
        total_energy_expenditure_milli_kcal: 2_330_000,
        lower_bound_milli_kcal: 1_459_000,
        deficit_milli_kcal: 400_000,
        budget_source: 'berechnet',
        calculation_sex: 'weiblich',
        age_years: 34,
        height_cm: 168,
        weight_g: 74_000,
        activity_level: 'aktiv',
        maintenance_reason: null,
        pace: 'entspannt',
        goal_weight_g: 68_000,
        water_target_ml: 2_000,
        weekly_sport_target_minutes: 120,
        ...created('2026-10-01T18:10:00.000Z'),
      },
    },
    seedWeeklyPlan({ id: seedIds.weeklyPlanVersion.anna, personId: anna, validFrom: seedDays.zielstart, createdAt: '2026-10-01T18:10:00.000Z', plan: annaWeeklyPlan }),
    ...seedDailyGoals({
      personId: anna,
      ids: seedIds.dailyGoal.annaHeute,
      localDate: seedDays.heute,
      dayEndsAt: seedDayEnds.heute,
      createdAt: '2026-10-14T05:00:00.000Z',
      bausteine: annaWeeklyPlan.mittwoch,
      thresholds: {
        wasserziel: { targetMl: 2_000 },
        sporteinheit: { minimumSingleSessionMinutes: 20 },
        im_kalorienbudget: { budgetKcal: 1_930, lowerBoundKcal: 1_459 },
      },
    }),
  ],
};

/**
 * Tracker (Spezifikation 3): Philipps Krafttraining heute; Anna hat ihr Wasserziel voll, ist heute
 * gelaufen und hat sich gestern gewogen.
 */
const tracker: SeedPart = {
  area: 'tracker',
  entities: [
    ...[
      { id: seedIds.sportEntry.philippHeute, person: philipp, activity: 'krafttraining', at: '2026-10-14T05:00:00.000Z', minutes: 30 },
      { id: seedIds.sportEntry.annaHeute, person: anna, activity: 'laufen', at: '2026-10-14T05:30:00.000Z', minutes: 45 },
    ].map(({ id, person, activity, at, minutes }) =>
      seedSportEntry({ id, personId: person, activity, startedAt: at, minutes, createdAt: at, localDate: seedDays.heute })),
    ...[
      { id: seedIds.waterEntry.annaHeute[0], amount: 1_200, at: '2026-10-14T07:00:00.000Z' },
      { id: seedIds.waterEntry.annaHeute[1], amount: 800, at: '2026-10-14T11:30:00.000Z' },
    ].map(({ id, amount, at }) => seedWaterEntry({ id, personId: anna, amountMl: amount, loggedAt: at, localDate: seedDays.heute })),
    {
      table: 'weight_entry',
      // Seit #175 beim Sync angemeldet: Der Eintrag steht im Änderungsprotokoll.
      entityType: 'weight_entry',
      ownerPersonId: anna,
      row: {
        id: seedIds.weightEntry.annaGestern,
        person_id: anna,
        weight_g: 73_600,
        measured_at: '2026-10-13T05:15:00.000Z',
        ...seedManualOrigin,
        ...day(seedDays.gestern),
        ...created('2026-10-13T05:15:00.000Z'),
      },
    },
  ],
};

/** Ein Mittagessen aus einem KI-Foto: Menge und Werte je 100 g in den Einheiten aus Abschnitt 8. */
function photoLunch(options: {
  id: string;
  person: string;
  photoId: string;
  at: string;
  name: string;
  grams: number;
  per100g: Readonly<{ milliKcal: number; proteinMg: number; carbsMg: number; fatMg: number }>;
}): SeedRow {
  const factor = options.grams / 100;
  return {
    id: options.id,
    person_id: options.person,
    consumed_at: options.at,
    ...day(seedDays.heute),
    meal: 'mittagessen',
    capture_method: 'foto',
    food_ref_type: null,
    food_ref_key: null,
    base_amount: options.grams * 1_000,
    display_unit: 'g',
    display_amount_milli: options.grams * 1_000,
    snapshot_name: options.name,
    snapshot_base_unit: 'g',
    snapshot_reference_amount: 100_000,
    snapshot_milli_kcal: options.per100g.milliKcal,
    snapshot_protein_mg: options.per100g.proteinMg,
    snapshot_carbs_mg: options.per100g.carbsMg,
    snapshot_fat_mg: options.per100g.fatMg,
    snapshot_portions: [],
    snapshot_source: 'ki',
    snapshot_attribution: null,
    total_milli_kcal: options.per100g.milliKcal * factor,
    total_protein_mg: options.per100g.proteinMg * factor,
    total_carbs_mg: options.per100g.carbsMg * factor,
    total_fat_mg: options.per100g.fatMg * factor,
    meal_photo_id: options.photoId,
    ...created(options.at),
  };
}

/**
 * Ernährung (Spezifikation 2): je Person ein geteiltes Mahlzeitenfoto von heute samt Eintrag. Die
 * Bilddaten fehlen noch; sie ergänzt der Erweiterungspunkt `mealPhotos` in Fassung 2 (#162).
 */
const ernaehrung: SeedPart = {
  area: 'ernaehrung',
  entities: [
    ...[
      { id: seedIds.mealPhoto.philippHeute, person: philipp, at: '2026-10-14T10:30:00.000Z' },
      { id: seedIds.mealPhoto.annaHeute, person: anna, at: '2026-10-14T10:45:00.000Z' },
    ].map(({ id, person, at }) => ({
      table: 'meal_photo',
      ownerPersonId: person,
      row: { id, person_id: person, image_key: `seed/${id}.jpg`, captured_at: at, shared_with_partner: true, ...created(at) },
    })),
    {
      table: 'nutrition_entry',
      // Seit #155 beim Sync angemeldet: Die Einträge stehen im Änderungsprotokoll.
      entityType: 'nutrition_entry',
      ownerPersonId: philipp,
      row: photoLunch({
        id: seedIds.nutritionEntry.philippMittag,
        person: philipp,
        photoId: seedIds.mealPhoto.philippHeute,
        at: '2026-10-14T10:30:00.000Z',
        name: 'Linsensuppe',
        grams: 300,
        per100g: { milliKcal: 90_000, proteinMg: 6_000, carbsMg: 12_000, fatMg: 2_000 },
      }),
    },
    {
      table: 'nutrition_entry',
      entityType: 'nutrition_entry',
      ownerPersonId: anna,
      row: photoLunch({
        id: seedIds.nutritionEntry.annaMittag,
        person: anna,
        photoId: seedIds.mealPhoto.annaHeute,
        at: '2026-10-14T10:45:00.000Z',
        name: 'Gemüsecurry mit Reis',
        grams: 350,
        per100g: { milliKcal: 120_000, proteinMg: 4_000, carbsMg: 18_000, fatMg: 3_500 },
      }),
    },
  ],
};

/** Tageszielerfüllung von heute samt `+1`-Gutschrift (#105). */
const completion = (person: string, dailyGoalId: string, slot: DailyGoalSlot, baustein: BausteinKey, at: string): SeedEntity[] =>
  seedCompletion({ personId: person, dailyGoalId, localDate: heute, slot, baustein, at });

/** Fundament (#105): Philipps Sporteinheit (Platz 3), Annas Sporteinheit (Platz 2) und Wasserziel (Platz 1). */
const energie: SeedPart = {
  area: 'fundament',
  entities: [
    ...completion(philipp, seedIds.dailyGoal.philippHeute[2], 3, 'sporteinheit', '2026-10-14T05:31:00.000Z'),
    ...completion(anna, seedIds.dailyGoal.annaHeute[1], 2, 'sporteinheit', '2026-10-14T06:16:00.000Z'),
    ...completion(anna, seedIds.dailyGoal.annaHeute[0], 1, 'wasserziel', '2026-10-14T11:30:00.000Z'),
  ],
};

const coupledAt = '2026-10-01T18:30:00.000Z';
const hatchedAt = '2026-10-01T18:40:00.000Z';
/** Anna hat Ernährung kurz nach der Kopplung auf `privat` gestellt. */
const annaPrivateAt = '2026-10-01T18:45:00.000Z';

const sharingLevels: Readonly<Record<Partner, Readonly<Record<AreaKey, PartnerSharingLevel>>>> = {
  philipp: { ernaehrung: 'zusammengefasst', wasser: 'zusammengefasst', sport: 'zusammengefasst', gewicht: 'zusammengefasst' },
  anna: { ernaehrung: 'privat', wasser: 'zusammengefasst', sport: 'zusammengefasst', gewicht: 'zusammengefasst' },
};

/**
 * Fundament (#103, #106): Kopplung samt Mitgliedern und geschlüpfter Insel, Partnerfreigaben und
 * Fotofreigaben. Die Annahme setzte alle Bereiche auf `zusammengefasst` und die Fotos auf `geteilt`.
 * Vor dem Schlüpfen (`hatched: false`, #180) haben die Mitglieder keine Rolle, und die Insel wartet.
 */
const kopplungPart = ({ hatched }: Readonly<{ hatched: boolean }>): SeedPart => {
  // Was sich mit dem Schlüpfen ändert, an einer Stelle.
  const islandState = hatched
    ? { state: 'aktiv', hatched_at: hatchedAt, time_zone: seedClock.timeZone, updated_at: hatchedAt }
    : { state: 'wartet_auf_rollen', hatched_at: null, time_zone: null, updated_at: coupledAt };
  return {
    area: 'fundament',
    entities: [
      {
        table: 'coupling',
        entityType: 'coupling',
        couplingId,
        row: {
          id: couplingId,
          person_low_id: philipp < anna ? philipp : anna,
          person_high_id: philipp < anna ? anna : philipp,
          status: 'aktiv',
          started_at: coupledAt,
          ended_at: null,
          reactivated_at: null,
          ...created(coupledAt),
        },
      },
      ...[
        { id: seedIds.couplingMember.philipp, person: philipp, role: 'bauen', name: 'Philipp' },
        { id: seedIds.couplingMember.anna, person: anna, role: 'natur', name: 'Anna' },
      ].map(({ id, person, role, name }) => ({
        table: 'coupling_member',
        entityType: 'coupling_member',
        couplingId,
        row: {
          id,
          coupling_id: couplingId,
          coupling_status: 'aktiv',
          person_id: person,
          role: hatched ? role : null,
          display_name: name,
          created_at: coupledAt,
          updated_at: islandState.updated_at,
          deleted_at: null,
        },
      })),
      {
        table: 'island',
        entityType: 'island',
        couplingId,
        row: {
          id: seedIds.island.philippAnna,
          coupling_id: couplingId,
          ...islandState,
          created_at: coupledAt,
          deleted_at: null,
        },
      },
      ...(['philipp', 'anna'] as const).flatMap((owner) =>
        AreaKey.options.map((area) => {
          const level = sharingLevels[owner][area];
          const changedAt = level === 'privat' ? annaPrivateAt : coupledAt;
          return {
            table: 'partner_sharing',
            entityType: 'partner_sharing',
            ownerPersonId: seedIds.person[owner],
            row: {
              id: seedIds.partnerSharing[owner][area],
              owner_person_id: seedIds.person[owner],
              coupling_id: couplingId,
              area,
              level,
              created_at: coupledAt,
              updated_at: changedAt,
              deleted_at: null,
            },
          };
        }),
      ),
      ...(['philipp', 'anna'] as const).map((owner) => ({
        table: 'photo_sharing',
        entityType: 'photo_sharing',
        ownerPersonId: seedIds.person[owner],
        row: { id: seedIds.photoSharing[owner], owner_person_id: seedIds.person[owner], coupling_id: couplingId, level: 'geteilt', ...created(coupledAt) },
      })),
    ],
  };
};

/** Zusammenfassung eines Bereichs für den Partner, im Zeitraum von heute (#106), berechnet zu `dataAsOf`. */
function summary(owner: Partner, area: AreaKey, id: string, content: Readonly<Record<string, number | string | null>>, dataAsOf: string = projectedAt): SeedEntity {
  const recipient = seedIds.person[partnerOf(owner)];
  const { from, to } = partnerSummaryBounds(partnerSummaryPeriod(area, heute));
  return {
    table: 'partner_summary',
    entityType: 'partner_summary',
    recipientPersonId: recipient,
    row: {
      id,
      coupling_id: couplingId,
      owner_person_id: seedIds.person[owner],
      recipient_person_id: recipient,
      area,
      period_from: from,
      period_to: to,
      generation: 1,
      content,
      data_as_of: dataAsOf,
      // Wie im Partnercache des Geräts: angelegt und geändert zum Datenstand.
      ...created(dataAsOf),
    },
  };
}

/** Grober Tageszielstand von heute für den Partner, aus den Tageszielerfüllungen des Eigentümers zu `dataAsOf`. */
export function partnerDailyGoalStatusEntity(owner: Partner, stage: PartnerDailyGoalStage, dataAsOf: string = projectedAt): SeedEntity {
  const recipient = seedIds.person[partnerOf(owner)];
  return {
    table: 'partner_daily_goal_status',
    entityType: 'partner_daily_goal_status',
    recipientPersonId: recipient,
    row: {
      id: seedIds.partnerDailyGoalStatus[owner],
      coupling_id: couplingId,
      owner_person_id: seedIds.person[owner],
      recipient_person_id: recipient,
      local_date: heute,
      generation: 1,
      stage,
      data_as_of: dataAsOf,
      ...created(dataAsOf),
    },
  };
}

/** Was Philipp von Anna sieht: Datenstand, Wasserfortschritt und grober Tageszielstand zu diesem Stand. */
export type AnnasProjections = Readonly<{ dataAsOf: string; waterPercent: number; stage: PartnerDailyGoalStage }>;

/** Annas Projektionen zur festen Uhr: 2000 von 2000 ml, zwei erfüllte Tagesziele. */
const annasProjectionsNow: AnnasProjections = { dataAsOf: projectedAt, waterPercent: 100, stage: 'fast_geschafft' };

/**
 * Fundament (#106): Projektionen, wie sie der Vor-Pull-Schritt berechnet hat, Philipps zur festen Uhr.
 * Philipp: zwei Mahlzeitentypen (Frühstück aus `solo`, Mittagessen aus dem Foto), 1250 von 2500 ml,
 * 30 + 35 von 150 Sportminuten der Woche, zwei Tagesgewichte (zu wenige für einen Trend), ein erfülltes
 * Tagesziel. Anna: Wasser und Tageszielstand nach `annas`, 45 von 120 Minuten, ein Tagesgewicht;
 * Ernährung ist privat. Annas Tageszielstand ist die letzte Entität, damit ein späterer Vor-Pull-Schritt
 * ihn als nächste Serverversion schreiben kann (`veralteter_partnerstand`, #113).
 */
const projektionenOf = (annas: AnnasProjections): SeedPart => ({
  area: 'fundament',
  entities: [
    summary('philipp', 'ernaehrung', seedIds.partnerSummary.philipp.ernaehrung, { recordedMealCategories: 2 }),
    summary('philipp', 'wasser', seedIds.partnerSummary.philipp.wasser, { progressPercent: 50 }),
    summary('philipp', 'sport', seedIds.partnerSummary.philipp.sport, { countedMinutes: 65, weeklyTargetMinutes: 150 }),
    summary('philipp', 'gewicht', seedIds.partnerSummary.philipp.gewicht, { changeKg: null, direction: 'noch_nicht_verfuegbar' }),
    summary('anna', 'wasser', seedIds.partnerSummary.anna.wasser, { progressPercent: annas.waterPercent }, annas.dataAsOf),
    summary('anna', 'sport', seedIds.partnerSummary.anna.sport, { countedMinutes: 45, weeklyTargetMinutes: 120 }, annas.dataAsOf),
    summary('anna', 'gewicht', seedIds.partnerSummary.anna.gewicht, { changeKg: null, direction: 'noch_nicht_verfuegbar' }, annas.dataAsOf),
    partnerDailyGoalStatusEntity('philipp', 'unterwegs'),
    partnerDailyGoalStatusEntity('anna', annas.stage, annas.dataAsOf),
  ],
});

/**
 * Beiträge beider Partner in Reihenfolge; Philipps Daten sind die aus `solo`. Vor dem Schlüpfen
 * (`hatched: false`, #180) wartet die Insel auf die Rollen, und kein Mitglied hat eine. `annas` legt den
 * Stand von Annas Projektionen fest (#113).
 */
const partnerParts = ({ hatched, annas }: Readonly<{ hatched: boolean; annas: AnnasProjections }>): readonly SeedPart[] => [
  ...soloParts, annaPerson, annaZiele, tracker, ernaehrung, energie, kopplungPart({ hatched }), projektionenOf(annas),
];

/** Beiträge des Szenarios, Annas Projektionen zu einem früheren Stand (#113). */
export const gekoppeltPartsWith = (annas: AnnasProjections): readonly SeedPart[] => partnerParts({ hatched: true, annas });

/** Beiträge des Szenarios `gekoppelt`. */
export const gekoppeltParts: readonly SeedPart[] = gekoppeltPartsWith(annasProjectionsNow);

/** Dieselben Beiträge vor dem Schlüpfen; Spezifikation 4 ergänzt darauf die offene Rollenwahl (`rollenwahl-offen`). */
export const vorDemSchluepfenParts = partnerParts({ hatched: false, annas: annasProjectionsNow });

/** Erweiterungspunkte beider Partner-Szenarien; die Fotos gelten im Ausgangszustand. */
export const gekoppeltExtensions = SeedExtensions.parse({
  mealPhotos: {
    version: 1,
    photos: [
      { id: seedIds.mealPhoto.philippHeute, account: 'philipp', nutritionEntryId: seedIds.nutritionEntry.philippMittag, visibleTo: ['anna'] },
      { id: seedIds.mealPhoto.annaHeute, account: 'anna', nutritionEntryId: seedIds.nutritionEntry.annaMittag, visibleTo: ['philipp'] },
    ],
  },
  decoGift: { version: 1, state: 'reserviert', actionId: seedIds.sharedAction.dekoGeschenk, from: 'anna', to: 'philipp' },
});

/** Ausgangszustand von `gekoppelt` und `nach_entkopplung`: beide Geräte auf dem Stand des Servers. */
export const gekoppeltState = buildSeedState({
  parts: gekoppeltParts,
  createdAt: seedClock.instant,
  devices: {
    [seedInstallations.philippIphone.key]: { personId: philipp, cursor: 'latest' },
    [seedInstallations.annaAndroid.key]: { personId: anna, cursor: 'latest' },
  },
});

export const gekoppeltManifest = SeedManifest.parse({
  formatVersion: 1,
  scenario: 'gekoppelt',
  // Revision 5: Sporteinträge seit #173 im Änderungsprotokoll, dazu Philipps Sportwoche aus `solo`.
  // Revision 4: Gewichtseinträge seit #175 im Änderungsprotokoll, heute ist Philipps Wiegetag.
  // Revision 3: Ernährungseinträge seit #155 im Änderungsprotokoll, dazu Philipps Frühstück aus `solo`;
  // Revision 2: Wassereinträge seit #171.
  revision: 5,
  clock: seedClock,
  localDates: seedDays,
  catalogVersion: null,
  accounts: [seedAccounts.philipp, seedAccounts.anna],
  installations: [seedInstallations.philippIphone, seedInstallations.annaAndroid],
  initial: gekoppeltState,
  // Ein Sync ändert nichts: Beide Geräte sind auf dem Stand, und die Projektionen sind zur festen Uhr frisch.
  steps: [
    { type: 'sync', installation: seedInstallations.philippIphone.key },
    { type: 'sync', installation: seedInstallations.annaAndroid.key },
  ],
  target: gekoppeltState,
  extensions: gekoppeltExtensions,
});
