import type { Clock } from '@abnehm/clock';
import type { IslandProgress } from '@abnehm/contracts/island';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useClock } from '../clock/clock-context';
import { color, space } from '../design';
import { IslandBar, type IslandEntry } from './IslandBar';
import { IslandCanvas } from './IslandCanvas';
import { IslandHud } from './IslandHud';
import { islandScene, localTimeOf, type IslandSceneInput, type LocalTime, type SceneHit } from './scene-model';

export type IslandViewProps = {
  island: IslandSceneInput;
  progress: IslandProgress;
  viewerPersonId: string;
  partnerName: string;
  /** Angezeigte eigene Energie, mindestens 0. */
  energy: number;
  /** Für die Person neue Ereignisse. */
  newEvents: number;
  onOpen: (view: IslandEntry) => void;
  /** Ein Tipp auf ein Feld oder in den Nebel; das Feld bleibt hervorgehoben, ein Tipp ins Wasser hebt das auf. */
  onFieldPress?: (hit: SceneHit) => void;
  /** Wie weit Leisten des Rahmens unten über der Insel liegen, etwa die Tab-Leiste. */
  bottomInset?: number;
};

/**
 * Inselansicht des Tabs „Momo“ (Spezifikation 4, Abschnitt 7): bildschirmfüllender Canvas, oben das
 * HUD, unten die Leiste. Die Szene folgt der lokalen Uhrzeit der betrachtenden Person und dem
 * Schalter „Bereiche“.
 */
export function IslandView({ island, progress, viewerPersonId, partnerName, energy, newEvents, onOpen, onFieldPress, bottomInset = 0 }: IslandViewProps) {
  const localTime = useLocalTime(useClock());
  const [areas, setAreas] = useState(false);
  const [selectedField, setSelectedField] = useState<string | null>(null);
  const insets = useSafeAreaInsets();
  const scene = useMemo(
    () => islandScene({ island, viewerPersonId, mode: areas ? 'bereiche' : 'ansehen', localTime, zoom: 1, selectedField }),
    [island, viewerPersonId, areas, localTime, selectedField],
  );
  const ownObjects = island.objects.filter((object) => object.ownerPersonId === viewerPersonId).length;

  return (
    <View style={styles.island}>
      <IslandCanvas
        testID="insel"
        scene={scene}
        accessibilityLabel={`Momos Insel, Level ${progress.level}, ${ownObjects} eigene Objekte`}
        onHit={(hit) => {
          setSelectedField(hit?.type === 'feld' ? hit.field : null);
          if (hit !== null) onFieldPress?.(hit);
        }}
      />
      <View style={[styles.top, { paddingTop: insets.top + space[2] }]} pointerEvents="box-none">
        <IslandHud
          season={scene.season}
          daytime={scene.daytime}
          energy={energy}
          progress={progress}
          viewerPersonId={viewerPersonId}
          partnerName={partnerName}
          areas={areas}
          onToggleAreas={() => setAreas((on) => !on)}
        />
      </View>
      <View style={[styles.bottom, { paddingBottom: bottomInset + space[3] }]} pointerEvents="box-none">
        <IslandBar newEvents={newEvents} onOpen={onOpen} />
      </View>
    </View>
  );
}

const minute = 60_000;

/** Lokale Uhrzeit, jede Minute neu abgelesen, damit Abend und Jahreszeit von selbst wechseln. */
function useLocalTime(clock: Clock): LocalTime {
  const [localTime, setLocalTime] = useState(() => localTimeOf(clock.read()));
  useEffect(() => {
    const update = () =>
      setLocalTime((current) => {
        const next = localTimeOf(clock.read());
        return next.localDate === current.localDate && next.minutesOfDay === current.minutesOfDay ? current : next;
      });
    update();
    const timer = setInterval(update, minute);
    return () => clearInterval(timer);
  }, [clock]);
  return localTime;
}

const styles = StyleSheet.create({
  island: { flex: 1, backgroundColor: color.islandWater },
  top: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: space[4] },
  bottom: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: space[4] },
});
