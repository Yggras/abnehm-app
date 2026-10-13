# PROTOTYP – Gamification-Konzept

> Wegwerfbarer Prototyp zur Frage: Welches spielerische Kernelement motiviert beide Partner, ohne Druck oder Bestrafung bei verfehlten Zielen zu erzeugen?

Drei strukturell unterschiedliche Varianten auf einer Route, umschaltbar über `?variant=` und die schwebende Leiste:

- `A` – **Momo:** gemeinsames digitales Wesen und gemeinsame Energie
- `B` – **Expedition:** zeitlich begrenzte gemeinsame Reise, zu der beide beitragen
- `C` – **Sammelalbum:** persönliche Level und bleibende Sammelkarten mit Duo-Meilensteinen

Alle Varianten reagieren auf Erfolge und verfehlte Ziele. Die Simulationsleiste macht die Zustandsänderungen sichtbar; unter „Vollständiger Zustand“ steht jederzeit das In-Memory-Modell.

## Starten

Im Repo-Root:

```bash
python3 -m http.server 4173 --directory prototypes/gamification
```

Dann [http://localhost:4173/?variant=A](http://localhost:4173/?variant=A) öffnen. Mit `←` und `→` oder der unteren Leiste zwischen den Varianten wechseln.

## Annahmen

- Es existiert noch keine App-Seite, in die der Prototyp eingebettet werden könnte; deshalb ist dies eine eigenständige Mobil-Webseite.
- „Partnerin“ bleibt absichtlich generisch, weil ihr Name in der bisherigen Spezifikation nicht festgelegt ist.
- Der Prototyp persistiert nichts und führt keine echten Aktionen aus.

## Evidenzgrundlage

Die Mechaniken folgen den Empfehlungen aus der Projektrecherche: Fortschritt sichtbar machen, Ermutigung statt Partnerdruck, verfehlte Ziele nicht hart bestrafen und unterbrochene Serien abfedern. Primärquellen und Evidenzbewertung sind im vollständigen Recherchebericht verlinkt:

- [Recherche: Studienlage zu Gamification und Motivation beim Abnehmen](https://github.com/Yggras/abnehm-app/blob/research/gamification-evidence/research/gamification-evidence.md)
