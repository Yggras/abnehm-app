/// <reference types="expo-router/build/ts-declarations/expect" />
import { act, fireEvent, screen, userEvent, within } from '@testing-library/react-native';
import { renderRouter, testRouter } from 'expo-router/testing-library';
import type * as ZodModule from 'zod';

import { EntityId, type BausteinKey } from '@abnehm/contracts/base';
import { RouteName, type RouteTarget } from '@abnehm/contracts/routes';

import { withDeviceConfig } from '../design/testing/device-config';
import { hitArea } from '../design/testing/hit-area';
import { appGameService } from '../island/app-game-service';
import { fakeGameService } from '../island/testing/fake-game-service';
import { hatchedStage } from '../island/testing/hatched-stage';
import { textScale } from '../design/tokens';
import { hrefFor, openTarget, routeCatalog } from '../navigation';
import type * as MessageTextsModule from './message-texts';
import { useMessageHost, type MessageHost } from './MessageHost';
import * as quickCommands from './quick-commands';
import { screenScrollId } from './ScreenFrame';
import { useMomoTabBadge } from './tab-badge';
import { titleOf } from './texts';

// Die App-Shell mit dem echten Verzeichnis `src/app`: Tabs, ＋-Sheet, Routenkatalog, Deep Links
// und Platzhalter. Jest läuft in `apps/mobile`, deshalb ist der Pfad relativ dazu.
const appDir = 'src/app';

// Der erste Test lädt das ganze App-Verzeichnis; auf dem CI-Runner dauert das länger als Jests 5 s.
jest.setTimeout(30_000);

jest.mock('../design/native/Sheet', () => jest.requireActual('../design/testing/inline-sheet'));
// Die Fachoberfläche hinter der Sitzungs-Weiche; ihre Zustände prüft SessionGate.test.tsx.
jest.mock('../session/use-session-gate', () => jest.requireActual('../session/testing/test-gate'));
jest.mock('./tab-badge', () => ({ useMomoTabBadge: jest.fn() }));

// Den echten Handler für `water.quick_add` und seinen Text liefert Spezifikation 3; bis dahin
// belegen ein Test-Handler über einer Test-Datenbank und ein Testtext den Ablauf.
const mockQuickCommands: { handler?: quickCommands.QuickCommandHandler<'water.quick_add'> } = {};
jest.mock('./app-quick-commands', () => {
  const { createQuickCommandRegistry } = jest.requireActual<typeof quickCommands>('./quick-commands');
  const tx = { afterCommit() {} };
  const database = { accountId: 'konto_a', transaction: (work: (context: unknown) => unknown) => work(tx) };
  const appQuickCommands = createQuickCommandRegistry();
  appQuickCommands.opened(database as never, {
    get 'water.quick_add'() {
      return mockQuickCommands.handler;
    },
  });
  return { appQuickCommands };
});
jest.mock('./message-texts', () => {
  const actual = jest.requireActual<typeof MessageTextsModule>('./message-texts');
  const { z } = jest.requireActual<typeof ZodModule>('zod');
  return {
    ...actual,
    messageTexts: {
      ...actual.messageTexts,
      'test.wasser': actual.messageText(z.strictObject({ ml: z.int() }), ({ ml }) => ({ text: `+${ml} ml Wasser` })),
    },
  };
});

let execute: jest.Mock;
let undo: jest.Mock;
let closeIsland: () => void = () => {};

// Der Tab „Momo“ zeigt die geschlüpfte Insel; Laichkugel und Rollenwahl prüft `island/MomoTab.test.tsx`.
beforeEach(() => {
  closeIsland = appGameService.opened(fakeGameService(hatchedStage()));
  jest.mocked(useMomoTabBadge).mockReturnValue(false);
  execute = jest.fn((_tx: unknown, { ml }: { ml: number }) => ({ messageKey: 'test.wasser', values: { ml }, undoData: 'eintrag-1' }));
  undo = jest.fn();
  mockQuickCommands.handler = quickCommands.quickCommandHandler<'water.quick_add', string>({ execute, undo });
});

