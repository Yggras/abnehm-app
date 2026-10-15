# Prototyp: Lagunenling ausarbeiten (Runde 2)

Ticket: [Momos Gestalt und Entwicklungsformen festlegen (#69)](https://github.com/Yggras/abnehm-app/issues/69) · baut auf [Momo-Konzepttafeln mit ComfyUI prototypen (#72)](https://github.com/Yggras/abnehm-app/issues/72) auf · Stand: 15.10.2026

**Ausgangspunkt:** Am 15.10.2026 hat der Nutzer entschieden, **Familie B · Lagunenling** auszuarbeiten ([Resolution #72](https://github.com/Yggras/abnehm-app/issues/72#issuecomment-6197516389)). Diese Runde arbeitet den Auftrag aus #72 ab: den Sprung zu Level 13 verstärken, Level 43 bei 104 dp lesbar halten, Konturen, Türkis und Farbdrift gegen die Stilregeln normalisieren. Dazu kommen alle Entwicklungsformen, die Stimmungen, das Ei und eine erste Accessoire-Probe.

**Nutzerentscheidungen (15.10.2026):** Level 43 wird der **sitzende Drache** (43b). Ohne Kopplung wartet Momo als **Laichkugel** (Ei B). Accessoires liegen in einem **gemeinsamen Schrank**: Beide können sie Momo an- und ablegen, die letzte Änderung gilt. Der schwache Sprung **Level 26 → 34 bleibt so**. Die verbindliche Fassung steht in [research/design-system.md › Momo](../../research/design-system.md#momo) und im Resolution-Kommentar von #69.

**Wegwerf-Prototyp.** Gestalten, Namen und Merkmale sind unbelegte Designvorschläge. Verbindliche Farben und Stilregeln stammen aus dem [Design-System „Lagune“](../../research/design-system.md#momo-und-insel). Die Bilder dienen als Vorlage. In der App wird Momo als Skia-Ebenenrig in Token-Farben gezeichnet ([Recherche Produktionsstrategie](../../research/momo-animation-assets.md), Abschnitt 10).

## Tafeln

| Tafel | Inhalt |
| --- | --- |
| [`boards/formen.webp`](boards/formen.webp) | alle acht Formen (Level 1, 4, 8, 13, 19, 26, 34, 43), Level 43 in zwei Varianten; je Silhouette, 104 px und 40 px |
| [`boards/stimmungen.webp`](boards/stimmungen.webp) | sechs Stimmungen auf der Kaulquappe und auf dem sitzenden Drachen |
| [`boards/ei.webp`](boards/ei.webp) | zwei Ei-Varianten |
| [`boards/accessoires.webp`](boards/accessoires.webp) | je ein Kopf- und ein Hals-Accessoire auf Kaulquappe, Level 13 und beiden Drachen, dazu eine Skizze mit zwölf Kandidaten. Im festgelegten Katalog ersetzt „Halsglöckchen“ die Fliege, weil sie der Haarschleife zu ähnlich sah. |

Die 104 px entsprechen `momo-today` bei 1× ([Design-System, Größen](../../research/design-system.md)). Die 40 px sind eine *eigene Annäherung* an „auf der Insel etwa ein Feld hoch“ (ein Feld ist 64 × 32 dp, ebd. › Insel). Einzelbilder liegen unter [`images/`](images/), das vollständige Protokoll je Bild (Prompt, Seed, Vorlagen mit SHA-256, Laufzeit, ausgeführter API-Graph) unter [`runs/`](runs/).

## Formenkette

Jede Form ist ein Referenz-Edit der vorigen gewählten Form. Ausnahme: Beide Varianten von Level 43 entstehen aus Level 34. Die Level sind die Gebietsschwellen aus [Momos Fortschrittskurve prototypen (#18)](https://github.com/Yggras/abnehm-app/issues/18).

| Level | Form | Körperbau und Umriss | Lauf |
| --- | --- | --- | --- |
| 1 | Kaulquappe | großer runder Kopf, kurzer Flossenschwanz, keine Gliedmaßen; schwebt | `fix-f1-shade-s602` (aus `f1-s601`, Bereinigung der #72-Grundform) |
| 4 | Hüpfer | sitzt auf zwei Hinterbeinchen, winzige Ärmchen, Schwanz um die Füße | `f2-s603` |
| 8 | Krabbler | waagerecht auf vier kurzen Beinen wie ein junger Axolotl | `fix-f3-color-s607` (aus `f3-s604`, Farbkorrektur) |
| 13 | Aufrechter | steht aufrecht wie ein Otter, Paddelflossen vor der Brust | `f4-s607` (zweiter Versuch, siehe unten) |
| 19 | Springer | C-Bogen wie ein springender Delfin, Korallenflossen, Rückensaum, Fluke | `f5-s608` |
| 26 | Spirale | aufrechte Spirale wie ein Seepferdchen, gekräuselter Flossenkamm | `f6-s610` |
| 34 | Flügling | schwebt unter zwei rundlichen Flügelpaaren, Schwanz hängt in einer Welle | `f7-s611` |
| 43a | Drache, fliegend | Körper zum Ring geschlungen, spitze Flügel nach oben, Kiemenkrone | `f8a-s613` |
| 43b | Drache, sitzend | sitzt wie eine Katze, Flügelfächer hinter dem Rücken, Schwanz um die Füße, Kiemenkrone | `f8b-s613` |

## Auswertung

Alle Urteile sind visuelle Einschätzungen des Agenten, keine Messungen.

| Kriterium aus #72 | Ergebnis | Beobachtung |
| --- | --- | --- |
| Sprung zu Level 13 verstärken | erfüllt | Die Kette hat jetzt Zwischenformen. Level 8 liegt waagerecht auf vier Beinen, Level 13 steht senkrecht. In #72 wurde die Figur von der geschlüpften Form bis Level 13 nur schlanker. |
| Level 43 bei 104 dp lesbar | erfüllt | Beide Varianten sind etwa so breit wie hoch. In #72 war die Form waagerecht und füllte das Quadrat nur in der Breite. Bei 104 px bleibt das Gesicht erkennbar, wird ab Level 26 aber klein. |
| Konturen | weitgehend erfüllt | Grundform per Edit ohne Kontur; die Folgeformen erben das. Rest: dünne Aderlinien in den Flügeln von Level 34 und 43a. |
| Türkis-Anteil | erfüllt | Flossen, Kamm und Flügel sind Koralle. Begründung: Momo steht auf „Heute“ vor `momo-stage` (#DDF0EE) und auf der Insel über der Lagune; türkise Flossen hätten dort wenig Kontrast (*eigene Einschätzung*). |
| Farbdrift | teilweise | Ohne Gegenmaßnahme wird jede Edit-Stufe oranger. Hex-Wert im Prompt plus eine Farbkorrektur bei Level 8 holten die Kette zurück, ab Level 19 driftet sie wieder. Das ist für Vorlagen hinnehmbar, weil das Rig die Token-Farben verwendet. |
| Varianz der Formen | weitgehend erfüllt | Level 1 bis 19 und 34 → 43 wechseln jeweils den Umriss. **Schwächster Sprung: Level 26 → 34**, derselbe senkrechte S-Körper bekommt Flügel. |
| Identität | erfüllt | Gesicht, Wangen, Kiemenwedel und Bauchstreifen bleiben auf allen Formen. Bei Level 26 verschmelzen rechts Kiemenwedel und Kamm. |

**Ablauf-Erkenntnisse** (aus den Läufen dieser Runde):

1. **Farbdrift summiert sich über Edit-Ketten.** Ein Hex-Wert im Edit-Prompt allein hält die Farbe nicht. Ein eigener Edit „nur umfärben“ wirkt und lässt Umriss und Gesicht unverändert (`fix-f3-color-s607`).
2. **„Senkrecht und höher als breit“ wirkt stärker als ein Posenwort.** „rears up … in an S-curve“ ergab einen liegenden Körper mit langem Hals (`f4-s606`). Erst „the whole body is now vertical and taller than wide“ brachte die aufrechte Form (`f4-s607`).
3. **Stimmungs-Prompts schlagen Hinweise zum Körperbau.** Verlangte der Stimmungstext erhobene Arme, bekam die Kaulquappe Arme, auch mit dem Zusatz „no arms“ (`mood-f1-freut-s609`). Erst ein eigener Text für Formen ohne Gliedmaßen half (`mood-f1-freut-s612`).
4. **Lokale Korrekturen per Edit funktionieren weiter** (Konturen entfernen, Schatten umfärben, Ei flach zeichnen).

**Offene Fehler und Grenzen**

- Farbdrift ab Level 19, Aderlinien in den Flügeln, verschmolzene Kiemenwedel bei Level 26.
- Die Accessoire-Skizze hat Konturen und Strukturen, Schleife und Fliege sehen fast gleich aus.
- Die Stimmungs-Edits des Drachen verändern neben dem Gesicht auch die Haltung (er steht teils statt zu sitzen). Im Rig sind Gesicht und Haltung ohnehin getrennt.
- Hibiskus in Koralle hebt sich auf den Drachen kaum von Kiemenwedeln und Krone ab; daraus folgt die Farbregel für Kopf-Accessoires.
- Stimmungen nur auf zwei Formen. Für den vertikalen Schnitt empfiehlt die Produktionsstrategie die erste und die größte Form (Abschnitt 10).
- Die Tafeln normieren jede Form auf dieselbe Kachelgröße; Wachstum ist nicht dargestellt.
- Je Stufe gibt es ein bis zwei Läufe; Seeds variieren beim Turbo-Modell kaum ([#72, Ablauf-Erkenntnis 1](../momo-comfyui/README.md#auswertung)).

## Reproduktion

Setup, Modelle und Workflows wie in [#72](../momo-comfyui/README.md#reproduktion): ComfyUI Core v0.40.0 ohne Custom Nodes, Qwen-Image-2.1 Turbo int8, 768 px, Edit-KV-Cache int8, MacBook Pro M2 Pro 32 GB. Der Client [`../momo-comfyui/tools/comfy.py`](../momo-comfyui/tools/comfy.py) wird wiederverwendet.

```bash
# Server wie in #72 starten, dann im Repo:
PY=~/personal/comfyui-momo/venv/bin/python
$PY prototypes/momo-lagunenling/tools/gen.py f1 --seed 601            # Bereinigung der #72-Grundform
$PY prototypes/momo-lagunenling/tools/gen.py fix:f1:shade --seed 602  # Korrektur eines gewählten Laufs
$PY prototypes/momo-lagunenling/tools/gen.py f2 --seed 603            # nächste Form aus der gewählten vorigen
$PY prototypes/momo-lagunenling/tools/gen.py mood:f1:freut acc:f1:strohhut+muschelkette egg-a
$PY prototypes/momo-lagunenling/tools/board.py                        # selection.json → images/, runs/, boards/
```

Vorlagen löst `gen.py` über [`selection.json`](selection.json) auf (Job → gewählter Lauf); `--use JOB=LAUF` überschreibt das für einen Aufruf. Prompts stehen in [`prompts.json`](prompts.json); maßgeblich für jedes Bild ist der Prompt im jeweiligen Protokoll unter `runs/`, weil `prompts.json` während der Runde nachgeschärft wurde. Rohbilder liegen außerhalb des Repos unter `~/personal/comfyui-momo/runs/B2/`.

### Laufzeit

Gemessen am 15.10.2026, Ausführungszeit laut `/history` aus den Rohprotokollen unter `~/personal/comfyui-momo/runs/B2/` (alle 33 Läufe dieser Runde einschließlich verworfener; im Repo liegen nur die gewählten): **Edit Median 160,9 s** (n = 30, 159,7–171,1 s), **Text-zu-Bild Median 124,9 s** (n = 3, 124,2–126,2 s). Anders als in #72 gab es keine Ausreißer über 400 s.

## Quellen

- Vorarbeit: [Prototyp #72 (README)](../momo-comfyui/README.md), [Resolution #72](https://github.com/Yggras/abnehm-app/issues/72#issuecomment-6197516389)
- Stilregeln, Stimmungen, Größen und Farben: [research/design-system.md](../../research/design-system.md#momo-und-insel)
- Produktionsstrategie (Skia-Ebenenrig, Steckplätze): [research/momo-animation-assets.md](../../research/momo-animation-assets.md)
- Gebietsschwellen: [Momos Fortschrittskurve prototypen (#18)](https://github.com/Yggras/abnehm-app/issues/18); Accessoires aus „Momos Wunsch“: [Momos Insel prototypen (#28)](https://github.com/Yggras/abnehm-app/issues/28)
- ComfyUI und Modell: siehe [Quellen in #72](../momo-comfyui/README.md#quellen)
