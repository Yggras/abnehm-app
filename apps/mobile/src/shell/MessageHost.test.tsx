import { act, renderHook, screen, userEvent } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AccessibilityInfo } from 'react-native';
import type * as ZodModule from 'zod';

import { withDeviceConfig } from '../design/testing/device-config';
import { hitArea } from '../design/testing/hit-area';
import type * as MessageTextsModule from './message-texts';
import { MessageHostProvider, MessageSlot, useMessageHost, type Message } from './MessageHost';

// Der eine Meldungs-Host über der Tab-Leiste (Spezifikation 0, Abschnitt 6), geprüft über
// `showMessage` und die gezeigte Meldung: Standzeit, Ansage, „Rückgängig“ und die Regeln für
// mehrere Meldungen. Die Texte der Bereiche kommen hier aus Testeinträgen.

jest.mock('./message-texts', () => {
  const actual = jest.requireActual<typeof MessageTextsModule>('./message-texts');
  const { z: zod } = jest.requireActual<typeof ZodModule>('zod');
  return {
    ...actual,
    messageTexts: {
      ...actual.messageTexts,
      'test.wasser': actual.messageText(zod.strictObject({ ml: zod.int() }), ({ ml }) => ({ text: `+${ml} ml Wasser` })),
      'test.essen': actual.messageText(zod.strictObject({}), () => ({ text: 'Frühstück gespeichert' })),
      'test.wasserziel': actual.messageText(zod.strictObject({}), () => ({
        text: 'Wasserziel erfüllt · +1 Energie',
        energy: true,
      })),
      'test.bonus': actual.messageText(zod.strictObject({}), () => ({ text: 'Alle drei geschafft · +1 Energie', energy: true })),
      'test.gespeichert': actual.messageText(zod.strictObject({}), () => ({ text: 'Eintrag gespeichert' })),
      'test.gestern_und_heute': actual.messageText(zod.strictObject({}), () => [
        { text: 'Gestern im Kalorienbudget · +1 Energie', energy: true },
        { text: 'Wasserziel erfüllt · +1 Energie', energy: true },
      ]),
    },
  };
});

const dwell = 5_000;
const screenReaderDwell = 10_000;

let showMessage: (message: Message) => void;

function Host({ children }: { children: ReactNode }) {
  return (
    <MessageHostProvider>
      {children}
      <MessageSlot />
    </MessageHostProvider>
  );
}

const user = userEvent.setup({ advanceTimers: (ms) => jest.advanceTimersByTime(ms) });

let announce: jest.SpyInstance;

beforeEach(() => {
  jest.useFakeTimers();
  announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
  jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
});

afterEach(() => {
  jest.useRealTimers();
  // Die React-Native-Jest-Umgebung mockt AccessibilityInfo schon; `restoreAllMocks` leert diese Mocks nicht.
  jest.clearAllMocks();
  jest.restoreAllMocks();
});

async function renderHost() {
  const { result } = await renderHook(() => useMessageHost(), { wrapper: Host });
  showMessage = result.current.showMessage;
}

async function show(message: Message) {
  await act(async () => showMessage(message));
}

