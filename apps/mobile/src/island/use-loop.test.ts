import { act, renderHook } from '@testing-library/react-native';

import { useLoop, usePulse } from './use-loop';

// Wellen, Ruheatmung und Partikel hängen an diesem Takt; bei „Bewegung reduzieren“ stehen sie still
// (Spezifikation 4, Abschnitt 7).

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('der Takt läuft, solange Bewegung erlaubt ist', async () => {
  const { result } = await renderHook(() => useLoop(false));

  await act(async () => jest.advanceTimersByTime(900));

  expect(result.current.value).toBeGreaterThan(0);
  expect(result.current.value).toBeLessThan(1);
});

test('bei „Bewegung reduzieren“ steht der Takt still', async () => {
  const { result } = await renderHook(() => useLoop(true));

  await act(async () => jest.advanceTimersByTime(900));

  expect(result.current.value).toBe(0);
});

test('schaltet jemand „Bewegung reduzieren“ ein, bleibt der Takt stehen', async () => {
  const { result, rerender } = await renderHook(({ reduce }: { reduce: boolean }) => useLoop(reduce), { initialProps: { reduce: false } });
  await act(async () => jest.advanceTimersByTime(900));

  await rerender({ reduce: true });
  await act(async () => jest.advanceTimersByTime(900));

  expect(result.current.value).toBe(0);
});

describe('Pulsieren der gültigen Felder im Bau-Modus (#192)', () => {
  test('pulsiert hin und zurück, je Richtung `duration-slow` (400 ms)', async () => {
    const { result } = await renderHook(() => usePulse(false));

    await act(async () => jest.advanceTimersByTime(200));
    const rising = result.current.value;
    await act(async () => jest.advanceTimersByTime(200));
    const top = result.current.value;
    await act(async () => jest.advanceTimersByTime(200));

    expect(rising).toBeGreaterThan(0);
    expect(rising).toBeLessThan(1);
    expect(top).toBeCloseTo(1, 1);
    expect(result.current.value).toBeLessThan(top);
  });

  test('bei „Bewegung reduzieren“ leuchtet es ruhig', async () => {
    const { result } = await renderHook(() => usePulse(true));

    await act(async () => jest.advanceTimersByTime(300));

    expect(result.current.value).toBe(1);
  });
});
