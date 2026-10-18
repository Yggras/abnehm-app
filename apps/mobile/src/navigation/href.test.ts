import { EntityId, LocalDate } from '@abnehm/contracts/base';
import { RouteName, type RouteTarget } from '@abnehm/contracts/routes';

import { hrefFor, targetFromLink } from './href';

const challengeId = EntityId.parse('0b9f4a1e-6c1d-4f7b-9a51-2f3d8c7e1a10');

const targets: RouteTarget[] = [
  { type: 'today' },
  { type: 'log' },
  { type: 'capture.food', meal: 'mittagessen', localDate: LocalDate.parse('2026-10-18') },
  { type: 'capture.water' },
  { type: 'capture.sport', newEntry: true },
  { type: 'capture.weight' },
  { type: 'momo', view: 'projekt' },
  { type: 'challenge.propose' },
  { type: 'challenge.detail', challengeId },
  { type: 'partner', focus: 'received_encouragement' },
  { type: 'partner.invite' },
  { type: 'partner.redeem' },
  { type: 'partner.encourage' },
  { type: 'notifications.permission' },
  { type: 'settings' },
  { type: 'settings', section: 'weekly_plan' },
  { type: 'onboarding' },
  { type: 'plan.budget_suggestion', suggestionId: challengeId },
  { type: 'plan.goal_reached' },
];

test('die Beispielziele decken jede Route des Katalogs ab', () => {
  expect(new Set(targets.map((target) => target.type))).toEqual(new Set(RouteName.options));
});

test.each(targets)('$type: Link und Rückweg ergeben dasselbe Ziel', (target) => {
  const href = hrefFor(target);
  expect(targetFromLink(href.pathname, href.params)).toEqual(target);
});

test('Pfade folgen dem Routennamen, Parameter stehen in der Abfrage', () => {
  expect(hrefFor({ type: 'today' })).toEqual({ pathname: '/', params: {} });
  expect(hrefFor({ type: 'capture.sport', newEntry: true })).toEqual({
    pathname: '/capture/sport',
    params: { newEntry: 'true' },
  });
  expect(hrefFor({ type: 'settings', section: 'goals' })).toEqual({ pathname: '/settings/goals', params: {} });
});

test.each([
  ['unbekannter Pfad', '/capture/steps', {}],
  ['unbekannte Ansicht', '/momo', { view: 'shop' }],
  ['fremder Parameter', '/log', { view: 'projekt' }],
  ['Pflichtparameter fehlt', '/challenge/detail', {}],
  ['keine UUID', '/challenge/detail', { challengeId: 'abc' }],
  ['newEntry false', '/capture/weight', { newEntry: 'false' }],
  ['doppelter Parameter', '/capture/food', { meal: ['mittagessen', 'snacks'] }],
  ['unbekannter Einstellungsabschnitt', '/settings/privacy', {}],
  ['Abschnitt doppelt', '/settings/goals', { section: 'health' }],
])('%s öffnet „Heute“', (_case, pathname, params) => {
  expect(targetFromLink(pathname, params)).toEqual({ type: 'today' });
});
