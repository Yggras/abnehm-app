// Bausteine für die flächigen Pfade des Momo-Rigs. Jeder liefert eine geschlossene SVG-Pfadangabe,
// die Skias `Path` direkt zeichnet und als Clip nimmt ([Skia-Doku: Path](https://shopify.github.io/react-native-skia/docs/shapes/path)).
// Koordinaten in Rig-Einheiten, y nach unten; Winkel in Grad, 0° zeigt nach rechts, positiv im
// Uhrzeigersinn wie auf dem Bildschirm.

export type Point = Readonly<{ x: number; y: number }>;

const round = (value: number) => Math.round(value * 100) / 100;
const at = ({ x, y }: Point) => `${round(x)} ${round(y)}`;
const polar = (cx: number, cy: number, r: number, degrees: number): Point => {
  const radians = (degrees * Math.PI) / 180;
  return { x: cx + r * Math.cos(radians), y: cy + r * Math.sin(radians) };
};

/** Ellipse um `(cx, cy)`. */
export function ellipse(cx: number, cy: number, rx: number, ry: number): string {
  return `M${at({ x: cx - rx, y: cy })} A${rx} ${ry} 0 1 1 ${at({ x: cx + rx, y: cy })} A${rx} ${ry} 0 1 1 ${at({ x: cx - rx, y: cy })} Z`;
}

/** Stab mit runden Enden von `a` nach `b`, Radius `r`: Kiemenwedel, Beinchen, Kronenzacken. */
export function capsule(a: Point, b: Point, r: number): string {
  const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const n = { x: (-(b.y - a.y) / length) * r, y: ((b.x - a.x) / length) * r };
  return [
    `M${at({ x: a.x + n.x, y: a.y + n.y })}`,
    `L${at({ x: b.x + n.x, y: b.y + n.y })}`,
    `A${r} ${r} 0 0 0 ${at({ x: b.x - n.x, y: b.y - n.y })}`,
    `L${at({ x: a.x - n.x, y: a.y - n.y })}`,
    `A${r} ${r} 0 0 0 ${at({ x: a.x + n.x, y: a.y + n.y })}`,
    'Z',
  ].join(' ');
}

/** Band zwischen zwei Kreisbögen um denselben Mittelpunkt: Lachaugen, Lächeln, Brauen, Fragezeichen. */
export function arcBand(cx: number, cy: number, outer: number, inner: number, from: number, to: number): string {
  const large = to - from > 180 ? 1 : 0;
  return [
    `M${at(polar(cx, cy, outer, from))}`,
    `A${outer} ${outer} 0 ${large} 1 ${at(polar(cx, cy, outer, to))}`,
    `L${at(polar(cx, cy, inner, to))}`,
    `A${inner} ${inner} 0 ${large} 0 ${at(polar(cx, cy, inner, from))}`,
    'Z',
  ].join(' ');
}

/** Vieleck durch die Punkte. */
export function polygon(points: readonly Point[]): string {
  return `${points.map((point, index) => `${index === 0 ? 'M' : 'L'}${at(point)}`).join(' ')} Z`;
}

/** Stern mit `points` Zacken: der Energie-Funke hat vier. */
export function star(cx: number, cy: number, outer: number, inner: number, points = 4): string {
  const corners = Array.from({ length: points * 2 }, (_, index) => polar(cx, cy, index % 2 === 0 ? outer : inner, -90 + (index * 180) / points));
  return polygon(corners);
}

/**
 * Weiche, geschlossene Kurve durch die Punkte (Catmull-Rom als kubische Bézierkurven). So entstehen
 * die organischen Umrisse aus wenigen Stützpunkten.
 */
export function smooth(points: readonly Point[]): string {
  const n = points.length;
  const p = (index: number) => points[((index % n) + n) % n]!;
  const segments = points.map((_, index) => {
    const [p0, p1, p2, p3] = [p(index - 1), p(index), p(index + 1), p(index + 2)];
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    return `C${at(c1)} ${at(c2)} ${at(p2)}`;
  });
  return `M${at(p(0))} ${segments.join(' ')} Z`;
}
