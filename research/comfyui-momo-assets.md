# Recherche: ComfyUI für Momo-Kreaturen und Produktionsassets

Ticket: [#69 „Momos Gestalt und Entwicklungsformen festlegen“](https://github.com/Yggras/abnehm-app/issues/69) · Stand: 15.10.2026

## Kurzurteil

**Bedingtes Go.** ComfyUI ist für Ticket #69 als **Explorations-, Varianten- und Assistenzwerkzeug** geeignet: deutlich verschiedene Kreaturenfamilien, referenzgestützte Entwicklungsformen, lokale Korrekturen, Masken/Alpha sowie kurze Bild-zu-Video-Sequenzen lassen sich in reproduzierbar gespeicherten Workflows kombinieren. Mit Qwen-Image-2.1 gibt es inzwischen sogar einen nativ unterstützten lokalen Workflow für Mehrbildreferenzen, lokale Edits und RGBA-Ausgabe; klassische SD-/SDXL-Pipelines bieten zusätzlich Image-to-Image, Inpainting und ControlNet [C1][C3][C4][C5][C6].

**Kein Go als unbeaufsichtigte Endfertigung.** Die geprüften Primärquellen belegen weder, dass eine nichtmenschliche Figur über stark veränderte Entwicklungsformen automatisch identisch bleibt, noch dass generierte bzw. nachträglich getrennte Rasterebenen bereits einen sauberen Skia-Rig-Vertrag mit vollständigen verdeckten Körperteilen und stabilen Ankern ergeben. Final ausgewählte Momo-Entwürfe benötigen deshalb Art-Direction, manuelle Normalisierung und einen Rig-/Rekompositions-Test.

| Ziel aus Ticket #69 | Urteil | Begründung |
|---|---|---|
| Hochwertige, deutlich verschiedene Kreaturenfamilien | **Go** | Breite native Bildmodell-Auswahl und editierbare Graphen; „hochwertig“ bleibt durch einen visuellen Vergleich zu prüfen [C1][C2]. |
| Konsistente Entwicklungsformen derselben Figur | **Bedingtes Go** | Native Mehrbild-/Subject-Referenzen, Image-to-Image, Inpainting und ControlNet sind vorhanden. Konsistenz ist eine Modellleistung, keine Garantie der ComfyUI-Laufzeit [C3][C4][C5][C6]. |
| Getrennte Quellgrafiken/Layers für Skia | **Bedingtes Go** | Core kann Masken, RGBA-PNGs und Batches verarbeiten; automatische semantische Ebenentrennung ist als externer Partner Node verfügbar. Rig-taugliche Trennung und verdeckte Geometrie müssen geprüft bzw. manuell korrigiert werden [C7][C8][C9]. |
| Kurze Sprite-/Animationssequenzen | **Bedingtes Go** | Native Video-Familien, Image-to-Video, transparente Wan-Alpha-Videos und Frame-/WebM-Ausgabe sind vorhanden. Loop-, Modell- und Kantenstabilität für Momo sind nicht belegt [C1][C15][C16]. |
| Lokale bzw. automatisierte Produktion | **Go** | Lokale REST-/WebSocket-API, API-JSON, Upload-, Queue-, History- und Output-Routen sind dokumentiert [C12][C13]. |

Rechts- und Lizenzfragen sind gemäß Auftrag nicht betrachtet.

## 1. Untersuchungsstand und Einordnung

Untersucht wurden ComfyUI Core auf Commit `ba994879b88d0ebd9950b1e5c1e923d928f216ba`, die offizielle Dokumentation auf Commit `91be1500ec974ed1e95f63dd81c74b916d7458aa`, die stabile Core-Veröffentlichung `v0.40.0` vom 13.10.2026 sowie die unten genannten Custom-Node-Repositories [C1][C17]. Sämtliche Belege sind Primärquellen der jeweiligen Software-, Modell- oder Projektverantwortlichen.

Wichtig für die Bewertung: ComfyUI ist Graphoberfläche und Inferenz-/Automatisierungsengine; die eigentliche Bildfähigkeit kommt aus separat geladenen Gewichten. Die offizielle Doku warnt ausdrücklich, dass nicht jede Gewichtsdatei nativ funktioniert, First-Party-Support begrenzt ist und ein passender offizieller Workflow bzw. eine Vorlage geprüft werden soll [C2]. Daher ist „ComfyUI kann X“ im Folgenden immer als **Core plus konkret unterstütztes Modell bzw. konkret benannter Zusatz** zu lesen.

## 2. Belegte Fakten

### 2.1 Unterstützte Modellfamilien und für Momo relevante Aufgaben

ComfyUI Core nennt folgende **repräsentative**, nicht abschließende native Unterstützung [C1]:

- **Bildgenerierung:** Stable Diffusion 1.5, SDXL, SD3.5, Flux.1/Flux.2, Qwen Image, Z-Image, Hunyuan Image 2.1, HiDream, Lumina Image 2.0, Chroma, Anima, LongCat Image, Ideogram 4, Krea 2, MageFlow, Kandinsky 5 und weitere.
- **Bildbearbeitung:** unter anderem Flux Kontext, Flux.2 Klein, Qwen Image Edit, HiDream E1.1/O1, OmniGen2 und MageFlow Edit.
- **Video:** unter anderem Wan 2.1/2.2, LTX-Video 2/2.3, HunyuanVideo 1.5, CogVideoX und Mochi.
- **Hilfsmodelle:** vollständige Checkpoints oder getrennte Diffusionsmodelle, VAEs, Textencoder, LoRAs, ControlNets, Adapter und Upscaler.
- **Core-Werkzeuge:** In-/Outpainting, Referenzkonditionierung, Masken/Compositing, Segmentierung, Tiefenschätzung und Frame-Interpolation.

Für Momo besonders passend ist der native Qwen-Image-2.1-Workflow: ein Modell deckt Text-zu-Bild und instruction-basiertes Editing ab, erzeugt nativ bis 2K, führt Alpha im vierkanaligen VAE und nimmt im Textencoder bis zu 16 Bildslots auf; die offiziellen Edit-Vorlagen verdrahten zehn davon. Die Doku beschreibt außerdem lokalisierte Edits, bei denen der Rest des Bilds erhalten werden soll [C6]. Das ist Core-Support, kein Custom Node.

**Grenze des Belegs:** Aus Modelllisten und Beispielbildern folgt nicht, welches Modell den vorgegebenen flächigen, weichen Momo-Stil am besten trifft. Dafür gibt es keinen offiziellen, Momo-spezifischen Vergleich.

### 2.2 Image-to-Image, Inpainting und ControlNet

#### Image-to-Image — Core

Der offizielle Workflow lädt ein Bild, codiert es per VAE in den Latentraum und sampelt darauf. `denoise < 1` erhält Bildmerkmale; je kleiner `denoise`, desto geringer die Abweichung, während `denoise = 1` die Referenzmerkmale verliert [C3]. Damit lassen sich gewählte Momo-Entwürfe vorsichtig variieren oder stilistisch angleichen.

#### Inpainting/Outpainting — Core

ComfyUI besitzt einen Mask Editor und den Node `VAE Encode (for Inpainting)`. Dessen Maske bestimmt den Änderungsbereich; `grow_mask_by` vergrößert die Übergangszone. Die offizielle Anleitung nutzt sowohl einen Alpha-Kanal als Eingabemaske als auch manuell gemalte Masken [C4]. Das eignet sich für gezielte Korrekturen an Gesicht, Spross, Gliedmaßen oder Accessoire-Sitz, ohne das gesamte Bild bewusst neu aufzubauen.

#### ControlNet — Core, Preprocessing teils Custom

`Load ControlNet` und `Apply ControlNet` sind Core-Nodes. `Apply ControlNet` nimmt ein vorbereitetes Kontrollbild entgegen und steuert Einflussstärke sowie Start-/Endzeitpunkt; mehrere ControlNets können verkettet werden [C5]. Offiziell genannte Konditionen sind etwa Kanten, Tiefe und Pose.

Core enthält laut offizieller Doku **nicht alle Preprozessoren**. Ein bereits passendes Scribble-, Canny-, Tiefen- oder Posebild kann Core direkt verwenden; für zusätzliche automatische Lineart-, Tiefen-, OpenPose- oder Animal-Pose-Hinweise verweist die Doku auf Custom Nodes [C5]. Das offizielle Repository `comfyui_controlnet_aux` stellt genau solche Hint-Preprozessoren bereit, darunter mehrere Lineart-Varianten, Tiefenschätzer, DWPose/OpenPose und Animal Pose [X3].

**Momo-Relevanz:** ControlNet fixiert primär Struktur bzw. Kontrollsignale; es ist kein eigener Identitätsspeicher. Für Entwicklungsformen kann es Pose, Silhouette oder Kantenlayout stabilisieren, ersetzt aber keine Referenzkonditionierung.

### 2.3 Referenz- und Figurenkonsistenz: Core zuerst, IP-Adapter nur als Fallback

#### Nativ in Core

Qwen-Image-2.1 kann mehrere Referenzbilder indexiert in einen Edit einbinden; `image_1` ist das zu bearbeitende Bild, weitere Slots liefern zusätzlichen Inhalt. Der offizielle Beispielprompt verlangt ausdrücklich, Figur, Gesicht, Körperform und Pose einer Referenz beizubehalten [C6]. Weitere nativ unterstützte Edit-/Referenzfamilien werden im Core-README genannt [C1]. Damit ist ein **Core-only-Versuch** für Momo heute plausibel; IP-Adapter ist nicht automatisch erforderlich.

#### Klassischer IP-Adapter — Custom Node

Das offizielle IP-Adapter-Projekt beschreibt IP-Adapter als leichten Bildprompt-Adapter für vortrainierte Text-zu-Bild-Diffusionsmodelle. Es zeigt Bildvariationen, Image-to-Image, Inpainting sowie die Kombination mit ControlNet; bei geringerer Adapterstärke werden Ergebnisse vielfältiger, können aber weniger konsistent zur Bildreferenz sein [X2].

Für ComfyUI ist `cubiq/ComfyUI_IPAdapter_plus` ein **Custom Node**, nicht Core. Sein README bezeichnet ihn als ComfyUI-Referenzimplementierung, die Motiv oder Stil eines bzw. mehrerer Referenzbilder übertragen kann. Die dokumentierten Modelllisten konzentrieren sich auf SD1.5, SDXL sowie einzelne Kolors-Varianten; Installation erfolgt unter `custom_nodes`, mit zusätzlichen CLIP-Vision- und IP-Adapter-Gewichten [X1].

Der Wartungsstatus ist ein wesentliches Risiko: Der Maintainer setzte das Repository am 14.04.2025 ausdrücklich auf **„maintenance only“**, plant keine kontinuierliche Arbeit und verlangt zugleich die jeweils neueste ComfyUI-Version. Das Repository ist zwar nicht archiviert, sein letzter Commit ist jedoch ebenfalls vom 14.04.2025 [X1][X4]. Deshalb ist IP-Adapter Plus nur ein gepinnter A/B-Fallback, nicht der empfohlene Ausgangspunkt.

**Nicht belegt:** Weder Qwen-Referenzen noch IP-Adapter garantieren in den Primärquellen die Identität einer stilisierten nichtmenschlichen Kreatur über große anatomische Entwicklungsstufen. Die finale Konsistenz muss visuell abgenommen werden.

### 2.4 Masken, Alpha und getrennte Ebenen

#### Core: Masken und RGBA

- `LoadImage` gibt Bild und Maske getrennt aus; bei Alpha-Eingaben wird der Alpha-Kanal in die ComfyUI-Maskenkonvention überführt. `JoinImageWithAlpha` setzt RGB und Maske wieder zu RGBA zusammen [C7].
- `SaveImage` schreibt jedes Element eines Bild-Batches als eigenes PNG und bettet, solange Metadaten nicht deaktiviert sind, Prompt-/Workflowinformationen ein [C7][C11].
- `Save Image (Advanced)` unterstützt PNG in 8 oder 16 Bit sowie EXR; PNG und EXR akzeptieren vierkanalige RGBA-Bilder. AVIF unterstützt in diesem Node kein Alpha [C16].
- Qwen-Image-2.1 kann Transparenz bereits im Modell erzeugen, statt nur nachträglich freizustellen [C6].

Damit kann ein Workflow pro Körperteil bzw. Ausdruck ein transparentes PNG exportieren. Core belegt aber nur Bild-/Maskenverarbeitung und Compositing, **keine automatische fachliche Zerlegung eines Momo in genau die späteren Rig-Slots**.

#### Automatische Ebenentrennung — Core-Partner-Node, aber externer Dienst

Der von ComfyUI ausgelieferte ByteDance-Partner-Node „Seedream 5.0 Layer Separation“ zerlegt ein flaches Bild laut offizieller Doku in eine Hintergrundplatte und bis zu 16 transparente, benannte Ebenen mit Z-Reihenfolge, Bounding Boxes, Beschreibung, Masken sowie einem `LAYERS`-Dokument [C8]. Das ist **kein Community-Custom-Node**, aber auch **keine lokale Core-Inferenz**: Partner Nodes rufen externe gehostete Modelle per API auf, benötigen Anmeldung/Guthaben und sind optional abschaltbar [C9].

Für ein Skia-Rig kann diese Trennung Vorarbeit sparen. Die Quelle belegt jedoch nicht, dass beispielsweise hinter einem Arm verdeckte Bauchflächen, Gelenküberlappungen, Augen-/Mundvarianten oder Kopf-/Halsanker so rekonstruiert werden, wie der geplante Rig-Vertrag sie benötigt.

### 2.5 Workflow-Speicherung und Reproduzierbarkeit

ComfyUI kann Workflows als normales JSON und als **API-JSON** exportieren. Das API-Format enthält ausführbare Node-IDs, Typen und Widgetwerte, einschließlich Seed, Prompt, Modellname und Samplerparametern, lässt aber reine Layoutdaten weg [C10].

Built-in-Save-Nodes können zwei JSON-Felder in Ausgaben einbetten [C11]:

- `workflow`: kompletter Frontendgraph einschließlich Links und Layout;
- `prompt`: ausführungsorientierter API-Graph.

Offiziell dokumentierte Metadatenträger sind unter anderem PNG, animiertes PNG/WebP, MP4 und WebM. Eine Datei kann wieder auf den Canvas gezogen werden, um den Workflow zu laden [C11].

Das ist **Prozess- und Parameterreproduzierbarkeit**, aber keine vollständige oder bitgenaue Reproduktion:

- Eingabedateien, Modelle und Custom-Node-Pakete sind nicht in den Workflow-Metadaten enthalten [C11].
- Umbenannte oder fehlende Abhängigkeiten können die erneute Ausführung verhindern [C11].
- `--deterministic` aktiviert langsamere deterministische PyTorch-Algorithmen „wo möglich“, garantiert laut Core-Doku aber keine identischen Bilder [C14].
- Der rohe lokale Server-API-Vertrag hat laut offizieller Doku keine Kompatibilitätsgarantie über Releases hinweg [C13].

**Folgerung:** Für belastbare Wiederholbarkeit müssen zusätzlich Core-Version, Modell-Dateien mit Hashes, Eingaben, Custom-Node-Commits und Python-Umgebung gepinnt werden. Das ist eine Empfehlung aus den dokumentierten Grenzen, keine eingebaute ComfyUI-Garantie.

### 2.6 Lokale Ausführung und API-Automatisierung

Core kann vollständig offline laufen; `--offline` deaktiviert Partner Nodes und blockiert externe Frontendkommunikation [C1][C14]. Für die Automatisierung bestehen zwei offizielle Wege [C12][C13]:

1. **Rohe lokale Server-API:** API-JSON per `POST /prompt`, Status über WebSocket `/ws`, Resultate über `/history/{prompt_id}` und `/view`; Bilder und Masken können über `/upload/image` bzw. `/upload/mask` eingespielt werden.
2. **Versionierte Comfy API v2/SDKs:** offizielle Python-/TypeScript-SDKs; für Self-Hosting wird ein API Proxy vor ComfyUI gesetzt. Die Doku empfiehlt diesen Weg für neue Integrationen und bezeichnet v2-Änderungen innerhalb der Version als additiv.

Die offiziellen Beispiele zeigen sowohl „submit and forget“ als auch WebSocket-Überwachung mit anschließendem Download und direkte Bildübertragung ohne Plattenschreibzugriff [C12]. Eine Batch-Pipeline kann daher Prompts, Seeds, Referenzen und Exportnamen systematisch variieren.

### 2.7 Video, Animation und Sprite-Frames

ComfyUI Core unterstützt mehrere lokale Video-Familien [C1]. Der offizielle Wan-2.1-Workflow bietet Text-to-Video mit 1,3 Milliarden Parametern und Image-to-Video mit 14 Milliarden Parametern; für I2V werden Startbild und CLIP-Vision-Konditionierung verwendet [C15]. Wan-Alpha ist ein spezialisierter Wan-2.1-14B-Workflow, der Videos mit Alpha-Kanal erzeugt [C15].

Für die Ausgabe gilt [C7][C16]:

- Ein Bild-Batch kann mit `SaveImage` als fortlaufende einzelne PNGs gespeichert werden und eignet sich damit grundsätzlich als Framequelle.
- `SaveWEBM` schreibt eine Bildsequenz als VP9 oder AV1; RGBA-Transparenz bleibt nur mit VP9 erhalten.
- Metadaten können auch in Videoformaten eingebettet werden [C11].

Damit sind kurze Animationsreferenzen oder ausgewählte Sprite-Sequenzen technisch möglich. Nicht belegt sind jedoch ein nahtloser Loop, pixelstabile Konturen, konstante Layergrenzen oder gleichbleibende Rig-Anker. Für das beschlossene Skia-Ebenenrig ist generiertes Video deshalb eher Bewegungsreferenz oder Quelle für wenige manuell bereinigte Spezialframes als der primäre Animationsweg.

### 2.8 Installation und Hardware

Offiziell unterstützt werden Windows, Linux und macOS auf Apple Silicon. Als Hardware-Backends nennt die Doku NVIDIA/CUDA, AMD/ROCm unter Linux und Windows, Intel Arc/XPU, Apple MPS, weitere NPUs/MLUs sowie CPU-Betrieb; CPU ist ausdrücklich langsamer [C18]. Desktop wird für Windows/macOS als einfachster Einstieg empfohlen, daneben bestehen Windows-Portable, `comfy-cli` und manuelle Python-Installation [C18].

Modelle sind nicht Teil der App-Installation, liegen häufig bei mehreren Gigabyte und müssen passend zum Workflow in Modellordnern abgelegt werden [C2]. Core wirbt mit Ausführung selbst großer Open-Source-Modelle ab 4 GB VRAM plus 8 GB RAM durch Weight Streaming [C1]. Dieser Herstellerwert belegt technische Ausführbarkeit, nicht eine für interaktive Art-Direction ausreichende Geschwindigkeit. Modellabhängig gelten andere Angaben: Die Wan-2.1-Doku nennt 8 GB VRAM für die 1.3B-Variante, während der Momo-relevante I2V-Workflow die 14B-Variante verwendet [C15]. Für Qwen-Image-2.1 nennt die offizielle Seite zwar speichersparende INT8-Dateien, aber kein belastbares Mindest-VRAM [C6].

**Konsequenz:** Ohne Kenntnis des vorhandenen Rechners gibt es kein lokales Hardware-Go für den konkreten Momo-Workflow. Installation allein ist breit unterstützt; Durchsatz, Auflösung und nutzbare Modellvariante müssen gemessen werden.

## 3. Core, Partner und Custom Nodes im Überblick

| Baustein | Klassifizierung | Für Momo | Wartungsstand am 15.10.2026 |
|---|---|---|---|
| ComfyUI Text-/Bild-/Edit-/Video-Workflows, I2I, Inpaint, Masken, ControlNet, API | **Core** | Basis und bevorzugter Start | Aktiv; Release `v0.40.0` am 13.10.2026, Repository nicht archiviert [C17]. |
| Qwen-Image-2.1 Referenzen und RGBA | **Core, lokales Modell** | Bevorzugter erster Konsistenz-/Alpha-Test | Offizielle native Vorlage und Core-Doku vorhanden [C6]. |
| Seedream 5.0 Layer Separation | **Core-Partner-Node, externer API-Dienst** | Optionaler Ebenentrennungs-Spike | Aktueller V2-Node in Core; Partner Nodes sind opt-in und extern [C8][C9]. |
| Wan 2.1 / Wan-Alpha | **Core, lokale Modelle** | Optional für kurze Bewegung/Alpha-Video | Offizielle native Vorlagen vorhanden [C15]. |
| `ComfyUI_IPAdapter_plus` | **Custom Node** | Nur Fallback für SD1.5/SDXL-Referenzkonditionierung | **Maintenance only** seit 14.04.2025; letzter Commit an diesem Tag; nicht archiviert [X1][X4]. |
| `comfyui_controlnet_aux` | **Custom Node** | Optional für Lineart/Tiefe/Pose/Animal-Pose-Preprocessing | Aktiv: nicht archiviert; letzter geprüfter Commit `a587a4c` vom 11.10.2026 [X3][X5]. |

**Empfohlene minimale Abhängigkeit:** zunächst keine Custom Nodes. Referenzen mit Qwen-Image-2.1, Masken/Inpainting und vorhandene bzw. manuell erstellte Control-Bilder mit Core testen. `comfyui_controlnet_aux` nur für tatsächlich benötigte Preprozessoren ergänzen. IP-Adapter Plus nur installieren, wenn ein dokumentierter A/B-Test einen klaren Vorteil zeigt.

## 4. Ableitungen für Ticket #69

Die folgenden Aussagen sind **Bewertung und Empfehlung**, nicht Aussagen der Hersteller:

1. **Kreaturenfamilien:** Text-zu-Bild mit festen Stil-, Farb- und Formregeln ist ein guter Divergenzgenerator. Mehrere Seeds und bewusst verschiedene Silhouettenprompts können schnell 2–3 Wahlfamilien liefern. Eine menschliche Auswahl ist notwendig, weil die Quellen „deutlich verschieden“ und „hochwertig“ nicht für Momo operationalisieren.
2. **Entwicklungsformen:** Die ausgewählte Grundform sollte nicht in acht unabhängigen Text-zu-Bild-Läufen neu erfunden werden. Besser ist eine Kette aus Referenz-Edit, niedrigem/mittlerem Änderungsgrad, festem Ansichtsblatt und optionaler Kanten-/Scribble-Kontrolle. Unveränderliche Identitätsmerkmale werden explizit als Checkliste geprüft.
3. **Rig-Quellen:** ComfyUI kann transparente Rasterteile liefern, aber der endgültige Rig-Schnitt muss vom benötigten Skia-Manifest ausgehen: Körper-/Kopfgruppen, Gesichtselemente, Vorder-/Hinterebenen und definierte Kopf-/Halsanker. Automatische Layer Separation ist ein Startpunkt, nicht die Abnahme.
4. **Animation:** Da die App ein Skia-Ebenenrig verwenden soll, sollten reguläre Idle-/Stimmungsanimationen aus dem Rig entstehen. Videoerzeugung ist sinnvoll für Motion-Ideen oder wenige Frame-by-Frame-Akzente, nicht als Ersatz für rig-taugliche Quellgrafik.
5. **Reproduzierbarkeit:** Ein PNG mit Workflow-Metadaten ist wertvoll, aber nicht das Produktionsarchiv. Das Archiv braucht zusätzlich Eingaben, Modellhashes, Softwarestände und freigegebene Exporte.

## 5. Notwendige nächste Schritte

### A. Time-boxed Core-only-Qualitätsschnitt

1. Eine **stabile Core-Version pinnen** statt `master`; alle verwendeten Modelle mit Dateiname und SHA-256 erfassen.
2. Mit einem nativen Bildmodell mindestens drei bewusst unterschiedliche Momo-Familien erzeugen und gegen die verbindlichen Stilregeln aus Ticket #69 auswählen.
3. Für einen Favoriten mit Qwen-Image-2.1 oder einem anderen nativ unterstützten Edit-Modell erzeugen:
   - Ei,
   - erste, mittlere und große Entwicklungsform,
   - Vorder-/Dreiviertel-/Seitenansicht,
   - die sieben Stimmungen,
   - je ein Kopf- und Halsaccessoire.
4. Fixe Seeds helfen beim Vergleich, gelten aber nicht als Identitätsnachweis. Ergebnisse anhand einer expliziten Merkmalsliste prüfen: Silhouette, Gesichtsproportionen, Spross/Ohren/Gliedmaßen, Bauchfläche, Palette und Licht von links oben.

### B. Rig- und Alpha-Gate

1. Eine Form in die später tatsächlich benötigten semantischen Teile schneiden: mindestens hintere Teile, Körper, Kopf, Augen/Brauen/Mund/Wangen sowie Kopf-/Halsaccessoire jeweils vor/hinter der Figur.
2. Jedes Teil als RGBA-PNG exportieren, um transparente Randpixel und Farbsäume zu prüfen.
3. Alle Teile außerhalb von ComfyUI im geplanten Skia-Rig wieder zusammensetzen. Die Rekomposition muss in Ruhepose visuell dem freigegebenen Master entsprechen und bei kleinen Gelenkbewegungen keine Löcher offenbaren.
4. Seedream Layer Separation nur als parallelen Beschleunigungstest verwenden; Ergebnis gegen manuell geschnittene Ebenen vergleichen. Bei unvollständiger verdeckter Geometrie manuell neu zeichnen.

### C. Konsistenz-Fallbacks nur nach Messung

1. Wenn Core-Referenzediting die Identitätsmerkmale nicht hält, zuerst Referenzblatt plus ControlNet/Scribble testen.
2. Nur falls das nicht reicht, SDXL plus `ComfyUI_IPAdapter_plus` als A/B-Spike auf Commit `a0f451a` pinnen. Kein ungepinnter Auto-Update-Pfad wegen „maintenance only“.
3. `comfyui_controlnet_aux` nur für konkret benötigte Hint-Erzeugung pinnen, zum Beispiel Lineart oder Animal Pose; einfache vorhandene Kontrollbilder brauchen es nicht.
4. Falls wiederkehrend viele Posen/Formen benötigt werden und Referenzconditioning versagt, wäre ein eigener Figuren-/Stil-LoRA-Trainingsversuch eine mögliche spätere Untersuchung. Die vorliegenden Quellen belegen noch nicht, dass er für Momo nötig ist.

### D. Optionaler Animationsschnitt

1. Eine freigegebene Momo-Pose mit einem nativen I2V-Workflow als Startbild verwenden und einen sehr kurzen Idle-Akzent erzeugen. Wan-Alpha getrennt als T2V-Alpha-Variante testen; die geprüfte Vorlage belegt dafür kein Referenzbild.
2. I2V-Frames einzeln als PNG ausgeben und bei Bedarf per geprüfter Maske zu RGBA zusammensetzen; Silhouette, Gesicht, Alpha-Kante und Accessoire-Anker frameweise prüfen.
3. Nur stabile Schlüsselbilder in eine Sprite-Sequenz übernehmen. Loop und Reduced-Motion-Ersatzframe außerhalb des Generators festlegen.
4. Gegen eine direkt im Skia-Rig animierte Variante vergleichen; die Rig-Variante bleibt Standard, sofern die generierte Sequenz keinen klaren visuellen Mehrwert hat.

### E. Produktionsarchiv pro freigegebenem Ergebnis

- sichtbares Workflow-JSON und API-JSON;
- Ausgabe-PNG mit eingebetteten Metadaten;
- alle Eingabebilder, Masken und Kontrollbilder;
- Prompts, Seeds, Sampler-/Auflösungswerte;
- Core-Release, Modellnamen und SHA-256;
- Custom-Node-Repository und Commit, falls verwendet;
- Python-/PyTorch-Abhängigkeitsstand und Hardware;
- bereinigte finale Ebenen plus Skia-Manifest getrennt von rohen Generierungen.

## 6. Quellenlücken

- Keine Primärquelle bewertet die konkrete Momo-Formsprache oder definiert eine Erfolgsquote für „hochwertig“ bzw. „deutlich verschieden“.
- Keine geprüfte Quelle garantiert Referenzkonsistenz einer stilisierten nichtmenschlichen Figur über große anatomische Entwicklungsstufen.
- Es gibt keinen offiziellen Vergleich von Qwen-Image-2.1, SDXL+IP-Adapter und anderen Edit-Modellen für genau diese Aufgabe.
- Automatische Ebenentrennung ist funktional dokumentiert, aber ihre Eignung für semantische Skia-Rig-Teile, vollständige verdeckte Geometrie und stabile Anker ist nicht belegt.
- Ein direkter Export eines Momo-Rig-Manifests oder editierbarer Skia-/SVG-Pfade aus den geprüften lokalen Core-Workflows ist nicht dokumentiert. Belegt sind vor allem Rasterbilder, Masken und Layer-Dokumente.
- Bitidentische Neuberechnung über GPU-, Treiber-, PyTorch-, Core- oder Modelländerungen ist nicht garantiert; `--deterministic` reicht laut Core selbst nicht aus.
- Rechnerausstattung und akzeptable Renderzeit sind unbekannt. Deshalb fehlen belastbare lokale Laufzeit-, VRAM- und Durchsatzwerte für den gewählten Modell-/Auflösungsmix.
- Loopstabilität, zeitliche Konsistenz und transparente Kanten einer konkreten Momo-Sequenz wurden nicht praktisch getestet.

## 7. Primärquellen

### Projekt und ComfyUI Core

- **[P1]** Projekt-Issue #69, „Momos Gestalt und Entwicklungsformen festlegen“: https://github.com/Yggras/abnehm-app/issues/69
- **[C1]** ComfyUI Core, README auf geprüftem Commit, Abschnitte „Features“, „Get Started“ und „Release Process“: https://github.com/Comfy-Org/ComfyUI/blob/ba994879b88d0ebd9950b1e5c1e923d928f216ba/README.md#features
- **[C2]** Offizielle ComfyUI-Doku, „ComfyUI Models: Files, Folders, and Loader Nodes“, Abschnitte „Supported models“, „Expect large downloads“, „Beyond the main checkpoint“: https://docs.comfy.org/basic-concepts/models
- **[C3]** Offizielle ComfyUI-Doku, „ComfyUI Image to Image Workflow“, Abschnitt „Key Points“ (`denoise`): https://docs.comfy.org/tutorials/basic/image-to-image
- **[C4]** Offizielle ComfyUI-Doku, „ComfyUI Inpainting Workflow“, Abschnitte „Using the Mask Editor“ und „VAE Encoder (for Inpainting)“: https://docs.comfy.org/tutorials/basic/inpaint
- **[C5]** Offizielle ComfyUI-Doku, „ControlNet in ComfyUI: Preprocessors, Models, and Workflows“, Abschnitte „Image Preprocessing“ und „Apply ControlNet“: https://docs.comfy.org/tutorials/controlnet/controlnet
- **[C6]** Offizielle ComfyUI-Doku, „Qwen-Image-2.1 ComfyUI Native Workflow Example“, Abschnitte „Key Features“, „Image Edit“, „Model links“, „Resolution“ und „Prompting for image edit“: https://docs.comfy.org/tutorials/image/qwen/qwen-image-2-1
- **[C7]** ComfyUI Core-Quellcode auf geprüftem Commit, `SaveImage`/`LoadImage` und `JoinImageWithAlpha`/`SplitImageWithAlpha`: https://github.com/Comfy-Org/ComfyUI/blob/ba994879b88d0ebd9950b1e5c1e923d928f216ba/nodes.py#L1669-L1817, https://github.com/Comfy-Org/ComfyUI/blob/ba994879b88d0ebd9950b1e5c1e923d928f216ba/comfy_extras/nodes_compositing.py#L171-L224
- **[C8]** Offizielle ComfyUI-Doku, „ByteDance Seedream 5.0 Pro“, Abschnitt „Layer separation workflow“, sowie V2-Node-Ausgaben: https://docs.comfy.org/tutorials/partner-nodes/bytedance/seedream-5-pro, https://docs.comfy.org/built-in-nodes/ByteDanceSeedreamLayerSeparationNodeV2
- **[C9]** Offizielle ComfyUI-Doku, „Partner Nodes“, Abschnitte „What are Partner Nodes?“, „Pricing“, „About Open Source and Opt-in“: https://docs.comfy.org/tutorials/partner-nodes/overview
- **[C10]** Offizielle ComfyUI-Doku, „Workflow API Format“, Abschnitte „Save Format vs API Format“ und „How to Export“: https://docs.comfy.org/development/api-development/workflow-api-format
- **[C11]** Offizielle ComfyUI-Doku, „Workflow Metadata“, Abschnitte „Embedded fields“, „Supported formats“ und „Limitations“: https://docs.comfy.org/development/api-development/workflow-metadata
- **[C12]** Offizielle ComfyUI-Doku, „API Examples“, Methoden 1–3: https://docs.comfy.org/development/comfyui-server/api-examples
- **[C13]** Offizielle ComfyUI-Doku, „Running Workflows“ und „ComfyUI Server Routes“, insbesondere API-Vergleich und Core-Routen: https://docs.comfy.org/development/run-workflows/overview, https://docs.comfy.org/development/comfyui-server/comms_routes
- **[C14]** Offizielle ComfyUI-Doku, „Startup Flags“, Abschnitte „Performance & Debugging“, „Custom Nodes & API Nodes“ (`--deterministic`, `--offline`): https://docs.comfy.org/development/comfyui-server/startup-flags
- **[C15]** Offizielle ComfyUI-Doku, „ComfyUI Wan2.1 Video Examples“ und „Wan-Alpha Tutorial“, Abschnitte T2V/I2V bzw. Alpha-Workflow: https://docs.comfy.org/tutorials/video/wan/wan-video, https://docs.comfy.org/tutorials/video/wan/wan-alpha
- **[C16]** Offizielle ComfyUI-Doku, „SaveImage“, „Save Image (Advanced)“ und „SaveWEBM“, Eingabe-/Formatabschnitte: https://docs.comfy.org/built-in-nodes/SaveImage, https://docs.comfy.org/built-in-nodes/SaveImageAdvanced, https://docs.comfy.org/built-in-nodes/SaveWEBM
- **[C17]** ComfyUI Core, Release `v0.40.0` und Repository-Metadaten: https://github.com/Comfy-Org/ComfyUI/releases/tag/v0.40.0, https://api.github.com/repos/Comfy-Org/ComfyUI
- **[C18]** Offizielle ComfyUI-Doku, „System Requirements“ und „Install ComfyUI Manually“, Abschnitte Betriebssysteme, Hardware, Python und Installation: https://docs.comfy.org/installation/system_requirements, https://docs.comfy.org/installation/manual_install

### Referenzkonditionierung und optionale Custom Nodes

- **[X1]** `cubiq/ComfyUI_IPAdapter_plus`, offizielles README auf geprüftem Commit, Einleitung, Wartungshinweis, Installation und Modelllisten: https://github.com/cubiq/ComfyUI_IPAdapter_plus/blob/a0f451a5113cf9becb0847b92884cb10cbdec0ef/README.md
- **[X2]** Tencent AI Lab, offizielles IP-Adapter-Repository, Abschnitte „Introduction“, „How to Use“, „Best Practice“ und SDXL: https://github.com/tencent-ailab/IP-Adapter/blob/62e4af9d0c1ac7d5f8dd386a0ccf2211346af1a2/README.md
- **[X3]** `Fannovel16/comfyui_controlnet_aux`, offizielles README auf geprüftem Commit, Abschnitte „Nodes“, „Line Extractors“, „Depth Estimators“, „Faces and Poses Estimators“: https://github.com/Fannovel16/comfyui_controlnet_aux/blob/a587a4c1594524c1d2de5cd1a86cd868ff448e1c/README.md
- **[X4]** GitHub-Repository-Metadaten und letzter Commit von `ComfyUI_IPAdapter_plus`: https://api.github.com/repos/cubiq/ComfyUI_IPAdapter_plus, https://github.com/cubiq/ComfyUI_IPAdapter_plus/commit/a0f451a5113cf9becb0847b92884cb10cbdec0ef
- **[X5]** GitHub-Repository-Metadaten und letzter geprüfter Commit von `comfyui_controlnet_aux`: https://api.github.com/repos/Fannovel16/comfyui_controlnet_aux, https://github.com/Fannovel16/comfyui_controlnet_aux/commit/a587a4c1594524c1d2de5cd1a86cd868ff448e1c
