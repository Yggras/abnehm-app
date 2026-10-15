# PROTOTYP – Momos Gestalt und Entwicklungsformen

> Wegwerfbarer UI-Prototyp zu [Momos Gestalt und Entwicklungsformen festlegen](https://github.com/Yggras/abnehm-app/issues/69). Drei Gestaltvarianten auf einer Seite, umschaltbar über `?variant=`.

## Frage dieser Runde

Welche **Grundgestalt** soll Momo bekommen? Die drei Entwürfe prüfen bewusst unterschiedliche Silhouetten:

- `A` – **Keimling:** samenförmiger Körper und Blattspross; wächst sichtbar mit der Insel.
- `B` – **Lagunenling:** rundes Land-Wasser-Wesen mit Seitenflossen und Ringelschwanz.
- `C` – **Kieselgeist:** aus weichen, versetzten Formen aufgebautes Inselwesen mit langen Fühlern.

Die Namen beschreiben nur die Entwürfe. In der App heißt das Wesen in jeder Variante ausschließlich **Momo**.

Jede Variante zeigt:

- die Grundgestalt in einer Insel-Szene;
- vier Stimmungen als Ausdrucksprobe;
- Ei, geschlüpfte Form sowie Entwicklungsproben für Level 4, 8 und 13;
- Kopf- und Hals-Accessoires an festen Ankerpunkten;
- die Figur in 104-dp-Nähe für „Heute“ und klein auf einem Inselfeld.

Nach der Wahl wird die gewählte Gestalt in einer zweiten Runde für **alle sieben Stimmungen**, das Ei und **alle großen Formen bei Level 4, 8, 13, 19, 26, 34 und 43** ausgearbeitet; danach folgt der verbindliche Accessoire-Katalog.

## Starten

Im Repo-Root:

```bash
python3 -m http.server 4183 --directory prototypes/momo-gestalt
```

Dann <http://localhost:4183/?variant=A> öffnen. Wechsel über die untere Leiste oder `←`/`→`.

## Verbindliche Grundlage

- Flächiger Skia-Stil, festgelegte Farben, Licht von links oben, weiche Formen, keine Zähne/Krallen, Accessoires am Kopf oder Hals, sieben nicht strafende Stimmungen: [Design-System „Lagune“](../../research/design-system.md#momo-und-insel)
- Große Formen und Gebietsfreischaltungen bei Level 4, 8, 13, 19, 26, 34 und 43: [Momos Fortschrittskurve prototypen](https://github.com/Yggras/abnehm-app/issues/18#issuecomment-6109654036)
- Momo wartet ohne Partner als Ei: [Ziele und Onboarding festlegen](https://github.com/Yggras/abnehm-app/issues/14#issuecomment-6100860766)
- Momo-Accessoires kommen aus Momos Wunsch, sitzen am Hals oder Kopf und haben keinen Spielvorteil: [Momos Insel prototypen](https://github.com/Yggras/abnehm-app/issues/28#issuecomment-6108999481)

## Entwurfsstatus

Die drei Gestalten, ihre Namen, Merkmale und Entwicklungsschritte sind **unbelegte Designvorschläge**. Der Browser-Prototyp verwendet SVG statt Skia; er prüft deshalb weder Renderleistung noch die endgültige Zeichenimplementierung. Die kleine Darstellung ist eine visuelle Entwurfsprobe, kein Gerätetest.
