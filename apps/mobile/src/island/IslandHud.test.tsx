import { render, screen, userEvent } from '@testing-library/react-native';
import { contractFixtures } from '@abnehm/contracts/fixtures';
import { IslandProgress } from '@abnehm/contracts/island';

import { hitArea } from '../design/testing/hit-area';
import { IslandHud, type IslandHudProps } from './IslandHud';
import { anna, philipp } from './testing/persons';

// HUD des Tabs „Momo“ (Spezifikation 4, Abschnitt 7): Jahreszeit mit Tageszeit, eigene Energie,
// Levelbalken und Schalter „Bereiche“. Der Fortschritt ist das Vertrags-Fixture „Level 6, eigene
// Hälfte voll“: Philipp 100 %, Anna 43 %.

const progress = IslandProgress.parse(contractFixtures.island!.IslandProgress!.valid['Level 6, eigene Hälfte voll']);

const hud = (overrides: Partial<IslandHudProps> = {}) => (
  <IslandHud
    season="herbst"
    daytime="tag"
    energy={23}
    progress={progress}
    viewerPersonId={philipp}
    partnerName="Anna"
    areas={false}
    onToggleAreas={jest.fn()}
    {...overrides}
  />
);

test('zeigt Jahreszeit und Tageszeit als Anzeige, nicht als Button', async () => {
  await render(hud());

  expect(screen.getByText('Herbst · Tag')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: /Herbst/ })).not.toBeOnTheScreen();
});

test.each([
  ['fruehling', 'tag', 'Frühling · Tag'],
  ['sommer', 'tag', 'Sommer · Tag'],
  ['winter', 'abend', 'Winter · Abend'],
] as const)('%s am %s heißt „%s“', async (season, daytime, label) => {
  await render(hud({ season, daytime }));

  expect(screen.getByText(label)).toBeOnTheScreen();
});

test('zeigt die eigene Energie mit Symbol und Wort, wie auf „Heute“', async () => {
  await render(hud());

  expect(screen.getByLabelText('23 Energie')).toBeOnTheScreen();
  expect(screen.getByText('23')).toBeOnTheScreen();
  expect(screen.getByText('Energie')).toBeOnTheScreen();
  expect(screen.getByTestId('icon-energy', { includeHiddenElements: true })).toBeOnTheScreen();
});

test('Levelbalken: Level als Abzeichen, eigene Hälfte „Du“ links, Partner rechts, ohne Prozentzahlen nebeneinander', async () => {
  await render(hud());

  const bar = screen.getByRole('progressbar', { name: 'Level 6' });
  expect(bar).toHaveAccessibilityValue({ min: 0, max: 100, now: 100, text: 'Deine Hälfte ist voll' });
  expect(screen.getByText('6')).toBeOnTheScreen();
  expect(screen.getByText('Du')).toBeOnTheScreen();
  expect(screen.getByText('Anna')).toBeOnTheScreen();
  expect(screen.queryByText(/%|Prozent/)).not.toBeOnTheScreen();
  expect(screen.getByTestId('levelbar-eigen')).toHaveStyle({ width: '100%' });
  expect(screen.getByTestId('levelbar-partner')).toHaveStyle({ width: '43%' });
});

test('aus Annas Sicht ist ihre Hälfte die eigene', async () => {
  await render(hud({ viewerPersonId: anna, partnerName: 'Philipp' }));

  expect(screen.getByRole('progressbar', { name: 'Level 6' })).toHaveAccessibilityValue({ now: 43, text: 'Deine Hälfte zu 43 Prozent gefüllt' });
  expect(screen.getByTestId('levelbar-eigen')).toHaveStyle({ width: '43%' });
  expect(screen.getByTestId('levelbar-partner')).toHaveStyle({ width: '100%' });
  expect(screen.getByText('Philipp')).toBeOnTheScreen();
});

test('der Schalter „Bereiche“ zeigt seinen Zustand und schaltet um', async () => {
  const onToggleAreas = jest.fn();
  await render(hud({ onToggleAreas }));

  const toggle = screen.getByRole('switch', { name: 'Bereiche' });
  expect(toggle).not.toBeChecked();
  await userEvent.press(toggle);
  expect(onToggleAreas).toHaveBeenCalledTimes(1);

  await render(hud({ areas: true }));
  expect(screen.getByRole('switch', { name: 'Bereiche' })).toBeChecked();
});

test('der Schalter hat mindestens 48 × 48 dp Trefferfläche', async () => {
  await render(hud());

  const area = hitArea(screen.getByRole('switch', { name: 'Bereiche' }));
  expect(area.width).toBeGreaterThanOrEqual(48);
  expect(area.height).toBeGreaterThanOrEqual(48);
});

test('der Levelbalken öffnet „So wächst Momo“ und sagt das sichtbar an (#184)', async () => {
  const onLevelPress = jest.fn();
  await render(hud({ onLevelPress }));

  expect(screen.getByText('So wächst Momo')).toBeOnTheScreen();
  await userEvent.press(screen.getByRole('progressbar', { name: 'Level 6' }));
  expect(onLevelPress).toHaveBeenCalledTimes(1);
});

test('ohne Handler bleibt der Levelbalken reine Anzeige', async () => {
  await render(hud());

  expect(screen.queryByText('So wächst Momo')).not.toBeOnTheScreen();
});
