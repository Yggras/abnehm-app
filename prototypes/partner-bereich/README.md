# PROTOTYP – Partner-Bereich und Einstellungen

Wegwerfbarer UI-Prototyp für [Partner-Bereich (Tab „Wir“) und Einstellungen prototypen](https://github.com/Yggras/abnehm-app/issues/43).

**Frage:** Welche Informationshierarchie macht den Partner-Bereich motivierend und übersichtlich, ohne Vergleich oder Kontrolldruck, und wie werden die festgelegten Einstellungen auffindbar?

Drei strukturell unterschiedliche Varianten auf einer Route, wechselbar über `?variant=`:

- **A – Überblick:** Partnerzusammenfassung und getrennte Arbeitskarten für Challenge, Gemeinschaftsprojekt und Anfeuern.
- **B – Miteinander:** emotionaler Einstieg und chronologischer Aktivitätsstrom.
- **C – Zwei Welten:** klare Trennung zwischen gemeinsamer Gesundheit und Momos Insel.

Die Einstellungen sind in allen Varianten identisch, damit nur die Struktur des Tabs „Wir“ verglichen wird. Zahnrad öffnen; besonders vollständig sind **Partner & Freigaben** und **Benachrichtigungen**.

## Ausgewählte Kombination

Nach Nutzerfeedback ist **A – Überblick** die Grundstruktur. Aus B übernimmt sie den Verlauf **„Neu bei euch“** mit drei ausschließlich gemeinsamen Ereignissen und einer nach Wochen gruppierten Gesamtansicht. Individuelle Tracker-Aktivitäten des Partners erscheinen dort nicht. Vorgänge, die eine Antwort brauchen, stehen oben; die Partnerübersicht zeigt die Aktualität als „Stand vor …“ statt den letzten App-Besuch.

## Start

Im Repo-Root:

```bash
python3 -m http.server 4177 --directory prototypes/partner-bereich
```

Dann öffnen:

- <http://localhost:4177/?variant=A>
- <http://localhost:4177/?variant=B>
- <http://localhost:4177/?variant=C>

Pfeile unten oder `←`/`→` wechseln die Variante. Unter **Simulation** lassen sich Solo-Zustand, Challenge-Vorschlag und eingehende Anfeuerung ausprobieren.

## Bewusst nicht produktionsreif

Nur statisches HTML/CSS/JavaScript mit synthetischen Daten; keine Persistenz, kein Backend und keine echten Gesundheitsdaten. Zahlen und visuelle Details sind nicht belegt und dienen ausschließlich der Designentscheidung.
