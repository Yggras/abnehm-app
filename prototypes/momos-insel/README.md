# PROTOTYP – Momos Insel (Runde 2)

> Wegwerfbarer Prototyp zu [Momos Insel prototypen](https://github.com/Yggras/abnehm-app/issues/28). Runde 1 (drei Bildschirmstrukturen: Inselkarte, Inselbuch, Panorama) liegt in Commit `59c8f09` auf diesem Branch.

**Erkenntnisse aus Runde 1 (Nutzer, 2026-10-10):**
- Momo levelt über **Bauen/Pflanzen**, nicht direkt über Tätigkeiten. Umgesetzt: Tagesziele bringen nur Energie; jede verbaute Energie (inkl. Einzahlungen in Gemeinschaftsprojekte) füllt die **eigene Hälfte** des 50/50-Balkens; Levelaufstieg, wenn beide Hälften voll sind.
- Es braucht eine **sehr ansprechende Inselansicht**, die man gern ansieht und ausbauen möchte. Deshalb zeigt Runde 2 dieselbe Insel in drei Bildstilen.
- Jahreszeiten-Deko **kommt im Folgejahr wieder** (plus ein neues Stück); verschenkbar sind **nur Fundstücke/Ereignis-Deko**.

Drei Varianten, umschaltbar über `?variant=` und die schwebende Leiste (oder `←`/`→`):

- `A` – **Isometrisches Diorama:** handgezeichnetes SVG schräg von oben, Wellen, Boot, Jahreszeiten-Partikel, Nebel über dem gesperrten Nordstrand.
- `B` – **Illustrierte Karte:** Aquarell-/Schatzkarten-Stil von oben mit handschriftlichen Bereichsnamen, Kompass, Kartenpins für Ereignisse.
- `C` – **3D Low-Poly:** drehbare und zoombare 3D-Insel (three.js 0.160 vom CDN, daher Internet nötig) mit Schatten, Wasseranimation und Lichtern.

Bedienung in allen drei: Ziehen = verschieben (C: drehen), Pinch/Mausrad = zoomen. Freies eigenes Feld antippen oder „🔨 Bauen“ → Bauplan wählen → leuchtendes Feld antippen. Ereignisse liegen am Strand (oder „✨“). 🗺️ zeigt die Bereiche, 🌙 schaltet auf Abend (Laternen und Fenster leuchten). „Simulation & Regeln“: Tage, Partnerin baut/schenkt, Jahreszeit/Jahr, +10 Energie, Ereignistypen, Tagesdeckel.

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
- Vorbilder für Ereignisse (Saison-Events, Geschenke): [Recherche Spielformen](https://github.com/Yggras/abnehm-app/blob/main/research/spielformen-gesundheitsspiel.md), Abschnitte 1, 2.1, 2.4, 2.9
- three.js r160 und OrbitControls: <https://threejs.org/docs/#examples/en/controls/OrbitControls>

**Nicht belegt (Entwurfsannahmen):** alle Zahlen (1 Energie pro Tagesziel, Baukosten 1–6, Levelbedarf 10 + 2 × Level pro Hälfte, Projektanteile, Tagesdeckel 2), Inselgrundriss, Besucher/Belohnungen, die Bildstile selbst. Ob sich einer der Stile mit Expo/React Native in vergleichbarer Qualität umsetzen lässt, ist **nicht geprüft**.
