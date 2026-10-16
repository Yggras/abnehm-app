# Prototyp: App-Icon „Gemeinsam leichter“

Ticket: [App-Name und App-Icon festlegen (#70)](https://github.com/Yggras/abnehm-app/issues/70) · Stand: 16.10.2026

**Frage:** Welche Bildidee verbindet Momo mit Gesundheit und partnerschaftlicher Unterstützung und bleibt als kleines App-Icon verständlich?

**Wegwerf-Prototyp.** Die Bilder sind KI-generierte Auswahlentwürfe, keine Produktionsgrafiken. Farben, Abstände und Momos Anatomie sind nicht pixelgenau gegen das [Design-System „Lagune“](../../research/design-system.md) geprüft. Qualitätsurteile sind visuelle Einschätzungen, keine Messungen.

## Ansehen

```bash
python3 -m http.server 4184 --directory prototypes/app-icon
```

Dann <http://localhost:4184/?variant=A> öffnen. Die Pfeile oder die Pfeiltasten wechseln zwischen:

- **A · Porträt:** Momo groß vor zwei überlappenden Personenfarben.
- **B · Gemeinsamer Weg:** Zwei farbige Wege laufen unter Momo zusammen.
- **C · Umarmung:** Zwei farbige Bänder umfassen Momo als offenes Herz.

Die Seite zeigt jeden Entwurf vollformatig, mit abgerundeter und runder Vorschau sowie bei 48 px. Die Masken sind eine Designannäherung, keine technische Abnahme für einen Store.

## Erzeugung

- Lokales ComfyUI-Core-Setup und Modelle wie im reproduzierbaren [ComfyUI-Prototyp](../momo-comfyui/README.md): ComfyUI v0.40.0, Qwen-Image-2.1 Turbo int8, keine Custom Nodes.
- Referenz: [`mood-f1-freut.webp`](../momo-lagunenling/images/mood-f1-freut.webp), die beschlossene erste Form des Lagunenlings in freudiger Stimmung.
- Pro Variante ein Referenz-Edit mit frischem 1024 × 1024 Latent und acht Turbo-Schritten.
- Die vollständigen Prompts, Seeds, Referenz-Prüfsummen, Laufzeiten und ausgeführten API-Graphen liegen unter [`runs/`](runs/); die unveränderten Ausgaben unter [`images/`](images/).

| Variante | Seed | Ausführung | Datei |
| --- | ---: | ---: | --- |
| A · Porträt | 701 | 271,1 s | [`a-portrait.png`](images/a-portrait.png) |
| B · Gemeinsamer Weg | 702 | 258,4 s | [`b-path.png`](images/b-path.png) |
| C · Umarmung | 703 | 254,0 s | [`c-embrace.png`](images/c-embrace.png) |

## Vorläufige visuelle Einschätzung

- **A** hat das größte Gesicht und die wenigsten kleinen Einzelheiten; dadurch wirkt es in der 48-px-Vorschau am klarsten. Die zwei Personenfarben sind sichtbar, erzählen aber ohne Kontext keinen „gemeinsamen Weg“.
- **B** übersetzt den Namen am direktesten in ein Wegmotiv. Momo ist kleiner und die drei statt zwei Bodenfarben machen die Aussage unruhiger als beabsichtigt.
- **C** macht gegenseitige Unterstützung am deutlichsten. Das Herz-/Umarmungsmotiv ist leichter verständlich, aber weniger eigenständig als A.

**Empfehlung vor Nutzerfeedback:** A als stärkster App-Icon-Ausgangspunkt; die Überlappung der beiden Farbflächen kann in der Reinzeichnung subtil zu einem gemeinsamen Weg oder einer Umarmung geschärft werden.
