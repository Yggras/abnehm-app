# PROTOTYP – Momos Insel

> Wegwerfbarer Prototyp zur Frage aus [Momos Insel prototypen](https://github.com/Yggras/abnehm-app/issues/28): Wie fühlt sich Momos Insel an, welche Insel-Ereignisse gibt es, kehrt Jahreszeiten-Deko wieder, darf man Gegenstände schenken, und wie läuft eine Spielrunde ab?

Drei strukturell unterschiedliche Varianten des Tabs „Momo“ (= Insel), umschaltbar über `?variant=` und die schwebende Leiste (oder `←`/`→`):

- `A` – **Inselkarte:** Die ganze Insel als Karte von oben: Nordstrand (Nebel bis Level 5), Meine Ecke · Gemeinschaft · Ecke der Partnerin, Bauen · Lichtung mit Momo · Natur; Ereignisse liegen als Symbole am Strand. Bauen = auf ein freies „＋“-Feld tippen.
- `B` – **Inselbuch:** Insel nur als kleiner Streifen oben; darunter Reiter Ereignisse · Bauen · Projekt · Lager als Listen. Bauen = Bauplan wählen, dann „Wohin?“.
- `C` – **Panorama mit Momo:** Momo spricht oben und schlägt den nächsten Schritt vor; Inselbereiche als wischbare Tafeln; unten eine Rundenleiste ① Neues ② Bauen ③ Ansehen.

Spielbar (nur im Speicher): Ereignisse ansehen, einsammeln oder als Wunsch merken; Baupläne mit Energie bauen; Lager-Deko kostenlos platzieren oder verschenken; Energie in den eigenen Anteil des Gemeinschaftsprojekts einzahlen. Über „Simulation & Regeln“ (unten rechts): Tage, Levelaufstieg (Level 5 öffnet den Nordstrand → Entdeckung), Jahreszeit/Jahr, Partnerin spielt/schenkt; Ereignistypen an/aus, Tagesdeckel, sowie die beiden offenen Fragen als Schalter:

- **Jahreszeiten-Deko im Folgejahr:** „kommt wieder“ (verpasste Deko aus dem Vorjahr kommt mit) oder „einmalig“ (jedes Jahr andere Deko, Verpasstes ist weg). Ausprobieren: „Nächste Jahreszeit“ bis Herbst, „+1 Jahr“, „Nächster Tag“, Wetter-Ereignis öffnen.
- **Schenken:** aus · nur Fundstücke/Ereignis-Deko · auch mit Energie Gebautes. Energie selbst ist nie verschenkbar.

## Starten

Im Repo-Root:

```bash
python3 -m http.server 4176 --directory prototypes/momos-insel
```

Dann <http://localhost:4176/?variant=A> öffnen.

## Grundlage

- Kernschleife, Energie (persönlich, verfällt nie, nicht verschenkbar, max. 3 Ziele + Tagesbonus pro Tag), Rollen Bauen/Natur, eigene Ecke, Gemeinschaftsprojekte ohne Frist, Ereignisse freiwillig/nie verfallend/pro Tag gedeckelt/Ansehen kostenlos, kein „Partner fehlt“: [Spielkonzept festlegen](https://github.com/Yggras/abnehm-app/issues/26)
- Momo, 50/50-Levelbalken: [Gamification-Konzept prototypen](https://github.com/Yggras/abnehm-app/issues/12)
- Tab-Leiste Heute · Protokoll · ＋ · Momo · Wir: [Hauptbildschirm und Navigation prototypen](https://github.com/Yggras/abnehm-app/issues/15)
- Vorbilder für Ereignisse (Saison-Events, Geschenke 1 pro Tag): [Recherche Spielformen](https://github.com/Yggras/abnehm-app/blob/research/spielformen-gesundheitsspiel/research/spielformen-gesundheitsspiel.md), Abschnitte 1, 2.1, 2.4, 2.9

**Nicht belegt (Entwurfsannahmen):** alle Zahlen (1 Energie pro Tagesziel, Baukosten 1–6, Projektanteile 10/14, Tagesdeckel 2), die konkreten Besucher/Fundstücke/Belohnungen, die Aufteilung der Inselfläche und die drei Bildschirmstrukturen.
