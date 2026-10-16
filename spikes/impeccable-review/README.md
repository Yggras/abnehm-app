# Arbeitsordner: Impeccable-Prüfung

Belege zu [„Design-System und Kernabläufe mit Impeccable prüfen“](https://github.com/Yggras/abnehm-app/issues/91). Das Ergebnis steht in [`research/impeccable-review.md`](../../research/impeccable-review.md).

| Inhalt | Zweck |
| --- | --- |
| `screens/heute.png`, `screens/momo.png`, `screens/wir.png` | Die drei Referenzentwürfe aus dem Artifact, in headless Chrome gerendert (HTML-Entwürfe, keine Gerätebilder) |
| `DESIGN.md` | Momentaufnahme aus `/impeccable document` (Scan-Modus über `tokens.json`). **Nicht maßgeblich**; maßgeblich bleibt [`research/design-system.md`](../../research/design-system.md). |
| `artifact/` (nicht im Repo) | lokale Kopie der Artifact-Dateien, mit Artifact-`read` wieder abrufbar |

Die Bilder entstanden aus der Artifact-Version `1792094930-af8a`:

1. Die Dateien unter `project/` per Artifact-`read` nach `artifact/` holen.
2. `artifact/project` lokal ausliefern (`python3 -m http.server`).
3. `components/Bildschirm*/preview.html` in der Kartengröße aus dem Kopfkommentar `@dsCard` öffnen und aufnehmen.
