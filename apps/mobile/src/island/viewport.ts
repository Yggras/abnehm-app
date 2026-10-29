import type { Point, Rect } from './scene-model';

// Ausschnitt der Inselansicht: Verschiebung und Zoom, mit denen der Canvas die Szene zeichnet
// (Bildschirm = Verschiebung + Zoom × Szene). Die Gesten rechnen auf dem UI-Thread, deshalb sind die
// Funktionen Worklets. Das Worklets-Plugin macht aus ihnen Zuweisungen ohne Hoisting: Jede Funktion
// steht vor ihren Aufrufern.

/** Ausschnitt: Verschiebung und Zoom der Szene auf dem Bildschirm. */
export type Viewport = Readonly<{ x: number; y: number; scale: number }>;
export type Size = Readonly<{ width: number; height: number }>;

/** Zoomgrenzen (Spezifikation 4, Abschnitt 7: 0,5–2,0, neu festgelegt, nicht belegt). */
export const zoomLimits = { min: 0.5, max: 2 } as const;

/** Start bei Zoom 1 mit dem Fokus, Momos Lichtung, in der Mitte des Bildschirms. */
export function startView(screen: Size, focus: Point): Viewport {
  'worklet';
  return { x: screen.width / 2 - focus.x, y: screen.height / 2 - focus.y, scale: 1 };
}

/** Punkt des Bildschirms in Szenenkoordinaten. */
export function toScene(view: Viewport, point: Point): Point {
  'worklet';
  return { x: (point.x - view.x) / view.scale, y: (point.y - view.y) / view.scale };
}

/**
 * Neue Größe des Canvas, etwa wenn die Tab-Leiste über die Insel wechselt: Der Punkt in der Mitte
 * bleibt in der Mitte.
 */
export function resizeView(view: Viewport, from: Size, to: Size): Viewport {
  'worklet';
  return { x: view.x + (to.width - from.width) / 2, y: view.y + (to.height - from.height) / 2, scale: view.scale };
}

/** Die Bildschirmmitte bleibt über der Ausdehnung der Insel, damit man sie nie aus den Augen verliert. */
function keepReachable(view: Viewport, screen: Size, bounds: Rect): Viewport {
  'worklet';
  const center = toScene(view, { x: screen.width / 2, y: screen.height / 2 });
  const x = Math.min(bounds.x + bounds.width, Math.max(bounds.x, center.x));
  const y = Math.min(bounds.y + bounds.height, Math.max(bounds.y, center.y));
  return { x: screen.width / 2 - x * view.scale, y: screen.height / 2 - y * view.scale, scale: view.scale };
}

/** Ziehen: verschiebt um den Fingerweg. */
export function panBy(view: Viewport, change: Point, screen: Size, bounds: Rect): Viewport {
  'worklet';
  return keepReachable({ x: view.x + change.x, y: view.y + change.y, scale: view.scale }, screen, bounds);
}

/** Pinch: zoomt um `factor` innerhalb der Grenzen; der Punkt unter `focal` bleibt stehen. */
export function zoomAt(view: Viewport, focal: Point, factor: number, screen: Size, bounds: Rect): Viewport {
  'worklet';
  const scale = Math.min(zoomLimits.max, Math.max(zoomLimits.min, view.scale * factor));
  const ratio = scale / view.scale;
  return keepReachable({ x: focal.x - (focal.x - view.x) * ratio, y: focal.y - (focal.y - view.y) * ratio, scale }, screen, bounds);
}
