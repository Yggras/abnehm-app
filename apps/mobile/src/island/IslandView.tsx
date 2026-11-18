import { minutesOfDay, type Clock } from '@abnehm/clock';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useClock } from '../clock/clock-context';
import { color, space } from '../design';
import type { IslandHalves } from './halves';
import { BuildModeBar, IslandBar, type IslandEntry } from './IslandBar';
import { IslandCanvas } from './IslandCanvas';
import { IslandHud } from './IslandHud';
import { islandScene, type IslandSceneInput, type LocalTime, type SceneHit } from './scene-model';
import { islandTexts } from './texts';

/** Bau-Modus der Inselansicht: was gebaut oder umgestellt wird (#194), wohin es darf und wie man abbricht. */
export type BuildMode = Readonly<{ title: string; fields: ReadonlySet<string>; onCancel: () => void }>;

export type IslandViewProps = {
  island: IslandSceneInput;
  /** Levelbalken; die eigene Hälfte ist lokal sofort wirksam (#191). */
  halves: IslandHalves;
  viewerPersonId: string;
  partnerName: string;
  /** Angezeigte eigene Energie, mindestens 0. */
  energy: number;
  onOpen: (view: IslandEntry) => void;
  /** Ein Tipp auf ein Feld oder in den Nebel; das Feld bleibt hervorgehoben, ein Tipp ins Wasser hebt das auf. */
  onFieldPress?: (hit: Exclude<SceneHit, { type: 'momo' }>) => void;
  /** Ein Tipp auf Momo; öffnet das Momo-Sheet (#184). */
  onMomoPress?: () => void;
  /** Ein Tipp auf den Levelbalken; öffnet „So wächst Momo“ (#184). */
  onLevelPress?: () => void;
  /** Wie weit Leisten des Rahmens unten über der Insel liegen, etwa die Tab-Leiste. */
  bottomInset?: number;
  /** Bau-Modus (#192): was gesetzt wird, die Felder, die leuchten, und „Abbrechen“ in der Leiste; auch beim Umstellen (#194). */
  building?: BuildMode | null;
  /** Das eben gebaute, aufgewertete oder umgestellte Objekt; es erscheint mit Feder. */
  appearing?: string | null;
};

/**
 * Inselansicht des Tabs „Momo“ (Spezifikation 4, Abschnitt 7): bildschirmfüllender Canvas, oben das
 * HUD, unten die Leiste. Die Szene folgt der lokalen Uhrzeit der betrachtenden Person und dem
 * Schalter „Bereiche“. Im Bau-Modus leuchten die gültigen Felder, und die Leiste wird zur Bau-Leiste mit
 * „Abbrechen“ (#192).
 */
export function IslandView({
  island,
  halves,
  viewerPersonId,
  partnerName,
  energy,
  onOpen,
  onFieldPress,
  onMomoPress,
  onLevelPress,
  bottomInset = 0,
  building = null,
  appearing = null,
}: IslandViewProps) {
  const localTime = useLocalTime(useClock());
  const [areas, setAreas] = useState(false);
  const [selectedField, setSelectedField] = useState<string | null>(null);
  const insets = useSafeAreaInsets();
  const buildable = building?.fields ?? null;
  const scene = useMemo(
    () =>
      islandScene({
        island,
        viewerPersonId,
        mode: buildable !== null ? { type: 'bauen', fields: buildable } : areas ? 'bereiche' : 'ansehen',
        localTime,
        zoom: 1,
        // Im Bau-Modus leuchten die gültigen Felder; eine Auswahl darüber verwischte sie.
        selectedField: buildable !== null ? null : selectedField,
        appearing,
      }),
    [island, viewerPersonId, buildable, areas, localTime, selectedField, appearing],
  );
  const ownObjects = island.objects.filter((object) => object.ownerPersonId === viewerPersonId).length;

  return (
    <View style={styles.island}>
      <IslandCanvas
        testID="insel"
        scene={scene}
        accessibilityLabel={islandTexts.island(halves.level, ownObjects)}
        onHit={(hit) => {
          if (hit?.type === 'momo') {
            onMomoPress?.();
            return;
          }
          // Ein Tipp im Bau-Modus setzt oder verschiebt ein Objekt; eine ältere Auswahl markierte danach ein leeres Feld.
          setSelectedField(buildable === null && hit?.type === 'feld' ? hit.field : null);
          if (hit !== null) onFieldPress?.(hit);
        }}
      />
      <View style={[styles.top, { paddingTop: insets.top + space[2] }]} pointerEvents="box-none">
        <IslandHud
          season={scene.season}
          daytime={scene.daytime}
          energy={energy}
          halves={halves}
          partnerName={partnerName}
          areas={areas}
          onToggleAreas={() => setAreas((on) => !on)}
          onLevelPress={onLevelPress}
        />
      </View>
      <View style={[styles.bottom, { paddingBottom: bottomInset + space[3] }]} pointerEvents="box-none">
        {building !== null ? <BuildModeBar title={building.title} onCancel={building.onCancel} /> : <IslandBar onOpen={onOpen} />}
      </View>
    </View>
  );
}

const minute = 60_000;

function localTimeOf(clock: Clock): LocalTime {
  const reading = clock.read();
  return { localDate: reading.localDate, minutesOfDay: minutesOfDay(reading) };
}

/** Lokale Uhrzeit, jede Minute neu abgelesen, damit Abend und Jahreszeit von selbst wechseln. */
function useLocalTime(clock: Clock): LocalTime {
  const [localTime, setLocalTime] = useState(() => localTimeOf(clock));
  useEffect(() => {
    const update = () =>
      setLocalTime((current) => {
        const next = localTimeOf(clock);
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
