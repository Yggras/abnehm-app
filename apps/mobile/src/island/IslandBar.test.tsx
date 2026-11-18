import { render, screen, userEvent, within } from '@testing-library/react-native';

import { textScale } from '../design';
import { withDeviceConfig } from '../design/testing/device-config';
import { hitArea } from '../design/testing/hit-area';
import { BuildModeBar, IslandBar } from './IslandBar';

// Untere Leiste des Tabs „Momo“ (Spezifikation 4, Abschnitt 7): Lager · Projekt · Bauen · Ereignisse
// als Einstiege für die späteren Tickets.

test('vier Einstiege in fester Reihenfolge; jeder meldet seine Ansicht', async () => {
  const onOpen = jest.fn();
  await render(<IslandBar onOpen={onOpen} />);

  const buttons = screen.getAllByRole('button');
  expect(buttons.map((button) => button.props.accessibilityLabel)).toEqual(['Lager', 'Projekt', 'Bauen', 'Ereignisse']);

  for (const name of ['Lager', 'Projekt', 'Bauen', 'Ereignisse']) await userEvent.press(screen.getByRole('button', { name }));
  expect(onOpen.mock.calls).toEqual([['lager'], ['projekt'], ['bauen'], ['ereignisse']]);
});

test('jeder Einstieg hat mindestens 48 × 48 dp Trefferfläche', async () => {
  await render(<IslandBar onOpen={jest.fn()} />);

  const tooSmall = screen.getAllByRole('button').map(hitArea).filter((area) => area.width < 48 || area.height < 48);
  expect(tooSmall).toEqual([]);
});

describe('große Schrift (Impeccable-Prüfung, B12)', () => {
  withDeviceConfig('schriftfaktor-2');

  test('die Beschriftungen wachsen wie `tab-label` höchstens bis Faktor 1,3, das Icon trägt die Bedeutung mit', async () => {
    await render(<IslandBar onOpen={jest.fn()} />);

    expect(textScale.limit.tabLabel).toBe(1.3);
    for (const [name, icon] of [['Lager', 'box'], ['Projekt', 'flag'], ['Bauen', 'hammer'], ['Ereignisse', 'star']] as const) {
      const entry = screen.getByRole('button', { name });
      expect(within(entry).getByText(name)).toHaveProp('maxFontSizeMultiplier', textScale.limit.tabLabel);
      expect(within(entry).getByTestId(`icon-${icon}`, { includeHiddenElements: true })).toBeTruthy();
    }
  });
});

describe('Bau-Leiste im Bau-Modus (#192)', () => {
  test('sagt, was gebaut wird, wie es geht, und bietet „Abbrechen“ mit 48 dp', async () => {
    const onCancel = jest.fn();
    await render(<BuildModeBar name="Laterne" onCancel={onCancel} />);

    expect(screen.getByLabelText('Laterne bauen. Tippe auf ein leuchtendes Feld.')).toBeOnTheScreen();
    const cancel = screen.getByRole('button', { name: 'Abbrechen' });
    expect(hitArea(cancel).height).toBeGreaterThanOrEqual(48);
    await userEvent.press(cancel);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
