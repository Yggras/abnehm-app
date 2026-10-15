# Recherche: Produktionsstrategie für Momos Animation und Assets

Ticket: [#69 „Momos Gestalt und Entwicklungsformen festlegen“](https://github.com/Yggras/abnehm-app/issues/69) · Stand: 15.10.2026

Diese Recherche vergleicht ausschließlich anhand von Primärquellen:

1. Raster-Sprites/Sprite-Sheets mit React Native Skia,
2. ein in Skia aus Ebenen zusammengesetztes 2D-Rig,
3. Rive für React Native/Expo,
4. Lottie für React Native/Expo.

Rechts- und Lizenzfragen sind ausdrücklich nicht betrachtet. Aussagen unter **Belegte Fakten** stammen aus offiziellen Dokumentationen, veröffentlichtem Quellcode bzw. Paketmetadaten oder den eigenen Geräte-Messungen des Projekts. Aussagen unter **Designschluss**, **Empfehlung** oder **eigene Ableitung** sind daraus abgeleitete Bewertungen.

## Kurzantwort

- **Der vorhandene Stack trägt beide Skia-Varianten unmittelbar.** Der Geräte-Spike verwendet Expo SDK 57, React Native 0.86.3, Skia 2.6.2 und Reanimated 4.5.1; die belastete Insel lief im Release-Build auf beiden Zielgeräten flüssig [P3][P4].
- **Lottie ist technisch am einfachsten zusätzlich einzusetzen:** Expo SDK 57 bündelt `lottie-react-native` 7.3.8, und Expo Go SDK 57 enthält das Paket [E1][E2]. Seine React-Native-API ist aber primär ein Timeline-Player; sie bietet Abspielen, Pausieren, Fortschritt, Frame-Segmente sowie Farb- und Textfilter, jedoch keine dokumentierte State-Machine- oder allgemeine Komponenten-Swap-API [L1][L2].
- **Rive besitzt den stärksten fertigen Funktionsumfang für ein modulares Character-Rig:** Bones für Vektor- und Rasterteile, wiederverwendbare Komponenten, State Machines sowie Data Binding für Enums, Bilder und austauschbare Artboards sind offiziell dokumentiert [R3][R4][R5]. Es braucht jedoch einen Development Build, rendert als eigene `RiveView` statt als Skia-Zeichenbefehl und hat im aktuellen Paket eine Nitro-Peer-Abhängigkeit, die mit dem derzeit im Health-Spike gepinnten Nitro 0.37.1 kollidiert [R1][N1][P5].
- **Empfehlung für dieses Projekt: Variante 2, ein datengetriebenes Skia-Ebenenrig, mit Variante 1 nur für gezielte Frame-by-Frame-Akzente.** Entwicklungsform, Stimmung, Aktionsanimation und Accessoires bleiben getrennte Dimensionen. Kopf- und Hals-Accessoires hängen an benannten Ankerpunkten des Rigs. Dadurch entstehen nicht für jede Kombination eigene Vollbild-Assets.
- **Rive ist der fachlich stärkste Plan B**, falls ein vertikaler Skia-Schnitt die gewünschte Ausdrucksstärke nicht erreicht. Vor einer Umstellung müssen ein Rive/Skia-Z-Order-Spike, die Nitro-Auflösung und die reale Größenänderung beider Release-Builds bestanden sein.

## 1. Ausgangslage und Zielkriterien

### Belegte Fakten

Ticket #69 und das angenommene Design-System geben für Momo unter anderem vor: eine über die Formen konsistente Konstruktion, sieben freundliche bzw. neutrale Stimmungen, einen flächigen zweitönigen Stil, Animationen für Reaktionen sowie Kopf- oder Hals-Accessoires, die das Gesicht nicht verdecken [P1][P2]. Die Aufgabenstellung ergänzt acht Entwicklungsformen.

Der derzeitige technische Referenzstand ist kein fertiges App-Root-Projekt, sondern eine beschlossene Planung mit Spikes:

| Baustein | Vorhandener Stand | Bedeutung für Momo |
|---|---|---|
| Expo / React Native | Expo 57.0.27, React Native 0.86.3, React 19.2.3 [P3] | Gemeinsamer iOS-/Android-Unterbau |
| Skia | `@shopify/react-native-skia` 2.6.2, von Expo SDK 57 gebündelt [E1][P3] | Bereits für die Insel beschlossen und im Zielgeräte-Spike erprobt |
| Animation | Reanimated 4.5.1 [E1][P3] | Shared Values/Worklets können Skia-Eigenschaften direkt treiben [S4] |
| Zielgeräte | iPhone SE 3 und Fairphone 6 | Insel-Spike: Skia praktisch 60 fps auf dem iPhone und ca. 89 fps auf dem Fairphone; das ist eine projektspezifische Messung des Insel-Lastprofils, kein allgemeiner Momo-Benchmark [P4] |
| Native Builds | Der Health-Spike enthält native HealthKit-/Health-Connect-Pakete und eigene `expo run`-/EAS-Build-Skripte [P5] | „Nicht in Expo Go“ ist für Rive kein Produktionsausschluss, erhöht aber Build- und Integrationsaufwand |

### Bewertungsmaßstab

Eine Produktionsstrategie muss die folgenden Dimensionen unabhängig kombinieren können:

- acht Entwicklungsformen,
- sieben Stimmungen,
- mehrere Schleifen und einmalige Reaktionen,
- kein bzw. genau ein Kopf- und/oder Hals-Accessoire aus einem wachsenden Katalog,
- normale und bewegungsreduzierte Darstellung.

**Eigene Ableitung:** Bei vollständig vorgerenderten Kombinationen wächst der Assetraum grob mit
`Formen × Stimmungen × Animationen × Frames × Accessoire-Kombinationen`.
Eine modulare Lösung soll stattdessen Form/Rig, Ausdruck, Bewegung und Accessoire separat speichern und erst zur Laufzeit zusammensetzen. Die Zahl ist ein Strukturmodell, keine Schätzung der späteren Dateigröße.

## 2. Variante 1: Raster-Sprites und Sprite-Sheets mit Skia

### Belegte Fakten

- Skia lädt lokale Bilder per `require`, Netzwerkbilder oder native Bundle-Ressourcen mit `useImage` und zeichnet sie mit `Image` [S2].
- `Atlas` zeichnet rechteckige Ausschnitte einer Textur mit je einer `RSXform` für Translation, gleichmäßige Skalierung und Rotation sowie optionalen Farben/Blend-Modi. Die Doku nennt Sprites, Tiles und große Mengen ähnlicher Objekte als Einsatzzweck [S1].
- Für eine feste Sprite-Anzahl empfiehlt die Skia-Doku Retained Mode plus Atlas; die Darstellung geschieht dort in einem Draw Call. Atlas-Rechtecke und -Transformationen können mit Worklet-basierten Buffern animiert werden [S1][S6].
- Alternativ unterstützt Skia animierte GIFs und animiertes WebP. `useAnimatedImageValue` liefert das aktuelle Bild als Shared Value und nimmt optional einen Pause-Shared-Value entgegen [S2a].
- Reanimated Shared und Derived Values können direkt als Skia-Props verwendet werden; die Animation läuft auf dem UI-Thread [S4].

### Designschluss

Ein klassisches Vollkörper-Sheet kann handgezeichnete, sehr charaktervolle Einzelbilder wiedergeben. Es löst die Kombinatorik aber **nicht allein**:

- Werden Stimmung und Accessoire in jedes Körperbild eingebrannt, vervielfacht jede neue Auswahl alle betroffenen Frames.
- Werden Gesicht und Accessoire separat gezeichnet, braucht jeder Körperframe passende Ankerdaten für Kopf/Hals sowie gegebenenfalls Vorder-/Hinterebenen für korrekte Überdeckung. Dann entsteht bereits ein kleines Ebenenrig mit frameweisen Metadaten.
- Ein animiertes GIF/WebP ist bequem für genau eine fertige Sequenz, stellt aber keine dokumentierte API für unabhängige Körper-, Gesichts- und Accessoire-Spuren bereit.

**Eignung:** gut für kurze Frame-by-Frame-Spezialeffekte oder bewusst handgezeichnete Reaktionen; als alleinige Hauptrepräsentation bei acht Formen, sieben Stimmungen und vielen Accessoires nur mit erheblicher Asset- und Metadatenproduktion geeignet.

### Sinnvolle Produktionsform, falls Raster gewählt wird

**Empfehlung:** Nicht ein globales Riesen-Atlas, sondern ein Sheet je Entwicklungsform und Animationsfamilie. Pro Frame werden mindestens gespeichert:

- Quellrechteck,
- Dauer,
- Ursprung/Bodenpunkt,
- Kopf- und Halsanker mit Rotation/Skalierung,
- optional getrennte hintere und vordere Accessoire-Ebene,
- ein ruhiger Ersatzframe für Reduced Motion.

Gesicht, Körper und Accessoire sollten nur dann getrennte Sprites sein, wenn ihre Überlagerung in allen Frames wirklich funktioniert. Andernfalls ist für diese konkrete Sequenz ein bewusst gebackener Körper-/Gesicht-Clip vertretbar; Accessoires sollten trotzdem separat bleiben.

## 3. Variante 2: Zusammengesetztes 2D-Rig in Skia

### Belegte Fakten

- Skia-`Group`s können beliebig verschachtelt werden und Transformationen mit frei gesetztem Ursprung, Clipping, Ebeneneffekte und lokale Zeichenreihenfolge anwenden [S3]. Das reicht als technische Basis für hierarchische Gelenke und Accessoire-Anker.
- Eine Gruppe darf Vektorpfade und Rasterbilder gemeinsam enthalten. `Path` akzeptiert SVG-Pfadnotation; `Image` zeichnet Rasterteile [S2][S5].
- Reanimated-Werte können Transformationen, Positionen, Deckkraft und andere Zeichenattribute direkt treiben [S4]. Im Retained Mode ist eine feste Szenenstruktur laut Skia-Doku besonders für animierte Benutzeroberflächen geeignet [S6].
- `usePathInterpolation` kann Formen weich ineinander überführen, sofern die Pfade gleich viele und gleichartige Befehle haben. Für beliebige Pfade garantiert die API keine korrekte Interpolation [S5].
- Die offizielle Skia-API stellt Zeichen- und Animationsprimitive bereit. In den geprüften Skia-Dokumenten ist kein visueller Character-Rig-/Timeline-/State-Machine-Editor dokumentiert; Ablaufsteuerung und Assetvertrag wären daher Projektcode. Dies ist eine ausdrücklich benannte Quellenlücke, keine Behauptung über sämtliche Drittwerkzeuge.

### Designschluss

Diese Variante trennt die Dimensionen am direktesten, ohne einen zweiten Renderer einzuführen:

- **Form:** eigenes Teile- und Anker-Manifest je Entwicklungsform.
- **Stimmung:** Augen, Brauen, Mund, Wangen und kleine Haltungsparameter; keine Kopie des ganzen Körpers.
- **Animation:** wiederverwendbare Transform-Spuren für Körpergruppen, ergänzt um formspezifische Korrekturen.
- **Accessoire:** ein eigenes Asset mit Slot `head` oder `neck`, optional in Vorder-/Hinterteil geteilt.

Dadurch werden keine fertigen Bilder für `Form × Stimmung × Accessoire` benötigt. Ein Accessoire braucht im Normalfall ein Asset und nur formspezifische Passdaten, nicht sieben Stimmungs- und mehrere Animationskopien.

**Eignung:** beste Passung zum vorhandenen Skia-Inselrenderer, zur flächigen Momo-Formsprache und zu einem wachsenden Accessoire-Katalog. Der Preis ist eine eigene kleine Animationsschicht und weniger komfortables visuelles Authoring als in Rive.

## 4. Variante 3: Rive React Native/Expo

### Belegte Fakten

#### Stack und Laufzeit

- Rive empfiehlt für neue React-Native-Projekte `@rive-app/react-native`. Die offizielle Expo-Anleitung verlangt wegen nativen Codes einen Development Build; Expo Go wird nicht unterstützt. Der neue Runtime-Zweig unterstützt Expo SDK 53+, React Native 0.78+, iOS 15.1+ und Android API 24+ und passt damit grundsätzlich zu Expo 57/RN 0.86 [R1][R2].
- Das veröffentlichte Paket `@rive-app/react-native@0.5.5` verlangt `react-native-nitro-modules >=0.35.10 <0.37` [N1]. Der vorhandene Health-Spike pinnt dagegen `react-native-nitro-modules ^0.37.1` [P5]. Die deklarierte HealthKit-Peer-Abhängigkeit selbst lautet nur `>=0.35`, aber eine gemeinsame Nitro-0.36.x-Auflösung wurde im Projekt nicht gebaut oder getestet [N2].
- Rive lädt lokale `.riv`-Dateien per `require`, aus einer URL, als native Ressource oder aus einem `ArrayBuffer`. Für Expo/Metro muss `riv` in `assetExts` ergänzt werden. Bei `require` wird die Datei in den Build aufgenommen und kann laut Rive-Doku über OTA-Updates aktualisiert werden [R9].

#### Character-Funktionen

- Rive-Bones können ganze Vektor-/Rasterelemente transformieren sowie Vektorpfade oder Rastermeshes gewichtet verformen [R4].
- Wiederverwendbare Components dürfen eigene Grafik, Animationen, State Machines und Daten enthalten. Ihre Quelle kann per Data Binding dynamisch gewechselt werden [R4a].
- „Solos“ zeigen genau eines ihrer Kindelemente, sind animierbar und werden offiziell unter anderem für Character-Skins und wechselnde Rigs beschrieben [R4b].
- State Machines bestehen aus Animationszuständen und Übergängen. Der neue React-Native-Runtime-Zweig setzt für neue Projekte auf State Machines statt direkter Timeline-Auswahl und kann sie abspielen, pausieren und zurücksetzen [R3].
- Data Binding unterstützt Zahlen, Booleans, Trigger, Strings, Enums, Farben, verschachtelte View Models, Listen, Bilder und Artboards. Die Doku nennt bei Artboard-Properties ausdrücklich Character Creator mit wechselnden Körperteilen, Kleidung und Accessoires sowie das Aufteilen großer Dateien in nachladbare Komponenten [R5]. Das offizielle React-Native-Beispiel tauscht Artboards auch aus einer zweiten `.riv`-Datei aus [R5a].
- Rasterbilder können zur Laufzeit über Image Properties ersetzt werden; referenzierte statt eingebettete Bilder/Schriften halten `.riv`-Dateien kleiner. Rive unterstützt für solche Bilder JPEG, PNG und WebP; eingebettete Assets, insbesondere Schriften, können die Datei vergrößern [R5][R6].

#### Reduced Motion und Größe

- Rive wendet Reduced Motion nicht automatisch an. Die offizielle Empfehlung ist, die Plattformpräferenz als Data-Binding-Boolean wie `prefersReducedMotion` zu übergeben und damit einen alternativen State-Machine-Pfad, reduzierte Geschwindigkeit bzw. nicht-räumliches Feedback zu wählen [R7].
- Rives Größenmessung für den nativen Runtime-Kern nennt gegenüber einer leeren App ungefähr **1,67 MB Download-/4,66 MB Installationszuwachs auf Apple** sowie **2,40 MB Download-/7,03 MB Installationsgröße für Android ARM-v8a**. Die Doku weist darauf hin, dass geteilte Abhängigkeiten und R8 den realen Zuwachs verändern [R8]. Das sind Herstellerwerte für den Runtime-Kern, keine Messung dieser Expo-App inklusive Nitro-Wrapper und Momo-Dateien.

### Designschluss

Rive kann die gewünschte Kombinatorik am natürlichsten als visuell authorbares Character-System abbilden:

- `form` als austauschbares Artboard/Component,
- `mood` als Enum im View Model,
- einmalige Reaktionen als Trigger,
- Accessoires als austauschbare Components/Artboards in Kopf- und Halsslots,
- `prefersReducedMotion` als Boolean,
- je Form ein gleich benanntes View-Model-Interface.

Damit ist Rive **funktionsseitig der stärkste Kandidat** für ein ausdrucksstarkes Pet ohne vorgerenderte Kombinationen.

Für dieses Projekt bestehen aber drei Integrationsnachteile:

1. Der dokumentierte React-Native-Einstiegspunkt ist eine eigene `RiveView`. In den geprüften offiziellen APIs ist kein Weg dokumentiert, einen laufenden Rive-Frame als `SkImage` in den vorhandenen Insel-Canvas einzuspeisen. **Eigene Ableitung:** Momo wäre daher eine transparente View über/unter dem Skia-Canvas; eine Überdeckung zwischen einzelnen Inselobjekten und Momo ist nicht ohne zusätzliche Canvas-/View-Aufteilung möglich.
2. Der aktuelle Nitro-Peer-Bereich kollidiert mit dem vorhandenen Health-Spike und verlangt eine koordinierte, erneut getestete Abhängigkeitsentscheidung.
3. Es kommt ein zweiter nativer Renderer mit messbarem Größenbeitrag hinzu, obwohl Skia ohnehin vorhanden ist.

## 5. Variante 4: Lottie React Native/Expo

### Belegte Fakten

- Expo SDK 57 bündelt `lottie-react-native ~7.3.8`; auch das Expo-Go-Projekt für SDK 57 führt `lottie-react-native ^7.3.8` [E1][E2]. Die Paketversion ist damit bereits auf das gewählte SDK abgestimmt.
- Lottie React Native rendert aus After Effects/Bodymovin exportierte JSON-Animationen nativ. Lokale/entfernte JSON-Quellen und `.lottie`-Dateien werden unterstützt; für `.lottie` muss die Metro-Asset-Erweiterung ergänzt werden [L1].
- Die dokumentierte API kann automatisch oder imperativ abspielen, pausieren, fortsetzen und zurücksetzen, einen normalisierten `progress` setzen und auf iOS/Android ein Frame-Segment `play(startFrame, endFrame)` starten. Dynamische Anpassungen sind als Farbfilter nach Keypath und plattformspezifische Textfilter dokumentiert [L1][L2].
- Die offizielle Lottie-Featurematrix bestätigt unter anderem Vektorformen, Transformationen, Parenting, Bilder, Precomps und Marker. Sie dokumentiert zugleich Plattformlücken: Expressions und viele Layer Effects laufen nicht nativ auf Android/iOS; weitere Features unterscheiden sich zwischen den Renderern [L3]. Das React-Native-Projekt warnt deshalb selbst, nicht unterstützte After-Effects-Funktionen gegen diese Matrix zu prüfen [L1].
- In der öffentlichen API von `lottie-react-native@7.3.8` sind keine State Machine, kein allgemeines Ein-/Ausblenden beliebiger Layer und kein Austausch eines beliebigen Komponenten-/Artboard-Slots dokumentiert [L2]. Die dynamische Einheit ist im Wesentlichen die geladene Komposition; `colorFilters` und Textfilter sind die dokumentierten Layer-Anpassungen.
- Die API bietet `pause()` und `progress`, aber keinen eigenen Reduced-Motion-Prop [L2]. Eine appseitig gelesene Plattformpräferenz kann daher die Animation pausieren oder einen festgelegten ruhigen Frame anzeigen.

### Designschluss

Lottie eignet sich gut für abgeschlossene, lineare Clips wie Schlüpfen, einen Erfolgsfunken oder eine einmalige Levelaufstiegssequenz. Für Momo als dauerhaft zustandsbehaftete Figur entstehen dagegen zwei ungünstige Wege:

- eine Lottie-Komposition je Form/Stimmung/Aktion bzw. vorgerenderter Kombination, oder
- mehrere übereinanderliegende `LottieView`s für Körper, Gesicht und Accessoire, deren Fortschritt und Anker die App selbst synchronisieren muss.

Beides nutzt die eigentliche Stärke eines fertigen Timeline-Players, nicht die eines zur Laufzeit zusammensetzbaren Character-Rigs. Parenting innerhalb **einer** Komposition hilft einem fest eingebauten Accessoire, die React-Native-API stellt aber keinen dokumentierten generischen Slot bereit, um beliebige neue Accessoires in diese Hierarchie einzusetzen. **Eignung:** gut für isolierte Effekte, nicht als primäres Momo-System empfohlen.

## 6. Vergleich

Die Spalte „Bewertung“ ist eine Designbewertung für die Anforderungen dieses Projekts; die technischen Eigenschaften davor sind belegt.

| Kriterium | Skia Raster/Atlas | Skia-Ebenenrig | Rive | Lottie |
|---|---|---|---|---|
| Technisch im vorhandenen Stack | Ja, bereits installiert [E1][P3] | Ja, bereits installiert [E1][P3] | Grundsätzlich ja, aber Development Build und aktuelle Nitro-Kollision [R1][N1][P5] | Ja, SDK-/Expo-Go-Version 7.3.8 vorhanden [E1][E2] |
| Laufzeitmodell | Sprite-Rechtecke und Transformationen in Skia-Atlas; alternativ GIF/WebP [S1][S2a] | Verschachtelte Groups, Paths/Images, Reanimated [S2][S3][S4] | Eigene View mit Bones, Components, State Machine, Data Binding [R3][R4][R5] | Eigene View für Timeline-Komposition; Playback/Progress/Filter [L1][L2] |
| Visuelles Authoring | Externes Zeichen-/Sprite-Werkzeug; Metadaten selbst | Kein dokumentierter Skia-Rig-Editor; Projektcode | Dedizierter Editor und Runtime-Verträge | After Effects/Bodymovin; Feature-Subset beachten [L1][L3] |
| Accessoires ohne Vollkombinationen | Möglich, aber frameweise Anker nötig | Direkt als Child am Kopf-/Halsanker | Direkt als Component-/Artboard-Slot | Kein dokumentierter generischer Slot; nur mit getrennten Views/Kompositionen |
| Stimmung unabhängig von Bewegung | Nur mit separaten Gesichts-Layern | Ja, über Expressions-Layer und Poseparameter | Ja, über Enum/Data Binding und State Machine | Nur durch selbst entworfene Segmente/Kompositionen |
| Formspezifische Animation | Viele Frames je Form | Rig/Clips mit formspezifischen Korrekturen | Je Form Component/Rig, gemeinsames Dateninterface | In der Regel eigene Kompositionen je Form |
| Reduced Motion | Ruhiger Frame bzw. Pause [S2a] | Animationen gar nicht starten; statische Pose/Überblendung | Offizieller Data-Binding-Pfad [R7] | Appseitig `pause`/statischer `progress` [L2] |
| Zusätzlicher nativer Runtime-Anteil | Keiner, Skia ist ohnehin da | Keiner, Skia ist ohnehin da | Ja; Herstellerwerte siehe oben [R8] | Ja; kein belastbarer offizieller RN-Größenwert gefunden |
| Risiko kombinatorischer Assets | Hoch bei gebackenen Kombinationen; mittel mit Layern | Niedrig | Niedrig | Hoch bis mittel, abhängig von selbst gebauter Layer-Synchronisierung |
| **Bewertung als Momo-Hauptsystem** | **bedingt geeignet** | **empfohlen** | **stärkster Funktionsumfang, Plan B für dieses Projekt** | **nicht empfohlen** |

## 7. Empfohlener Asset- und Laufzeitvertrag

Dieser Abschnitt ist eine **Designempfehlung**, keine Bibliotheksdokumentation.

### 7.1 Eine stabile öffentliche Schnittstelle

Die Oberfläche außerhalb des Renderers sollte nur fachliche Zustände kennen:

```ts
type MomoVisualState = {
  form: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  mood: MomoMood;             // genau sieben benannte Zustände
  action: MomoAction | null; // z. B. kurze Ziel-/Levelreaktion
  headAccessory: AccessoryId | null;
  neckAccessory: AccessoryId | null;
  reducedMotion: boolean;
};
```

Der Renderer entscheidet daraus Pose, Clip und Layer. Fachcode darf keine Frame-Nummern, Pfade oder Gelenkkoordinaten kennen.

### 7.2 Ein Rig-Manifest je Entwicklungsform

Jede Form nutzt denselben semantischen Vertrag, darf grafisch aber eigenständig sein:

- normiertes lokales Koordinatensystem und Bodenpunkt,
- Layerliste mit `Path`- oder `Image`-Quelle,
- verschachtelte Gelenkgruppen mit Ursprung,
- benannte Slots `head.back`, `head.front`, `neck.back`, `neck.front`,
- sieben Expression-Sets für Augen/Brauen/Mund/Wangen,
- formspezifische Korrekturwerte für gemeinsame Clips,
- ruhige Schlüsselpose je Stimmung.

Vorder-/Hinter-Slots lösen Überdeckungen, etwa ein Hutband hinter dem Kopf und die Krempe davor. Ein neues Accessoire liefert höchstens Vorder- und Hinterteil sowie seine Slot-Ausrichtung; es erhält keine Kopien je Stimmung oder Animation.

### 7.3 Animationen als semantische Clips

- Ruhige Loops: Atmen/leichtes Wippen, Dösen, Schlafen.
- Einmalige Aktionen: freut sich, begeistert/Levelaufstieg, neugierige Reaktion.
- Primär Group-Transformationen animieren; Gesichtsformen diskret wechseln oder überblenden.
- Path-Morphing nur bei bewusst kompatibel konstruierten Pfaden einsetzen [S5].
- Atlas-/Rastersequenzen nur für Details verwenden, die mit Rig-Transformationen sichtbar schlechter wirken, etwa einen kurzen handgezeichneten Ohr- oder Schweif-Akzent.
- Eine einmalige Aktion hat Priorität vor dem Stimmungsloop und kehrt danach deterministisch in dessen Ruhepose zurück.

### 7.4 Kein universelles Master-Asset

**Empfehlung:** Assets nach Entwicklungsform und Funktionsart schneiden, nicht alle Formen in eine einzige Textur oder unübersichtliche Datei packen. Das erleichtert Review, Austausch und Regressionstests. Gemeinsame Farbtokens und der semantische Rig-Vertrag sichern die Konsistenz; identische Pixel-/Pfadgeometrie zwischen allen Formen ist nicht erforderlich.

## 8. Reduced Motion

### Belegte Fakten

- Reanimated `useReducedMotion()` liest synchron, ob Reduced Motion beim App-Start aktiviert war. Eine spätere Systemänderung rendert Komponenten laut Doku nicht automatisch neu [A1].
- React Native `AccessibilityInfo.isReduceMotionEnabled()` und das Ereignis `reduceMotionChanged` erlauben Initialabfrage und Reaktion auf Änderungen [A2].
- Rive verlangt die explizite Übergabe dieser Präferenz und empfiehlt je nach Bedeutung einen alternativen Pfad, Geschwindigkeit 0/reduzierte Geschwindigkeit, Opazitäts-/Farbfeedback oder kürzere Wege [R7].
- Skias animierte Bild-API kann über einen Shared Value pausiert werden; Lottie bietet `pause` und einen statischen `progress` [S2a][L2].

### Empfohlene Produktregel

- Keine Dauerloops, Sprünge, Rotationen, Wellen oder Partikel, sobald Reduced Motion aktiv ist.
- Stimmungen bleiben über Gesicht, Haltung und Farbe vollständig erkennbar.
- Zustandswechsel erfolgen als kurze Überblendung gemäß Design-System statt räumlicher Bewegung.
- Ein Erfolg endet sofort in einer klaren freudigen Schlüsselpose; Feedback wird nicht ersatzlos entfernt.
- Die Präferenz wird zentral über `AccessibilityInfo` inklusive Änderungsereignis verwaltet und als Boolean an jeden Renderer übergeben. So verhalten sich Skia, ein möglicher späterer Rive-Renderer und normale UI konsistent.

## 9. Asset- und App-Größe

### Belegte Fakten

- Expo nennt statische Bilder, Fonts, Videos und Sounds als häufige Ursache für App-Größenwachstum. Ein Release-Artefakt soll mit APK Analyzer bzw. entpackter IPA geprüft werden; die tatsächlich ausgelieferte Größe ist erst über Play Console bzw. App Store Connect/TestFlight belastbar [E3].
- `npx expo export` listet Update-Assets in `dist/assets`; EAS Update lädt neue oder geänderte Assets, sofern sie statisch im Code referenziert sind. Expo dokumentiert `npx expo-optimize` zur Bildkompression [E4].
- Skias eigener Installationsleitfaden nennt als erwarteten Zuwachs beim **Hinzufügen** der Bibliothek ca. 6 MB auf iOS und 4 MB auf Android [S7]. Für Momo ist dieser Runtime-Anteil bereits durch die Insel vorhanden; zusätzlich zählen also primär Momos Assets und Code.
- Rives veröffentlichte Runtime-Größen stehen in Abschnitt 4. Für Lottie React Native wurde in den offiziellen Quellen kein vergleichbarer, belastbarer Download-/Installationszuwachs gefunden.
- Rive bietet für Rasterassets Kompression sowie „Embedded“, „Referenced“ und „Hosted“; Referenzen können eine `.riv`-Datei klein halten, verlagern die Bytes aber in App-Assets oder einen Download [R6].

### Empfohlene Größenstrategie

1. **Keine pauschale Annahme „Vektor ist immer kleiner“.** Pfadkomplexität, Zahl der Keys, Rasterauflösung und Kompression entscheiden; ohne fertige Momo-Dateien ist kein seriöser MB-Wert belegbar.
2. **Skia-Baseline messen:** Release-Build mit Insel, aber ohne Momo-Produktassets.
3. **Vertikalen Momo-Schnitt messen:** zwei stark unterschiedliche Formen, sieben Stimmungen, vier Animationen und mindestens drei Accessoires. `dist/assets`, Android APK Analyzer und TestFlight-App-File-Sizes vergleichen [E3][E4].
4. **Bei einem Rive-Spike denselben Inhalt vergleichen:** Größenunterschied umfasst Runtime, Nitro-Auflösung und `.riv`-/Rasterassets; nicht nur die Dateigröße der `.riv` betrachten.
5. **Raster nur in der tatsächlich nötigen Auflösung liefern** und nach visueller Prüfung komprimieren. Für Rive empfiehlt die offizielle Doku WebP für die meisten Rasterbilder; für Skia-Sheets ist das Format anhand von Qualität, Ladezeit und realer Build-Größe zu entscheiden [R6].
6. **Große neue Assetpakete bevorzugt mit einem Store-Build ausliefern.** Expo empfiehlt Updates eher für kleine Änderungen, weil neue Update-Assets auf Mobilverbindungen separat heruntergeladen werden [E4].

## 10. Entscheidung und Produktionsplan

### Empfehlung

**Momo wird als eigenes, tiefes Skia-Modul mit einem hierarchischen 2D-Ebenenrig produziert.** Vektorpfade bilden die flächigen Hauptformen; Rasterteile sind erlaubt, wenn sie einen sichtbaren Qualitätsvorteil bringen. Reanimated treibt die benannten Rig-Gruppen. Sprite-Sheets bleiben ein internes Werkzeug für wenige Frame-by-Frame-Akzente, nicht die Hauptrepräsentation.

Warum diese Wahl:

1. Sie komponiert Form, Stimmung, Bewegung und Accessoire zur Laufzeit und verhindert dadurch die kombinatorische Vollasset-Matrix.
2. Sie nutzt den bereits ausgewählten und auf beiden Zielgeräten erprobten Renderer [P4].
3. Momo kann im selben Skia-Canvas korrekt zwischen Inselobjekten einsortiert, mit der Insel skaliert und durch dieselben Abend-/Lichteffekte beeinflusst werden.
4. Es entsteht kein zweiter nativer Renderer und kein zusätzlicher Runtime-Größenbeitrag.
5. Der vorgegebene flächige, zweitönige Stil verlangt voraussichtlich keine komplexe Mesh-Deformation; das ist eine Designannahme, die der vertikale Schnitt prüfen muss.

### Umsetzungsreihenfolge

1. **Vertikaler Schnitt:** erste und größte Entwicklungsform, alle sieben Stimmungen, Idle/Freude/Begeisterung/Schlaf sowie je ein Kopf- und Hals-Accessoire.
2. **Beide Kontexte:** 104-dp-Darstellung auf „Heute“ und Momo im echten Insel-Canvas, einschließlich Überdeckung durch ein Vordergrundobjekt.
3. **Reduced Motion:** jede Stimmung als klare Schlüsselpose, keine bloß pausierte unleserliche Zwischenpose.
4. **Qualitätsgate:** Formen, Gesichtsausdruck, Übergänge und Accessoire-Sitz auf iPhone SE 3 und Fairphone 6 im Release-Build prüfen.
5. **Größengate:** Assetliste und Store-nahe Größen gegen die Skia-Baseline messen.
6. **Erst danach Formen 2–7 produzieren;** so werden Rig-Vertrag und Produktionsfehler nicht achtfach vervielfältigt.

### Wann Rive neu bewertet wird

Ein begrenzter Rive-Spike ist gerechtfertigt, wenn der Skia-Schnitt trotz guter Grafik an mindestens einem dieser Punkte scheitert:

- glaubwürdige organische Verformung ist mit Group-Transformationen/kompatiblen Pfaden nicht erreichbar,
- Animationsiteration ohne visuellen Rig-Editor ist der dominante Produktionsengpass,
- die gewünschte Zahl ineinander überblendender Zustände macht die eigene Ablaufsteuerung unbeherrschbar.

Der Spike muss denselben vertikalen Inhalt zeigen und zusätzlich nachweisen:

- Nitro-Version gemeinsam mit HealthKit/Health Connect gebaut und getestet,
- akzeptable transparente Überlagerung und Z-Order mit der Skia-Insel,
- Reduced-Motion-Pfad über Data Binding,
- gemessener App-Größenzuwachs auf beiden Plattformen.

Lottie wird nicht als Plan B für das Haupt-Rig vorgesehen; es kann höchstens für isolierte lineare Effekte gewählt werden, falls diese nicht ohnehin in Skia entstehen.

## Quellenlücken und offene Prüfungen

- Keine offizielle Quelle kann „hochwertig“ oder „ausdrucksstark“ objektiv für den konkreten Momo-Stil messen. Die Empfehlung beruht auf Funktionspassung; die visuelle Qualität muss der vertikale Schnitt zeigen.
- Es gibt keine offiziellen, vergleichbaren Performance-Benchmarks der vier Varianten für genau acht Formen, sieben Stimmungen und diesen Insel-Canvas. Vorhanden ist nur der eigene Skia-Insel-Spike [P4].
- Für `lottie-react-native` wurde kein offizieller aktueller Wert zum zusätzlichen Download-/Installationsumfang gefunden.
- Für Rive ist keine offizielle direkte Ausgabe eines laufenden React-Native-Rive-Frames als Skia-Textur dokumentiert. Ob es einen nicht dokumentierten oder künftigen Interop-Weg gibt, bleibt offen.
- Die gemeinsame Auflösung von Rive 0.5.5 mit Nitro 0.36.x und den Health-Bibliotheken ist anhand der deklarierten Bereiche möglich, wurde aber nicht gebaut oder auf den Zielgeräten getestet.
- Ohne finale Momo-Grafiken, Framezahlen, Rasterauflösungen und Accessoire-Anzahl ist keine belastbare Assetgrößenprognose möglich.
- Maximale sinnvolle Atlasabmessungen und dekodierter Speicherbedarf auf den konkreten Zielgeräten wurden nicht untersucht; große Rasteratlanten benötigen deshalb einen eigenen Messpunkt.

## Primärquellen

### Projektvorgaben und eigene Messungen

- **[P1]** GitHub-Issue #69, „Momos Gestalt und Entwicklungsformen festlegen“: https://github.com/Yggras/abnehm-app/issues/69
- **[P2]** Projekt, „Design-System Lagune“, Abschnitte „Bewegung“ und „Momo und Insel“: https://github.com/Yggras/abnehm-app/blob/main/research/design-system.md
- **[P3]** Projekt, Insel-Rendering-Spike, `package.json`: https://github.com/Yggras/abnehm-app/blob/main/spikes/insel-rendering/package.json
- **[P4]** Projekt, Insel-Rendering-Spike, eigene Release-Messungen auf iPhone SE 3 und Fairphone 6: https://github.com/Yggras/abnehm-app/blob/main/spikes/insel-rendering/RESULTS.md
- **[P5]** Projekt, Health-Hintergrund-Spike, `package.json`: https://github.com/Yggras/abnehm-app/blob/main/spikes/health-hintergrund/package.json

### Expo und React Native

- **[E1]** Expo SDK 57.0.27, veröffentlichte `bundledNativeModules.json` (`@shopify/react-native-skia` 2.6.2, Reanimated 4.5.1, Lottie 7.3.8): https://unpkg.com/expo@57.0.27/bundledNativeModules.json
- **[E2]** Expo Go SDK-57-Quellcode, `apps/expo-go/package.json` (`lottie-react-native ^7.3.8`): https://github.com/expo/expo/blob/sdk-57/apps/expo-go/package.json
- **[E3]** Expo-Doku, „Understanding app size“, Abschnitte „Determining … size“, „Static assets“: https://docs.expo.dev/distribution/app-size/
- **[E4]** Expo-Doku, „Optimize assets for EAS Update“, Abschnitte „Image assets“, „Further considerations“: https://docs.expo.dev/eas-update/optimize-assets/
- **[A1]** Reanimated 4.x, `useReducedMotion`: https://docs.swmansion.com/react-native-reanimated/docs/device/useReducedMotion/
- **[A2]** React Native, `AccessibilityInfo`, `isReduceMotionEnabled` und `reduceMotionChanged`: https://reactnative.dev/docs/accessibilityinfo

### React Native Skia 2.6.2

- **[S1]** React Native Skia v2.6.2, „Atlas“, Abschnitte API und „Animations“: https://github.com/wcandillon/react-native-skia/blob/v2.6.2/apps/docs/docs/shapes/atlas.md
- **[S2]** React Native Skia v2.6.2, „Images“, Abschnitte „Loading Images“ und „Image Component“: https://github.com/wcandillon/react-native-skia/blob/v2.6.2/apps/docs/docs/image.md
- **[S2a]** React Native Skia v2.6.2, „Animated Images“: https://github.com/wcandillon/react-native-skia/blob/v2.6.2/apps/docs/docs/animated-images.md
- **[S3]** React Native Skia v2.6.2, „Group“, Abschnitte „Transformations“, „Clipping“, „Drawing Order“: https://github.com/wcandillon/react-native-skia/blob/v2.6.2/apps/docs/docs/group.md
- **[S4]** React Native Skia v2.6.2, „Animations“/Reanimated-Integration: https://github.com/wcandillon/react-native-skia/blob/v2.6.2/apps/docs/docs/animations/reanimated3.md
- **[S5]** React Native Skia v2.6.2, „Animation Hooks“, `usePathInterpolation`, sowie „Path“: https://github.com/wcandillon/react-native-skia/blob/v2.6.2/apps/docs/docs/animations/hooks.md, https://github.com/wcandillon/react-native-skia/blob/v2.6.2/apps/docs/docs/shapes/path.md
- **[S6]** React Native Skia v2.6.2, „Rendering Modes“, insbesondere Retained Mode und Fixed Sprites/Tiles: https://github.com/wcandillon/react-native-skia/blob/v2.6.2/apps/docs/docs/canvas/rendering-modes.md
- **[S7]** React Native Skia v2.6.2, „Installation“, Abschnitt „Bundle Size“: https://github.com/wcandillon/react-native-skia/blob/v2.6.2/apps/docs/docs/getting-started/installation.md

### Rive

- **[R1]** Rive-Doku, „Adding Rive to Expo“, Abschnitte „Initial setup“, „Creating a development build“: https://rive.app/docs/runtimes/react-native/adding-rive-to-expo
- **[R2]** Rive React Native, offizielles Runtime-Repository, README „Requirements“ und „Feature Support“: https://github.com/rive-app/rive-nitro-react-native/blob/main/README.md
- **[R3]** Rive-Doku, „State Machine Playback“ und „Animation Playback“: https://rive.app/docs/runtimes/react-native/state-machines, https://rive.app/docs/runtimes/react-native/animation-playback
- **[R4]** Rive-Doku, „Bones“, Abschnitte „Transforming elements“ und „Deforming elements“: https://rive.app/docs/editor/manipulating-shapes/bones
- **[R4a]** Rive-Doku, „Components“, Abschnitte „Component instance properties“, „Source“, „Animations“: https://rive.app/docs/editor/fundamentals/components
- **[R4b]** Rive-Doku, „Solos“, Abschnitte „Creating new skins“, „Change the underlying rig“: https://rive.app/docs/editor/manipulating-shapes/solos
- **[R5]** Rive-Doku, „Data Binding“, Abschnitte „Properties“, „Images“, „Artboards“, „Enums“: https://rive.app/docs/runtimes/react-native/data-binding
- **[R5a]** Rive React Native, offizielles Beispiel „DataBindingArtboardsExample“: https://github.com/rive-app/rive-nitro-react-native/blob/main/example/src/demos/DataBindingArtboardsExample.tsx
- **[R6]** Rive-Doku, „Loading Assets“ und Editor „Assets“, Abschnitte „Embedded/Referenced assets“, „Compression“, „Export options“: https://rive.app/docs/runtimes/react-native/loading-assets, https://rive.app/docs/editor/fundamentals/assets-overview
- **[R7]** Rive-Doku, „Reduced Motion“, Abschnitte „Common strategies“, „Runtime setup“: https://rive.app/docs/editor/accessibility/reduced-motion
- **[R8]** Rive-Doku, „Runtime Sizes“, Tabs „Apple“ und „Android“: https://rive.app/docs/runtimes/runtime-sizes
- **[R9]** Rive-Doku, „Loading Rive Files“, `require`, URL, Resource und ArrayBuffer: https://rive.app/docs/runtimes/react-native/loading-rive-files
- **[N1]** npm-Registry, veröffentlichte Metadaten `@rive-app/react-native@0.5.5`, insbesondere `peerDependencies`: https://registry.npmjs.org/@rive-app%2Freact-native/0.5.5
- **[N2]** npm-Registry, veröffentlichte Metadaten `@kingstinct/react-native-healthkit@16.1.0`, insbesondere `peerDependencies`: https://registry.npmjs.org/@kingstinct%2Freact-native-healthkit/16.1.0

### Lottie

- **[L1]** Lottie React Native 7.3.8, README „Usage“, `.lottie`, API und Troubleshooting: https://github.com/lottie-react-native/lottie-react-native/blob/v7.3.8/README.md
- **[L2]** Lottie React Native 7.3.8, dokumentierte Props/Methoden und veröffentlichte TypeScript-API: https://github.com/lottie-react-native/lottie-react-native/blob/v7.3.8/docs/api.md, https://github.com/lottie-react-native/lottie-react-native/blob/v7.3.8/packages/core/src/types.ts
- **[L3]** Airbnb Lottie, offizielle „Supported Features“-Matrix: https://github.com/airbnb/lottie/blob/master/supported-features.md