afterEach(() => closeIsland());

const id = EntityId.parse('0b9f4a1e-6c1d-4f7b-9a51-2f3d8c7e1a10');

/** Ein Ziel je Route des Katalogs, dazu jede Einstellungsseite. */
const targets: RouteTarget[] = [
  { type: 'today' },
  { type: 'log' },
  { type: 'capture.food', meal: 'abendessen' },
  { type: 'capture.water' },
  { type: 'capture.sport', newEntry: true },
  { type: 'capture.weight', newEntry: true },
  { type: 'momo', view: 'projekt' },
  { type: 'challenge.propose' },
  { type: 'challenge.detail', challengeId: id },
  { type: 'partner', focus: 'received_encouragement' },
  { type: 'partner.invite' },
  { type: 'partner.redeem' },
  { type: 'partner.encourage' },
  { type: 'notifications.permission' },
  { type: 'settings' },
  { type: 'settings', section: 'goals' },
  { type: 'settings', section: 'weekly_plan' },
  { type: 'settings', section: 'partner_sharing' },
  { type: 'settings', section: 'notifications' },
  { type: 'settings', section: 'health' },
  { type: 'settings', section: 'account' },
  { type: 'onboarding' },
  { type: 'plan.budget_suggestion', suggestionId: id },
  { type: 'plan.goal_reached' },
];

const user = userEvent.setup();

const heading = (title: string) => screen.findByRole('header', { name: title });

/**
 * Woran man einen Bildschirm erkennt: seine Titelzeile. Der Tab „Momo“ ist die bildschirmfüllende
 * Insel ohne Titelzeile (#182), hier die geschlüpfte Insel aus `island/testing/hatched-stage.ts` (#184).
 */
const landmark = (title: string) =>
  title === 'Momo' ? screen.findByRole('image', { name: /^Momos Insel/ }) : heading(title);

async function open(target: RouteTarget) {
  await act(async () => openTarget(target));
}

