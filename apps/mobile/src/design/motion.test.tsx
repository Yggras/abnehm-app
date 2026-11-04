import { act, renderHook } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import { motionFor, useMotion } from './motion';
import { withDeviceConfig } from './testing/device-config';
import { motion } from './tokens';

describe('motionFor', () => {
  test('Erfolge federn mit den Federn des Design-Systems', () => {
    expect(motionFor('bounce', { reduceMotion: false })).toEqual({ type: 'spring', config: motion.spring.bouncy });
    expect(motionFor('settle', { reduceMotion: false })).toEqual({ type: 'spring', config: motion.spring.firm });
  });

  test('Ein- und Ausblenden laufen über Dauer und Kurve', () => {
    expect(motionFor('enter', { reduceMotion: false })).toEqual({
      type: 'timing',
      duration: motion.duration.base,
      easing: motion.easing.enter,
    });
    expect(motionFor('celebrate', { reduceMotion: false })).toEqual({
      type: 'spring',
      config: motion.spring.bouncy,
      duration: motion.duration.celebrate,
    });
  });

  test.each(['bounce', 'settle', 'celebrate', 'enter', 'exit', 'move'] as const)(
    'reduzierte Bewegung ersetzt „%s“ durch eine kurze Überblendung',
    (intent) => {
      expect(motionFor(intent, { reduceMotion: true })).toEqual({ type: 'crossfade', duration: motion.duration.fast });
    },
  );

  test('dauerhafte Bewegung (Wellen, Wippen, Partikel) steht bei reduzierter Bewegung still', () => {
    expect(motionFor('loop', { reduceMotion: false })).toEqual({ type: 'loop', duration: motion.duration.celebrate });
    expect(motionFor('loop', { reduceMotion: true })).toEqual({ type: 'still' });
  });
});

describe('useMotion', () => {
  test('folgt der Systemeinstellung „Bewegung reduzieren“ und ihren Änderungen', async () => {
    let notify: ((enabled: boolean) => void) | undefined;
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation((_event, handler) => {
      notify = handler as (enabled: boolean) => void;
      return { remove: jest.fn() } as unknown as ReturnType<typeof AccessibilityInfo.addEventListener>;
    });

    const { result } = await renderHook(() => useMotion('bounce'));
    await act(async () => {});
    expect(result.current).toEqual({ type: 'crossfade', duration: motion.duration.fast });

    await act(async () => notify?.(false));
    expect(result.current).toEqual({ type: 'spring', config: motion.spring.bouncy });
  });
});

describe('Gerätekonfiguration reduzierte Bewegung (#113)', () => {
  withDeviceConfig('reduzierte-bewegung');

  test.each(['bounce', 'settle', 'enter', 'celebrate'] as const)('„%s“ wird zur kurzen Überblendung', async (intent) => {
    const { result } = await renderHook(() => useMotion(intent));
    await act(async () => {});
    expect(result.current).toEqual({ type: 'crossfade', duration: motion.duration.fast });
  });

  test('eine Schleife steht still', async () => {
    const { result } = await renderHook(() => useMotion('loop'));
    await act(async () => {});
    expect(result.current).toEqual({ type: 'still' });
  });
});
