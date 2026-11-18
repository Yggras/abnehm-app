import { Canvas, Fill, Group, Path, type Transforms3d } from '@shopify/react-native-skia';
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { GestureDetector, useCompetingGestures, usePanGesture, usePinchGesture, useSimultaneousGestures, useTapGesture } from 'react-native-gesture-handler';
import { useDerivedValue, useSharedValue, type SharedValue } from 'react-native-reanimated';

import { color, useReducedMotion } from '../design';
import { fogPath, LampGlow, MomoOnIsland, ObjectArt, Particle, polygonPath, Wave } from './IslandArt';
import type { IslandScene, Rect, SceneHit, SceneItem } from './scene-model';
import { useLoop } from './use-loop';
import { panBy, resizeView, startView, toScene, zoomAt, type Size, type Viewport } from './viewport';

export type IslandCanvasProps = {
  /** Szene in Zoom 1 („Szenenraum“); Verschiebung und Zoom legt der Canvas selbst darüber. */
  scene: IslandScene;
  /** Ein Tipp auf die Insel, `null` im Wasser. */
  onHit: (hit: SceneHit | null) => void;
  /** Beschreibung der Insel für Screenreader. */
  accessibilityLabel: string;
  /** testID der Gesten für `fireGestureHandler` im Test. */
  testID?: string;
};

/**
 * Skia-Canvas der Inselansicht: zeichnet nur die Zeichenliste des Szenenmodells und bringt die
 * Gesten mit. Ziehen verschiebt, Pinch zoomt von 0,5 bis 2,0, ein Tipp wird mit der Umkehrabbildung
 * der Szene erkannt; der Start zeigt Momos Lichtung in der Mitte (Spezifikation 4, Abschnitt 7).
 *
 * Wie im Spike (spikes/insel-rendering) entsteht die Zeichenliste einmal, und Verschiebung und Zoom
 * laufen auf dem UI-Thread ohne React-Render je Frame. Anders als dort bewegt aber keine
 * `Animated.View` einen festen Canvas, sondern eine Skia-Gruppe transformiert die Szene in einem
 * bildschirmfüllenden Canvas: So bleiben die Vektoren beim Zoomen scharf (eigene Einschätzung, nicht
 * gemessen). Die Leistung dieses Musters auf den Geräten misst #221. Die Szene kommt deshalb in Zoom 1,
 * und ein Tipp wird mit dem aktuellen Ausschnitt in den Szenenraum zurückgerechnet.
 */
export function IslandCanvas({ scene, onHit, accessibilityLabel, testID }: IslandCanvasProps) {
  const view = useSharedValue<Viewport>({ x: 0, y: 0, scale: 1 });
  const screen = useSharedValue<Size>({ width: 0, height: 0 });
  const bounds = useSharedValue<Rect>(scene.bounds);
  useEffect(() => {
    bounds.value = scene.bounds;
  }, [bounds, scene.bounds]);
  const laidOut = useRef<Size | null>(null);

  // Größen kommen aus dem Layout, nicht aus `screen.value`: Ein eben geschriebener Shared Value
  // liefert auf dem JS-Thread noch den alten Wert (im Simulator beobachtet, #182). Die erste Größe
  // legt den Start fest; wird der Canvas danach größer, etwa wenn die Tab-Leiste über die Insel
  // wechselt, bleibt die Mitte stehen.
  const onLayout = ({ nativeEvent: { layout } }: LayoutChangeEvent) => {
    const size = { width: layout.width, height: layout.height };
    const previous = laidOut.current;
    laidOut.current = size;
    screen.value = size;
    if (previous === null) view.value = startView(size, scene.focus);
    // `modify` ruft die Funktion auf dem UI-Thread auf; ohne `'worklet'` brach die App auf Android beim
    // Verlassen des Tabs ab („Tried to synchronously call a Remote Function“, beobachtet im Emulator am
    // 18.11.2026, #184; https://docs.swmansion.com/react-native-worklets/docs/guides/troubleshooting).
    else
      view.modify((current) => {
        'worklet';
        return resizeView(current, previous, size);
      });
  };

  const pan = usePanGesture({
    testID: testID && `${testID}-ziehen`,
    onUpdate: (event) => {
      'worklet';
      view.value = panBy(view.value, { x: event.changeX, y: event.changeY }, screen.value, bounds.value);
    },
  });
  const pinch = usePinchGesture({
    testID: testID && `${testID}-zoomen`,
    onUpdate: (event) => {
      'worklet';
      view.value = zoomAt(view.value, { x: event.focalX, y: event.focalY }, event.scaleChange, screen.value, bounds.value);
    },
  });
  const tap = useTapGesture({
    testID: testID && `${testID}-tippen`,
    runOnJS: true,
    onActivate: (event) => onHit(scene.hitAt(toScene(view.value, { x: event.x, y: event.y }))),
  });
  const move = useSimultaneousGestures(pan, pinch);
  const gesture = useCompetingGestures(tap, move);

  const transform = useDerivedValue<Transforms3d>(() => [{ translateX: view.value.x }, { translateY: view.value.y }, { scale: view.value.scale }]);
  const progress = useLoop(useReducedMotion());
  const drawing = useMemo(() => drawScene(scene, transform, progress), [scene, transform, progress]);

  return (
    <GestureDetector gesture={gesture}>
      <View
        testID={testID}
        style={StyleSheet.absoluteFill}
        onLayout={onLayout}
        accessible
        accessibilityRole="image"
        accessibilityLabel={accessibilityLabel}
      >
        <Canvas style={StyleSheet.absoluteFill}>{drawing}</Canvas>
      </View>
    </GestureDetector>
  );
}

