import { StatusBar } from 'expo-status-bar';
import * as Application from 'expo-application';
import * as Device from 'expo-device';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Dimensions,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  type SharedValue,
  useAnimatedProps,
  useAnimatedStyle,
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Polygon, Rect } from 'react-native-svg';
import {
  Canvas,
  Circle as SkCircle,
  Group,
  Points,
  Rect as SkRect,
  vec,
} from '@shopify/react-native-skia';

type Renderer = 'Skia' | 'SVG';
type Shape =
  | { kind: 'polygon'; points: Array<{ x: number; y: number }>; color: string }
  | { kind: 'circle'; x: number; y: number; radius: number; color: string; animated: boolean; phase: number }
  | { kind: 'rect'; x: number; y: number; width: number; height: number; color: string; animated: boolean; phase: number };

type Result = {
  renderer: Renderer;
  averageFps: number;
  minimumFps: number;
  maximumGapMs: number;
  seconds: number;
};

const SCENE_WIDTH = 600;
const SCENE_HEIGHT = 700;
const TILE_WIDTH = 60;
const TILE_HEIGHT = 30;
const TILE_DEPTH = 16;
const ANIMATED_ELEMENTS = 157;
const AnimatedSvgCircle = Animated.createAnimatedComponent(Circle);
const AnimatedSvgRect = Animated.createAnimatedComponent(Rect);

function createScene(): Shape[] {
  const map = [
    '..nnn....',
    '.nnnnn...',
    '.sEEGPPs.',
    '.EEGGGPP.',
    'sBBBMNNNs',
    '.BBBMNNN.',
    '..BBsNN..',
    '...sss...',
    '.........',
  ];
  const plots: Array<{ row: number; column: number }> = [];
  map.forEach((line, row) => {
    [...line].forEach((cell, column) => {
      if (cell !== '.') plots.push({ row, column });
    });
  });
  let animatedIndex = 0;
  const shapes: Shape[] = [
    { kind: 'rect', x: 0, y: 0, width: SCENE_WIDTH, height: SCENE_HEIGHT, color: '#173d68', animated: false, phase: 0 },
  ];

  plots.forEach(({ row, column }, tileIndex) => {
    const x = (column - row) * (TILE_WIDTH / 2) + 300;
    const y = (column + row) * (TILE_HEIGHT / 2) + 160;
    const grass = tileIndex % 5 === 0 ? '#aac969' : '#80bd58';
    shapes.push(
      {
        kind: 'polygon',
        points: [
          { x: x - TILE_WIDTH / 2, y },
          { x, y: y + TILE_HEIGHT / 2 },
          { x, y: y + TILE_HEIGHT / 2 + TILE_DEPTH },
          { x: x - TILE_WIDTH / 2, y: y + TILE_DEPTH },
        ],
        color: '#9c6848',
      },
      {
        kind: 'polygon',
        points: [
          { x, y: y + TILE_HEIGHT / 2 },
          { x: x + TILE_WIDTH / 2, y },
          { x: x + TILE_WIDTH / 2, y: y + TILE_DEPTH },
          { x, y: y + TILE_HEIGHT / 2 + TILE_DEPTH },
        ],
        color: '#795039',
      },
      {
        kind: 'polygon',
        points: [
          { x, y: y - TILE_HEIGHT / 2 },
          { x: x + TILE_WIDTH / 2, y },
          { x, y: y + TILE_HEIGHT / 2 },
          { x: x - TILE_WIDTH / 2, y },
        ],
        color: grass,
      },
    );

    // 27 details per plot make the fully populated scene comparable to the web prototype.
    for (let detail = 0; detail < 27; detail += 1) {
      const columnOffset = (detail % 6) - 2.5;
      const rowOffset = Math.floor(detail / 6) - 2;
      const isAnimated = animatedIndex < ANIMATED_ELEMENTS;
      const phase = (animatedIndex % 17) / 17;
      if (isAnimated) animatedIndex += 1;
      const color = detail % 4 === 0 ? '#f4ca55' : detail % 3 === 0 ? '#d7edf1' : '#3f8f49';
      if (detail % 5 === 0) {
        shapes.push({
          kind: 'rect',
          x: x + columnOffset * 4 - 1.5,
          y: y - 18 + rowOffset * 3,
          width: 3,
          height: 13,
          color: '#75452c',
          animated: isAnimated,
          phase,
        });
      } else {
        shapes.push({
          kind: 'circle',
          x: x + columnOffset * 4,
          y: y - 20 + rowOffset * 3,
          radius: 2 + ((detail + tileIndex) % 4),
          color,
          animated: isAnimated,
          phase,
        });
      }
    }
  });

  shapes.push({
    kind: 'rect',
    x: 0,
    y: 0,
    width: SCENE_WIDTH,
    height: SCENE_HEIGHT,
    color: 'rgba(14, 18, 62, 0.28)',
    animated: false,
    phase: 0,
  });
  return shapes;
}

