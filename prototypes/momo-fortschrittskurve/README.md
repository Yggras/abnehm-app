# PROTOTYP – Momos Fortschrittskurve

## Frage

Welche Punkteverteilung, Levelkurve und Abfolge kleiner Veränderungen beziehungsweise großer Entwicklungsformen wirkt über gute, gemischte und ungleiche Wochenverläufe motivierend, ohne zu schnell ausgeschöpft oder unerreichbar zu sein?

Drei Designvarianten sind über `?variant=A`, `?variant=B` und `?variant=C` umschaltbar. Die simulierten Werte sind **Designvorschläge**, keine wissenschaftlich belegten Fakten. Der fachliche Rahmen stammt aus der Entscheidung [Gamification-Konzept prototypen](https://github.com/Yggras/abnehm-app/issues/12): drei persönliche Tagesziele, Bonus für einen vollständigen Tag, ein gemeinsamer 50/50-Levelbalken, bleibender Fortschritt und keine Bestrafung für Pausen.

## Start

Im Repo-Root:

```bash
python3 -m http.server 4180 --directory prototypes/momo-fortschrittskurve
```

Dann <http://localhost:4180/?variant=A> öffnen.

Die Varianten lassen sich über die Leiste unten oder mit den Pfeiltasten wechseln. Wochenverlauf und Simulationsdauer sind oben auf der Seite wählbar.

## Bewusste Annahme

Punkte oberhalb einer bereits gefüllten Hälfte bleiben für spätere Level vorgemerkt. Dadurch gehen Beiträge nicht verloren, während die andere Person aufholt. Ob dieser Überhang in der fertigen App sichtbar sein soll, ist mit diesem Prototyp noch nicht entschieden.
