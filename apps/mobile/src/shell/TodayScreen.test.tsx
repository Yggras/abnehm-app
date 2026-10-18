import { act, render, screen } from '@testing-library/react-native';
import { contractFixtures } from '@abnehm/contracts/fixtures';
import type { Clock } from '@abnehm/clock';

import { ClockProvider } from '../clock/clock-context';
import { createTodayRegistry, todaySlots, type TodayState } from './today-registry';
import { TodayContent } from './TodayScreen';
import { MessageHostProvider } from './MessageHost';

const day = { instant: '2026-10-14T12:00:00.000Z', timeZone: 'Europe/Berlin', localDate: '2026-10-14' };
const clock = { read: () => day } as Clock;
function registryWithFixtures() {
  const registry = createTodayRegistry();
  const names: Record<string, string> = {
    header: 'HeaderReady', top_notice: 'TopNoticeReady', 'momo.character': 'MomoCharacterReady',
    'momo.daily_goals': 'MomoDailyGoalsReady', 'nutrition.budget': 'NutritionBudgetReady',
    'nutrition.log': 'NutritionLogReady', 'trackers.water': 'TrackerWaterReady',
    'trackers.sport': 'TrackerSportReady', 'trackers.weight': 'TrackerWeightReady', partner: 'PartnerCardReady',
  };
  for (const { key, owner } of todaySlots) {
    const example = Object.values(contractFixtures.today![names[key]!]!.valid)[0];
    registry.register(owner, key, { subscribe(listener) { listener({ type: 'ready', data: example } as never); return () => {}; } });
  }
  return registry;
}

// Test-Seam: öffentliche Registry-Beiträge in die fertige Heute-Komposition, nicht einzelne Karten intern.
test('komponiert feste Reihenfolge mit Ernährung, drei Zielen und Mini-Trackern', async () => {
  await render(<ClockProvider clock={clock}><MessageHostProvider><TodayContent registry={registryWithFixtures()} /></MessageHostProvider></ClockProvider>);
  const slots = screen.getAllByTestId(/^today-slot-/).map((node) => node.props.testID);
  expect(slots).toEqual(['today-slot-header', 'today-slot-top_notice', 'today-slot-momo', 'today-slot-nutrition', 'today-slot-trackers', 'today-slot-partner']);
  expect(screen.getByText(/Philipp/)).toBeOnTheScreen();
  expect(screen.getByText(/Budgetvorschlag/)).toBeOnTheScreen();
  expect(screen.getByText(/750 ml/)).toBeOnTheScreen();
});

test('fehlender Pflichtbeitrag hat im Development einen sichtbaren Platzhalter', async () => {
  await render(<ClockProvider clock={clock}><MessageHostProvider><TodayContent registry={createTodayRegistry()} /></MessageHostProvider></ClockProvider>);
  expect(screen.getByText(/Beitrag für Kalorienbudget fehlt/)).toBeOnTheScreen();
});

test('ein beobachteter Pflichtslot zeigt loading, ready, stale, empty und error ohne Farbcodierung allein', async () => {
  const registry = createTodayRegistry();
  let publish: (state: TodayState<'partner'>) => void = () => {}; 
  registry.register('partner', 'partner', { subscribe(listener) { publish = listener; listener({ type: 'loading' }); return () => {}; } });
  await render(<ClockProvider clock={clock}><MessageHostProvider><TodayContent registry={registry} /></MessageHostProvider></ClockProvider>);
  expect(screen.getByText('Partner lädt …')).toBeOnTheScreen();
  const solo = contractFixtures.today!.PartnerCardReady!.valid.solo;
  await act(async () => publish({ type: 'ready', data: solo } as TodayState<'partner'>));
  expect(screen.getByText(/Momo wartet im Ei/)).toBeOnTheScreen();
  await act(async () => publish({ type: 'stale', data: solo, dataAsOf: '2026-10-14T12:00:00.000Z' } as TodayState<'partner'>));
  expect(screen.getByText('Stand: 14.10.2026 · 12:00 UTC')).toBeOnTheScreen();
  await act(async () => publish({ type: 'empty', reasonKey: 'nicht_gekoppelt' }));
  expect(screen.getByText('Hier gibt es noch nichts zu zeigen.')).toBeOnTheScreen();
  await act(async () => publish({ type: 'error', code: 'invalid_payload' }));
  expect(screen.getByText('Dieser Bereich ist gerade nicht verfügbar.')).toBeOnTheScreen();
});

test('eine zusammengesetzte Ernährungskarte kennzeichnet veraltete Teildaten mit Zeitpunkt', async () => {
  const registry = createTodayRegistry();
  registry.register('ziele', 'nutrition.budget', { subscribe(listener) {
    listener({ type: 'stale', data: contractFixtures.today!.NutritionBudgetReady!.valid['Haltemodus ohne Hinweis'] as never, dataAsOf: '2026-10-14T12:00:00.000Z' as never });
    return () => {};
  } });
  registry.register('ernaehrung', 'nutrition.log', { subscribe(listener) {
    listener({ type: 'ready', data: contractFixtures.today!.NutritionLogReady!.valid['ohne Aufnahme'] as never });
    return () => {};
  } });
  await render(<ClockProvider clock={clock}><MessageHostProvider><TodayContent registry={registry} /></MessageHostProvider></ClockProvider>);
  expect(screen.getByText('Stand: 14.10.2026 · 12:00 UTC')).toBeOnTheScreen();
  expect(screen.getByText(/2.120 kcal übrig/)).toBeOnTheScreen();
});

test('ohne Kopplung ersetzt die Laichkugel den Momo-Bereich', async () => {
  const registry = createTodayRegistry();
  registry.register('momo', 'momo.character', { subscribe(listener) {
    listener({ type: 'empty', reasonKey: 'momo_wartet_im_ei', action: { actionId: 'momo.invite_partner', target: { type: 'partner.invite' } } });
    return () => {};
  } });
  await render(<ClockProvider clock={clock}><MessageHostProvider><TodayContent registry={registry} /></MessageHostProvider></ClockProvider>);
  expect(screen.getByRole('image', { name: 'Momo wartet im Ei' })).toBeOnTheScreen();
});

test('ein leerer Unterbeitrag bleibt sichtbar, auch wenn sein Kartenpartner fehlt', async () => {
  const registry = createTodayRegistry();
  registry.register('ernaehrung', 'nutrition.log', {
    subscribe(listener) { listener({ type: 'empty', reasonKey: 'noch_keine_eintraege' }); return () => {}; },
  });
  await render(<ClockProvider clock={clock}><MessageHostProvider><TodayContent registry={registry} /></MessageHostProvider></ClockProvider>);
  expect(screen.getByText(/Noch keine Einträge/)).toBeOnTheScreen();
});
