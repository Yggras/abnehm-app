# PROTOTYP – Momos Fortschrittskurve

## Frage

Welche Energie je Tagesziel und Tagesbonus, welche Levelkurve (in **verbauter Energie** je Hälfte des 50/50-Balkens), welche Baukosten und welches Freischalttempo für Baupläne und Gebiete wirken über gute, gemischte und ungleiche Wochenverläufe motivierend, ohne zu schnell ausgeschöpft oder unerreichbar zu sein?

## Runde 2: Kette Tagesziele → Energie → Bauen → Levelbalken

Grundlage ist die Entscheidung [Momos Insel prototypen](https://github.com/Yggras/abnehm-app/issues/28): Tagesziele und Tagesbonus bringen nur Energie. Jede selbst verbaute Energie, auch eine Einzahlung in ein Gemeinschaftsprojekt, füllt die eigene Hälfte des 50/50-Balkens. Überschuss bleibt erhalten. Ausgangsrichtung ist Kurve B aus Runde 1. Rahmen aus [Spielkonzept festlegen](https://github.com/Yggras/abnehm-app/issues/26): Energie verfällt nie, Level schaltet Baupläne frei, größere Meilensteine schalten Gebiete frei.

Drei Varianten, umschaltbar über `?variant=B1`, `?variant=B2` und `?variant=B3`:

- **B1 – Kurve B, kleine feste Preise:** Bedarf je Hälfte 10 + 2 × Level, höchstens 40. Neue Baupläne kosten 1–6 Energie.
- **B2 – Kurve B, Preise wachsen mit:** gleicher Bedarf. Ein Bauplan von Level L kostet etwa 3 + 0,6 × L.
- **B3 – Kurve B flacher, Preise wachsen mit:** Bedarf 10 + Level, höchstens 30. Preise wie B2.

Gemeinsam: 1 Energie je erfülltem Tagesziel, Tagesbonus +1 (umschaltbar auf +2). Zum Start gibt es drei Baupläne je Rolle (1/2/3 Energie). Jedes Level bringt einen Bauplan je Rolle. Große Formen (Level 4, 8, 13, 19, 26, 34, 43, aus Kurve B) öffnen je ein Gebiet mit zwei zusätzlichen Entdeckungs-Bauplänen je Rolle. Für den Platz gilt die Annahme: 30 Felder je Person zum Start plus 20 je Gebiet.

Umschaltbar sind außerdem der Wochenverlauf (4 Szenarien aus Runde 1), der Zeitraum (4/12/26/52 Wochen), das Bauverhalten (sofort bauen oder auf den neuesten Bauplan sparen) und der Anteil der Energie, der ins Gemeinschaftsprojekt fließt (0/25/50 %).

**Alle Zahlen sind Designvorschläge und nicht belegt.**

## Runde 3: Motivation über das erste Jahr hinaus

Nutzerentscheidung vom 2026-10-11: **Preise aus B2 mit dem Tempo aus B3**. Das entspricht Variante B3, die jetzt die Voreinstellung ist (Preisdeckel 24 Energie). Der Zeitraum reicht bis 104 Wochen, eine Tabelle vergleicht das erste mit dem zweiten Jahr. Die Feldgrenze wird jetzt durchgesetzt: Ist kein Feld frei, kann man nicht neu bauen.

Neue Schalter:
- **Nach dem siebten Gebiet:** *Nichts* · *Endlose Gebiete* (alle 6 Level eine neue Landschaft, +Felder, ein wiederverwendeter Bauplan je Rolle) · *Inselkapitel* (6 Level nach dem siebten Gebiet eine Nachbarinsel; Levelbedarf und Preise beginnen wieder klein, die alte Insel bleibt)
- **Platz je Person:** *Knapp* (30 + 20 je Gebiet) · *Großzügig* (60 + 40 je Gebiet) · *Unbegrenzt*
- **Aufwerten:** Ist kein Feld frei, wird Gebautes aufgewertet (Stufe 2 kostet das 2-Fache, Stufe 3 das 3-Fache des Grundpreises)

Alle Zahlen bleiben Designvorschläge und sind nicht belegt.

## Start

Im Repo-Root:

```bash
python3 -m http.server 4180 --directory prototypes/momo-fortschrittskurve
```

Dann <http://localhost:4180/?variant=B3> öffnen. Die Varianten lassen sich über die Leiste unten oder mit den Pfeiltasten wechseln.

## Runde 1

Die drei punktbasierten Kurven A/B/C (Tagesziele füllten den Balken direkt) stehen in Commit [`315b415`](https://github.com/Yggras/abnehm-app/commit/315b415). B wurde dort als Ausgangsrichtung bevorzugt.
