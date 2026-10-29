import type { Clock } from '@abnehm/clock';
import { LocalDate } from '@abnehm/contracts/base';
import { useEffect, useState } from 'react';

import { todayRefresh } from '../shell/today-refresh';
import type { DayLog } from './day-log';
import type { Nutrition } from './nutrition';

/**
 * „Heute“ der Bildschirme: der lokale Tag der Uhr, in deren Zone auch neue Einträge entstehen. Er liest
 * am Tageswechsel und bei Rückkehr in den Vordergrund neu, wie die Beiträge zu „Heute“.
 */
export function useLocalToday(clock: Clock): LocalDate {
  const [today, setToday] = useState(() => LocalDate.parse(clock.read().localDate));
  useEffect(() => {
    const update = () => setToday(LocalDate.parse(clock.read().localDate));
    update();
    return todayRefresh(update);
  }, [clock]);
  return today;
}

/** Das beobachtete Tagesprotokoll; `null`, solange kein Konto offen ist oder die Person noch fehlt. */
export function useDayLog(nutrition: Nutrition | null, localDate: LocalDate): DayLog | null {
  const [state, setState] = useState<{ source: Nutrition; localDate: LocalDate; log: DayLog | null } | null>(null);
  useEffect(
    () => nutrition?.observeDayLog(localDate, (log) => setState({ source: nutrition, localDate, log })),
    [nutrition, localDate],
  );
  return state !== null && state.source === nutrition && state.localDate === localDate ? state.log : null;
}
