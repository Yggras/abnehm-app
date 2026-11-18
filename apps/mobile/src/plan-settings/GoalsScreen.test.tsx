/// <reference types="expo-router/build/ts-declarations/expect" />
import { act, fireEvent, screen, userEvent } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';

import { createTestClock, type TestClock } from '@abnehm/clock/testing';
import { LocalDate } from '@abnehm/contracts/base';
import { goalVersionId } from '@abnehm/contracts/plan';

import SettingsGoals from '../app/settings/goals';
import { Button } from '../design';
import { hitArea } from '../design/testing/hit-area';
import { withDeviceConfig } from '../design/testing/device-config';
import { openTarget } from '../navigation';
import { writeGoalVersion } from '../plan/plan-repository';
import { berlin, philipp, wednesdayNoon } from '../plan/testing/today-world';
import { createGoalsWorld, type GoalsWorld } from './testing/goals-world';

jest.mock('../design/native/Sheet', () => jest.requireActual('../design/testing/inline-sheet'));

// Nachweis für #147: die Einstellungsseite „Ziele“ (Spezifikation 1, Abschnitt 10) mit der echten
// Routendatei und dem echten Plan-Modul über einer SQLite-Datei mit den Migrationen der App. Die Testuhr
// steht in Berlin am Mittwoch, 14.10.2026, 12:00. Ausgangsfall ist der Referenzfall der Recherche: Frau,
// 35 Jahre, 168 cm, 80 kg, wenig aktiv, entspannt, Zielgewicht 76 kg, Wasser 1,5 l, Sport 150 min.

const user = userEvent.setup();
let world: GoalsWorld;
let clock: TestClock;

afterEach(() => world.close());

async function open(plan: Parameters<GoalsWorld['saveInitialPlan']>[0] | null = {}) {
  clock = createTestClock({ instant: wednesdayNoon, timeZone: berlin });
  world = await createGoalsWorld(clock);
  if (plan !== null) await world.saveInitialPlan(plan);
  await renderRouter({ _layout: world.Layout, 'settings/goals': SettingsGoals }, { initialUrl: '/settings/goals' });
  await act(async () => {});
}

const row = (name: string) => screen.getByLabelText(name);
const button = (name: string) => screen.getByRole('button', { name });
const toggle = (name: string) => screen.getByRole('switch', { name });
const field = (name: string) => screen.getByLabelText(name);
const save = () => button('Ab morgen übernehmen');
const edit = () => user.press(button('Ziele ändern'));
const typeInto = (name: string, text: string) => act(async () => fireEvent.changeText(field(name), text));

