import { indexCatalog } from '@abnehm/game-rules/catalog';
import { gameCatalog } from '@abnehm/game-rules/content';
import { hatching } from '@abnehm/game-rules/hatching';
import { basePrice } from '@abnehm/game-rules/prices';
import { islandProgress } from '@abnehm/game-rules/progress';

import { addDays } from '../src/calendar.ts';
import { energyBookingId } from '../src/energy.ts';
import { LocalDate, weekdayOf, type BausteinKey } from '../src/base.ts';
import type { SeedEntity, SeedPart } from './build.ts';
import { seedDays, seedIds } from './ids.ts';
import { seedCompletion, seedDailyBonus, seedDailyGoals, type SeedWeeklyPlan } from './rows.ts';

// Spielverlauf von Philipp und Anna (Spezifikation 4, Abschnitt 13; #191): wie viel Energie sie seit dem
// Zielstart gesammelt und was sie davon auf der Insel verbaut haben. Objekte, Buchungen und der
// Inselfortschritt entstehen mit denselben Spielregeln wie auf dem Server (Preise, Levelkurve), damit die
// Seeds dieselben Zeilen ergeben wie `buildObject`.
//
// `gekoppelt` steht damit auf Level 3 mit 23 Energie statt auf Level 6 wie im Design-System (Annahme 2):
// Level 6 bräuchte 88 Gutschriften für Philipp, seit dem Zielstart gibt es höchstens 53
// (Nutzerentscheidung in #191). Alle Werte sind erfunden.

const catalog = indexCatalog(gameCatalog);
const philipp = seedIds.person.philipp;
const anna = seedIds.person.anna;
const couplingId = seedIds.coupling.philippAnna;
const islandId = seedIds.island.philippAnna;

/** Die Tage vom Zielstart bis gestern: 01.10. bis 13.10.2026. */
export const verlaufTage: readonly LocalDate[] = Array.from({ length: 13 }, (_, index) => LocalDate.parse(addDays(seedDays.zielstart, index)));

/** Beginn des Folgetags in Berlin: im ganzen Verlauf gilt die Sommerzeit (UTC+2), also 22:00 UTC am Tag selbst. */
const dayEndOf = (localDate: string) => `${localDate}T22:00:00.000Z`;

export type VerlaufPerson = Readonly<{
  personId: string;
  plan: SeedWeeklyPlan;
  thresholds: Readonly<Partial<Record<BausteinKey, Readonly<Record<string, number>>>>>;
  /** Wann die Zielversion entstand; am Zielstart materialisiert die App die Tagesziele erst danach. */
  goalsFrom: string;
}>;

/**
 * Energieverlauf (Spezifikation 0, Abschnitte 3 und 4): An jedem Tag des Verlaufs erfüllt jede Person ihre
 * drei Tagesziele am Abend und bekommt den Tagesbonus, also 4 Energie je Tag und 52 im ganzen Verlauf.
 */
export function energieverlaufPart(people: readonly VerlaufPerson[]): SeedPart {
  let n = 0;
  return {
    area: 'fundament',
    entities: people.flatMap(({ personId, plan, thresholds, goalsFrom }) =>
      verlaufTage.flatMap((localDate) => {
        const ids = [seedIds.dailyGoal.verlauf(++n), seedIds.dailyGoal.verlauf(++n), seedIds.dailyGoal.verlauf(++n)] as const;
        const bausteine = plan[weekdayOf(localDate)]!;
        const morning = `${localDate}T05:00:00.000Z`;
        const at = (minute: number) => `${localDate}T19:${minute}:00.000Z`;
        return [
          ...seedDailyGoals({
            personId,
            ids,
            localDate,
            dayEndsAt: dayEndOf(localDate),
            createdAt: goalsFrom > morning ? goalsFrom : morning,
            bausteine,
            thresholds,
          }),
          ...bausteine.flatMap((baustein, index) =>
            seedCompletion({ personId, dailyGoalId: ids[index]!, localDate, slot: (index + 1) as 1 | 2 | 3, baustein, at: at(10 * (index + 1)) }),
          ),
          seedDailyBonus({ personId, localDate, at: at(30) }),
        ];
      }),
    ),
  };
}

/** Ein Bau: Person, Feld der Grundinsel, Bauplan und Zeitpunkt, zu dem der Server ihn angenommen hat. */
export type SeedBuild = Readonly<{ personId: string; fieldKey: string; blueprintKey: string; at: string }>;

/** Feldschlüssel `grundinsel:x:y` für die ersten `count` Felder eines Rechtecks ab (x, y), zeilenweise. */
const fieldsFrom = (x: number, y: number, width: number, count: number) =>
  Array.from({ length: count }, (_, index) => `grundinsel:${x + (index % width)}:${y + Math.floor(index / width)}`);