/**
 * Zeichnet die Liste in ihrer Reihenfolge. Lagune und Abend füllen den ganzen Canvas, alles andere
 * liegt im Ausschnitt; aufeinanderfolgende Einträge teilen sich eine Gruppe.
 */
function drawScene(scene: IslandScene, transform: SharedValue<Transforms3d>, progress: SharedValue<number>): ReactNode[] {
  const nodes: ReactNode[] = [];
  let run: ReactNode[] = [];
  const flush = () => {
    if (run.length === 0) return;
    nodes.push(
      <Group key={`ausschnitt-${nodes.length}`} transform={transform}>
        {run}
      </Group>,
    );
    run = [];
  };
  scene.items.forEach((item, index) => {
    if (item.type === 'wasser' || item.type === 'abend') {
      flush();
      nodes.push(<Fill key={`${item.type}-${index}`} color={color[item.tone]} opacity={item.type === 'abend' ? item.opacity : 1} />);
    } else {
      run.push(<Item key={index} item={item} foliage={scene.foliage} progress={progress} />);
    }
  });
  flush();
  return nodes;
}

/** Einträge im Ausschnitt; Lagune und Abend füllen den Canvas und zeichnet `drawScene` selbst. */
type FramedItem = Exclude<SceneItem, Readonly<{ type: 'wasser' | 'abend' }>>;

function Item({ item, foliage, progress }: { item: FramedItem; foliage: IslandScene['foliage']; progress: SharedValue<number> }) {
  switch (item.type) {
    case 'inselschatten':
      return <Path path={polygonPath(item.polygon)} color={color[item.tone]} />;
    case 'welle':
      return <Wave at={item.at} phase={item.phase} progress={progress} />;
    case 'seite': {
      const path = polygonPath(item.polygon);
      return (
        <Group>
          <Path path={path} color={color[item.tone]} />
          <Path path={path} color={color.ink} opacity={item.shade} />
        </Group>
      );
    }
    case 'feld': {
      const path = polygonPath(item.polygon);
      return (
        <Group>
          <Path path={path} color={color[item.tone]} />
          {item.tint ? <Path path={path} color={color[item.tint.tone]} opacity={item.tint.opacity} /> : null}
        </Group>
      );
    }
    case 'objekt':
      return <ObjectArt at={item.at} art={item.art} foliage={foliage} />;
    case 'momo':
      return <MomoOnIsland at={item.at} appearance={item.appearance} progress={progress} />;
    case 'nebel':
      return <Path path={fogPath(item.cells)} color={color[item.tone]} opacity={item.opacity} />;
    case 'partikel':
      return <Particle at={item.at} phase={item.phase} tone={item.tone} progress={progress} />;
    case 'licht':
      return <LampGlow at={item.at} />;
    case 'auswahl':
      return <Path path={polygonPath(item.polygon)} color={color[item.tone]} opacity={item.opacity} />;
  }
}
