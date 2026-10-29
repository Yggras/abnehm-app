import { Skeleton, size, Text } from '../design';
import { closeRoute, type RouteScreenProps } from '../navigation';
import { Placeholder } from '../shell/Placeholder';
import { ScreenFrame } from '../shell/ScreenFrame';
import { titleOf } from '../shell/texts';
import { useAppTrackers } from './app-trackers';
import { WeightEntryForm } from './WeightEntryForm';

/**
 * Bildschirm der Route `capture.weight` (Spezifikation 3, Abschnitte 4 und 5). Mit `newEntry: true`
 * öffnet er direkt das Formular für einen neuen Eintrag, wie „Eintragen“ auf dem Mini-Tracker und
 * „Gewicht“ im ＋-Sheet. Gespeichert kehrt der modale Ablauf zum Aufrufer zurück; die Meldung mit
 * „Rückgängig“ erscheint dort. Den Detailbildschirm mit Verlauf liefert #176; bis dahin zeigt die
 * Route ohne `newEntry` den Platzhalter des Bereichs.
 */
export function WeightCaptureScreen({ target }: RouteScreenProps<'capture.weight'>) {
  const trackers = useAppTrackers();
  if (target.newEntry !== true) return <Placeholder target={target} />;
  return (
    <ScreenFrame title={titleOf(target)} presentation="modal">
      {trackers === null ? (
        <>
          <Text tone="inkMuted">Gewicht lädt …</Text>
          <Skeleton width="100%" height={size.fieldHeight} />
        </>
      ) : (
        <WeightEntryForm trackers={trackers} onSaved={closeRoute} />
      )}
    </ScreenFrame>
  );
}
