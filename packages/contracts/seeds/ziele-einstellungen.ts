import { EntityId, LocalDate } from '../src/base.ts';
import { ageOn, calculateGoals, type GoalCalculatorInput } from '../src/goal-calculator.ts';
import { goalVersionId, goalVersionOf } from '../src/plan.ts';
import type { SeedEntity } from './build.ts';
import { seedDays, seedIds } from './ids.ts';
import type { SeedRow } from './manifest.ts';
import { seedGoalVersion } from './rows.ts';

// Szenarien der Einstellungsseite „Ziele“ aus Spezifikation 1, Abschnitt 12 (#147): „erzwungener
// Haltemodus“ je Sicherheitsgrund, „Budget angehoben“ (Rechnung unter der Untergrenze) und „bevorstehende
// Fassung ‚ab morgen‘“. Sie sind Varianten von `solo` (`solo.ts`): Philipp mit denselben IDs, derselben
// Wochenplanversion und denselben Tageszielen von heute, nur mit eigenen Personenangaben, Zielversionen und
// bei abweichendem Gewicht eigenen Wiegungen. Anders als in `solo` stammen die Zielversionen hier aus dem
// Zielrechner, sodass sie zu ihren Eingaben passen; Wasserziel (2.500 ml) und Sportwochenziel (150 min)
// bleiben die aus `solo`, damit die Snapshots der Tagesziele von heute zur Fassung passen. Alle Werte sind
// erfunden.

const philipp = seedIds.person.philipp;
const birthDate = LocalDate.parse('1990-05-17');
const zielstart = LocalDate.parse(seedDays.zielstart);
/** Anlage der Fassungen aus dem Onboarding, wie in `solo`. */
const onboardedAt = '2026-10-01T07:05:00.000Z';

/** Personenangaben, die eine Variante gegenüber `solo` ändert. */
export type GoalSettingsPerson = Readonly<Partial<Record<'calculation_sex' | 'activity_level' | 'pregnant_or_breastfeeding' | 'known_eating_disorder', SeedRow[string]>>>;

/** Eingaben des Zielrechners einer Fassung; alles Übrige wie in `solo`. */
type GoalInputs = Partial<Omit<GoalCalculatorInput, 'calculationDate' | 'ageYears'>>;

/** Philipps Eingaben in `solo`: männlich, 36, 182 cm, 92 kg, mäßig aktiv, entspannt, Ziel 84 kg. */
const soloInputs = {
  calculationSex: 'maennlich',
  heightCm: 182,
  weightG: 92_000,
  weightTrendG: null,
  activityLevel: 'maessig_aktiv',
  pregnantOrBreastfeeding: false,
  knownEatingDisorder: false,
  goalWeightG: 84_000,
  pace: 'entspannt',
  manualBudgetKcal: null,
  waterTargetMl: 2_500,
  weeklySportTargetMinutes: 150,
} as const satisfies Omit<GoalCalculatorInput, 'calculationDate' | 'ageYears'>;

/** Eine Zielversion aus dem Zielrechner, gültig ab `validFrom`, mit der ID aus Person und Tag. */
function calculatedGoalVersion(validFrom: LocalDate, createdAt: string, inputs: GoalInputs): SeedEntity {
  const input: GoalCalculatorInput = { ...soloInputs, ...inputs, calculationDate: validFrom, ageYears: ageOn(birthDate, validFrom) };
  const calculation = calculateGoals(input);
  if (calculation.type === 'ungueltig') throw new Error(`Zielversion ab ${validFrom}: ${calculation.errors.join(', ')}`);
  return seedGoalVersion({
    id: goalVersionId(EntityId.parse(philipp), validFrom),
    personId: philipp,
    createdAt,
    values: goalVersionOf({ validFrom, input, calculation }),
  });
}

/** Eine manuelle Messung wie in `solo`: ID, Gewicht in g, Zeitpunkt und lokaler Tag in Berlin. */
type Weighing = Readonly<{ id: string; weight: number; at: string; localDate: string }>;

/** Zwei Wiegungen bis gestern mit den IDs aus `solo`, für Varianten mit anderem Gewicht. */
const weighingsAround = (weightG: number): readonly Weighing[] => [
  { id: seedIds.weightEntry.philippVorgestern, weight: weightG + 400, at: '2026-10-12T05:30:00.000Z', localDate: seedDays.vorgestern },
  { id: seedIds.weightEntry.philippGestern, weight: weightG, at: '2026-10-13T05:45:00.000Z', localDate: seedDays.gestern },
];

export type GoalSettingsVariant = Readonly<{
  person: GoalSettingsPerson;
  /** Die Zielversionen der Variante, ältere zuerst. */
  goals: readonly SeedEntity[];
  /** Eigene Wiegungen, wenn das Gewicht der Berechnung von `solo` abweicht. */
  weights?: readonly Weighing[];
}>;

/**
 * Die Szenarien dieses Tickets. Ausgangszustand ist zugleich Sollzustand: Ein Sync ändert nichts.
 * - `solo-haltemodus-schwanger`, `-essstoerung`, `-untergewicht`: erzwungener Haltemodus je Sicherheitsgrund;
 *   für Schwangerschaft rechnet Philipp mit dem Berechnungsgeschlecht weiblich, beim Untergewicht wiegt er
 *   60 kg (BMI 18,1).
 * - `solo-budget-angehoben`: wenig aktiv und zügiger bei 90 kg; die Rechnung (1.857,5 kcal) läge unter dem
 *   Grundumsatz (1.862,5 kcal), das Budget ist auf 1.870 kcal angehoben.
 * - `solo-ziele-ab-morgen`: Die heute gültige Fassung ist die aus dem Onboarding; heute hat Philipp „zügiger“,
 *   2,75 l Wasser und 180 Sportminuten ab morgen festgelegt. Die Fassung ist noch nicht wirksam.
 */
export const goalSettingsVariants = {
  'solo-haltemodus-schwanger': {
    person: { calculation_sex: 'weiblich', pregnant_or_breastfeeding: true },
    goals: [calculatedGoalVersion(zielstart, onboardedAt, { calculationSex: 'weiblich', pregnantOrBreastfeeding: true })],
  },
  'solo-haltemodus-essstoerung': {
    person: { known_eating_disorder: true },
    goals: [calculatedGoalVersion(zielstart, onboardedAt, { knownEatingDisorder: true })],
  },
  'solo-haltemodus-untergewicht': {
    person: {},
    // Das Zielgewicht muss mindestens dem Gewicht bei BMI 18,5 entsprechen (61,3 kg).
    goals: [calculatedGoalVersion(zielstart, onboardedAt, { weightG: 60_000, goalWeightG: 61_300 })],
    weights: weighingsAround(60_000),
  },
  'solo-budget-angehoben': {
    person: { activity_level: 'wenig_aktiv' },
    goals: [calculatedGoalVersion(zielstart, onboardedAt, { weightG: 90_000, goalWeightG: 84_000, activityLevel: 'wenig_aktiv', pace: 'zuegiger' })],
    weights: weighingsAround(90_000),
  },
  'solo-ziele-ab-morgen': {
    person: {},
    goals: [
      calculatedGoalVersion(zielstart, onboardedAt, {}),
      calculatedGoalVersion(LocalDate.parse('2026-10-15'), '2026-10-14T11:30:00.000Z', { pace: 'zuegiger', waterTargetMl: 2_750, weeklySportTargetMinutes: 180 }),
    ],
  },
} as const satisfies Readonly<Record<string, GoalSettingsVariant>>;