describe('Tab-Leiste', () => {
  test('Heute, andere Tabs und Bereichsseiten besitzen Pull-to-Refresh', async () => {
    await renderRouter(appDir, { initialUrl: '/' });
    const canRefresh = () => screen.getAllByTestId(screenScrollId).some((node) => node.props.refreshControl != null);
    expect(canRefresh()).toBe(true);
    await user.press(screen.getByRole('tab', { name: 'Protokoll' }));
    expect(canRefresh()).toBe(true);
    await open({ type: 'settings' });
    expect(canRefresh()).toBe(true);
  });
  test('zeigt Heute · Protokoll · ＋ · Momo · Wir und wechselt die Tabs', async () => {
    await renderRouter(appDir, { initialUrl: '/' });

    const bar = screen.getByTestId('tab-bar');
    const names = within(bar)
      .getAllByRole(/^(tab|button)$/)
      .map((element) => element.props.accessibilityLabel as string);
    expect(names).toEqual(['Heute', 'Protokoll', 'Erfassen', 'Momo', 'Wir']);
    expect(screen.getByRole('tab', { name: 'Heute' })).toBeSelected();

    await user.press(screen.getByRole('tab', { name: 'Protokoll' }));
    expect(screen).toHavePathname('/log');
    expect(await heading('Protokoll')).toBeOnTheScreen();
    expect(screen.getByRole('tab', { name: 'Protokoll' })).toBeSelected();
    expect(screen.getByRole('tab', { name: 'Heute' })).not.toBeSelected();

    await user.press(screen.getByRole('tab', { name: 'Momo' }));
    expect(screen).toHavePathname('/momo');
    await user.press(screen.getByRole('tab', { name: 'Wir' }));
    expect(screen).toHavePathname('/partner');
    await user.press(screen.getByRole('tab', { name: 'Heute' }));
    expect(screen).toHavePathname('/');
  });

  test('das ＋ öffnet das Sheet, ohne zu navigieren', async () => {
    await renderRouter(appDir, { initialUrl: '/momo' });

    expect(screen.queryByRole('header', { name: 'Was möchtest du erfassen?' })).not.toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Erfassen' }));

    expect(await heading('Was möchtest du erfassen?')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Erfassen' })).toBeExpanded();
    expect(screen).toHavePathname('/momo');
    const options = within(screen.getByTestId('sheet'))
      .getAllByRole('button')
      .map((element) => within(element).getAllByText(/./).map((text) => text.props.children as string).join(' '));
    expect(options).toEqual(['+250 ml Wasser', 'Essen', 'Wasser', 'Sport', 'Gewicht']);
  });

  test.each([
    ['Essen', '/capture/food', {}],
    ['Wasser', '/capture/water', {}],
    ['Sport', '/capture/sport', { newEntry: 'true' }],
    ['Gewicht', '/capture/weight', { newEntry: 'true' }],
  ])('＋ → „%s“ schließt das Sheet, öffnet %s und kehrt zum Aufrufer zurück', async (option, pathname, params) => {
    await renderRouter(appDir, { initialUrl: '/log' });

    await user.press(screen.getByRole('button', { name: 'Erfassen' }));
    await user.press(await screen.findByRole('button', { name: option }));

    expect(screen).toHavePathname(pathname);
    expect(screen).toHaveSearchParams(params);
    expect(await heading(option)).toBeOnTheScreen();
    expect(screen.queryByRole('header', { name: 'Was möchtest du erfassen?' })).not.toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Fertig' }));
    expect(screen).toHavePathname('/log');
  });
});

describe('Quick-Commands und Meldungen', () => {
  const wasserMeldung = () => screen.queryByText('+250 ml Wasser', { exact: true });
  const quickAdd = async () => {
    await user.press(screen.getByRole('button', { name: 'Erfassen' }));
    await user.press(await screen.findByRole('button', { name: '+250 ml Wasser' }));
  };

  test('Heute-Vorschau bucht Wasser über den Mini-Tracker ohne Navigation und öffnet Sport/Gewicht über Routen', async () => {
    await renderRouter(appDir, { initialUrl: '/' });
    await user.press(screen.getByRole('button', { name: 'Beispieldaten anzeigen' }));
    expect(screen.getByRole('image', { name: 'Momo, Hüpfer, zufrieden' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: /Anna feuert dich an: Stark heute!/ })).toBeOnTheScreen();
    for (const name of ['Ernährung erfasst · 2 von 2 Mahlzeiten, erfüllt. Öffnen', 'Wasserziel · 0,8 von 1,5 l, teilweise. Öffnen', 'Im Kalorienbudget · am Tagesende. Öffnen']) {
      expect(screen.getByRole('button', { name })).toBeOnTheScreen();
    }
    await user.press(screen.getByRole('button', { name: 'Wasser: +250 ml' }));
    expect(execute).toHaveBeenCalledTimes(1);
    expect(screen).toHavePathname('/');
    expect(screen.getByRole('button', { name: 'Rückgängig' })).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Sport: + Einheit' }));
    expect(screen).toHavePathname('/capture/sport');
    expect(screen).toHaveSearchParams({ newEntry: 'true' });
  });

  test('＋ → „+250 ml Wasser“ bucht ohne Navigation, schließt das Sheet und zeigt die Meldung mit „Rückgängig“', async () => {
    await renderRouter(appDir, { initialUrl: '/momo' });

    await quickAdd();

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(expect.anything(), { ml: 250 });
    expect(screen).toHavePathname('/momo');
    expect(screen.queryByRole('header', { name: 'Was möchtest du erfassen?' })).not.toBeOnTheScreen();
    expect(within(screen.getByTestId('message-slot')).getByText('+250 ml Wasser')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Rückgängig' })).toBeOnTheScreen();
  });

  test('„Rückgängig“ ruft genau einmal das Undo des Handlers auf, auch bei Doppeltipp', async () => {
    await renderRouter(appDir, { initialUrl: '/' });
    await quickAdd();

    const button = screen.getByRole('button', { name: 'Rückgängig' });
    await user.press(button);
    await user.press(button);

    expect(undo).toHaveBeenCalledTimes(1);
    expect(undo).toHaveBeenCalledWith(expect.anything(), 'eintrag-1');
    expect(wasserMeldung()).not.toBeOnTheScreen();
  });

  test('ohne Handler zeigt der Development Build einen Platzhalter-Hinweis statt zu buchen', async () => {
    mockQuickCommands.handler = undefined;
    await renderRouter(appDir, { initialUrl: '/log' });

    await quickAdd();

    expect(screen.getByText('Dieser Bereich ist noch in Arbeit. Kommt mit: Wasser, Sport, Gewicht & Health')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Rückgängig' })).not.toBeOnTheScreen();
    expect(screen).toHavePathname('/log');
  });

  test('scheitert die Buchung, zeigt der Host eine Meldung ohne „Rückgängig“', async () => {
    const report = jest.spyOn(console, 'error').mockImplementation(() => {});
    execute.mockImplementation(() => {
      throw new Error('Fachfehler');
    });
    await renderRouter(appDir, { initialUrl: '/' });

    await quickAdd();

    expect(screen.getByText('Das hat nicht geklappt. Versuch es bitte noch einmal.')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Rückgängig' })).not.toBeOnTheScreen();
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ message: 'Fachfehler' }));
    report.mockRestore();
  });

  test('scheitert das Undo, zeigt der Host eine Meldung ohne „Rückgängig“', async () => {
    const report = jest.spyOn(console, 'error').mockImplementation(() => {});
    undo.mockImplementation(() => {
      throw new Error('Fachfehler');
    });
    await renderRouter(appDir, { initialUrl: '/' });
    await quickAdd();

    await user.press(screen.getByRole('button', { name: 'Rückgängig' }));

    expect(screen.getByText('Das hat nicht geklappt. Versuch es bitte noch einmal.')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Rückgängig' })).not.toBeOnTheScreen();
    report.mockRestore();
  });

  test.each([
    ['einem modalen Ablauf', { type: 'capture.water' }],
    ['einer Seite', { type: 'settings', section: 'goals' }],
  ] as const)('eine Meldung aus %s steht dort, nicht verdeckt über der Tab-Leiste', async (_case, target) => {
    // Der Host ist über allen Routen; die Leiste „Heute“ holt ihn hier für den Test ab.
    let host: MessageHost | undefined;
    jest.mocked(useMomoTabBadge).mockImplementation(() => {
      host = useMessageHost();
      return false;
    });
    const run = jest.fn();
    await renderRouter(appDir, { initialUrl: '/' });
    await open(target);
    await heading(titleOf(target));

    await act(async () => host!.showMessage({ messageKey: 'test.wasser', values: { ml: 250 }, undo: { run } }));

    expect(screen.getAllByTestId('message-slot')).toHaveLength(1);
    expect(screen.getByText('+250 ml Wasser')).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Rückgängig' }));
    expect(run).toHaveBeenCalledTimes(1);
  });

  const today = (goals: readonly BausteinKey[], bonus = false) => ({ goals, bonus, energy: goals.length + (bonus ? 1 : 0) });
  test.each([
    [{ yesterday: null, today: today(['wasserziel']), level: null }, ['Wasserziel erfüllt · +1 Energie']],
    [{ yesterday: null, today: today([], true), level: null }, ['Alle drei geschafft · +1 Energie']],
    // Mehreres aus einem Commit: eine Meldung mit der Summe der Energie.
    [{ yesterday: null, today: today(['sporteinheit'], true), level: null }, ['Alle drei geschafft · +2 Energie']],
    [{ yesterday: null, today: today(['wasserziel', 'gewogen']), level: null }, ['Wasserziel und Gewogen erfüllt · +2 Energie']],
    [{ yesterday: null, today: today(['ernaehrung_erfasst', 'wasserziel', 'gewogen']), level: null }, ['Ernährung erfasst, Wasserziel und Gewogen erfüllt · +3 Energie']],
    [{ yesterday: { bonus: false, energy: 1 }, today: null, level: null }, ['Gestern im Kalorienbudget · +1 Energie']],
    [{ yesterday: { bonus: true, energy: 2 }, today: null, level: null }, ['Gestern im Kalorienbudget, alle drei geschafft · +2 Energie']],
    // Gestern und heute zusammen: zwei Zeilen derselben Meldung, je mit eigenem Betrag.
    [{ yesterday: { bonus: true, energy: 2 }, today: today(['sporteinheit']), level: null }, ['Gestern im Kalorienbudget, alle drei geschafft · +2 Energie', 'Sporteinheit erfüllt · +1 Energie']],
    // Levelaufstieg (#200): eine Zeile; mit Gutschriften aus demselben Commit steht er als zweite Zeile unter ihnen,
    // gestern und heute dann in einer Zeile mit der Summe.
    [{ yesterday: null, today: null, level: 7 }, ['Momo ist jetzt auf Level 7']],
    [{ yesterday: null, today: today(['wasserziel']), level: 2 }, ['Wasserziel erfüllt · +1 Energie', 'Momo ist jetzt auf Level 2']],
    [{ yesterday: { bonus: true, energy: 2 }, today: today(['sporteinheit']), level: 4 }, ['Gestern im Kalorienbudget, alle drei geschafft, heute Sporteinheit erfüllt · +3 Energie', 'Momo ist jetzt auf Level 4']],
    [{ yesterday: { bonus: false, energy: 1 }, today: null, level: 3 }, ['Gestern im Kalorienbudget · +1 Energie', 'Momo ist jetzt auf Level 3']],
  ] as const)('Momos Reaktion %o erscheint als eine Meldung über den Meldungs-Host (#188, #200)', async (reaction, lines) => {
    closeIsland();
    closeIsland = appGameService.opened(fakeGameService(hatchedStage(), [reaction]));
    await renderRouter(appDir, { initialUrl: '/' });

    const slot = await screen.findByTestId('message-slot');
    for (const line of lines) expect(within(slot).getByText(line)).toBeOnTheScreen();
    expect(within(slot).queryByRole('button', { name: 'Rückgängig' })).not.toBeOnTheScreen();
  });

  test('im Release ist ein fehlender Handler ein Integrationsfehler', async () => {
    const runtime = globalThis as unknown as { __DEV__: boolean };
    mockQuickCommands.handler = undefined;
    await renderRouter(appDir, { initialUrl: '/log' });
    await user.press(screen.getByRole('button', { name: 'Erfassen' }));
    const button = await screen.findByRole('button', { name: '+250 ml Wasser' });

    runtime.__DEV__ = false;
    try {
      await expect(fireEvent.press(button)).rejects.toThrow(quickCommands.MissingQuickCommandError);
    } finally {
      runtime.__DEV__ = true;
    }
  });
});

describe('Routenkatalog', () => {
  test('die Ziele decken jede Route ab', () => {
    expect(new Set(targets.map((target) => target.type))).toEqual(new Set(RouteName.options));
  });

  // Das Onboarding ist nur im Zustand `onboarding` der Weiche erreichbar; das prüft SessionGate.test.tsx.
  test.each(targets.filter((target) => target.type !== 'onboarding'))('$type $section ist erreichbar, und System-Zurück führt zum Aufrufer', async (target) => {
    await renderRouter(appDir, { initialUrl: '/momo' });

    await open(target);
    const href = hrefFor(target);
    expect(screen).toHavePathname(href.pathname);
    expect(screen).toHaveSearchParams(href.params);
    expect(await landmark(titleOf(target))).toBeOnTheScreen();

    // Tabs gehen mit System-Zurück zu „Heute“, der ersten Route; von „Heute“ aus verlässt man die App.
    if (target.type === 'today') return;
    const caller = routeCatalog[target.type].presentation === 'tab' ? '/' : '/momo';
    await act(() => testRouter.back());
    expect(screen).toHavePathname(caller);
  });

  test('„Zurück“ auf einer Seite kehrt zum Aufrufer zurück', async () => {
    await renderRouter(appDir, { initialUrl: '/partner' });

    await open({ type: 'settings' });
    await open({ type: 'settings', section: 'account' });
    await user.press(screen.getByRole('button', { name: 'Zurück' }));
    expect(screen).toHavePathname('/settings');
    await user.press(screen.getByRole('button', { name: 'Zurück' }));
    expect(screen).toHavePathname('/partner');
  });
});

describe('Deep Links', () => {
  test.each([
    ['/momo?view=projekt', '/momo', 'Momo'],
    ['/partner?focus=received_encouragement', '/partner', 'Wir'],
    [`/challenge/detail?challengeId=${id}`, '/challenge/detail', 'Challenge'],
    ['/settings/health', '/settings/health', 'Gesundheitsdaten'],
  ])('%s öffnet die Route', async (url, pathname, title) => {
    await renderRouter(appDir, { initialUrl: url });

    expect(screen).toHavePathname(pathname);
    expect(await landmark(title)).toBeOnTheScreen();
  });

  test.each([
    ['unbekanntes Ziel', '/capture/steps'],
    ['unbekannte Einstellungsseite', '/settings/privacy'],
    ['unbekannte Ansicht', '/momo?view=shop'],
    ['fremder Parameter', '/log?view=projekt'],
    ['Pflichtparameter fehlt', '/challenge/detail'],
    ['keine UUID', '/plan/budget_suggestion?suggestionId=abc'],
    ['newEntry false', '/capture/sport?newEntry=false'],
  ])('%s öffnet „Heute“ und sagt, dass es das Ziel nicht mehr gibt', async (_case, url) => {
    await renderRouter(appDir, { initialUrl: url });

    expect(await heading('Heute')).toBeOnTheScreen();
    expect(screen).toHavePathname('/');
    expect(await screen.findByText('Das gibt es nicht mehr.')).toBeOnTheScreen();
  });

  test('ein modaler Ablauf aus einem Deep Link schließt mit „Fertig“ zu „Heute“', async () => {
    await renderRouter(appDir, { initialUrl: '/partner/redeem' });

    expect(await heading('Code eingeben')).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Fertig' }));
    expect(screen).toHavePathname('/');
  });

  test('System-Zurück aus einem Deep Link führt zu „Heute“', async () => {
    await renderRouter(appDir, { initialUrl: '/plan/goal_reached' });

    expect(await heading('Zielgewicht erreicht')).toBeOnTheScreen();
    await act(() => testRouter.back());
    expect(screen).toHavePathname('/');
  });
});

describe('TabBadge', () => {
  test('ohne Quelle zeigt der Tab „Momo“ keinen Punkt', async () => {
    await renderRouter(appDir, { initialUrl: '/' });

    expect(screen.getByRole('tab', { name: 'Momo' })).toBeOnTheScreen();
    expect(screen.queryByTestId('tab-badge')).not.toBeOnTheScreen();
  });

  test('meldet die Quelle Neues, zeigt der Tab „Momo“ einen Punkt mit zugänglichem Hinweis', async () => {
    jest.mocked(useMomoTabBadge).mockReturnValue(true);
    await renderRouter(appDir, { initialUrl: '/' });

    const momo = screen.getByRole('tab', { name: 'Momo, Neues auf der Insel' });
    expect(within(momo).getByTestId('tab-badge')).toBeOnTheScreen();
    expect(screen.getAllByTestId('tab-badge')).toHaveLength(1);
  });
});

describe('Zugänglichkeit', () => {
  const interactiveRoles = ['button', 'tab', 'link', 'switch', 'checkbox', 'radio'];

  async function controlsOn(url: string, openSheet = false) {
    await renderRouter(appDir, { initialUrl: url });
    if (openSheet) await user.press(screen.getByRole('button', { name: 'Erfassen' }));
    await screen.findAllByRole('header');
    return interactiveRoles.flatMap((role) => screen.queryAllByRole(role));
  }

  test.each([
    ['Tab mit ＋-Sheet', '/', true],
    ['Seite', '/settings/goals', false],
    ['modaler Ablauf', '/capture/water', false],
  ])('%s: jede Aktion hat einen deutschen Namen und mindestens 48 × 48 dp', async (_case, url, openSheet) => {
    const controls = await controlsOn(url, openSheet);

    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) {
      const name =
        (control.props.accessibilityLabel as string | undefined) ??
        within(control).getAllByText(/./).map((text) => text.props.children as string).join(' ');
      expect(name).toMatch(/^[+A-ZÄÖÜ][\p{L}\p{N} ,&+-]+$/u);
      const area = hitArea(control);
      expect({ name, fits: area.width >= 48 && area.height >= 48 }).toEqual({ name, fits: true });
    }
  });

  test.each([
    ['Tab mit ＋-Sheet', '/', true],
    ['Seite', '/settings/goals', false],
    ['modaler Ablauf', '/capture/water', false],
  ])('%s: Texte wachsen bis Schriftfaktor 2,0, die Tab-Beschriftung bis 1,3', async (_case, url, openSheet) => {
    await controlsOn(url, openSheet);

    const texts = screen.queryAllByText(/[\s\S]*/, { includeHiddenElements: true });
    expect(texts.length).toBeGreaterThan(3);
    for (const text of texts) {
      expect(text.props.allowFontScaling).not.toBe(false);
      expect([textScale.max, textScale.limit.tabLabel, textScale.limit.display]).toContain(text.props.maxFontSizeMultiplier);
    }
    for (const tab of screen.queryAllByRole('tab', { includeHiddenElements: true })) {
      expect(within(tab).getByText(/./, { includeHiddenElements: true }).props.maxFontSizeMultiplier).toBe(textScale.limit.tabLabel);
    }
  });
});

describe('Schriftfaktor 2,0', () => {
  withDeviceConfig('schriftfaktor-2');

  test('Heute-Vorschau stapelt Momo und Mini-Tracker, deren getrennte Aktionen bedienbar bleiben', async () => {
    await renderRouter(appDir, { initialUrl: '/' });
    await user.press(screen.getByRole('button', { name: 'Beispieldaten anzeigen' }));
    const controls = ['Wasser: +250 ml', 'Sport: + Einheit', 'Gewicht: Eintragen', 'Wasser: 0,8 l von 1,5 l, Unterwegs. Details öffnen'];
    for (const name of controls) {
      const control = screen.getByRole('button', { name });
      const area = hitArea(control);
      expect({ name, fits: area.width >= 48 && area.height >= 48 }).toEqual({ name, fits: true });
    }
    expect(screen.getByText('Deine drei Tagesziele')).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Wasser: +250 ml' }));
    expect(execute).toHaveBeenCalledTimes(1);
  });

  test('Wasser mit einem Tipp erfassen und rückgängig machen bleibt bedienbar', async () => {
    await renderRouter(appDir, { initialUrl: '/' });

    await user.press(screen.getByRole('button', { name: 'Erfassen' }));
    await user.press(await screen.findByRole('button', { name: '+250 ml Wasser' }));
    expect(within(screen.getByTestId('message-slot')).getByText('+250 ml Wasser')).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Rückgängig' }));

    expect(undo).toHaveBeenCalledTimes(1);
  });

  test('die Hauptaufgabe bleibt bedienbar: Tab wechseln, über ＋ erfassen, mit „Fertig“ zurück', async () => {
    await renderRouter(appDir, { initialUrl: '/' });

    await user.press(screen.getByRole('tab', { name: 'Momo' }));
    expect(await landmark('Momo')).toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Erfassen' }));
    await user.press(await screen.findByRole('button', { name: 'Gewicht' }));
    expect(screen).toHavePathname('/capture/weight');
    expect(await heading('Gewicht')).toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Fertig' }));
    expect(screen).toHavePathname('/momo');
  });
});