const SCENE = createScene();

function useAnimationProgress() {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withRepeat(withTiming(1, { duration: 1_800 }), -1, true);
  }, [progress]);
  return progress;
}

function SkiaCircle({ shape, progress }: { shape: Extract<Shape, { kind: 'circle' }>; progress: SharedValue<number> }) {
  const cy = useDerivedValue(() => shape.y + Math.sin((progress.value + shape.phase) * Math.PI * 2) * 2.5);
  return <SkCircle cx={shape.x} cy={cy} r={shape.radius} color={shape.color} />;
}

function SkiaRectangle({ shape, progress }: { shape: Extract<Shape, { kind: 'rect' }>; progress: SharedValue<number> }) {
  const y = useDerivedValue(() => shape.y + Math.sin((progress.value + shape.phase) * Math.PI * 2) * 2.5);
  return <SkRect x={shape.x} y={y} width={shape.width} height={shape.height} color={shape.color} />;
}

function SkiaScene() {
  const progress = useAnimationProgress();
  return (
    <Canvas style={styles.scene}>
      <Group>
        {SCENE.map((shape, index) => {
          if (shape.kind === 'polygon') {
            return <Points key={index} points={shape.points.map(({ x, y }) => vec(x, y))} mode="polygon" color={shape.color} />;
          }
          if (shape.kind === 'circle') {
            return shape.animated ? (
              <SkiaCircle key={index} shape={shape} progress={progress} />
            ) : (
              <SkCircle key={index} cx={shape.x} cy={shape.y} r={shape.radius} color={shape.color} />
            );
          }
          return shape.animated ? (
            <SkiaRectangle key={index} shape={shape} progress={progress} />
          ) : (
            <SkRect key={index} x={shape.x} y={shape.y} width={shape.width} height={shape.height} color={shape.color} />
          );
        })}
      </Group>
    </Canvas>
  );
}

function SvgCircleShape({ shape, progress }: { shape: Extract<Shape, { kind: 'circle' }>; progress: SharedValue<number> }) {
  const animatedProps = useAnimatedProps(() => ({
    cy: shape.y + Math.sin((progress.value + shape.phase) * Math.PI * 2) * 2.5,
  }));
  return <AnimatedSvgCircle cx={shape.x} r={shape.radius} fill={shape.color} animatedProps={animatedProps} />;
}

function SvgRectangleShape({ shape, progress }: { shape: Extract<Shape, { kind: 'rect' }>; progress: SharedValue<number> }) {
  const animatedProps = useAnimatedProps(() => ({
    y: shape.y + Math.sin((progress.value + shape.phase) * Math.PI * 2) * 2.5,
  }));
  return <AnimatedSvgRect x={shape.x} width={shape.width} height={shape.height} fill={shape.color} animatedProps={animatedProps} />;
}

