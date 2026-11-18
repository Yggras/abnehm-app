import { Notice, Skeleton, size, Text } from '../design';
import { closeRoute, type RouteScreenProps } from '../navigation';
import { ScreenFrame } from '../shell/ScreenFrame';
import { titleOf } from '../shell/texts';
import { useAppTrackers, useWeightDetail } from './app-trackers';
import { weightTexts } from './weight-texts';
import { WeightDetailContent } from './WeightDetailContent';
import { WeightEntryForm } from './WeightEntryForm';

/**
 * Bildschirm der Route `capture.weight` (Spezifikation 3, Abschnitte 4 und 5). Mit `newEntry: true`
 * öffnet er direkt das Formular für einen neuen Eintrag, wie „Eintragen“ auf dem Mini-Tracker und
 * „Gewicht“ im ＋-Sheet. Gespeichert kehrt der modale Ablauf zum Aufrufer zurück; die Meldung mit
 * „Rückgängig“ erscheint dort. Ohne `newEntry` zeigt er den Detailbildschirm mit Trend und Verlauf (#176).
 */
export function WeightCaptureScreen({ target }: RouteScreenProps<'capture.weight'>) {
  const trackers = useAppTrackers();
  const detail = useWeightDetail();
  return (
    <ScreenFrame title={titleOf(target)} presentation="modal">
      {trackers === null || (target.newEntry !== true && detail.type === 'loading') ? (
        <Loading />
      ) : target.newEntry === true ? (
        <WeightEntryForm trackers={trackers} onSaved={closeRoute} />
      ) : detail.type === 'error' ? (
        <Notice tone="problem" cause="technik" text={weightTexts.failed} />
      ) : detail.type === 'ready' ? (
        <WeightDetailContent detail={detail.detail} trackers={trackers} />
      ) : null}
    </ScreenFrame>
  );
}

function Loading() {
  return (
    <>
      <Text tone="inkMuted">{weightTexts.loading}</Text>
      <Skeleton width="100%" height={size.fieldHeight} />
    </>
  );
}
