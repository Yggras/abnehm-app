import { renderHook } from '@testing-library/react-native';
import { Dimensions } from 'react-native';

import { useLargeTextLayout } from './text-scale';

const initial = { window: Dimensions.get('window'), screen: Dimensions.get('screen') };

function withFontScale(fontScale: number) {
  Dimensions.set({ window: { ...initial.window, fontScale }, screen: { ...initial.screen, fontScale } });
}

afterEach(() => {
  Dimensions.set(initial);
});

test.each([
  [1, false],
  [1.29, false],
  [1.3, true],
  [2, true],
])('bei Schriftfaktor %s bricht das Layout um: %s', async (fontScale, wraps) => {
  withFontScale(fontScale);

  const { result } = await renderHook(() => useLargeTextLayout());

  expect(result.current).toBe(wraps);
});