function SvgScene() {
  const progress = useAnimationProgress();
  return (
    <Svg width={SCENE_WIDTH} height={SCENE_HEIGHT} style={styles.scene}>
      {SCENE.map((shape, index) => {
        if (shape.kind === 'polygon') {
          const points = shape.points.map(({ x, y }) => `${x},${y}`).join(' ');
          return <Polygon key={index} points={points} fill={shape.color} />;
        }
        if (shape.kind === 'circle') {
          return shape.animated ? (
            <SvgCircleShape key={index} shape={shape} progress={progress} />
          ) : (
            <Circle key={index} cx={shape.x} cy={shape.y} r={shape.radius} fill={shape.color} />
          );
        }
        return shape.animated ? (
          <SvgRectangleShape key={index} shape={shape} progress={progress} />
        ) : (
          <Rect key={index} x={shape.x} y={shape.y} width={shape.width} height={shape.height} fill={shape.color} />
        );
      })}
    </Svg>
  );
}

function useBenchmark() {
  const [liveFps, setLiveFps] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const measuredRenderer = useRef<Renderer>('Skia');
  const active = useSharedValue(false);
  const startedAt = useSharedValue(0);
  const windowStartedAt = useSharedValue(0);
  const totalFrames = useSharedValue(0);
  const windowFrames = useSharedValue(0);
  const minimumFps = useSharedValue(999);
  const maximumGapMs = useSharedValue(0);

  const finish = (averageFps: number, minimum: number, maximumGap: number, seconds: number) => {
    setResult({ renderer: measuredRenderer.current, averageFps, minimumFps: minimum, maximumGapMs: maximumGap, seconds });
  };

  useFrameCallback((frame) => {
    if (!active.value) return;
    if (startedAt.value === 0) {
      startedAt.value = frame.timestamp;
      windowStartedAt.value = frame.timestamp;
    }
    totalFrames.value += 1;
    windowFrames.value += 1;
    const gap = frame.timeSincePreviousFrame ?? 0;
    maximumGapMs.value = Math.max(maximumGapMs.value, gap);
    const windowDuration = frame.timestamp - windowStartedAt.value;
    if (windowDuration >= 1_000) {
      const fps = (windowFrames.value * 1_000) / windowDuration;
      minimumFps.value = Math.min(minimumFps.value, fps);
      runOnJS(setLiveFps)(fps);
      windowFrames.value = 0;
      windowStartedAt.value = frame.timestamp;
    }
    const duration = frame.timestamp - startedAt.value;
    if (duration >= 15_000) {
      active.value = false;
      runOnJS(finish)(
        (totalFrames.value * 1_000) / duration,
        minimumFps.value === 999 ? 0 : minimumFps.value,
        maximumGapMs.value,
        duration / 1_000,
      );
    }
  });

  const start = (renderer: Renderer) => {
    measuredRenderer.current = renderer;
    setResult(null);
    setLiveFps(0);
    startedAt.value = 0;
    windowStartedAt.value = 0;
    totalFrames.value = 0;
    windowFrames.value = 0;
    minimumFps.value = 999;
    maximumGapMs.value = 0;
    active.value = true;
  };

  return { liveFps, result, start };
}

function InteractiveScene({ renderer }: { renderer: Renderer }) {
  const scale = useSharedValue(0.62);
  const savedScale = useSharedValue(0.62);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(20);

  const pan = Gesture.Pan().onChange((event) => {
    translateX.value += event.changeX;
    translateY.value += event.changeY;
  });
  const pinch = Gesture.Pinch()
    .onUpdate((event) => {
      scale.value = Math.max(0.35, Math.min(1.8, savedScale.value * event.scale));
    })
    .onEnd(() => {
      savedScale.value = scale.value;
    });
  const gesture = Gesture.Simultaneous(pan, pinch);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[styles.scenePosition, animatedStyle]}>
        {renderer === 'Skia' ? <SkiaScene /> : <SvgScene />}
      </Animated.View>
    </GestureDetector>
  );
}

