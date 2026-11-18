import { act, renderHook } from '@testing-library/react-native';

import { useFilledPercent } from './LevelBar';
import { withDeviceConfig } from './testing/device-config';

// Levelbalken (Design-System, Komponente „Levelbalken“): Wächst eine Hälfte, füllt sie sich in
// `duration-slow` (400 ms; Design-System › Bewegung: „Ring und Levelbalken füllen sich“). Das nutzt das
// Bauen (#192): Nach einem Bau wächst die eigene Hälfte sichtbar. Geprüft wird der gezeichnete Stand, den
// Reanimated auf die Breite der Füllung legt.

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

/** Beginnt bei 30 %, wartet, bis „Bewegung reduzieren“ abgefragt ist, und setzt dann 60 %. */
async function grow() {
  const hook = await renderHook(({ percent }: { percent: number }) => useFilledPercent(percent), { initialProps: { percent: 30 } });
  await act(async () => jest.advanceTimersByTime(10));
  await hook.rerender({ percent: 60 });
  return hook;
}

test('steht beim ersten Zeichnen sofort auf dem Stand', async () => {
  const { result } = await renderHook(() => useFilledPercent(30));

  expect(result.current.value).toBe(30);
});

test('ein Bau lässt die Hälfte in `duration-slow` wachsen', async () => {
  const { result } = await grow();
  await act(async () => jest.advanceTimersByTime(200));
  const midway = result.current.value;
  await act(async () => jest.advanceTimersByTime(250));

  expect(midway).toBeGreaterThan(30);
  expect(midway).toBeLessThan(60);
  expect(result.current.value).toBe(60);
});

describe('Bewegung reduzieren', () => {
  withDeviceConfig('reduzierte-bewegung');

  test('springt die Hälfte ohne Bewegung auf den neuen Stand', async () => {
    const { result } = await grow();

    expect(result.current.value).toBe(60);
  });
});