describe('Anzeige', () => {
  test('Kalorienbudget mit Herleitung, Zielgewicht samt Prognose, Tempo, Wasser- und Sportziel und der Hinweis', async () => {
    await open();

    expect(screen.getByRole('header', { name: 'Kalorienbudget' })).toBeOnTheScreen();
    expect(row('Kalorienbudget pro Tag: 1.620 kcal, berechnet')).toBeOnTheScreen();
    expect(row('Grundumsatz: 1.514 kcal')).toBeOnTheScreen();
    expect(row('Aktivitätsstufe wenig aktiv – überwiegend sitzend: mal 1,4')).toBeOnTheScreen();
    expect(row('Gesamtumsatz: 2.120 kcal')).toBeOnTheScreen();
    expect(row('Defizit für das Tempo entspannt: minus 500 kcal')).toBeOnTheScreen();
    expect(row('Untergrenze: 1.514 kcal')).toBeOnTheScreen();

    expect(screen.getByRole('header', { name: 'Deine Ziele' })).toBeOnTheScreen();
    expect(row('Zielgewicht: 76,0 kg, etwa Dezember 2026, Schätzung')).toBeOnTheScreen();
    expect(screen.getByText('Nach etwa drei Monaten verlangsamt sich die Abnahme meist.')).toBeOnTheScreen();
    expect(row('Tempo: entspannt, etwa 0,5 kg pro Woche')).toBeOnTheScreen();
    expect(row('Wasserziel: 1,5 l pro Tag')).toBeOnTheScreen();
    expect(row('Sportziel: 150 Minuten pro Woche')).toBeOnTheScreen();
    expect(row('Haltemodus: aus')).toBeOnTheScreen();

    expect(screen.getByText('Die App gibt keine medizinische Beratung; alle Werte sind Schätzungen.')).toBeOnTheScreen();
    expect(screen.queryByRole('header', { name: 'Ab morgen' })).toBeNull();
  });

  test('ein angehobenes Budget nennt die Untergrenze und den Weg zur ärztlichen Begleitung', async () => {
    // Frau, 35, 155 cm, 60 kg, wenig aktiv, zügiger: Die Rechnung läge unter dem Grundumsatz.
    await open({ heightCm: 155, weightG: 60_000, goalWeightG: 57_000, pace: 'zuegiger' });

    expect(row('Kalorienbudget pro Tag: 1.240 kcal, berechnet')).toBeOnTheScreen();
    expect(
      screen.getByText('Die Rechnung lag unter deiner Untergrenze, deshalb ist dein Budget angehoben. Wenn du schneller abnehmen möchtest, lass dich bitte ärztlich begleiten.'),
    ).toBeOnTheScreen();
  });

  test('ohne Plan: ein Hinweis statt Werten und keine Bearbeitung', async () => {
    await open(null);

    expect(screen.getByText('Deine Ziele entstehen bei der Einrichtung.')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Ziele ändern' })).toBeNull();
  });
});

describe('Bearbeitung ab morgen', () => {
  test('Philipp erhöht das Wasserziel und wählt „zügiger“: eine vollständige Zielversion ab morgen, angezeigt als „ab morgen“', async () => {
    await open();
    await edit();

    await user.press(button('Wasserziel erhöhen'));
    await user.press(screen.getByRole('radio', { name: 'zügiger, etwa 0,75 kg pro Woche' }));
    expect(row('Kalorienbudget ab morgen: 1.520 kcal')).toBeOnTheScreen();
    await user.press(save());

    expect(world.goalVersions()).toEqual([
      expect.objectContaining({ validFrom: '2026-10-14', waterTargetMl: 1_500, pace: 'entspannt' }),
      expect.objectContaining({ validFrom: '2026-10-15', waterTargetMl: 1_750, pace: 'zuegiger', calorieBudgetMilliKcal: 1_520_000, goalWeightG: 76_000 }),
    ]);
    expect(world.outbox().filter((operation) => operation.type === 'createGoalVersion')).toHaveLength(2);
    expect(screen.getByText('Ziele gespeichert · gelten ab morgen')).toBeOnTheScreen();

    expect(screen.getByRole('header', { name: 'Ab morgen' })).toBeOnTheScreen();
    expect(row('Kalorienbudget pro Tag: 1.520 kcal, bisher 1.620 kcal')).toBeOnTheScreen();
    expect(row('Tempo: zügiger, bisher entspannt')).toBeOnTheScreen();
    expect(row('Wasserziel: 1,75 l pro Tag, bisher 1,5 l pro Tag')).toBeOnTheScreen();
    // Heute gelten weiter die bisherigen Werte.
    expect(row('Wasserziel: 1,5 l pro Tag')).toBeOnTheScreen();
  });

  test('ein erneutes Ändern am selben Tag ersetzt die noch nicht wirksame Fassung', async () => {
    await open();
    await edit();
    await user.press(button('Wasserziel erhöhen'));
    await user.press(save());

    await edit();
    expect(screen.getByLabelText('Wasserziel: 1,75 l')).toBeOnTheScreen();
    await user.press(button('Sportziel erhöhen'));
    await user.press(save());

    expect(world.goalVersions()).toEqual([
      expect.objectContaining({ validFrom: '2026-10-14' }),
      expect.objectContaining({ validFrom: '2026-10-15', waterTargetMl: 1_750, weeklySportTargetMinutes: 160 }),
    ]);
  });

  test('am Folgetag gilt die Änderung, und „ab morgen“ verschwindet', async () => {
    await open();
    await edit();
    await user.press(button('Wasserziel erhöhen'));
    await user.press(save());

    await act(async () => {
      clock.advanceBy(24 * 60 * 60 * 1_000);
      world.tick();
    });

    expect(row('Wasserziel: 1,75 l pro Tag')).toBeOnTheScreen();
    expect(screen.queryByRole('header', { name: 'Ab morgen' })).toBeNull();
  });

  test('„Ab morgen übernehmen“ bleibt ohne Änderung gesperrt; „Abbrechen“ verwirft den Entwurf', async () => {
    await open();
    await edit();
    expect(save()).toBeDisabled();

    await user.press(button('Wasserziel erhöhen'));
    expect(save()).toBeEnabled();
    await user.press(button('Abbrechen'));

    expect(screen.getByRole('button', { name: 'Ziele ändern' })).toBeOnTheScreen();
    expect(world.goalVersions()).toHaveLength(1);
  });

  test('ein Zielgewicht unter der Grenze von BMI 18,5 sperrt das Speichern mit Lösungsweg', async () => {
    await open();
    await edit();

    await typeInto('Zielgewicht', '50');

    expect(field('Zielgewicht')).toHaveProp('accessibilityHint', 'Fehler: Dein Zielgewicht muss mindestens 52,3 kg betragen, das entspricht einem BMI von 18,5.');
    expect(save()).toBeDisabled();
  });

  test('ein selbst festgelegtes Budget zwischen Untergrenze und Gesamtumsatz', async () => {
    await open();
    await edit();

    await user.press(toggle('Budget selbst festlegen'));
    await typeInto('Eigenes Kalorienbudget', '2.500');
    expect(field('Eigenes Kalorienbudget')).toHaveProp('accessibilityHint', 'Fehler: Bitte gib ein Budget von 1.520 bis 2.120 kcal in 10er-Schritten ein.');
    expect(save()).toBeDisabled();

    await typeInto('Eigenes Kalorienbudget', '1700');
    await user.press(save());

    expect(world.goalVersions()[1]).toMatchObject({ validFrom: '2026-10-15', calorieBudgetMilliKcal: 1_700_000, budgetSource: 'manuell' });
    expect(row('Kalorienbudget pro Tag: 1.700 kcal, bisher 1.620 kcal')).toBeOnTheScreen();
  });
});

describe('Budget aus einem angenommenen Budgetvorschlag', () => {
  test('bleibt bei einer anderen Änderung erhalten und lässt sich durch ein eigenes ersetzen', async () => {
    await open();
    // Wie `acceptBudgetSuggestion` (#151): eine Fassung ab morgen mit dem Budget des Vorschlags.
    const { validFrom: _validFrom, ...values } = world.plan.settings().goal.current!;
    const tomorrow = LocalDate.parse('2026-10-15');
    await act(async () => {
      world.database.transaction((tx) =>
        writeGoalVersion(tx, goalVersionId(philipp, tomorrow), philipp, { ...values, validFrom: tomorrow, calorieBudgetMilliKcal: 1_773_000, budgetSource: 'budgetvorschlag' }, wednesdayNoon),
      );
    });
    expect(row('Kalorienbudget pro Tag: 1.773 kcal, bisher 1.620 kcal')).toBeOnTheScreen();

    await edit();
    expect(toggle('Budget selbst festlegen')).not.toBeChecked();
    expect(screen.getByText('Es gilt weiter das Budget aus deinem Budgetvorschlag: 1.773 kcal.')).toBeOnTheScreen();
    await user.press(button('Wasserziel erhöhen'));
    expect(row('Kalorienbudget ab morgen: 1.773 kcal')).toBeOnTheScreen();
    await user.press(save());

    expect(world.goalVersions()[1]).toMatchObject({ validFrom: '2026-10-15', calorieBudgetMilliKcal: 1_773_000, budgetSource: 'budgetvorschlag', waterTargetMl: 1_750 });
  });
});

describe('Haltemodus', () => {
  test('freiwillig einschalten: ohne Tempo, das Budget ist ab morgen der Gesamtumsatz', async () => {
    await open();
    await edit();

    await user.press(toggle('Budget selbst festlegen'));
    await user.press(toggle('Gewicht halten'));
    expect(screen.queryByRole('radio', { name: /^entspannt/ })).toBeNull();
    // Im Haltemodus ist das Budget der Gesamtumsatz; ein eigenes gibt es dort nicht.
    expect(screen.queryByRole('switch', { name: 'Budget selbst festlegen' })).toBeNull();
    await user.press(save());

    expect(world.goalVersions()[1]).toMatchObject({ validFrom: '2026-10-15', maintenanceReason: 'gewaehlt', pace: null, calorieBudgetMilliKcal: 2_120_000, budgetSource: 'berechnet' });
    expect(row('Tempo: Gewicht halten, bisher entspannt')).toBeOnTheScreen();
    expect(row('Haltemodus: an, selbst gewählt, bisher aus')).toBeOnTheScreen();
  });

  test('freiwillig ausschalten verlangt ein Tempo', async () => {
    await open({ pace: null });
    expect(row('Haltemodus: an, selbst gewählt')).toBeOnTheScreen();
    await edit();

    await user.press(toggle('Gewicht halten'));
    expect(screen.getByText('Wähle ein Tempo, um wieder abzunehmen.')).toBeOnTheScreen();
    expect(save()).toBeDisabled();

    await user.press(screen.getByRole('radio', { name: 'entspannt, etwa 0,5 kg pro Woche' }));
    await user.press(save());

    expect(world.goalVersions()[1]).toMatchObject({ validFrom: '2026-10-15', maintenanceReason: null, pace: 'entspannt', calorieBudgetMilliKcal: 1_620_000 });
  });

  test('freiwillig ausschalten verlangt ein Zielgewicht unter dem aktuellen Gewicht', async () => {
    await open({ pace: null, goalWeightG: 80_000 });
    await edit();

    await user.press(toggle('Gewicht halten'));
    await user.press(screen.getByRole('radio', { name: 'entspannt, etwa 0,5 kg pro Woche' }));

    expect(screen.getByText('Dein Zielgewicht liegt nicht unter deinem Gewicht von 80,0 kg. Wähle ein niedrigeres, um abzunehmen.')).toBeOnTheScreen();
    expect(save()).toBeDisabled();

    await typeInto('Zielgewicht', '76,0');
    await user.press(save());
    expect(world.goalVersions()[1]).toMatchObject({ pace: 'entspannt', goalWeightG: 76_000 });
  });

  test.each([
    ['Schwangerschaft oder Stillzeit', { pregnantOrBreastfeeding: true }, 'Wegen Schwangerschaft oder Stillzeit'],
    ['bekannter Essstörung', { knownEatingDisorder: true }, 'Wegen einer bekannten Essstörung'],
    ['BMI unter 18,5', { weightG: 52_000, goalWeightG: 52_300 }, 'Wegen eines BMI unter 18,5'],
  ] as const)('erzwungen wegen %s: Die Seite erklärt den Grund statt Tempo und Budgeteingabe', async (_, changes, reason) => {
    await open(changes);

    expect(row('Haltemodus: an, wegen deiner Angaben im Sicherheits-Check')).toBeOnTheScreen();
    expect(screen.getByText(new RegExp(`^${reason} rechnet die App für dich ohne Kaloriendefizit`))).toBeOnTheScreen();
    expect(screen.queryByLabelText(/^Tempo:/)).toBeNull();

    await edit();
    expect(screen.queryByRole('switch', { name: 'Gewicht halten' })).toBeNull();
    expect(screen.queryByRole('radio', { name: /^entspannt/ })).toBeNull();
    expect(screen.queryByRole('switch', { name: 'Budget selbst festlegen' })).toBeNull();
    expect(screen.getAllByText(new RegExp(`^${reason} rechnet die App`)).length).toBeGreaterThan(0);

    await user.press(button('Wasserziel erhöhen'));
    await user.press(save());
    expect(world.goalVersions()[1]).toMatchObject({ maintenanceReason: 'sicherheits_check', pace: null, waterTargetMl: 1_750 });
  });
});

describe('Verlassen mit ungesicherten Änderungen', () => {
  /** Eine Vorgängerseite, damit „Zurück“ etwas zum Zurückgehen hat. */
  function Before() {
    return <Button label="Ziele öffnen" onPress={() => openTarget({ type: 'settings', section: 'goals' })} />;
  }

  async function openFromBefore() {
    clock = createTestClock({ instant: wednesdayNoon, timeZone: berlin });
    world = await createGoalsWorld(clock);
    await world.saveInitialPlan();
    await renderRouter({ _layout: world.Layout, 'settings/index': Before, 'settings/goals': SettingsGoals }, { initialUrl: '/settings' });
    await act(async () => {});
    await user.press(button('Ziele öffnen'));
    expect(screen).toHavePathname('/settings/goals');
    await edit();
  }

  test('ohne Änderung geht Zurück ohne Rückfrage', async () => {
    await openFromBefore();
    await user.press(button('Zurück'));
    expect(screen).toHavePathname('/settings');
  });

  test('fragt nach; „Ab morgen übernehmen“ legt die Fassung an und geht zurück', async () => {
    await openFromBefore();
    await user.press(button('Wasserziel erhöhen'));

    await user.press(button('Zurück'));
    expect(screen.getByRole('header', { name: 'Änderungen übernehmen?' })).toBeOnTheScreen();
    await user.press(screen.getAllByRole('button', { name: 'Ab morgen übernehmen' }).at(-1)!);

    expect(world.goalVersions()[1]).toMatchObject({ validFrom: '2026-10-15', waterTargetMl: 1_750 });
    expect(screen).toHavePathname('/settings');
  });

  test('„Verwerfen“ geht ohne neue Fassung zurück, „Weiter bearbeiten“ bleibt', async () => {
    await openFromBefore();
    await user.press(button('Wasserziel erhöhen'));

    await user.press(button('Zurück'));
    await user.press(button('Weiter bearbeiten'));
    expect(screen).toHavePathname('/settings/goals');
    expect(screen.getByLabelText('Wasserziel: 1,75 l')).toBeOnTheScreen();

    await user.press(button('Zurück'));
    await user.press(button('Verwerfen'));
    expect(screen).toHavePathname('/settings');
    expect(world.goalVersions()).toHaveLength(1);
  });
});

describe('Zugänglichkeit und Sprache', () => {
  test('Aktionen haben mindestens 48 × 48 dp', async () => {
    await open();
    await edit();

    for (const action of [
      button('Wasserziel verringern'),
      button('Wasserziel erhöhen'),
      button('Sportziel erhöhen'),
      toggle('Gewicht halten'),
      toggle('Budget selbst festlegen'),
      save(),
      button('Abbrechen'),
    ]) {
      const { width, height } = hitArea(action);
      expect(width).toBeGreaterThanOrEqual(48);
      expect(height).toBeGreaterThanOrEqual(48);
    }
  });

  test('das gewählte Tempo trägt Häkchen und Zustand, nicht nur Farbe', async () => {
    await open();
    await edit();

    expect(screen.getByRole('radio', { name: 'entspannt, etwa 0,5 kg pro Woche' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'zügiger, etwa 0,75 kg pro Woche' })).not.toBeChecked();
  });

  test('Grenzen der Stepper: an der Grenze ist die Richtung gesperrt', async () => {
    await open({ waterTargetMl: 5_000 });
    await edit();

    expect(button('Wasserziel erhöhen')).toBeDisabled();
    expect(button('Wasserziel verringern')).toBeEnabled();
  });

  describe('mit Schriftfaktor 2,0', () => {
    withDeviceConfig('schriftfaktor-2');

    test('bleiben alle Werte und Aktionen erreichbar', async () => {
      await open();

      expect(row('Kalorienbudget pro Tag: 1.620 kcal, berechnet')).toBeOnTheScreen();
      await edit();
      expect(button('Wasserziel erhöhen')).toBeOnTheScreen();
      expect(save()).toBeOnTheScreen();
    });
  });
});