export default function App() {
  const [renderer, setRenderer] = useState<Renderer>('Skia');
  const { liveFps, result, start } = useBenchmark();
  const deviceDescription = useMemo(
    () => `${Device.manufacturer ?? '?'} ${Device.modelName ?? Device.modelId ?? '?'} · ${Device.osName ?? '?'} ${Device.osVersion ?? '?'}`,
    [],
  );

  return (
    <GestureHandlerRootView style={styles.root}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Text style={styles.title}>Momos Insel · Rendering-Spike</Text>
        <Text style={styles.meta}>{deviceDescription}</Text>
        <Text style={styles.meta}>Build {Application.nativeApplicationVersion ?? '?'} · {SCENE.length} Elemente · {ANIMATED_ELEMENTS} animiert</Text>
        <View style={styles.tabs}>
          {(['Skia', 'SVG'] as Renderer[]).map((candidate) => (
            <Pressable
              key={candidate}
              onPress={() => setRenderer(candidate)}
              style={[styles.tab, renderer === candidate && styles.tabActive]}
            >
              <Text style={[styles.tabText, renderer === candidate && styles.tabTextActive]}>{candidate}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.viewport}>
        <InteractiveScene key={renderer} renderer={renderer} />
        <View pointerEvents="none" style={styles.hint}>
          <Text style={styles.hintText}>Während der Messung ziehen und mit zwei Fingern zoomen.</Text>
        </View>
      </View>

      <View style={styles.results}>
        <Text style={styles.live}>UI-Thread: {liveFps ? `${liveFps.toFixed(1)} fps` : 'noch nicht gemessen'}</Text>
        {result ? (
          <Text style={styles.resultText}>
            15 s {result.renderer}: Ø {result.averageFps.toFixed(1)} fps · Minimum {result.minimumFps.toFixed(1)} fps · größte Lücke {result.maximumGapMs.toFixed(1)} ms
          </Text>
        ) : (
          <Text style={styles.resultText}>Je Renderer einmal messen; Ruckeln zusätzlich subjektiv notieren.</Text>
        )}
        <Button title="15-Sekunden-Messung starten" onPress={() => start(renderer)} color="#3d9d67" />
      </View>
    </GestureHandlerRootView>
  );
}

const screenWidth = Dimensions.get('window').width;
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#101b2d' },
  header: { paddingTop: 54, paddingHorizontal: 16, paddingBottom: 10, backgroundColor: '#182945' },
  title: { color: '#fff', fontWeight: '800', fontSize: 19 },
  meta: { color: '#b9c8df', fontSize: 11, marginTop: 3 },
  tabs: { flexDirection: 'row', marginTop: 10, gap: 8 },
  tab: { paddingVertical: 7, paddingHorizontal: 24, borderRadius: 18, backgroundColor: '#263b5d' },
  tabActive: { backgroundColor: '#f2c14e' },
  tabText: { color: '#d9e2f0', fontWeight: '700' },
  tabTextActive: { color: '#33270c' },
  viewport: { flex: 1, overflow: 'hidden', backgroundColor: '#173d68' },
  scenePosition: {
    position: 'absolute',
    width: SCENE_WIDTH,
    height: SCENE_HEIGHT,
    left: (screenWidth - SCENE_WIDTH) / 2,
    top: -90,
  },
  scene: { width: SCENE_WIDTH, height: SCENE_HEIGHT },
  hint: { position: 'absolute', left: 12, right: 12, bottom: 10, alignItems: 'center' },
  hintText: { color: '#fff', backgroundColor: 'rgba(10,20,35,.72)', paddingVertical: 5, paddingHorizontal: 9, borderRadius: 10, fontSize: 11 },
  results: { padding: 12, gap: 7, backgroundColor: '#eef4f5' },
  live: { fontWeight: '800', color: '#193326' },
  resultText: { color: '#344650', fontSize: 12, minHeight: 32 },
});
