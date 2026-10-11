# Recherche: Isometrische Inselansicht in Expo/React Native

Ticket: [#29](https://github.com/Yggras/abnehm-app/issues/29) · Stand: 11.10.2026 · Versionen, Release-Daten, npm-Downloads (Woche 03.–09.10.2026) und GitHub-Sterne am 11.10.2026 über die öffentlichen APIs von npm und GitHub abgerufen [32][33].

Quellen-Nummern in eckigen Klammern [n] verweisen auf die Liste am Ende. Mit *eigene Rechnung* oder *eigene Einschätzung* markierte Stellen sind nicht durch eine Quelle belegt.

## Zusammenfassung

- **Ausgangslage (eigene Rechnung):** Der Web-Prototyp (Variante A) zeichnet die Insel als **ein** SVG mit 46 Feldern. Ich habe `render()` mit dem Startzustand des Prototyps ausgeführt. Ergebnis: **702 SVG-Elemente** am Tag, **783** am Abend mit Bereichsnamen und **1.382** bei einer voll bebauten Insel am Abend. **87 bis 157** dieser Elemente haben eine CSS-Animation [34].
- **Alle drei Hauptkandidaten sind im Expo SDK enthalten.** Expo SDK 57 (aktuell, `expo` 57.0.27) bündelt `react-native-svg` 15.15.4, `@shopify/react-native-skia` 2.6.2 und `react-native-webview` 13.16.1, dazu Reanimated 4.5.1 und Gesture Handler 2.32.0 [1][3]. Laut Expo-Doku laufen alle drei auch in Expo Go [4][5][6].
- **Skia im Umbruch:** Das Projekt ist von Shopify zu William Candillon umgezogen. Seit dem 02.10.2026 heißt das npm-Paket `react-native-skia`. `@shopify/react-native-skia` endet bei Version 2.14 [13][15][25]. v3 (Graphite-Backend, aktuell 3.3.0 vom 08.10.2026) braucht einen Development Build und Android API 26. v2 wird laut README weiter gepflegt [13][14][15][32].
- **Performance – belegt ist wenig:** Für die Kombination aus ~1.400 Elementen, Daueranimationen und 60 fps habe ich **keine** Benchmarks der Maintainer gefunden (nicht belegt). Belegt ist das Render-Modell von Skia: Animationsframes entstehen ohne React-Render und ohne Arbeit auf dem JS-Thread [17][18]. Ebenfalls belegt ist eine Faustregel aus der Reanimated-Doku: höchstens etwa 100 gleichzeitig animierte Komponenten auf schwachen Android-Geräten und etwa 500 auf iOS [26].
- **Antippen einzelner Felder:** `react-native-svg` hat `onPress` direkt am Element [12]. Skia hat keine Ereignisse pro Element. Die Doku empfiehlt Gesture Handler plus unsichtbare Overlay-Views [19]. Für das Rautenraster genügt eine Rückrechnung von Bildschirm- auf Feldkoordinaten (*eigene Rechnung*, siehe Abschnitt 3).
- **Übernahme des Prototyps:** Mit `react-native-svg` lässt sich der Code fast 1:1 übernehmen (gleiche Elementnamen, Verläufe vorhanden). CSS-Keyframes laufen über Reanimated weiter, die Funktion ist aber als experimentell markiert [12][27][28]. Skia erfordert eine Umschreibung auf eigene Komponenten. Dafür hat Skia Blend-Modi wie `multiply` und zeichnet Emojis mit der Emoji-Schrift der Plattform [18][23]. Die SVG-Import-Funktion von Skia (`ImageSVG`) taugt nicht als Abkürzung: Sie rendert keinen Text und kein CSS [22].
- **WebView / Expo-DOM-Komponenten** würden den Web-Code fast unverändert ausführen. Expo selbst rät aber zu nativen Komponenten, nennt langsameren Start und gedrosselte Bildraten im Stromsparmodus und überträgt Props nur asynchron [10].
- **Empfehlung (Vorschlag, Entscheidung beim Nutzer):** **Skia** in der Version, die das jeweilige Expo SDK bündelt (v2-Linie), zusammen mit Reanimated und Gesture Handler. Felder werden per Koordinaten-Rückrechnung angetippt. **Plan B:** `react-native-svg` mit Reanimated, falls sich die Umschreibung auf Skia als zu aufwendig erweist. **Vor der Festlegung:** ein kurzer Spike auf beiden Zielgeräten (iPhone, Android-Gerät der Partnerin), weil belastbare Zahlen fehlen.

## Ausgangslage: Was der Prototyp zeichnet

Quelle: `prototypes/momos-insel/island-iso.js` und `styles.css` auf Branch `prototype/momos-insel` [34].

- **Raster:** 9×9-Karte, davon 46 Landfelder (nicht ~60). Jedes Feld besteht aus 3–5 Polygonen (Seiten, Kante, Oberseite). Darauf liegen Objekte aus Kreisen, Ellipsen, Polygonen und Pfaden, Deko und Momo als Emoji-`<text>`.
- **Neuzeichnen:** Bei jeder Zustandsänderung entsteht das komplette SVG neu als String (`innerHTML`).
- **Effekte:** ein linearer Verlauf (Meer) und drei radiale Verläufe (Teich, Leuchten, Flachwasser). Das Abend-Overlay nutzt `mix-blend-mode: multiply`. `filter` wird nicht verwendet.
- **CSS-Animationen** (`styles.css`): `pulse` (gültige Felder), `foam`, `bob`, `hop` (Momo), `pop` (neu gebaut), `wave`, `drift` (Nebel), `fall` (Partikel), `twinkle` (Sterne, Leuchten, Fontäne), `sail` (Boot). Animiert werden nur `opacity` und `transform` (translate, scale, rotate).

**Elementzahl (eigene Rechnung):** Ich habe `render()` in Node mit dem `initialState()` aus `app.js` ausgeführt und die öffnenden Tags gezählt. Als animiert zählen Elemente mit einer der Animationsklassen.

| Zustand | SVG-Elemente gesamt | davon Polygone / Kreise / Ellipsen | animierte Elemente |
|---|---|---|---|
| Start, Tag | 702 | 277 / 143 / 100 | 87 |
| Start, Abend + Bereichsnamen | 783 | 313 / 169 / 100 | 113 |
| Alle freien Felder bebaut, Frühling, Abend, alle Felder „gültig“ | 1.382 | 433 / 490 / 174 | 157 |

## Kandidaten im Überblick

### 1. react-native-svg

- **Version:** 15.15.5 vom 11.05.2026. Expo SDK 57 bündelt 15.15.4, das SDK-58-Preview 15.15.5 [1][2][32]. Letzter Push im Repo am 01.10.2026, 274 offene Issues/PRs [33]. Gepflegt von Software Mansion [11]. Lizenz: MIT [32].
- **Expo:** im SDK enthalten, in Expo Go enthalten, Plattformen Android, iOS, macOS, tvOS und Web [4].
- **Funktionsumfang:** Elemente `Svg`, `Rect`, `Circle`, `Ellipse`, `Line`, `Polygon`, `Polyline`, `Path`, `Text`, `G`, `Defs`, `LinearGradient`, `RadialGradient`, `ClipPath`, `Mask` u. a. [12]. Touch-Ereignisse `onPress`, `onPressIn`, `onPressOut` und `onLongPress` direkt an Elementen [12]. Nativ umgesetzte Filter: `FeBlend`, `FeComposite`, `FeColorMatrix`, `FeDropShadow`, `FeFlood`, `FeGaussianBlur`, `FeMerge`, `FeOffset`. Weitere Filter funktionieren nur im Web [12]. Bekanntes Problem: Der Fokuspunkt von `RadialGradient` lässt sich auf Android nicht setzen [11].
- **Animation:** Reanimated animiert `react-native-svg`-Komponenten über `useAnimatedProps`, über Shared Values direkt als Props oder über CSS-Animationen und -Transitions. Die CSS-Variante für SVG ist als **experimentell** gekennzeichnet und ab Reanimated 4.4 standardmäßig aktiv [27][29]. Expo SDK 57 bündelt Reanimated 4.5.1 [1].

### 2. React Native Skia (`@shopify/react-native-skia` bzw. `react-native-skia`)

- **Versionen (Stand 11.10.2026):**
  - `@shopify/react-native-skia` 2.14.0 vom 01.10.2026. Das ist die letzte Version unter diesem Namen [15][32].
  - `react-native-skia` 3.3.0 vom 08.10.2026 (v3, Graphite). Die v2-Linie ist als `react-native-skia@2` erhältlich, 2.15.1 vom 08.10.2026. v3.0.0 erschien am 02.10.2026 [32].
  - Expo SDK 57 bündelt `@shopify/react-native-skia` 2.6.2, das SDK-58-Preview (`expo@58.0.7`, Tag `next`) 2.13.1 [1][2][3].
  - Lizenz: MIT [32].
- **Umzug:** Die alte Doku-Seite unter shopify.github.io meldet: „React Native Skia has moved to wcandillon.github.io/react-native-skia“ [25]. Die GitHub-API leitet `Shopify/react-native-skia` auf `wcandillon/react-native-skia` weiter (8.717 Sterne, letzter Push am 09.10.2026) [33]. Laut README wird v2 weiter gepflegt [13].
- **Expo:**
  - Laut Expo-Doku in Expo Go enthalten. Plattformen Android, iOS, tvOS und Web (über CanvasKit) [5].
  - v3 läuft nicht in Expo Go, weil Expo Go den nativen Code von v2 bündelt. v3 braucht einen Development Build [14][15].
  - v3 setzt React Native 0.79 mit New Architecture, iOS 15.1 und Android API 26 voraus. Auf Android rendert v3 mit Vulkan statt OpenGL ES [14][15].
- **Render-Modell:**
  - Im Standardmodus („Retained Mode“) übersetzt Skia den React-Baum in eine Display-Liste. Ändert sich ein Reanimated-Wert, schreibt der UI-Thread nur den neuen Wert in diese Liste. Ein Thread-Pool erzeugt daraus höchstens einen Frame pro angezeigtem Bild. Laut Doku kostet ein Animationsframe damit „no React render, no work on the JS thread, and no drawing on the UI thread“ [17].
  - Für eine veränderliche Anzahl von Zeichenbefehlen pro Frame gibt es den „Immediate Mode“ über die Picture-API [16][21].
- **Animation:** Shared und Derived Values von Reanimated lassen sich direkt als Props übergeben, ohne `createAnimatedComponent` [18]. Ab Skia 2.10 ist Reanimated v4 Pflicht [18]. Laut Peer-Dependencies von 2.6.2 genügt dort Reanimated ≥ 3.19.1 [32].

### 3. WebView (`react-native-webview`) bzw. Expo-DOM-Komponenten

- **Version:** 14.0.1 vom 20.06.2026. Expo SDK 57 bündelt 13.16.1, das SDK-58-Preview 14.0.1 [1][2][32]. Im SDK und in Expo Go enthalten, Plattformen Android und iOS [6]. Lizenz: MIT [32].
- **Lokale HTML-Dateien:** Laut offiziellem Guide funktioniert das Laden lokaler HTML-Dateien derzeit nicht (Issues #428, #518). Als Workarounds nennt der Guide Bundling oder einen lokalen Webserver. Inline-HTML (`source={{ html }}`) funktioniert [6][30]. Für die Kommunikation gibt es `injectJavaScript` und `postMessage`/`onMessage` (nur Strings) [30].
- **Expo-DOM-Komponenten (`'use dom'`):**
  - Expos offizieller Weg, Web-Code in einer nativen App auszuführen. Sie laufen in einer WebView, ab SDK 56 standardmäßig über `@expo/dom-webview` [10].
  - Laut Expo-Doku: Props werden „over an asynchronous bridge“ übertragen. Standard-JavaScript ist „slower to parse and start up than optimized Hermes bytecode“. Geräte im Stromsparmodus „will often throttle web frame rates“. Expo empfiehlt, „truly native apps“ mit nativen Primitiven zu bauen [10].

### 4. expo-gl / react-three-fiber (nur kurz)

- `expo-gl` 57.0.2 stellt einen OpenGL-ES-Kontext mit WebGL-ähnlicher API bereit und ist in Expo Go enthalten [9][32].
- react-three-fiber (9.8.1 vom 24.09.2026) unterstützt React Native über `@react-three/fiber/native` auf Basis von `expo-gl` [31][32]. Die Doku warnt, dass iOS-Simulatoren oft unvollständige OpenGL-ES-Unterstützung haben [31].
- **Bewertung (eigene Einschätzung):** Variante A ist eine 2D-Zeichnung in isometrischer Projektion. Eine 3D-Engine wäre nur für Variante C (3D Low-Poly) relevant. Für A wird sie hier nicht weiter betrachtet.

## Vergleichstabelle

| Kriterium | react-native-svg | React Native Skia | WebView / DOM-Komponente |
|---|---|---|---|
| Aktuelle Version (Datum) | 15.15.5 (11.05.2026) [32] | `@shopify/…` 2.14.0 (01.10.2026); `react-native-skia` 3.3.0 (08.10.2026), v2-Linie 2.15.1 [32] | 14.0.1 (20.06.2026) [32] |
| In Expo SDK 57 gebündelt | 15.15.4 [1] | `@shopify/react-native-skia` 2.6.2 [1] | 13.16.1 [1]; DOM-Komponenten ab SDK 56 über `@expo/dom-webview` [10] |
| Expo Go | ja [4] | ja (v2); v3 nur Development Build [5][15] | ja [6][10] |
| Plattformen | Android, iOS, macOS, tvOS, Web [4] | Android, iOS, tvOS, Web (v2) [5]; v3: Android ≥ API 26, iOS ≥ 15.1 [14] | Android, iOS [6] |
| Wartung | Software Mansion; Repo-Push 01.10.2026 [11][33] | Repo-Push 09.10.2026, v3 vom 02.10.2026, v2 weiter gepflegt [13][33] | Repo-Push 20.09.2026 [33] |
| npm-Downloads/Woche (03.–09.10.2026) | 8.416.704 [32] | 1.424.705 (`@shopify/…`) + 7.105 (`react-native-skia`) [32] | 5.415.291 [32] |
| GitHub-Sterne (11.10.2026) | 8.005 [33] | 8.717 [33] | 7.195 [33] |
| Animation | Reanimated: `useAnimatedProps`, Shared Values, CSS-Animationen (SVG: experimentell) [27] | Reanimated-Werte direkt als Props; Frames ohne React-Render [17][18] | CSS-Animationen des Prototyps laufen in der Browser-Engine der WebView weiter (*eigene Einschätzung*) |
| Antippen eines Feldes | `onPress` pro Element [12] | keine Element-Ereignisse; Gesture Handler + Overlay-Views oder eigene Koordinaten-Rückrechnung [19] | DOM-Ereignisse im Web-Code, Rückmeldung per `postMessage` [30] bzw. Native Actions (asynchron) [10] |
| Blend-Modus `multiply` | `FeBlend`-Filter nativ umgesetzt [12]; `mix-blend-mode` in der Doku nicht erwähnt | `blendMode="multiply"` an `Group` / Paint [18][21] | wie im Web |
| Emojis | `Text`-Element vorhanden [12]; Emoji-Darstellung nicht dokumentiert | Paragraph-API nutzt die Emoji-Schrift der Plattform [23] | wie im Web |
| Nähe zum Prototyp-Code | sehr hoch (gleiche Elementnamen) [12] | mittel (eigene Komponenten; `Path` versteht SVG-Pfadsyntax) [24] | fast unverändert |

## Performance: Was belegt ist und was nicht

**Belegt:**
- **Reanimated-Faustregel:** „you should animate no more than 100 components for low-end Android devices“ und „no more than 500 components for iOS“ [26]. Der Prototyp hat 87–157 animierte Elemente (*eigene Rechnung*, s. o.). Würde man jedes Element einzeln animieren, läge man auf schwachen Android-Geräten an oder über dieser Grenze.
- **Release- vs. Debug-Build:** Laut Reanimated-Doku treten Performance-Probleme sehr wahrscheinlich nur im Development-Build auf. Auf Android empfiehlt die Doku die Build-Variante `debugOptimized`. 120 fps auf iOS brauchen das Flag `CADisableMinimumFrameDurationOnPhone`, das ab React Native 0.82 im Template standardmäßig gesetzt ist [26].
- **Skia, Retained Mode:** Die Doku nennt „virtually zero FFI-cost“, wenn sich die Zeichenliste selten ändert, und empfiehlt diesen Modus für Oberflächen, deren Struktur sich während der Animation nicht ändert [16]. Für eine feste Anzahl von Kacheln empfiehlt sie die Atlas-API [16]. In v3 (Graphite) zeichnet Atlas jedes Sprite einzeln. Laut Doku ist der Unterschied bei einigen hundert Sprites „usually not noticeable“ [20].
- **Skia, Neuzeichnen:** Bei jedem React-Commit zeichnet der JS-Thread die Display-Liste neu auf [17]. Ein Zustandswechsel (Bauen, Tag/Abend) kostet also einen React-Render des Skia-Baums. Laufende Animationen kosten das nicht [17].

**Nicht belegt:**
- Bildraten für eine Szene mit ~700–1.400 Formen und 87–157 gleichzeitigen Animationen. Das gilt für alle drei Kandidaten auf konkreten Geräten. Benchmarks der Maintainer habe ich nicht gefunden. Sekundärquellen, die Skia als schneller beschreiben, nennen keine reproduzierbaren Messungen.
- Wie schnell `react-native-svg` ein einzelnes `Svg` mit ~1.400 Kindelementen neu rendert. Eine Drittquelle (GeekyAnts-Blog, 20.11.2024) berichtet, dass 500 **separate** SVGs mit `react-native-svg` 9–10 Sekunden zum Rendern brauchten. Gerät, Versionen und Messaufbau nennt sie nicht [36]. Der Fall ist nicht direkt vergleichbar (viele SVG-Komponenten statt eines SVG).
- WebView-Bildraten auf dem konkreten Android-Gerät der Partnerin.

## Gesten und Animation

- **react-native-gesture-handler:**
  - Im SDK und in Expo Go enthalten. Laut README läuft die Gestenlogik „100% in the native thread“ [7].
  - Expo SDK 57 bündelt 2.32.0 [1]. Aktuell ist 3.3.0 vom 11.09.2026, das SDK-58-Preview bündelt 3.2.1 [2][32]. Mit SDK 58 steht also ein Major-Wechsel an. Welche API-Änderungen v3 mitbringt, habe ich nicht geprüft.
- **react-native-reanimated:** Im SDK und in Expo Go enthalten. Das Babel-Plugin wird von `babel-preset-expo` automatisch konfiguriert. Installation mit `react-native-worklets` [8]. Version 4.7.1 vom 02.10.2026, SDK 57 bündelt 4.5.1 [1][32].
- **Pan + Pinch-Zoom:**
  - Die Skia-Doku zeigt `GestureDetector` um den `Canvas` mit Pan-Geste und Shared Values [19]. Transformationen setzt man über `Group` [24].
  - *Eigene Einschätzung:* Für die ganze Insel genügt eine Transformation (Verschieben + Skalieren) auf oberster Ebene, getrieben von Shared Values. Bei `react-native-svg` ginge das analog über eine `Animated.View` um das `Svg`, sodass beim Zoomen kein SVG-Neurendering nötig ist.
- **Antippen (Hit-Testing):**
  - *react-native-svg:* `onPress` direkt an `Polygon`/`G` [12]. Das entspricht dem `data-action="plot"` des Prototyps am ehesten.
  - *Skia:* Die Doku empfiehlt für Element-Tracking unsichtbare `Animated.View`s über den Elementen, mit denselben Transformationen wie auf dem Canvas [19]. *Eigene Rechnung:* Für das Rautenraster geht es einfacher. Der Prototyp rechnet `x = (c − r)·TW/2 + X0` und `y = (c + r)·TH/2 + Y0` (TW = 60, TH = 30) [34]. Nach Abzug von Pan/Zoom ergibt sich `c = (u + v)/2` und `r = (v − u)/2` mit `u = (x − X0)/(TW/2)` und `v = (y − Y0)/(TH/2)`, gerundet auf ganze Felder. Hohe Objekte (Bäume, Leuchtturm) ragen optisch in die Felder dahinter. Ein Tipp darauf träfe dann das hintere Feld. Das muss im Spike geprüft werden (*eigene Einschätzung*).
  - *WebView:* DOM-Ereignisse wie im Prototyp, Ergebnis per `postMessage` als String an React Native [30].

## Übernahme des Prototyp-Codes

- **react-native-svg:**
  - Die String-Templates (`<polygon points=…>`, `<circle>`, `<ellipse>`, `<path d=…>`, `<linearGradient>`/`<radialGradient>`) lassen sich auf gleichnamige Komponenten abbilden [12].
  - CSS-Keyframes des Prototyps entsprechen der Reanimated-Syntax für CSS-Animationen (`animationName` mit Prozent-Schlüsseln bzw. `from`/`to`) [28]. Für SVG-Komponenten ist das experimentell [27].
  - *Fraglich bzw. nicht dokumentiert:* `mix-blend-mode` (Ersatz: `FeBlend` [12] oder ein halbtransparentes Overlay ohne Blend-Modus), `transform-box: fill-box` und die Emoji-Darstellung in `Text`.
- **Skia:**
  - Polygone werden zu `Points mode="polygon"` oder `Path`. `Path` akzeptiert SVG-Pfadsyntax, `Skia.Path.MakeFromSVGString` existiert [24]. Kreise und Ellipsen gibt es als `Circle` bzw. `Oval`, lineare und radiale Verläufe als Shader [24].
  - Emojis gehen über die Paragraph-API, die die Emoji-Schrift der Plattform nutzt [23]. Der Blend-Modus `multiply` ist direkt verfügbar [18].
  - CSS-Animationen fallen weg und müssen als Reanimated-Werte nachgebaut werden (`withRepeat`/`withTiming`) [18].
  - Der Weg, das Prototyp-SVG als String per `ImageSVG` zu laden, scheidet aus: Text rendert nicht, CSS wird nicht unterstützt, `rgba()`-Farben auch nicht. Der Prototyp nutzt alle drei [22][34].
- **WebView:** Der Prototyp-Code (reines JS, kein Framework) liefe fast unverändert in einer WebView bzw. DOM-Komponente (*eigene Einschätzung*). Zustand und Feld-Klicks müssten asynchron über die Brücke laufen [10][30].

## Eignung für die Umsetzung durch KI-Agenten

- **Verbreitung:** `react-native-svg` hat ~8,4 Mio. Downloads pro Woche, React Native Skia ~1,4 Mio., WebView ~5,4 Mio. Reanimated und Gesture Handler liegen je über 9 Mio. [32]. Bei den GitHub-Sternen liegen alle drei Bibliotheken zwischen 7.000 und 8.800 [33].
- **Doku:**
  - Alle Kandidaten haben eine offizielle Expo-Referenzseite [4][5][6].
  - Die Skia-Doku hat Beispiele für Gesten, Animationen und Render-Modi [16][18][19]. Die Doku der v3-Linie (`main`) und die Doku für die von Expo gebündelte v2 sind getrennt (`/v2/`) [13]. *Eigene Einschätzung:* Weil die Umbenennung erst am 02.10.2026 kam, dürften KI-Modelle überwiegend den alten Paketnamen `@shopify/react-native-skia` kennen. Agenten sollten deshalb ausdrücklich auf die zur gebündelten Version passende Doku verwiesen werden.
- *Eigene Einschätzung:* Für `react-native-svg` ist die Lücke zwischen Prototyp und Zielcode am kleinsten. Das erleichtert Agenten die Übertragung.

## Empfehlung (Vorschlag)

**Primär: React Native Skia** in der vom Expo SDK gebündelten v2-Version, mit Reanimated und Gesture Handler. Pan/Zoom läuft über eine Transformation auf oberster Ebene, Felder werden per isometrischer Koordinaten-Rückrechnung angetippt.

Begründung:
1. Das dokumentierte Render-Modell passt zu einer Szene mit vielen dauerhaft laufenden Kleinanimationen. Animationsframes kosten keinen React-Render und keine JS-Thread-Arbeit [17].
2. Der Blend-Modus `multiply`, Verläufe und Emojis über die Plattform-Emoji-Schrift sind dokumentiert [18][23][24]. Damit lassen sich die Effekte des Prototyps ohne Abstriche nachbauen.
3. Die Bibliothek ist im SDK und in Expo Go enthalten [5]. Die Version richtet `npx expo install` aus. Die App braucht wegen HealthKit/Health Connect ohnehin einen Development Build [35], die Expo-Go-Frage ist also zweitrangig.
4. Auf v3 / `react-native-skia` erst wechseln, wenn ein Expo SDK es bündelt. v3 ist erst seit dem 02.10.2026 verfügbar, hatte bis zum 08.10.2026 schon 13 Releases (3.0.0 bis 3.3.0) und verlangt Android API 26 [14][15][32].

**Plan B: `react-native-svg` + Reanimated.** Die Übertragung des Prototyps ist nahezu 1:1, Antippen per `onPress` ist eingebaut [12]. Risiko: die Grenze von etwa 100 animierten Komponenten auf schwachen Android-Geräten [26]. Gegenmaßnahme (*eigene Einschätzung*): Animationen bündeln, z. B. eine gemeinsam animierte Gruppe für alle pulsierenden Felder, und Partikel sparsam einsetzen.

**Nicht empfohlen als Hauptansicht:** WebView/DOM-Komponente, wegen asynchroner Brücke, Startzeit, Drosselung im Stromsparmodus und Expos eigener Empfehlung für native Primitive [10]. Allenfalls als schneller Wegwerf-Test auf dem Gerät denkbar.

**Vor der Festlegung:** einen Spike bauen, der die Insel im Zustand „voll bebaut, Abend“ (~1.400 Formen, ~150 Animationen) mit Skia und `react-native-svg` in einem Release-Build auf beiden Zielgeräten zeigt und dabei die Bildrate misst. Ohne diesen Spike bleibt die 60-fps-Frage offen.

## Offene bzw. nicht belegbare Punkte

- Keine belegten Bildraten für Szenen dieser Größe, für keinen Kandidaten (siehe Abschnitt Performance).
- Leistungsfähigkeit des Android-Geräts der Partnerin unbekannt. Gerätemodell und Android-Version sind im Repo nicht dokumentiert.
- Ob `react-native-svg` Emojis in `Text` auf iOS und Android farbig darstellt: nicht dokumentiert.
- Ob `react-native-svg` `mix-blend-mode` unterstützt: in README/USAGE nicht erwähnt.
- Wie Skia v2 → v3 bzw. der Paketwechsel in einem künftigen Expo SDK umgesetzt wird: nicht belegt. Das SDK-58-Preview bündelt noch `@shopify/react-native-skia` 2.13.1 [2].
- API-Änderungen in Gesture Handler 3.x (SDK 58 bündelt 3.2.1) nicht geprüft [2].
- Treffergenauigkeit beim Antippen hoher Objekte (Bäume, Leuchtturm), die optisch in andere Felder ragen: nur als Annahme beschrieben.

## Quellen

1. Expo SDK 57, `bundledNativeModules.json` (`expo@57.0.27`): https://unpkg.com/expo@57.0.27/bundledNativeModules.json *(Expo/npm)*
2. Expo SDK 58 Preview, `bundledNativeModules.json` (`expo@58.0.7`, 09.10.2026): https://unpkg.com/expo@58.0.7/bundledNativeModules.json *(Expo/npm)*
3. npm-Registry `expo` (dist-tags: `latest` 57.0.27, `next` 58.0.7): https://registry.npmjs.org/expo *(npm)*
4. Expo-Doku `react-native-svg`: https://docs.expo.dev/versions/latest/sdk/svg/ *(Doku)*
5. Expo-Doku `@shopify/react-native-skia`: https://docs.expo.dev/versions/latest/sdk/skia/ *(Doku)*
6. Expo-Doku `react-native-webview`: https://docs.expo.dev/versions/latest/sdk/webview/ *(Doku)*
7. Expo-Doku `react-native-gesture-handler`: https://docs.expo.dev/versions/latest/sdk/gesture-handler/ *(Doku)*
8. Expo-Doku `react-native-reanimated`: https://docs.expo.dev/versions/latest/sdk/reanimated/ *(Doku)*
9. Expo-Doku `GLView` (`expo-gl`): https://docs.expo.dev/versions/latest/sdk/gl-view/ *(Doku)*
10. Expo-Doku „Using React DOM in Expo native apps“ (DOM-Komponenten, Stand 29.09.2026): https://docs.expo.dev/guides/dom-components/ *(Doku)*
11. `react-native-svg` README (Known issues, Maintainer, unterstützte RN-Versionen): https://github.com/software-mansion/react-native-svg/blob/main/README.md *(GitHub)*
12. `react-native-svg` USAGE.md (unterstützte Elemente, Touch Events, Filter): https://github.com/software-mansion/react-native-svg/blob/main/USAGE.md *(GitHub)*
13. React Native Skia README (v3 vs. v2, v2 weiter gepflegt): https://github.com/wcandillon/react-native-skia/blob/main/README.md *(GitHub)*
14. React Native Skia, Installation (Anforderungen, Expo): https://wcandillon.github.io/react-native-skia/docs/getting-started/installation *(Doku)*
15. React Native Skia, „Migrating to v3“ (Paketname, Expo Go, Android): https://wcandillon.github.io/react-native-skia/docs/getting-started/migration *(Doku)*
16. React Native Skia, Rendering Modes: https://github.com/wcandillon/react-native-skia/blob/main/apps/docs/docs/canvas/rendering-modes.md *(Doku, GitHub)*
17. React Native Skia, Canvas – „How frames are produced“: https://github.com/wcandillon/react-native-skia/blob/main/apps/docs/docs/canvas/canvas.md *(Doku, GitHub)*
18. React Native Skia, Animations (Reanimated-Integration): https://github.com/wcandillon/react-native-skia/blob/main/apps/docs/docs/animations/reanimated3.md *(Doku, GitHub)*
19. React Native Skia, Gestures / Element Tracking: https://github.com/wcandillon/react-native-skia/blob/main/apps/docs/docs/animations/gestures.md *(Doku, GitHub)*
20. React Native Skia, Atlas (inkl. Performance auf Graphite): https://github.com/wcandillon/react-native-skia/blob/main/apps/docs/docs/shapes/atlas.md *(Doku, GitHub)*
21. React Native Skia, Pictures: https://github.com/wcandillon/react-native-skia/blob/main/apps/docs/docs/pictures.md *(Doku, GitHub)*
22. React Native Skia, SVG Images (SVG Support, Einschränkungen): https://github.com/wcandillon/react-native-skia/blob/main/apps/docs/docs/image-svg.md *(Doku, GitHub)*
23. React Native Skia, Paragraph (Emojis/Systemschriften): https://github.com/wcandillon/react-native-skia/blob/main/apps/docs/docs/text/paragraph.md *(Doku, GitHub)*
24. React Native Skia, Polygons / Ellipses / Path / Gradients / Group: https://github.com/wcandillon/react-native-skia/tree/main/apps/docs/docs/shapes, https://github.com/wcandillon/react-native-skia/blob/main/apps/docs/docs/shaders/gradients.md, https://github.com/wcandillon/react-native-skia/blob/main/apps/docs/docs/group.md *(Doku, GitHub)*
25. Alte Skia-Doku mit Umzugshinweis: https://shopify.github.io/react-native-skia/ *(Doku)*
26. Reanimated, Performance-Guide (4.x): https://docs.swmansion.com/react-native-reanimated/docs/guides/performance/ *(Doku)*
27. Reanimated, Animating SVG (4.x): https://docs.swmansion.com/react-native-reanimated/docs/guides/animating-svg *(Doku)*
28. Reanimated, CSS-Animationen `animationName`: https://docs.swmansion.com/react-native-reanimated/docs/css-animations/animation-name *(Doku)*
29. Reanimated, `useAnimatedProps`: https://docs.swmansion.com/react-native-reanimated/docs/core/useAnimatedProps/ *(Doku)*
30. `react-native-webview` Guide (lokale HTML-Dateien, JS↔Native-Kommunikation): https://github.com/react-native-webview/react-native-webview/blob/master/docs/Guide.md *(GitHub)*
31. React Three Fiber, Installation (React Native): https://r3f.docs.pmnd.rs/getting-started/installation *(Doku)*
32. npm-Registry und npm-Downloads-API (abgerufen 11.10.2026), z. B. https://registry.npmjs.org/react-native-svg, https://registry.npmjs.org/@shopify/react-native-skia, https://registry.npmjs.org/react-native-skia, https://registry.npmjs.org/react-native-webview, https://registry.npmjs.org/react-native-gesture-handler, https://registry.npmjs.org/react-native-reanimated, https://registry.npmjs.org/expo-gl, https://registry.npmjs.org/@react-three/fiber, https://api.npmjs.org/downloads/point/last-week/react-native-svg *(npm)*
33. GitHub-REST-API, Repository-Daten (abgerufen 11.10.2026), z. B. https://api.github.com/repos/software-mansion/react-native-svg, https://api.github.com/repos/Shopify/react-native-skia (→ wcandillon/react-native-skia), https://api.github.com/repos/react-native-webview/react-native-webview *(GitHub)*
34. Web-Prototyp „Momos Insel“, Variante A: `prototypes/momos-insel/island-iso.js`, `app.js`, `styles.css` auf Branch `prototype/momos-insel`: https://github.com/Yggras/abnehm-app/tree/prototype/momos-insel/prototypes/momos-insel *(Repo)*
35. Recherche Tech-Stack (#2), Hinweis zu Development Builds: https://github.com/Yggras/abnehm-app/blob/research/tech-stack/research/tech-stack.md *(Repo)*
36. GeekyAnts-Blog, „Optimizing SVG Rendering in React Native: From React-Native-SVG to Expo-Image“ (20.11.2024): https://geekyants.com/en-ca/blog/optimizing-svg-rendering-in-react-native-from-react-native-svg-to-expo-image *(Drittquelle, Blog)*
