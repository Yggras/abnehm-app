# PROTOTYP – Hauptbildschirm und Navigation

> Wegwerfbarer Prototyp zur Frage aus [Hauptbildschirm und Navigation prototypen](https://github.com/Yggras/abnehm-app/issues/15): Wie sind Hauptbildschirm und Navigation aufgebaut, sodass Tagesfortschritt, schnelles Erfassen, Partner-Status und Momo auf einen Blick erreichbar sind?

Drei strukturell unterschiedliche Varianten, umschaltbar über `?variant=` und die schwebende Leiste (oder `←`/`→`):

- `A` – **Momo-Zentrum:** Momo mit 50/50-Levelbalken und Tageszielen ganz oben, darunter Kalorienring, Wasser/Sport/Gewicht und Partner-Karte. Fünf Tabs (Heute · Protokoll · **+** · Momo · Wir), das mittlere „+“ öffnet die Erfassungsauswahl.
- `B` – **Protokoll zuerst:** Der Startbildschirm *ist* das Tagesprotokoll mit „kcal übrig“ als Überschrift; Wasser/Sport/Gewicht als Schnell-Chips, Tagesziele als kompakte Reihe, Momo nur als Abzeichen oben rechts (öffnet ein Sheet). Drei Tabs (Heute · Fortschritt · Wir).
- `C` – **Wischseiten + Erfassungsleiste:** Keine Tab-Leiste; drei wischbare Seiten Ich · Momo · Wir mit Segment-Umschalter oben und einer festen dunklen Leiste unten (Essen · +250 ml · Sport · Gewicht), die auf jeder Seite gleich bleibt.

Interaktiv (nur im Speicher): Essen über „Zuletzt verwendet“ mit Mengenprüfung hinzufügen, Wasser +250 ml, Sporteinheit, Gewicht, Anfeuern/Stupsen. Erledigte Tagesziele füllen die eigene Hälfte des Levelbalkens. Die Simulation (unten rechts) lässt die Partnerin Ziele erledigen oder anfeuern und schaltet auf „ohne Partner“ (Momo als Ei). Nicht gezeigte Tabs sind Platzhalter.

## Starten

Im Repo-Root:

```bash
python3 -m http.server 4174 --directory prototypes/hauptbildschirm
```

Dann <http://localhost:4174/?variant=A> öffnen – am besten zusätzlich auf dem Handy im selben WLAN (`http://<rechner-ip>:4174/?variant=C` zum Wischen).

## Grundlage

Inhalte und Regeln folgen den bisherigen Entscheidungen; Zahlen sind Beispielwerte:

- Momo, drei Tagesziele pro Person, 50/50-Levelbalken, keine „Person X fehlt“-Anzeige: [Gamification-Konzept prototypen](https://github.com/Yggras/abnehm-app/issues/12)
- Bausteine, Standard-Wochenplan (Samstag hier als Sporttag), Wasser/Sport-Ziele, Sportkalorien nur angezeigt, Momo als Ei ohne Kopplung: [Ziele und Onboarding festlegen](https://github.com/Yggras/abnehm-app/issues/14)
- Mahlzeiten mit „+“, Mengenprüfung vor dem Speichern, Hinzufügen-Bildschirm (Suche, Barcode, Foto, Zuletzt): [Erfassungsablauf im Kalorientracker festlegen](https://github.com/Yggras/abnehm-app/issues/13)
- Partner-Sichtbarkeit als Zusammenfassung ohne absolutes Gewicht, Anfeuern, Stupsen: [Karte, Notes](https://github.com/Yggras/abnehm-app/issues/1)

Annahmen ohne Beleg: Platzierung, Gewichtung und Navigationsmuster der Varianten sind Entwurfsideen zum Reagieren, keine belegten Best Practices.
