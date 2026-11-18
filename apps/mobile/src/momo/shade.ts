import { PathOp, Skia, type SkPath } from '@shopify/react-native-skia';

// Zweitönige Schattierung mit Licht von links oben (Design-System › Momo, Zeichenstil): Der Schatten
// einer Fläche ist die Fläche ohne ihre nach links oben versetzte Kopie, also eine Sichel an der rechten
// und unteren Kante wie auf den Vorlagen in prototypes/momo-lagunenling. Skia rechnet die Differenz
// ([Skia-Doku: Path Operations](https://shopify.github.io/react-native-skia/docs/shapes/path#path-operations)).
// Der Versatz in Teilen von Breite und Höhe ist ein Designwert aus #187, nicht belegt.

const lightOffset = { x: 0.24, y: 0.14 } as const;

const cache = new Map<string, SkPath | null>();

/** Schattensichel einer Fläche, `null`, wenn Skia sie nicht berechnen kann. */
export function shadeOf(svg: string): SkPath | null {
  const cached = cache.get(svg);
  if (cached !== undefined) return cached;
  const body = Skia.Path.MakeFromSVGString(svg);
  let shade: SkPath | null = null;
  if (body !== null) {
    const bounds = body.computeTightBounds();
    const lit = Skia.PathBuilder.MakeFromPath(body)
      .offset(-bounds.width * lightOffset.x, -bounds.height * lightOffset.y)
      .build();
    shade = Skia.Path.MakeFromOp(body, lit, PathOp.Difference);
  }
  cache.set(svg, shade);
  return shade;
}