/** Ein Bau je Tag ab dem 02.10. am frühen Abend. */
const dailyBuilds = (personId: string, fieldKeys: readonly string[], blueprints: readonly string[], minute: number): SeedBuild[] =>
  fieldKeys.map((fieldKey, index) => ({ personId, fieldKey, blueprintKey: blueprints[index]!, at: `${addDays('2026-10-02', index)}T16:${String(minute).padStart(2, '0')}:00.000Z` }));

/**
 * Bauten in `gekoppelt`: Philipp setzt zehn Laternen in seine Ecke (30 Energie), Anna neun Apfelbäume und
 * einen Beerenstrauch in ihre (29 Energie). Beide liegen damit über Schwelle(3) = 23, keiner über
 * Schwelle(4) = 36: Level 3, Philipp 7/13 (53 %), Anna 6/13 (46 %).
 */
export const gekoppeltBauten: readonly SeedBuild[] = [
  ...dailyBuilds(philipp, fieldsFrom(0, 0, 4, 10), Array(10).fill('laterne'), 0),
  ...dailyBuilds(anna, fieldsFrom(12, 0, 4, 10), [...Array(9).fill('apfelbaum'), 'beerenstrauch'], 30),
];

/** `haelfte-voll`: Philipp setzt heute zwei Laternen mehr; 36 verbaut füllen seine Hälfte auf Level 3. */
export const haelfteVollBauten: readonly SeedBuild[] = [
  ...gekoppeltBauten,
  { personId: philipp, fieldKey: 'grundinsel:2:2', blueprintKey: 'laterne', at: '2026-10-14T09:00:00.000Z' },
  { personId: philipp, fieldKey: 'grundinsel:3:2', blueprintKey: 'laterne', at: '2026-10-14T09:05:00.000Z' },
];

/** Preis eines Bauplans nach den Spielregeln. */
export function priceOf(blueprintKey: string): number {
  const blueprint = catalog.find('bauplan', blueprintKey);
  if (blueprint.type !== 'found') throw new Error(`Seed: unbekannter Bauplan ${blueprintKey}`);
  return basePrice(blueprint.entry);
}

/** ID eines Inselfelds der Grundinsel, wie `geschluepftePart` sie vergibt: in Katalogreihenfolge. */
export function fieldIdOf(fieldKey: string): string {
  const plan = hatching(gameCatalog, { proposerPersonId: anna, proposerRole: 'natur', partnerPersonId: philipp });
  const index = plan.fields.findIndex((field) => field.key === fieldKey);
  if (index < 0) throw new Error(`Seed: Feld ${fieldKey} gibt es nicht`);
  return seedIds.islandField(index + 1);
}

/** Objekt und `build_debit` eines Baus, wie `buildObject` sie schreibt; `n` ist die laufende Nummer. */
export function buildEntities(build: SeedBuild, n: number, localDate: string = build.at.slice(0, 10)): SeedEntity[] {
  const objectId = seedIds.islandObject(n);
  const commandId = seedIds.buildCommand(n);
  return [
    {
      table: 'island_object',
      entityType: 'island_object',
      couplingId,
      row: {
        id: objectId,
        island_id: islandId,
        coupling_id: couplingId,
        owner_person_id: build.personId,
        catalog_key: build.blueprintKey,
        origin: 'gebaut',
        level: 1,
        field_id: fieldIdOf(build.fieldKey),
        created_at: build.at,
        updated_at: build.at,
        deleted_at: null,
      },
    },
    {
      table: 'energy_booking',
      entityType: 'energy_booking',
      ownerPersonId: build.personId,
      row: {
        id: energyBookingId(commandId),
        person_id: build.personId,
        type: 'build_debit',
        amount: -priceOf(build.blueprintKey),
        local_date: localDate,
        booking_key: commandId,
        trigger: { commandId, islandObjectId: objectId },
        daily_goal_completion_id: null,
        island_object_id: objectId,
        community_project_id: null,
        original_booking_id: null,
        created_at: build.at,
      },
    },
  ];
}

/**
 * Level, Bedarf und Hälften des Inselfortschritts aus den Bauten, wie der Projector sie schreibt: Mitglieder
 * nach Person sortiert, ohne Energiemengen.
 */
export function progressOf(builds: readonly SeedBuild[]) {
  const members = [philipp, anna].sort();
  const spent = members.map((personId) => builds.filter((build) => build.personId === personId).reduce((sum, build) => sum + priceOf(build.blueprintKey), 0));
  const { level, levelNeed, halves } = islandProgress([spent[0]!, spent[1]!]);
  return { level, levelNeed, members: members.map((personId, index) => ({ personId, ...halves[index]! })) };
}
