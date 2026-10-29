import { testCapabilities } from '../build-capabilities';
import { openTarget, type RouteScreenProps } from '../navigation';
import { Placeholder } from '../shell/Placeholder';
import { useTabBarOverlap } from '../shell/tab-bar-overlap';
import { IslandView } from './IslandView';

/**
 * Tab „Momo“ (Spezifikation 4, Abschnitt 7). Als Tracer Bullet von #182 zeigt er in Test-Artefakten
 * die Fixture-Insel; echte Inseldaten schließt „Schlüpfen“ an (#184), bis dahin bleibt im
 * Produktionsbuild der Platzhalter. Die Leiste öffnet ihre Ansichten über die Route `momo` mit `view`,
 * denselben Weg wie Aktionen auf „Wir“; die Ansichten selbst liefern spätere Tickets.
 */
export function MomoTab({ target }: RouteScreenProps<'momo'>) {
  const bottomInset = useTabBarOverlap();
  const fixture = testCapabilities?.fixtureIsland ?? null;
  if (fixture === null) return <Placeholder target={target} />;
  return <IslandView {...fixture} bottomInset={bottomInset} onOpen={(view) => openTarget({ type: 'momo', view })} />;
}
