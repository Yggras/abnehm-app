/// <reference types="expo-router/build/ts-declarations/expect" />
import { act, screen, userEvent, within } from '@testing-library/react-native';
import { Dimensions } from 'react-native';
import { renderRouter, testRouter } from 'expo-router/testing-library';

import { EntityId } from '@abnehm/contracts/base';
import { RouteName, type RouteTarget } from '@abnehm/contracts/routes';

import { hitArea } from '../design/testing/hit-area';
import { textScale } from '../design/tokens';
import { hrefFor, openTarget, routeCatalog } from '../navigation';
import { useMomoTabBadge } from './tab-badge';
import { titleOf } from './texts';

// Die App-Shell mit dem echten Verzeichnis `src/app`: Tabs, ＋-Sheet, Routenkatalog, Deep Links
// und Platzhalter. Jest läuft in `apps/mobile`, deshalb ist der Pfad relativ dazu.
const appDir = 'src/app';

jest.mock('../design/native/Sheet', () => jest.requireActual('../design/testing/inline-sheet'));
jest.mock('./tab-badge', () => ({ useMomoTabBadge: jest.fn() }));

beforeEach(() => {
  jest.mocked(useMomoTabBadge).mockReturnValue(false);
});

const id = EntityId.parse('0b9f4a1e-6c1d-4f7b-9a51-2f3d8c7e1a10');

/** Ein Ziel je Route des Katalogs, dazu jede Einstellungsseite. */
const targets: RouteTarget[] = [
  { type: 'today' },
  { type: 'log' },
  { type: 'capture.food', meal: 'abendessen' },
  { type: 'capture.water' },
  { type: 'capture.sport', newEntry: true },
  { type: 'capture.weight', newEntry: true },
  { type: 'momo', view: 'lager' },
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

async function open(target: RouteTarget) {
  await act(async () => openTarget(target));
}

describe('Tab-Leiste', () => {
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
    for (const option of ['Essen', 'Wasser', 'Sport', 'Gewicht']) {
      expect(screen.getByRole('button', { name: option })).toBeOnTheScreen();
    }
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

describe('Routenkatalog', () => {
  test('die Ziele decken jede Route ab', () => {
    expect(new Set(targets.map((target) => target.type))).toEqual(new Set(RouteName.options));
  });

  test.each(targets)('$type $section ist erreichbar, und System-Zurück führt zum Aufrufer', async (target) => {
    await renderRouter(appDir, { initialUrl: '/momo' });

    await open(target);
    const href = hrefFor(target);
    expect(screen).toHavePathname(href.pathname);
    expect(screen).toHaveSearchParams(href.params);
    expect(await heading(titleOf(target))).toBeOnTheScreen();

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
    expect(await heading(title)).toBeOnTheScreen();
  });

  test.each([
    ['unbekanntes Ziel', '/capture/steps'],
    ['unbekannte Einstellungsseite', '/settings/privacy'],
    ['unbekannte Ansicht', '/momo?view=shop'],
    ['fremder Parameter', '/log?view=projekt'],
    ['Pflichtparameter fehlt', '/challenge/detail'],
    ['keine UUID', '/plan/budget_suggestion?suggestionId=abc'],
    ['newEntry false', '/capture/sport?newEntry=false'],
  ])('%s öffnet „Heute“', async (_case, url) => {
    await renderRouter(appDir, { initialUrl: url });

    expect(await heading('Heute')).toBeOnTheScreen();
    expect(screen).toHavePathname('/');
  });

  test('ein modaler Ablauf aus einem Deep Link schließt mit „Fertig“ zu „Heute“', async () => {
    await renderRouter(appDir, { initialUrl: '/partner/redeem' });

    expect(await heading('Code eingeben')).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Fertig' }));
    expect(screen).toHavePathname('/');
  });

  test('System-Zurück aus einem Deep Link führt zu „Heute“', async () => {
    await renderRouter(appDir, { initialUrl: '/onboarding' });

    expect(await heading('Einrichtung')).toBeOnTheScreen();
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
      expect(name).toMatch(/^[A-ZÄÖÜ][\p{L} ,&-]+$/u);
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
  const initial = { window: Dimensions.get('window'), screen: Dimensions.get('screen') };

  beforeEach(() => {
    Dimensions.set({ window: { ...initial.window, fontScale: 2 }, screen: { ...initial.screen, fontScale: 2 } });
  });

  afterEach(() => {
    Dimensions.set(initial);
  });

  test('die Hauptaufgabe bleibt bedienbar: Tab wechseln, über ＋ erfassen, mit „Fertig“ zurück', async () => {
    await renderRouter(appDir, { initialUrl: '/' });

    await user.press(screen.getByRole('tab', { name: 'Momo' }));
    expect(await heading('Momo')).toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Erfassen' }));
    await user.press(await screen.findByRole('button', { name: 'Gewicht' }));
    expect(screen).toHavePathname('/capture/weight');
    expect(await heading('Gewicht')).toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Fertig' }));
    expect(screen).toHavePathname('/momo');
  });
});
