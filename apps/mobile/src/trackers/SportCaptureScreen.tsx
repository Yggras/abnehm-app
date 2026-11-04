import { Skeleton, size, Text } from '../design';
import { closeRoute, type RouteScreenProps } from '../navigation';
import { Placeholder } from '../shell/Placeholder';
import { ScreenFrame } from '../shell/ScreenFrame';
import { titleOf } from '../shell/texts';
import { useAppTrackers } from './app-trackers';
import { SportEntryForm } from './SportEntryForm';

/**
 * Bildschirm der Route `capture.sport` (Spezifikation 3, Abschnitte 4 und 5). Mit `newEntry: true`
 * öffnet er direkt das Formular „+ Einheit“, wie „+ Einheit“ auf dem Mini-Tracker und „Sport“ im
 * ＋-Sheet. Gespeichert kehrt der modale Ablauf zum Aufrufer zurück; die Meldung mit „Rückgängig“
 * erscheint dort. Die Wochenübersicht liefert #174; bis dahin zeigt die Route ohne `newEntry` den
 * Platzhalter des Bereichs.
 */
export function SportCaptureScreen({ target }: RouteScreenProps<'capture.sport'>) {
  const trackers = useAppTrackers();
  if (target.newEntry !== true) return <Placeholder target={target} />;
  return (
    <ScreenFrame title={titleOf(target)} presentation="modal">
      {trackers === null ? (
        <>
          <Text tone="inkMuted">Sport lädt …</Text>
          <Skeleton width="100%" height={size.fieldHeight} />
        </>
      ) : (
        <SportEntryForm trackers={trackers} onSaved={closeRoute} />
      )}
    </ScreenFrame>
  );
}
