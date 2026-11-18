/**
 * @jest-environment ./jest/skia-environment.js
 */
import { MomoMood, type MomoAppearance } from '@abnehm/contracts/island';
import { act, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import { withDeviceConfig } from '../design/testing/device-config';
import type * as mockSkia from '../island/testing/skia-mock';
import { formNames, MomoAppearanceProvider, MomoFigure, moodNames } from './index';

// Nachweis für #187 (und den zugänglichen Namen aus #109): `MomoFigure` zeichnet das Skia-Rig mit dem
// echten Skia-Code (CanvasKit, siehe jest/skia-environment.js), benennt Momo mit Form, Stimmung und
// Accessoires und steht bei „Bewegung reduzieren“ in der Schlüsselpose still.
jest.mock('@shopify/react-native-skia', () => jest.requireActual<typeof mockSkia>('../island/testing/skia-mock').skiaWithCanvasKit());

const moods = MomoMood.options;

const hatched = (formKey: MomoAppearance['formKey'], accessories: MomoAppearance['accessories'] = { kopf: null, hals: null }): MomoAppearance => ({
  stage: 'geschluepft',
  formKey,
  moodKey: 'zufrieden',
  accessories,
});

async function renderFigure(appearance: MomoAppearance | null, mood: MomoMood, size = 104) {
  await render(
    <MomoAppearanceProvider appearance={appearance}>
      <MomoFigure mood={mood} size={size} />
    </MomoAppearanceProvider>,
  );
}

/** Skia-Knoten der Zeichnung; animiert ist, was einen Shared Value als Prop trägt (wie in `rich-island-load.test.tsx`). */
function skiaNodes() {
  const nodes = screen.container.queryAll((node) => node.type.startsWith('sk'));
  const isShared = (value: unknown) => typeof value === 'object' && value !== null && 'value' in value && 'modify' in value;
  return { drawn: nodes.filter((node) => node.type === 'skPath'), animated: nodes.filter((node) => Object.values(node.props).some(isShared)) };
}

describe('zugänglicher Name', () => {
  test('ohne Kopplung oder vor der Rollenwahl beschreibt sie die Laichkugel', async () => {
    await render(<MomoFigure mood="neugierig" size={104} />);
    expect(screen.getByRole('image', { name: 'Momo wartet im Ei' })).toBeOnTheScreen();
  });

  test('nach der Rollenwahl liest sie Form und Accessoires selbst statt aus Figure-Props', async () => {
    await renderFigure(hatched('huepfer', { kopf: 'strohhuetchen', hals: null }), 'freut_sich', 80);
    expect(screen.getByRole('image', { name: 'Momo, Hüpfer, freut sich, trägt Strohhütchen' })).toBeOnTheScreen();
  });

  test('nennt beide Accessoires des Lagunendrachen', async () => {
    await renderFigure(hatched('lagunendrache', { kopf: 'strohhuetchen', hals: 'muschelkette' }), 'begeistert');
    expect(screen.getByRole('image', { name: 'Momo, Lagunendrache, begeistert, trägt Strohhütchen und Muschelkette' })).toBeOnTheScreen();
  });
});

describe('alle Stimmungen', () => {
  test.each(moods.flatMap((mood) => [['kaulquappe', mood] as const, ['lagunendrache', mood] as const]))(
    '%s zeichnet „%s“ als Skia-Rig',
    async (form, mood) => {
      await renderFigure(hatched(form, { kopf: 'strohhuetchen', hals: 'muschelkette' }), mood);
      expect(screen.getByRole('image', { name: `Momo, ${formNames[form]}, ${moodNames[mood]}, trägt Strohhütchen und Muschelkette` })).toBeOnTheScreen();
      expect(skiaNodes().drawn.length).toBeGreaterThan(20);
    },
  );

  test('die Laichkugel zeichnet sich ebenfalls als Rig', async () => {
    await renderFigure(null, 'zufrieden', 96);
    expect(skiaNodes().drawn.length).toBeGreaterThan(5);
  });

  test('Kopf- und Hals-Accessoire kommen als eigene Flächen dazu', async () => {
    await renderFigure(hatched('kaulquappe'), 'zufrieden');
    const bare = skiaNodes().drawn.length;
    await renderFigure(hatched('kaulquappe', { kopf: 'strohhuetchen', hals: 'muschelkette' }), 'zufrieden');
    expect(skiaNodes().drawn.length).toBeGreaterThan(bare + 5);
  });
});

describe('Bewegung', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  describe('erlaubt', () => {
    beforeEach(() => {
      jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
      jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({ remove: () => undefined } as ReturnType<typeof AccessibilityInfo.addEventListener>);
    });
    afterEach(() => jest.restoreAllMocks());

    test.each(moods)('%s treibt die Rig-Gruppen mit Shared Values an', async (mood) => {
      await renderFigure(hatched('kaulquappe'), mood);
      await act(async () => jest.advanceTimersByTime(0));
      expect(skiaNodes().animated.length).toBeGreaterThanOrEqual(6);
    });
  });

  describe('reduziert', () => {
    withDeviceConfig('reduzierte-bewegung');

    test.each([...moods.map((mood) => ['kaulquappe', mood] as const), ['lagunendrache', 'begeistert'] as const])(
      '%s zeigt „%s“ als feste Schlüsselpose ohne animierte Werte',
      async (form, mood) => {
        await renderFigure(hatched(form), mood);
        await act(async () => jest.advanceTimersByTime(0));
        expect(skiaNodes().animated).toEqual([]);
      },
    );

    test('auch die Laichkugel wippt nicht', async () => {
      await renderFigure(null, 'zufrieden');
      await act(async () => jest.advanceTimersByTime(0));
      expect(skiaNodes().animated).toEqual([]);
    });
  });
});
