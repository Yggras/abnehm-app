import { render, screen, userEvent } from '@testing-library/react-native';
import { Dimensions, StyleSheet } from 'react-native';

import { withDeviceConfig } from '../design/testing/device-config';
import { hitArea } from '../design/testing/hit-area';
import type { IslandHalves } from './halves';
import { IslandHud, type IslandHudProps } from './IslandHud';

// HUD des Tabs „Momo“ (Spezifikation 4, Abschnitt 7): Jahreszeit mit Tageszeit, eigene Energie,
// Levelbalken und Schalter „Bereiche“. Der Levelbalken entspricht dem Vertrags-Fixture „Level 6, eigene
// Hälfte voll“ aus Philipps Sicht: Philipp 100 %, Anna 43 %, Momo wartet auf Anna.

const half = (halfPercent: number) => ({ halfPercent, halfFull: halfPercent === 100 });
const philippsSicht: IslandHalves = { level: 6, own: half(100), partner: half(43), waitingForPartner: true };
const annasSicht: IslandHalves = { level: 6, own: half(43), partner: half(100), waitingForPartner: false };

const hud = (overrides: Partial<IslandHudProps> = {}) => (
  <IslandHud
    season="herbst"
    daytime="tag"
    energy={23}
    halves={philippsSicht}
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
  await render(hud({ halves: annasSicht, partnerName: 'Philipp' }));

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

test('ist die eigene Hälfte voll, wartet Momo neutral auf den Partner, ohne zu sagen, was ihm fehlt (#191)', async () => {
  await render(hud());

  expect(screen.getByText('Deine Hälfte ist voll – Momo wartet auf Anna')).toBeOnTheScreen();
  expect(screen.queryByText(/fehlt|noch \d/i)).not.toBeOnTheScreen();
});

test('ohne volle eigene Hälfte steht kein Wartetext', async () => {
  await render(hud({ halves: annasSicht, partnerName: 'Philipp' }));

  expect(screen.queryByText(/wartet auf/)).not.toBeOnTheScreen();
});

describe('große Schrift (Impeccable-Prüfung, B12)', () => {
  const ownLine = () => StyleSheet.flatten(screen.getByTestId('hud-jahreszeit').props.style) ?? {};
  /** Schriftfaktor für die Tests eines `describe`; danach wieder wie vorher, nachdem das HUD abgebaut ist. */
  const atFontScale = (fontScale: number) => {
    const initial = { window: Dimensions.get('window'), screen: Dimensions.get('screen') };
    beforeEach(() => Dimensions.set({ window: { ...initial.window, fontScale }, screen: { ...initial.screen, fontScale } }));
    afterEach(() => {
      screen.unmount();
      Dimensions.set(initial);
    });
  };

  describe('Schriftfaktor 1,0', () => {
    atFontScale(1);

    test('steht alles in einer Zeile', async () => {
      await render(hud());

      expect(ownLine()).not.toHaveProperty('flexBasis');
    });
  });

  describe('ab Schriftfaktor 1,3', () => {
    atFontScale(1.3);

    test('bricht das HUD in zwei Zeilen um: Jahreszeit oben, Energie und „Bereiche“ darunter', async () => {
      await render(hud());

      expect(ownLine()).toMatchObject({ flexBasis: '100%' });
      expect(screen.getByLabelText('23 Energie')).toBeOnTheScreen();
      expect(screen.getByRole('switch', { name: 'Bereiche' })).toBeOnTheScreen();
    });
  });

  describe('Schriftfaktor 2,0', () => {
    withDeviceConfig('schriftfaktor-2');

    test('bleibt zweizeilig, der Schalter behält seine 48 dp', async () => {
      await render(hud());

      expect(ownLine()).toMatchObject({ flexBasis: '100%' });
      const area = hitArea(screen.getByRole('switch', { name: 'Bereiche' }));
      expect(Math.min(area.width, area.height)).toBeGreaterThanOrEqual(48);
    });
  });
});
