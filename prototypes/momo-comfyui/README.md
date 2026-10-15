# Prototyp: Momo-Konzepttafeln mit ComfyUI

Ticket: [Momo-Konzepttafeln mit ComfyUI prototypen (#72)](https://github.com/Yggras/abnehm-app/issues/72) · Vorarbeit für [Momos Gestalt und Entwicklungsformen festlegen (#69)](https://github.com/Yggras/abnehm-app/issues/69) · Stand: 15.10.2026

**Nutzerentscheidung (15.10.2026):** Das Ergebnis reicht als Auswahlgrundlage für #69. Ausgearbeitet wird **Familie B · Lagunenling** ([Kommentar in #72](https://github.com/Yggras/abnehm-app/issues/72)).

**Wegwerf-Prototyp.** Alle Gestalten, Namen und Merkmale sind unbelegte Designvorschläge zur Auswahl in #69. Verbindliche Farben und Stilregeln kommen aus dem [Design-System „Lagune“](../../research/design-system.md#momo-und-insel).

## Tafeln

| Tafel | Inhalt |
| --- | --- |
| [`boards/familie-a.webp`](boards/familie-a.webp) | Familie A · Dünenläufer – bodennaher, kräftiger Vierbeiner |
| [`boards/familie-b.webp`](boards/familie-b.webp) | Familie B · Lagunenling – langes, geschwungenes Lagunenwesen |
| [`boards/familie-c.webp`](boards/familie-c.webp) | Familie C · Wolkenschweber – breites, schwebendes Inselwesen |
| [`boards/silhouetten.webp`](boards/silhouetten.webp) | alle zwölf Ankerformen als schwarze Silhouetten |

Jede Familientafel zeigt die vier Ankerformen **geschlüpft, Level 13, Level 26, Level 43**, darunter ihre Silhouetten und dieselben Bilder in Momos Anzeigegröße auf „Heute“ (`momo-today`, 104 dp; auf der Tafel 104 px, also die 1×-Dichte). Die einzelnen Bilder liegen unter [`images/`](images/), das vollständige Laufprotokoll je Bild (Prompt, Seed, Referenzen mit SHA-256, Laufzeit, ausgeführter API-Graph) unter [`runs/`](runs/).

## Auswertung

**Kurzurteil: Ja, mit Einschränkungen.** Das lokale Core-only-Setup liefert drei schon als Silhouette klar verschiedene Familien. Jede hat vier Ankerformen, die über Gesicht, Wangen, Palette und die zwei konstanten Merkmale als dieselbe Figur erkennbar bleiben. Das reicht als Auswahlgrundlage für #69. Als Produktionsgrafik reicht es nicht: Dünne Konturen, Fell- und Wurzelstruktur sowie Farbdrift verletzen stellenweise die Stilregeln. Außerdem brauchten die Entwicklungssprünge Art-Direction durch geschärfte Prompts und Seed-Auswahl, zwei Sprünge eine zweite Runde. Alle Bewertungen sind visuelle Einschätzungen des Agenten, keine Messungen.

| Kriterium | Ergebnis | Beobachtung |
| --- | --- | --- |
| Varianz der Familien | erfüllt | Silhouettentafel: A bodennah auf vier Beinen, B senkrechte S-Kurve bis waagerechter Drache, C flach und breit. Die Fortbewegung unterscheidet sich (laufen, schlängeln/schwimmen, gleiten/schweben). |
| Varianz der Formen | weitgehend erfüllt | **A:** jede Stufe mit neuer Haltung und neuen Proportionen (liegend → trabend → aufrecht mit Mooskragen → flache Kuppel auf Säulenbeinen). **B:** Level 13 nur mäßig (schlanker, Paddelflossen), Level 26 Spirale mit Flossenkamm, Level 43 waagerechter Drache. **C:** Kissen → Manta → gewellte Ränder mit Ranken und Bäumchen; **Level 26 → 43 ist überwiegend aufgesetztes Detail** (Insellandschaft, Wurzeln) bei ähnlichem Umriss. |
| Identitätskonsistenz | erfüllt innerhalb jeder Kette | A: Blattohren und Blesse auf allen vier Formen. B: Kiemenwedel und Bauchstreifen auf allen vier. C: Seitenflossen auf allen vier; die Augen stehen nur mäßig „sehr weit“ auseinander. Gesicht und Wangen bleiben je Familie gleich. |
| Lesbarkeit bei 104 dp | gemischt | A und B bis Level 26 gut. Breite Formen (C ab Level 13, B Level 43) füllen das quadratische Feld nur in der Breite, das Gesicht wird sehr klein. |
| Stiltreue | teilweise | Viele Bilder haben dünne dunkle Konturen (Regel: ohne Kontur). Strukturen bei A Level 26/43 (Mähne) und C Level 43 (Wurzeln). Farbdrift: C wird satter orange, A und B tragen viel Grün bzw. Türkis. Licht von links oben und zweitönige Schattierung sind überwiegend eingehalten. |

**Ablauf-Erkenntnisse** (aus den Läufen dieses Prototyps):

1. **Seeds variieren beim Turbo-Modell kaum** – die vier Grundformen A s101–s104 sind fast gleich. Varianten entstehen über den Prompt, nicht über den Seed.
2. **Lange Edit-Prompts verhindern Entwicklung.** Mit dem wiederholten Stilblock änderte das Modell fast nur die Haltung (`A-l13-edit-s201`). Kurze, explizite Änderungsanweisungen wirkten (`A-l13-edit-s201-v2`). Ein leeres Latent statt der Leinwand von `<image1>` brachte keinen Unterschied (`A-l13-ref-s201`).
3. **Sprünge, die nur Details aufsetzen, brauchen Umriss-Anweisungen.** A und B Level 43 wurden erst mit „whole silhouette changes into …“ deutlich anders (v2).
4. **Lokale Korrektur funktioniert:** Der leicht traurig wirkende Mund der Grundform B wurde per Edit zum Lächeln, der Rest blieb erhalten (Regel: Momo nie traurig).
5. **Kein Fallback nötig:** Weder ControlNet noch IP-Adapter, Core hielt die Identitätsmerkmale.

**Offene Fehler und Grenzen**

- Konturen, Strukturen und Farbdrift müssen vor einer Produktion manuell oder als Vektor normalisiert werden ([Recherche ComfyUI, Abschnitt 4](https://github.com/Yggras/abnehm-app/blob/bb1de0a/research/comfyui-momo-assets.md)).
- Die Tafeln normieren jede Form auf dieselbe Kachelgröße; das Wachstum zwischen den Stufen ist nicht dargestellt.
- Ei, Zwischenformen, Stimmungen und Accessoires fehlen bewusst (Ticket-Umfang).
- Je Familie gibt es nur eine Kette; der Agent hat aus 2–4 Kandidaten je Stufe ausgewählt. Die nicht gewählten Rohbilder liegen außerhalb des Repos.
- Die 104-dp-Zeile zeigt 104 px bei 1×; auf einem 3×-Display sind es 312 px (*eigene Annäherung*).

### Auswahl

| Familie | Geschlüpft | Level 13 | Level 26 | Level 43 |
| --- | --- | --- | --- | --- |
| A | t2i s103 (bf16) | Edit s201 (v2-Prompt) | Edit s301 | Edit s403 (v2-Prompt) |
| B | t2i s101 (bf16) + Mund-Edit s111 | Edit s211 | Edit s312 | Edit s414 (v2-Prompt) |
| C | t2i s113 (geschärfter Prompt) | Edit s221 | Edit s321 | Edit s421 |

Jede Stufe ist ein Referenz-Edit der jeweils gewählten Vorform (`<image1>`). Es gibt keine unabhängigen Neuerfindungen. Das Protokoll des Ausgangsbilds für die Mund-Korrektur von B liegt in `runs/B-hatchling-base.json`. `prompts.json` enthält die zuletzt verwendeten Prompts; die frühen Fassungen stehen in den Protokollen unter `runs/`.

## Reproduktion

### Hardware und Software

| | Stand |
| --- | --- |
| Rechner | MacBook Pro, Apple M2 Pro, 32 GB gemeinsamer Speicher, macOS 26.6.2 (25G83) |
| ComfyUI | Core [`v0.40.0`](https://github.com/Comfy-Org/ComfyUI/releases/tag/v0.40.0) (Commit `3541246a9c997f4b8c32f9f88f3c985d02021c79`, Release vom 13.10.2026), manuell per `git clone` |
| Python | 3.13.14 (uv-venv); ComfyUI nennt 3.13 „very well supported“ ([README v0.40.0](https://github.com/Comfy-Org/ComfyUI/blob/v0.40.0/README.md)) |
| PyTorch | Nightly `2.16.0.dev20261015`, torchvision `0.30.0.dev20261014`; ComfyUI verlangt auf Apple Silicon die aktuelle Nightly nach [Apples Anleitung](https://developer.apple.com/metal/pytorch/) ([README v0.40.0, „Apple Mac silicon“](https://github.com/Comfy-Org/ComfyUI/blob/v0.40.0/README.md#apple-mac-silicon)) |
| Pakete | vollständig in [`requirements.lock.txt`](requirements.lock.txt), u. a. `comfyui-frontend-package` 1.55.17, `comfyui-workflow-templates` 0.11.82, `comfy-kitchen` 0.2.37 |
| Custom Nodes | **keine**. `custom_nodes/` enthält nur die beiden Beispieldateien des Core-Repos. |

### Modelle

Alle Dateien stammen aus [Comfy-Org/Qwen-Image-2.1](https://huggingface.co/Comfy-Org/Qwen-Image-2.1) (Model Card: Turbo „Use 8 steps and cfg 1“). Die lokal berechneten SHA-256 stimmen mit den LFS-Prüfsummen auf Hugging Face überein ([Dateiliste per API](https://huggingface.co/api/models/Comfy-Org/Qwen-Image-2.1/tree/main?recursive=true)).

| Ordner `ComfyUI/models/…` | Datei | Größe | SHA-256 | Verwendet für |
| --- | --- | --- | --- | --- |
| `diffusion_models/` | `qwen_image_2.1_turbo_int8_convrot.safetensors` | 7,26 GB | `8144a0182964aa8403ad6dbc011db837304167d235161b9aabaa8532e967314c` | alle Entwicklungsstufen, Grundformen B (außer s101) und C |
| `diffusion_models/` | `qwen_image_2.1_turbo_bf16.safetensors` | 14,23 GB | `8b74237a7f505773e2c66726fa696444b4c704585c93a347cff9044937f7914a` | Grundformen A und B s101 (danach wegen Swap verworfen, siehe Laufzeit) |
| `text_encoders/` | `qwen3vl_8b_int8_convrot.safetensors` | 9,35 GB | `8bfd0f6e12abf2d2d697ecc888e5e90b0d6741d6708f05799f53afa560452e8f` | alle |
| `vae/` | `qwen_image_2.1_vae_bf16.safetensors` | 0,68 GB | `bb21f7473051e1ac368515dd3f2e15cd44d7a11748ee8823e1ddca3e4876b7c9` | alle |

Modellgewichte liegen nicht im Repo.

### Einrichten

```bash
mkdir -p ~/personal/comfyui-momo && cd ~/personal/comfyui-momo
git clone --branch v0.40.0 --depth 1 https://github.com/Comfy-Org/ComfyUI.git
uv venv --python 3.13 venv
uv pip install --python venv/bin/python --pre torch torchvision \
  --extra-index-url https://download.pytorch.org/whl/nightly/cpu --index-strategy unsafe-best-match
uv pip install --python venv/bin/python -r ComfyUI/requirements.txt
# Modelle aus der Tabelle in die genannten Ordner laden, z. B.:
curl -L -o ComfyUI/models/vae/qwen_image_2.1_vae_bf16.safetensors \
  https://huggingface.co/Comfy-Org/Qwen-Image-2.1/resolve/main/vae/qwen_image_2.1_vae_bf16.safetensors
shasum -a 256 ComfyUI/models/*/qwen*.safetensors
```

Nightly-Wheels verschwinden nach einiger Zeit vom Index; ein exakter Nachbau mit `uv pip sync requirements.lock.txt` ist deshalb nur begrenzt garantiert (*eigene Einschätzung*).

### Starten und erzeugen

```bash
cd ~/personal/comfyui-momo/ComfyUI
../venv/bin/python main.py --listen 127.0.0.1 --port 8188 --disable-auto-launch --use-pytorch-cross-attention

# zweites Terminal, im Repo:
PY=~/personal/comfyui-momo/venv/bin/python
$PY prototypes/momo-comfyui/tools/generate.py explore A --seeds 101 102 103 104 --size 768
$PY prototypes/momo-comfyui/tools/generate.py evolve A l13 --ref ~/personal/comfyui-momo/runs/A/A-hatchling-t2i-s103.png --seeds 201
$PY prototypes/momo-comfyui/tools/boards.py   # Auswahl aus selection.json → images/, runs/, boards/
```

`generate.py` schreibt Rohbilder nach `~/personal/comfyui-momo/runs/<Familie>/` (über `MOMO_RUNS` änderbar, `MOMO_UNET` wählt die bf16-Gewichte). `boards.py` braucht die Schrift Rubik ([Google Fonts, `ofl/rubik`](https://github.com/google/fonts/tree/main/ofl/rubik)) unter `~/personal/comfyui-momo/fonts/` (über `MOMO_FONT` änderbar). Für den exakten Nachbau eines Bilds den `api_graph` aus `runs/<bild>.json` per `POST /prompt` an den Server schicken ([Server-Routen](https://docs.comfy.org/development/comfyui-server/comms_routes)); Referenzbilder vorher per `/upload/image` unter dem dort genannten Namen hochladen. Bitgleichheit ist auch dann nicht garantiert ([Startup Flags: `--deterministic`](https://docs.comfy.org/development/comfyui-server/startup-flags)).

## Workflows

Beide Graphen sind die ausgepackten Subgraphen der offiziellen Vorlagen aus `comfyui-workflow-templates` 0.11.82 – nur Core-Knoten, Prompt-Verbesserer aus (Vorlagenstandard):

- [`workflows/t2i.api.json`](workflows/t2i.api.json) ← [`image_qwen_image_2_1_turbo_t2i`](https://github.com/Comfy-Org/workflow_templates/blob/main/templates/image_qwen_image_2_1_turbo_t2i.json): `UNETLoader` → `QwenImage21Cache` → `CFGGuider` (cfg 1), `TextEncodeQwenImage21`, `EmptyLatentImage`, `ManualSigmas` (Turbo-Plan mit 8 Schritten), `KSamplerSelect` (euler), `SamplerCustomAdvanced`, `VAEDecode`, `SaveImage`.
- [`workflows/edit.api.json`](workflows/edit.api.json) ← [`image_qwen_image_2_1_turbo_image_edit`](https://github.com/Comfy-Org/workflow_templates/blob/main/templates/image_qwen_image_2_1_turbo_image_edit.json): Vorform als `<image1>` (`LoadImage` → `images.image_1`), Latent aus dem Encoder (Leinwand = `<image1>`), `resolution` 0 wie in der Vorlage. **Einzige Abweichung:** KV-Cache `dtype` = `int8` statt `default`. Der Knoten beschreibt das selbst als Hilfe für Edit-Workflows bei Speichermangel („int8 halves the cache at about bf16 accuracy“, [`nodes_qwen.py` v0.40.0](https://github.com/Comfy-Org/ComfyUI/blob/v0.40.0/comfy_extras/nodes_qwen.py#L185-L200)).

Qwen-Image-2.1 ist in ComfyUI nativ unterstützt (Text-zu-Bild, Mehrbild-Edit, Alpha-VAE; [Doku](https://docs.comfy.org/tutorials/image/qwen/qwen-image-2-1)). Die Bild-JSONs unter `runs/` enthalten den jeweils ausgeführten Graphen. Seeds und Prompts stehen dort und in [`prompts.json`](prompts.json).

## Laufzeit auf dem M2 Pro (32 GB)

Gemessen am 15.10.2026, Ausführungszeit laut `/history` (ohne Wartezeit in der Queue), 8 Schritte Turbo:

| Konfiguration | Zeit pro Bild | Beobachtung |
| --- | --- | --- |
| Text-zu-Bild int8, 1024², Sub-Quadratic-Attention | ≈ 250 s (≈ 25 s/Schritt) | erster Test |
| Text-zu-Bild int8, 1024², PyTorch-Attention | 238 s (≈ 24 s/Schritt) | Attention-Variante ändert kaum etwas |
| **Text-zu-Bild int8, 768²** | **Median 131,5 s** (n = 9, 123–132 s; ≈ 14 s/Schritt) | Standard dieses Prototyps |
| Text-zu-Bild bf16, 768² | ≈ 100 s (10–11,5 s/Schritt), Ausreißer 1.025 s | Mit Text-Encoder (8,9 GB geladen) bis 10,4 GB Swap |
| Edit int8, KV-Cache `default` | 1.590 s (n = 1) | Swap, einzelne Schritte bis 427 s |
| **Edit int8, KV-Cache `int8`** | **Median 167 s** (n = 24, 141–672 s; 3 Läufe > 400 s) | Standard dieses Prototyps |

- ComfyUI erkennt den gemeinsamen Speicher als `SHARED` (32.768 MB) und lässt den Text-Encoder in diesem Modus auf der CPU laufen ([`model_management.py` v0.40.0, Z. 594–595 und 1219–1230](https://github.com/Comfy-Org/ComfyUI/blob/v0.40.0/comfy/model_management.py#L1219-L1230)). Die int8-Gewichte laufen auf MPS über emulierte Operationen; das meldet der Server beim Laden („emulated ops: … int8_tensorwise“).
- Ohne ComfyUI belegten andere Programme ≈ 13 GB (`top`, PhysMem). Für Diffusionsmodell, Text-Encoder und Edit-Aktivierungen blieben also nur ≈ 18 GB. Diese Grenze bestimmte die Wahl von int8 und 768 px, nicht die Bildqualität.
- Gesamt: 39 Rohbilder plus 3 Benchmarks in ≈ 3,5 h einschließlich Einrichtung (≈ 30 GB Downloads) und Fehlersuche. Für eine Runde mit Ei, sieben Stimmungen und Accessoires je Form ist mit ≈ 2–3 min pro Bild zu rechnen (*Hochrechnung aus den Medianen, nicht gemessen*).

## Quellen

- ComfyUI Core `v0.40.0`: [Release](https://github.com/Comfy-Org/ComfyUI/releases/tag/v0.40.0), [README](https://github.com/Comfy-Org/ComfyUI/blob/v0.40.0/README.md), [`model_management.py`](https://github.com/Comfy-Org/ComfyUI/blob/v0.40.0/comfy/model_management.py), [`nodes_qwen.py`](https://github.com/Comfy-Org/ComfyUI/blob/v0.40.0/comfy_extras/nodes_qwen.py)
- ComfyUI-Doku: [Qwen-Image-2.1](https://docs.comfy.org/tutorials/image/qwen/qwen-image-2-1), [Server-Routen](https://docs.comfy.org/development/comfyui-server/comms_routes), [Startup Flags](https://docs.comfy.org/development/comfyui-server/startup-flags)
- Modelle: [Comfy-Org/Qwen-Image-2.1 (Model Card)](https://huggingface.co/Comfy-Org/Qwen-Image-2.1)
- Vorlagen: [Comfy-Org/workflow_templates](https://github.com/Comfy-Org/workflow_templates/tree/main/templates)
- PyTorch auf dem Mac: [Apple Developer – Accelerated PyTorch training on Mac](https://developer.apple.com/metal/pytorch/)
- Vorarbeit (noch auf dem Branch von #69): [Recherche ComfyUI, Commit `bb1de0a`](https://github.com/Yggras/abnehm-app/blob/bb1de0a/research/comfyui-momo-assets.md), [Recherche Produktionsstrategie, Commit `57439e0`](https://github.com/Yggras/abnehm-app/blob/57439e0/research/momo-animation-assets.md)