async function wait(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

const undoButton = () => screen.queryByRole('button', { name: 'Rückgängig' });
const water = (undo = { run: jest.fn(), expire: jest.fn() }) => ({ messageKey: 'test.wasser', values: { ml: 250 }, undo });

describe('eine Meldung', () => {
  test('mit „Rückgängig“ bleibt die volle Standzeit von 5 s stehen und verschwindet dann', async () => {
    await renderHost();
    const message = water();

    await show(message);
    expect(screen.getByText('+250 ml Wasser')).toBeOnTheScreen();
    expect(undoButton()).toBeOnTheScreen();

    await wait(dwell - 1);
    expect(screen.getByText('+250 ml Wasser')).toBeOnTheScreen();

    await wait(1);
    expect(screen.queryByText('+250 ml Wasser')).not.toBeOnTheScreen();
    expect(message.undo.expire).toHaveBeenCalledTimes(1);
    expect(message.undo.run).not.toHaveBeenCalled();
  });

  test('ohne „Rückgängig“ ist eine reine Bestätigung ohne Button', async () => {
    await renderHost();

    await show({ messageKey: 'test.gespeichert', values: {} });

    expect(screen.getByText('Eintrag gespeichert')).toBeOnTheScreen();
    expect(undoButton()).not.toBeOnTheScreen();
    await wait(dwell);
    expect(screen.queryByText('Eintrag gespeichert')).not.toBeOnTheScreen();
  });

  test('der Screenreader sagt die Meldung einmal an', async () => {
    await renderHost();

    await show(water());

    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith('+250 ml Wasser');
  });

  test('mit Screenreader bleibt die Meldung länger stehen', async () => {
    jest.mocked(AccessibilityInfo.isScreenReaderEnabled).mockResolvedValue(true);
    await renderHost();

    await show(water());
    await wait(dwell);
    expect(screen.getByText('+250 ml Wasser')).toBeOnTheScreen();

    await wait(screenReaderDwell - dwell);
    expect(screen.queryByText('+250 ml Wasser')).not.toBeOnTheScreen();
  });

  test('„Rückgängig“ ruft das Undo genau einmal auf und schließt die Meldung, auch bei Doppeltipp', async () => {
    await renderHost();
    const message = water();
    await show(message);

    const button = undoButton()!;
    await user.press(button);
    await user.press(button);

    expect(message.undo.run).toHaveBeenCalledTimes(1);
    expect(message.undo.expire).not.toHaveBeenCalled();
    expect(screen.queryByText('+250 ml Wasser')).not.toBeOnTheScreen();
  });

  test('„Rückgängig“ hat mindestens 48 × 48 dp', async () => {
    await renderHost();
    await show(water());

    const area = hitArea(undoButton()!);
    expect(area.width).toBeGreaterThanOrEqual(48);
    expect(area.height).toBeGreaterThanOrEqual(48);
  });
});

describe('mehrere Meldungen', () => {
  test('eine Meldung ohne „Rückgängig“ kommt als zweite Zeile dazu, „Rückgängig“ bleibt und die Standzeit beginnt neu', async () => {
    await renderHost();
    const message = water();
    await show(message);
    await wait(4_000);

    await show({ messageKey: 'test.wasserziel', values: {} });

    expect(screen.getByText('+250 ml Wasser')).toBeOnTheScreen();
    expect(screen.getByText('Wasserziel erfüllt · +1 Energie')).toBeOnTheScreen();
    expect(screen.getByTestId('icon-energy', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(undoButton()).toBeOnTheScreen();
    await wait(dwell - 1);
    expect(undoButton()).toBeOnTheScreen();
    await wait(1);
    expect(screen.queryByText('+250 ml Wasser')).not.toBeOnTheScreen();
    expect(message.undo.expire).toHaveBeenCalledTimes(1);
  });

  test('jede weitere solche Meldung ersetzt die zweite Zeile', async () => {
    await renderHost();
    await show(water());
    await show({ messageKey: 'test.wasserziel', values: {} });

    await show({ messageKey: 'test.bonus', values: {} });

    expect(screen.getByText('+250 ml Wasser')).toBeOnTheScreen();
    expect(screen.queryByText('Wasserziel erfüllt · +1 Energie')).not.toBeOnTheScreen();
    expect(screen.getByText('Alle drei geschafft · +1 Energie')).toBeOnTheScreen();
    expect(undoButton()).toBeOnTheScreen();
  });

  test('„Rückgängig“ nach angehängter Zeile ruft weiterhin das Undo der ersten Meldung auf', async () => {
    await renderHost();
    const message = water();
    await show(message);
    await show({ messageKey: 'test.wasserziel', values: {} });

    await user.press(undoButton()!);

    expect(message.undo.run).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Wasserziel erfüllt · +1 Energie')).not.toBeOnTheScreen();
  });

  test('eine neue Meldung mit „Rückgängig“ ersetzt die bisherige, deren Undo verfällt', async () => {
    await renderHost();
    const first = water();
    const second = { messageKey: 'test.essen', values: {}, undo: { run: jest.fn(), expire: jest.fn() } };
    await show(first);
    await show({ messageKey: 'test.wasserziel', values: {} });

    await show(second);

    expect(screen.queryByText('+250 ml Wasser')).not.toBeOnTheScreen();
    expect(screen.queryByText('Wasserziel erfüllt · +1 Energie')).not.toBeOnTheScreen();
    expect(screen.getByText('Frühstück gespeichert')).toBeOnTheScreen();
    expect(first.undo.expire).toHaveBeenCalledTimes(1);

    await user.press(undoButton()!);
    expect(second.undo.run).toHaveBeenCalledTimes(1);
    expect(first.undo.run).not.toHaveBeenCalled();
  });

  test('ein Tipp auf die ersetzte Meldung ruft deren Undo nicht mehr auf', async () => {
    await renderHost();
    const first = water();
    await show(first);
    const staleButton = undoButton()!;

    await show({ messageKey: 'test.essen', values: {}, undo: { run: jest.fn(), expire: jest.fn() } });
    await act(async () => staleButton.props.onPress?.());

    expect(first.undo.run).not.toHaveBeenCalled();
    expect(screen.getByText('Frühstück gespeichert')).toBeOnTheScreen();
  });

  test('Meldungen ohne „Rückgängig“ ersetzen einander', async () => {
    await renderHost();
    await show({ messageKey: 'test.gespeichert', values: {} });

    await show({ messageKey: 'test.wasserziel', values: {} });

    expect(screen.queryByText('Eintrag gespeichert')).not.toBeOnTheScreen();
    expect(screen.getByText('Wasserziel erfüllt · +1 Energie')).toBeOnTheScreen();
  });

  test('der Screenreader sagt jede neue Zeile einmal an', async () => {
    await renderHost();

    await show(water());
    await show({ messageKey: 'test.wasserziel', values: {} });
    await show({ messageKey: 'test.bonus', values: {} });

    expect(announce.mock.calls).toEqual([
      ['+250 ml Wasser'],
      ['Wasserziel erfüllt · +1 Energie'],
      ['Alle drei geschafft · +1 Energie'],
    ]);
  });
});

// Eine Meldung ohne „Rückgängig“ darf selbst zwei Zeilen tragen, etwa Momos Reaktion auf gestern und
// heute (#188, https://github.com/Yggras/abnehm-app/issues/188#issuecomment-6986767756).
describe('zweizeilige Meldung', () => {
  const twoLines = { messageKey: 'test.gestern_und_heute', values: {} };

  test('zeigt beide Zeilen mit ihrem Energiesymbol, ohne „Rückgängig“, und sagt beide an', async () => {
    await renderHost();

    await show(twoLines);

    expect(screen.getByText('Gestern im Kalorienbudget · +1 Energie')).toBeOnTheScreen();
    expect(screen.getByText('Wasserziel erfüllt · +1 Energie')).toBeOnTheScreen();
    expect(screen.getAllByTestId('icon-energy', { includeHiddenElements: true })).toHaveLength(2);
    expect(undoButton()).not.toBeOnTheScreen();
    expect(announce.mock.calls).toEqual([['Gestern im Kalorienbudget · +1 Energie'], ['Wasserziel erfüllt · +1 Energie']]);
    await wait(dwell);
    expect(screen.queryByText('Wasserziel erfüllt · +1 Energie')).not.toBeOnTheScreen();
  });

  test('an eine Meldung mit „Rückgängig“ hängt der Host nur ihre letzte Zeile an', async () => {
    await renderHost();
    const message = water();
    await show(message);

    await show(twoLines);

    expect(screen.getByText('+250 ml Wasser')).toBeOnTheScreen();
    expect(screen.getByText('Wasserziel erfüllt · +1 Energie')).toBeOnTheScreen();
    expect(screen.queryByText('Gestern im Kalorienbudget · +1 Energie')).not.toBeOnTheScreen();
    expect(undoButton()).toBeOnTheScreen();
    expect(announce.mock.calls.at(-1)).toEqual(['Wasserziel erfüllt · +1 Energie']);
  });
});

describe('Texte', () => {
  const runtime = globalThis as unknown as { __DEV__: boolean };
  const developmentBuild = runtime.__DEV__;
  afterEach(() => {
    runtime.__DEV__ = developmentBuild;
  });

  test('im Development Build zeigt ein unbekannter Schlüssel einen Hinweis statt eines Textes', async () => {
    await renderHost();

    await show({ messageKey: 'gibt.es.nicht', values: {} });

    expect(screen.getByText('Text fehlt: gibt.es.nicht')).toBeOnTheScreen();
  });

  test('ungültige Werte zu einem Schlüssel sind ebenfalls ein fehlender Text', async () => {
    await renderHost();

    await show({ messageKey: 'test.wasser', values: { ml: 'viel' } });

    expect(screen.getByText('Text fehlt: test.wasser')).toBeOnTheScreen();
  });

  test('im Release ist ein unbekannter Schlüssel ein Integrationsfehler', async () => {
    await renderHost();
    runtime.__DEV__ = false;

    expect(() => showMessage({ messageKey: 'gibt.es.nicht', values: {} })).toThrow(
      'Integrationsfehler: Für die Meldung gibt.es.nicht fehlt der Text.',
    );
  });
});

describe('Schriftfaktor 2,0', () => {
  withDeviceConfig('schriftfaktor-2');

  test('beide Zeilen und „Rückgängig“ bleiben sichtbar und bedienbar', async () => {
    await renderHost();
    const message = water();
    await show(message);
    await show({ messageKey: 'test.wasserziel', values: {} });

    expect(screen.getByText('+250 ml Wasser')).toBeOnTheScreen();
    expect(screen.getByText('Wasserziel erfüllt · +1 Energie')).toBeOnTheScreen();
    await user.press(undoButton()!);
    expect(message.undo.run).toHaveBeenCalledTimes(1);
  });
});
