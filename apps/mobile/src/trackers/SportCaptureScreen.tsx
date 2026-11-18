import { useState } from 'react';

import type { LocalDate } from '@abnehm/contracts/base';

import { Notice, Skeleton, size, Text } from '../design';
import { closeRoute, type RouteScreenProps } from '../navigation';
import { ScreenFrame } from '../shell/ScreenFrame';
import { titleOf } from '../shell/texts';
import { useAppTrackers, useSportWeek } from './app-trackers';
import { SportEntryForm } from './SportEntryForm';
import { sportTexts } from './sport-texts';
import { SportWeekContent } from './SportWeekContent';

/**
 * Bildschirm der Route `capture.sport` (Spezifikation 3, Abschnitte 4 und 5). Mit `newEntry: true`
 * öffnet er direkt das Formular „+ Einheit“, wie „+ Einheit“ auf dem Mini-Tracker und „Sport“ im
 * ＋-Sheet. Gespeichert kehrt der modale Ablauf zum Aufrufer zurück; die Meldung mit „Rückgängig“
 * erscheint dort. Ohne `newEntry` zeigt er die Wochenübersicht, anfangs die laufende Woche (#174).
 */
export function SportCaptureScreen({ target }: RouteScreenProps<'capture.sport'>) {
  const trackers = useAppTrackers();
  return (
    <ScreenFrame title={titleOf(target)} presentation="modal">
      {trackers === null ? (
        <Loading />
      ) : target.newEntry === true ? (
        <SportEntryForm trackers={trackers} onSaved={closeRoute} />
      ) : (
        <SportOverview trackers={trackers} />
      )}
    </ScreenFrame>
  );
}

function SportOverview({ trackers }: { trackers: NonNullable<ReturnType<typeof useAppTrackers>> }) {
  /** Ein Tag der gezeigten Woche; `null` folgt der laufenden Woche, auch über einen Wochenwechsel. */
  const [week, setWeek] = useState<LocalDate | null>(null);
  const state = useSportWeek(week);
  if (state.type === 'loading') return <Loading />;
  if (state.type === 'error') return <Notice tone="problem" cause="technik" text={sportTexts.failed} />;
  return <SportWeekContent week={state.week} trackers={trackers} onWeek={setWeek} />;
}

function Loading() {
  return (
    <>
      <Text tone="inkMuted">{sportTexts.loading}</Text>
      <Skeleton width="100%" height={size.fieldHeight} />
    </>
  );
}
