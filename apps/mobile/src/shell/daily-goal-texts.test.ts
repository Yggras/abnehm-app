import { Instant } from '@abnehm/contracts/base';
import type { DailyGoalEvaluated } from '@abnehm/contracts/daily-goals';

import { dailyGoalText } from './daily-goal-texts';

// Nachweis für #136: Die Zeilen der Tagesziele auf „Heute“ entstehen in der App aus `messageKey`, den
// typisierten Werten, dem aktuellen Zustand und der festgehaltenen Erfüllung (Spezifikation 1, Abschnitt 6).

const at = Instant.parse('2026-10-14T10:00:00.000Z');
function goal(evaluation: Partial<DailyGoalEvaluated> & Pick<DailyGoalEvaluated, 'currentState' | 'progress' | 'messageKey' | 'values'>): DailyGoalEvaluated {
  return { type: 'evaluated', dayClosed: false, completion: { type: 'nie' }, ...evaluation } as DailyGoalEvaluated;
}

it('zeigt das Wasserziel mit gezählter Menge und Ziel in Litern', () => {
  const water = { countedMl: 1000, targetMl: 1500 };
  expect(dailyGoalText(goal({ currentState: 'teilweise', progress: { type: 'wasserziel', ...water }, messageKey: 'tagesziel.wasserziel.teilweise', values: water })))
    .toEqual({ title: 'Wasserziel · 1,0 von 1,5 l', name: 'Wasserziel', detail: '1,0 von 1,5 l', status: 'teilweise' });
});

it('zeigt „Im Kalorienbudget“ tagsüber als „am Tagesende“ und danach mit Aufnahme und Budget', () => {
  const values = { intakeKcal: 1540, budgetKcal: 1620, lowerBoundKcal: 1200 };
  const progress = { type: 'im_kalorienbudget', ...values } as const;
  expect(dailyGoalText(goal({ currentState: 'tagesende', progress, messageKey: 'tagesziel.im_kalorienbudget.tagesende', values })))
    .toMatchObject({ title: 'Im Kalorienbudget · am Tagesende', status: null });
  expect(dailyGoalText(goal({ currentState: 'erfuellt', dayClosed: true, progress, messageKey: 'tagesziel.im_kalorienbudget.erfuellt', values })))
    .toMatchObject({ title: 'Im Kalorienbudget · 1.540 von 1.620 kcal', status: 'erfüllt' });
});

it('nennt nach einer Korrektur den aktuellen Zustand und die festgehaltene Gutschrift', () => {
  const water = { countedMl: 0, targetMl: 1500 };
  expect(dailyGoalText(goal({
    currentState: 'offen',
    progress: { type: 'wasserziel', ...water },
    messageKey: 'tagesziel.wasserziel.offen',
    values: water,
    completion: { type: 'festgehalten', firstCompletedAt: at },
  }))).toMatchObject({ title: 'Wasserziel · 0,0 von 1,5 l', status: 'offen · bereits gutgeschrieben' });
});

it('zeigt Ernährung, Sporteinheit und Gewogen mit ihren Werten', () => {
  const meals = { recordedMealCategories: 1, minimumMealCategories: 2 };
  expect(dailyGoalText(goal({ currentState: 'teilweise', progress: { type: 'ernaehrung_erfasst', ...meals }, messageKey: 'tagesziel.ernaehrung_erfasst.teilweise', values: meals })).title)
    .toBe('Ernährung erfasst · 1 von 2 Mahlzeiten');
  const sport = { longestSessionMinutes: 20, minimumSingleSessionMinutes: 30 };
  expect(dailyGoalText(goal({ currentState: 'teilweise', progress: { type: 'sporteinheit', ...sport }, messageKey: 'tagesziel.sporteinheit.teilweise', values: sport })).title)
    .toBe('Sporteinheit · 20 von 30 min');
  expect(dailyGoalText(goal({ currentState: 'erfuellt', progress: { type: 'gewogen', weightEntryCount: 1 }, messageKey: 'tagesziel.gewogen.erfuellt', values: { weightEntryCount: 1 } })))
    .toMatchObject({ title: 'Gewogen · eingetragen', status: 'erfüllt' });
});

it('zeigt bei unbekanntem messageKey oder unpassenden Werten nur den Namen des Bausteins, nie den Schlüssel', () => {
  const water = { countedMl: 750, targetMl: 1500 };
  expect(dailyGoalText(goal({ currentState: 'teilweise', progress: { type: 'wasserziel', ...water }, messageKey: 'wasser.unbekannt', values: water })))
    .toMatchObject({ title: 'Wasserziel', status: 'teilweise' });
  expect(dailyGoalText(goal({ currentState: 'teilweise', progress: { type: 'wasserziel', ...water }, messageKey: 'tagesziel.wasserziel.teilweise', values: { ml: 750 } })))
    .toMatchObject({ title: 'Wasserziel', status: 'teilweise' });
});
