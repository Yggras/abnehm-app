# Design-System „Lagune“

Ticket: [#65](https://github.com/Yggras/abnehm-app/issues/65) · Stand: 16.10.2026 · Quelle: das veröffentlichte Design-System-Artifact [„Abnehm-App“](https://claude.ai/artifact/FXrPV237YtYXY4ARRSGiic) (Claude Design, Phase 2), am 14.10.2026 gelesen (Artifact-Version `1792007765-af36`); am 15.10.2026 um Momos Gestalt aus [#69](https://github.com/Yggras/abnehm-app/issues/69) ergänzt (Artifact-Version `1792091707-ba6e`) und am 16.10.2026 um Name und Icon aus [#70](https://github.com/Yggras/abnehm-app/issues/70).

Diese Datei hält das Ergebnis von #65 im Repo fest, damit [Spezifikation 0: Fundament & Verträge (#56)](https://github.com/Yggras/abnehm-app/issues/56) die Tokens übernehmen kann, statt sie zu erfinden. Die Token-Tabellen sind maschinell aus `project/tokens.json` des Artifacts erzeugt. Alles andere ist aus `project/README.md`, `project/1-tokens.md` bis `project/6-annahmen-und-offene-fragen.md` und den Komponenten-READMEs zusammengefasst. Mit *eigene Rechnung* markierte Stellen stammen nicht aus dem Artifact.

Das Artifact enthält außerdem die Vorschauen aller Komponenten und die Referenzentwürfe. Es ist privat; andere öffnen den Link erst nach einer Freigabe über das Teilen-Menü. Ändert sich das Artifact, wird diese Datei nachgezogen.

## Zusammenfassung

- **Richtung:** A · Lagune – sonnig, verspielt, „wie aus Momos Insel geschnitzt“, aber erwachsen. Gewählt am 14.10.2026 aus drei Richtungen (A · Lagune, B · Skizzenbuch, C · Klar).
- **Leitbild:** Die App ist aus demselben Material wie die Insel: **Sand** als Grund (`surface-base`), **Lagune** für alles Eigene und jede Hauptaktion (`self`, `primary`), **Sonne** für den Partner (`partner`), **Gold** für Energie (`energy`). Karten stehen auf einer **Sockelkante** wie die Inselfelder (`elevation-card`), nicht auf weichen Schatten. **Rubik** trägt alle Texte und Zahlen.
- **Farbe = Person:** Kategorien (Wasser, Sport …) erkennt man an Icon und Name, nicht an eigenen Farben. Es gibt **kein „Fehler-Rot“ für Ziele**; `problem` gilt nur für Technik und ungültige Eingaben.
- **Tokens:** 61 Farben, 11 Textstile, 8 Abstände, 6 Radien, 10 Elevationen, 20 Größen, 6 Deckkräfte, 5 Dauern, 3 Kurven, 2 Federn – als `tokens.json` und als typisierte `code/tokens.ts` für `StyleSheet` ([#41](https://github.com/Yggras/abnehm-app/issues/41)).
- **Komponenten:** Fast alles ist gebrandet (eigene Komponente mit `StyleSheet` und Tokens). Über `@expo/ui` kommen nur Sheet-Container, Schalter, Picker (Datum/Uhrzeit) und Kontextmenüs. Momo und Insel zeichnet Skia, den Gewichtsverlauf Victory Native.
- **Annahmen und frühere offene Fragen:** 15 Annahmen; alle 8 Designfragen haben einen entschiedenen Verbleib. Momo ist der Lagunenling aus [#69](https://github.com/Yggras/abnehm-app/issues/69), die App heißt **„Gemeinsam leichter“** und trägt das Umarmungs-Icon aus [#70](https://github.com/Yggras/abnehm-app/issues/70); Dunkelmodus und Insel-Bedienung ohne Sehen sind nicht in V1 (siehe Ende der Datei).

## Gewählte Richtung: A · Lagune

Phase 1 hat drei Richtungen mit demselben „Heute“-Bildschirm als Vergleich und je drei Sätzen Begründung und Risiken gezeigt. Phase 1 liegt in der Versionsgeschichte des Artifacts.

| | A · Lagune | B · Skizzenbuch | C · Klar |
| --- | --- | --- | --- |
| Gefühl | sonnig, verspielt | ruhig, erwachsen | nativ, aufgeräumt |
| Farbe | eine Farbe pro Person: Türkis für dich, Orange für den Partner | sparsam: Tinte, Moos, Honig | eine Farbe pro Datenart, Kalorien und Gewicht neutral |
| Schrift | Rubik | Fraunces + Figtree | Systemschrift (SF Pro / Roboto) |
| Form | Radius 24, feste 4-dp-Kante unter Karten wie bei den Inselfeldern | Radius 14, Haarlinien statt Schatten | Radius 12, gruppierte Listen |

**Begründung (Phase 1, Tafel A):**

- Überträgt das gewählte isometrische Diorama ([#28](https://github.com/Yggras/abnehm-app/issues/28)) auf die Oberfläche: Sand, Lagune und Sockelkanten lassen „Heute“ und Insel wie eine Welt wirken.
- Stellt Momo und den Levelbalken sichtbar in den Vordergrund, wie es die Entscheidung für das Momo-Zentrum verlangt ([#15](https://github.com/Yggras/abnehm-app/issues/15)).
- „Farbe = Person“ macht das Miteinander sichtbar – Lagune für dich, Sonne für den Partner, ohne Rot und ohne Wertung.

**Risiken (Phase 1, Tafel A):**

- Viel Farbe und Rundung kippt schnell ins Kindliche; Sättigung und Illustration müssen streng dosiert werden. In Phase 2 steht dafür Prinzip 6 „Verspielt im Detail, erwachsen im Ganzen“.
- Fast alles sind eigene, gebrandete Komponenten; native `@expo/ui`-Elemente (Sheets, Picker, Schalter) wirken daneben am fremdesten.
- Türkis und Orange als Flächenfarben schaffen auf Sand nur knapp 3:1; als Textfarbe taugen nur die dunklen Varianten (`primary`, `hint`).

Claude hat in Phase 1 A empfohlen; der Nutzer hat A ohne Mischung mit B oder C gewählt.

## Gestaltungsprinzipien

Jede neue Ansicht wird an diesen sieben Prinzipien gemessen (Vorschau **Prinzipien** im Artifact).

| # | Prinzip | Do | Don't |
| --- | --- | --- | --- |
| 1 | **Momo zuerst** – die Gamification steht vorn ([#15](https://github.com/Yggras/abnehm-app/issues/15)) | Momo-Bereich ist das größte Element auf „Heute“, Levelbalken und Energie direkt bei Momo | Momo als kleines Abzeichen in einer Ecke |
| 2 | **Wohlwollend statt wertend** – offene und verfehlte Ziele bleiben neutral ([#12](https://github.com/Yggras/abnehm-app/issues/12), [#38](https://github.com/Yggras/abnehm-app/issues/38)) | „Sporteinheit · 0 von 50 min“ mit gestricheltem Kreis in `neutral` | Rot, Kreuz und „Ziel verfehlt!“ |
| 3 | **Miteinander, nie gegeneinander** – Farbe = Person, aber kein Vergleich ([#12](https://github.com/Yggras/abnehm-app/issues/12), [#19](https://github.com/Yggras/abnehm-app/issues/19), [#43](https://github.com/Yggras/abnehm-app/issues/43)) | Zwei Hälften, `self` und `partner`, ohne Zahl beim Partner | Rangliste, „Anna liegt vorn“, Prozentwerte nebeneinander |
| 4 | **Eine Welt aus Sand und Lagune** – Oberfläche und Insel teilen Farben, Licht und Kanten | Karte auf `elevation-card`, Licht von links oben | Glas, Verläufe, kühle graue Schatten |
| 5 | **Ein Tipp genügt** – Erfassen sofort, Korrigieren über „Rückgängig“ ([#15](https://github.com/Yggras/abnehm-app/issues/15), [#38](https://github.com/Yggras/abnehm-app/issues/38)) | „+250 ml“ bucht direkt, danach „+250 ml Wasser · Rückgängig“ | „Wirklich 250 ml hinzufügen?“ |
| 6 | **Verspielt im Detail, erwachsen im Ganzen** – Illustration, Federn und Funken gehören Momo und der Insel | „640 kcal übrig“ in `number-xl` | Comic-Schrift, Konfetti auf jedem Bildschirm, „Juhuuu!!!“ |
| 7 | **Bedeutung immer doppelt** – jeder Zustand hat Symbol und Wort ([WCAG 2.2, SC 1.4.1](https://www.w3.org/TR/WCAG22/#use-of-color)) | Häkchen und „erfüllt“ | nur ein grüner Punkt |

### Sprache und Ton

- Du-Form, kurz und konkret. Verben auf Buttons: „Eintragen“, „Anfeuern“, „Bauen“, „Speichern“, „Rückgängig“.
- Nur Begriffe aus `CONTEXT.md` (Tagesziel, Energie, Insel, Bauplan, Gemeinsame Challenge, Anfeuern, Zusammenfassung …) – nie Punkte, Coins, XP, Quest, Streak, Nutzer, Stupsen.
- Ohne Schuld und ohne Verlust-Framing: nie „verpasst“, „verfehlt“, „versagt“, „zu viel gegessen“, „Momo ist traurig“, „Partner fehlt“ ([#37](https://github.com/Yggras/abnehm-app/issues/37)). Über dem Budget heißt es „120 kcal drüber“, steigendes Gewicht „Trend +0,3 kg in 2 Wochen“ ([#38](https://github.com/Yggras/abnehm-app/issues/38)).
- Momo spricht freundlich und neugierig („Momo fragt: Schon was gegessen? 🍎“, [#37](https://github.com/Yggras/abnehm-app/issues/37)). Probleme sagen, was passiert ist und was hilft („Dieser Code ist abgelaufen. Bitte Anna um einen neuen.“).
- Zahlen deutsch: „1.210 kcal“, „1,0 l“, „82,4 kg“, echtes Minus „−0,3 kg“, Einheiten mit Leerzeichen. Datum „Mittwoch, 14. Oktober“, Uhrzeit „14:20“.
- Emojis nur in den festen Kurzbotschaften zum Anfeuern und in Momos Benachrichtigungen ([#37](https://github.com/Yggras/abnehm-app/issues/37)), in der Oberfläche nie als Icon-Ersatz.

### Ikonografie

Eigener Linien-Icon-Satz auf 24er Raster, Strich `icon-stroke` (2 dp) mit runden Enden, Größen `icon-sm`/`icon-md`/`icon-lg`, Farbe vom Text (`ink`, aktiv `primary`). Auf iOS und Android identisch – keine SF Symbols, keine Material Symbols. Einzige gefüllte Form ist das Energie-Symbol (`energy` mit Kontur `energy-edge`).

## Tokens

Alle Längen sind dp (Android) bzw. pt (iOS) und stehen im Code als Zahl ohne Einheit; Farben als Hex (`#RRGGBB` bzw. `#RRGGBBAA`). Token-Namen sind kebab-case, in TypeScript camelCase. Token-Bezeichner sind englische Code-Namen, die Fachbegriffe aus `CONTEXT.md` stehen in Beschreibungen und Oberfläche (Annahme 5).

### Abbildung in TypeScript

`code/tokens.ts` im Artifact ist aus `tokens.json` erzeugt; Aliase sind dort aufgelöst und kommentiert.

| Gruppe in `tokens.json` | Export in `code/tokens.ts` | Beispiel |
| --- | --- | --- |
| `color` | `color` | `surface-base` → `color.surfaceBase` |
| `type` | `type`, `fontFamily` | `number-xl` → `type.numberXl` = `{ fontFamily, fontSize, lineHeight, letterSpacing, fontVariant: ['tabular-nums'] }` |
| `spacing` | `space` | `space-4` → `space[4]` |
| `radius` | `radius` | `radius-lg` → `radius.lg` |
| `shadow` | `elevation` | `elevation-card` → `elevation.card`, `focus-ring` → `elevation.focusRing` (jeweils `boxShadow`-Zeichenkette) |
| `size` | `size` | `touch-min` → `size.touchMin` |
| `opacity` | `opacity` | `opacity-shade-left` → `opacity.shadeLeft` |
| `duration`, `easing`, Federn | `motion` | `duration-base` → `motion.duration.base`; `easing-standard` → `motion.easing.standard` = `[0.2, 0, 0, 1]` für `Easing.bezier`; `spring-bouncy` → `motion.spring.bouncy` für `withSpring` |

Dazu exportiert die Datei die Typen `ColorToken` und `TypeToken`. Beispiel aus `1-tokens.md`:

```ts
import { StyleSheet } from 'react-native';
import { color, type, space, radius, elevation } from './tokens';

const styles = StyleSheet.create({
  card: {
    backgroundColor: color.surfaceCard,
    borderRadius: radius.lg,
    padding: space[4],
    boxShadow: elevation.card,
  },
  title: { ...type.title, color: color.ink },
});
```

### Farbe

Nur eine Fassung: **hell**. Die semantischen Namen erlauben ein zweites Theme ohne Umbenennung (offene Frage 2).

**Regeln:**

- **Farbe = Person.** Alles Eigene ist Lagune (`self`), alles vom Partner Sonne (`partner`). Deshalb sind `tracker-calories`, `tracker-water`, `tracker-sport` und `chart-trend` Aliase auf `self`. Nie zwei Werte von Du und Partner nebeneinander, die man vergleichen könnte.
- Bildschirm auf `surface-base`, Inhalte in Karten auf `surface-card`, Spuren und Zeilen in Karten auf `surface-sunken`.
- `line` nur dekorativ; Rahmen von Bedienelementen immer `line-strong`. `plinth` ist die Sockelkante.
- `ink` für alles Wichtige, auch auf jeder `*-soft`-Fläche. `ink-disabled` nur für deaktivierte Bedienelemente.
- Eine Hauptaktion pro Bildschirm in `primary`. Auf `primary-soft-pressed` steht Text in `primary-pressed`.
- Energie ist ein Symbol, nie eine Textfarbe. Energie (Spiel) und kcal (Essen) teilen nie eine Farbe.
- Gewichtsverlauf: Punkte `chart-day`, Trend 3 dp `chart-trend`, Zielgewicht 1,5 dp gestrichelt `chart-goal`.
- `momo-*` und `island-*` nur für Skia-Zeichnungen.

**Zustände – es gibt kein „Fehler-Rot“ für Ziele:**

| Zustand | Tokens | Wann | Immer zusammen mit |
| --- | --- | --- | --- |
| Erfüllt | `success`, `success-soft` | Tagesziel erfüllt, Ziel erreicht, Challenge geschafft | Häkchen + „erfüllt“ bzw. „erreicht“ |
| Hinweis | `hint`, `hint-soft` | Neues auf der Insel, Wiegetag, Tagesende, „Tippfehler?“ | Icon + Satz |
| Neutral | `neutral`, `neutral-soft` | Offen, „kcal drüber“, Offline, „Stand von …“ | gestrichelter Kreis oder Info-Icon + Wert |
| Partner | `partner`, `partner-soft` | Anfeuerung erhalten, antwortbedürftige Vorgänge | Herz- bzw. Personen-Icon + Name |
| Problem | `problem`, `problem-soft` | Nur Technik und ungültige Eingaben: KI-Foto fehlgeschlagen, Code abgelaufen | Ausrufezeichen-Icon + Lösungsweg |

`problem` erscheint nie bei Gesundheitswerten, Zielen, Gewicht oder Kalorien.

#### Flächen und Linien

| Token | Wert | Zweck |
| --- | --- | --- |
| `surface-base` | `#FBF4E6` | Seitenhintergrund aller Bildschirme („Sand“). |
| `surface-card` | `#FFFCF6` | Karten, Sheets, Tab-Leiste, Eingabefelder, Beschriftungsfelder. |
| `surface-sunken` | `#F4EBDA` | Spur von Ring und Balken, Zeilen innerhalb von Karten, Skeleton beim Laden. |
| `surface-overlay` | `#1D333266` | Abdunklung hinter Sheets (40 % ink). |
| `surface-inverse` | `#1D3332` | Meldung mit „Rückgängig“ (dunkle Fläche am unteren Rand). |
| `on-inverse` | `#FFFCF6` | Text und Icons auf surface-inverse. |
| `line` | `#EAD9BC` | Dekorative Trennlinien zwischen Listenzeilen. Nie der einzige Rahmen eines Bedienelements. |
| `line-strong` | `#8F7B59` | Rahmen von Eingabefeldern und Chips; mindestens 3:1 auf surface-card und surface-base. |
| `plinth` | `#E4D2B0` | Sockelkante unter Karten und hellen Buttons (wie die Seitenfläche eines Inselfelds). |
| `focus` | `#0B7470` (Alias auf `primary`) | Fokusring bei Tastatur- und Schaltersteuerung (siehe Schatten focus-ring). |

#### Text und Aktion

| Token | Wert | Zweck |
| --- | --- | --- |
| `ink` | `#1D3332` | Haupttext, Zahlen und Icons auf surface-base, surface-card, surface-sunken und allen *-soft-Flächen. |
| `ink-muted` | `#55625E` | Nebentext, Einheiten, Metadaten auf surface-base, surface-card und surface-sunken (mind. 4,5:1). |
| `ink-disabled` | `#A2998A` | Text und Icons deaktivierter Bedienelemente. Ausgenommen von der Kontrastpflicht (WCAG 1.4.3), deshalb nie für Inhalte. |
| `on-primary` | `#FFFFFF` | Text und Icons auf primary und primary-pressed. |
| `primary` | `#0B7470` | Hauptaktion: Primär-Button, ＋, aktiver Tab, Links; als Text auf surface-card, surface-base und primary-soft. |
| `primary-pressed` | `#085B58` | Primär-Button gedrückt und seine Sockelkante. |
| `primary-soft` | `#DDF0EE` | Sekundär-Button, ausgewählter Chip, Fläche hinter Momo auf „Heute“; Text darauf in primary oder ink. |
| `primary-soft-pressed` | `#C6E6E2` | Sekundär-Button gedrückt und seine Sockelkante; Text darauf in primary-pressed. |
| `fill-disabled` | `#EDE4D3` | Fläche deaktivierter Buttons und Chips; Beschriftung in ink-disabled. |

#### Personen und Spiel

| Token | Wert | Zweck |
| --- | --- | --- |
| `self` | `#0E8580` | Farbe = Person: alles Eigene – eigene Hälfte des Levelbalkens, Kalorienring, Wasser- und Sportbalken. Mind. 3:1 auf surface-sunken. |
| `partner` | `#C9662B` | Farbe = Person: alles vom Partner – seine Hälfte des Levelbalkens, Avatar, sein Bereich auf der Insel. Nie als Vergleich neben eigenen Werten. |
| `partner-soft` | `#F9E4D5` | Hintergrund partnerbezogener Hinweise (Anfeuerung erhalten); Text darauf in ink. |
| `energy` | `#F2B33D` | Energie-Symbol (Füllung). Nie als Textfarbe; die Zahl steht in ink. |
| `energy-edge` | `#8C5A00` | Kontur des Energie-Symbols, damit es 3:1 zur Fläche erreicht. |

#### Zustände

| Token | Wert | Zweck |
| --- | --- | --- |
| `success` | `#256F3F` | Erfüllt: Häkchen und Text bei Tageszielen und erreichten Zielen; auf surface-card und success-soft. |
| `success-soft` | `#DDF0E0` | Zeilenhintergrund erfüllter Tagesziele. |
| `hint` | `#8C5A00` | Hinweis ohne Wertung: Neues auf der Insel, Wiegetag, Tagesende, „Tippfehler?“; Text auf hint-soft und surface-card. |
| `hint-soft` | `#FDEBC2` | Hintergrund von Hinweiszeilen. |
| `neutral` | `#66625A` | Offen und „kcal drüber“: neutral statt Rot. Icon und Text auf surface-card. |
| `neutral-soft` | `#EFE7D6` | Hintergrund neutraler Zustände und Hilfstexte. |
| `problem` | `#A1401F` | Nur technische Probleme und ungültige Eingaben (KI-Foto fehlgeschlagen, Code abgelaufen). Nie für Gesundheitswerte oder Ziele. |
| `problem-soft` | `#FBE3D9` | Hintergrund von Problemmeldungen; Text darauf in ink, Icon in problem. |

#### Daten

| Token | Wert | Zweck |
| --- | --- | --- |
| `tracker-calories` | `#0E8580` (Alias auf `self`) | Kalorienring (Alias auf self). |
| `tracker-water` | `#0E8580` (Alias auf `self`) | Wasserbalken und Teilring des Wasserziels (Alias auf self). |
| `tracker-sport` | `#0E8580` (Alias auf `self`) | Sport-Wochenbalken (Alias auf self). |
| `chart-day` | `#55625E` (Alias auf `ink-muted`) | Gewichtsverlauf: Tagesgewichte als Punkte (Victory Native). |
| `chart-trend` | `#0E8580` (Alias auf `self`) | Gewichtsverlauf: Gewichtstrend als Linie, 3 dp. |
| `chart-goal` | `#66625A` (Alias auf `neutral`) | Gewichtsverlauf: Zielgewicht als gestrichelte Linie, 1,5 dp. |
| `chart-grid` | `#EAD9BC` (Alias auf `line`) | Gewichtsverlauf: Hilfslinien. |

#### Momo (Skia)

| Token | Wert | Zweck |
| --- | --- | --- |
| `momo-body` | `#FFC56E` | Skia: Momos Körper (Lagunenling, [#69](https://github.com/Yggras/abnehm-app/issues/69)). |
| `momo-belly` | `#FFEBC4` | Skia: Momos Bauch. |
| `momo-cheek` | `#F48C73` | Skia: Wangen, mit opacity-cheek. |
| `momo-frond` | `#F48C73` (Alias auf `momo-cheek`) | Skia: Kiemenwedel, Flossen, Kamm und Flügel, volle Deckkraft; nie Türkis ([#69](https://github.com/Yggras/abnehm-app/issues/69)). |
| `momo-stage` | `#DDF0EE` (Alias auf `primary-soft`) | Fläche hinter Momo im Momo-Bereich auf „Heute“. |

#### Insel (Skia)

| Token | Wert | Zweck |
| --- | --- | --- |
| `island-grass` | `#8BCB5E` | Skia: Gras der Inselfelder (Sommer, Tag). |
| `island-grass-spring` | `#9FD774` | Skia: Gras im Frühling. |
| `island-grass-autumn` | `#B9C46A` | Skia: Gras im Herbst. |
| `island-grass-winter` | `#EEF4F7` | Skia: Schnee im Winter. |
| `island-foliage` | `#5FA44A` | Skia: Laub von Bäumen und Büschen (Sommer). |
| `island-foliage-autumn` | `#E8913A` | Skia: Laub im Herbst. |
| `island-water` | `#3FB7D0` | Skia: Lagune um die Insel. |
| `island-water-deep` | `#2A93B3` | Skia: tieferes Wasser am Rand und Schatten der Insel im Wasser. |
| `island-sand` | `#F3D9A4` | Skia: Strandfelder, Hauswände. |
| `island-earth` | `#B07A48` | Skia: Erdschicht der Inselseiten, Baumstämme. |
| `island-wood` | `#A86B3C` | Skia: Holz – Stege, Zäune, Brücken. |
| `island-stone` | `#CFC6B4` | Skia: Wege, Steine, Brunnen. |
| `island-roof` | `#D2693A` | Skia: Dächer und Fahnen (warm). Feste Inselfarbe, unabhängig davon, wer gebaut hat. |
| `island-roof-alt` | `#2E8C87` | Skia: Dächer und Bänder (kühl). Feste Inselfarbe, unabhängig davon, wer gebaut hat. |
| `island-night` | `#1E3557` | Skia: Abend-Überlagerung über der ganzen Szene (mit opacity-evening). |
| `island-lamp` | `#FFD36A` | Skia: Laternen und Fenster am Abend, Leuchten gültiger Felder. |
| `island-buildable` | `#FFF3B0` | Skia: Füllung gültiger Felder im Bau-Modus (pulsierend). |

### Typografie

Rubik in vier Schnitten (400, 500, 600, 700), eingebunden über `@expo-google-fonts/rubik` und `expo-font` ([expo/google-fonts](https://github.com/expo/google-fonts)). Zahlen (`number-xl`, `number-m`) mit tabellarischen Ziffern (`fontVariant: ['tabular-nums']`), damit sich Werte beim Hochzählen nicht verschieben.

- `display` nur einmal pro Bildschirm (Begrüßung, Tab-Titel).
- `title` für Karten, `headline` für Zeilen und Tagesziele, `body` für Text, `label` für Beschriftungen, `caption` für Metadaten, `tab-label` nur in der Tab-Leiste, `button` auf Buttons.
- Höchstens drei Größen pro Karte.

| Stil | Schnitt | Größe / Zeilenhöhe | Laufweite | Zweck |
| --- | --- | --- | --- | --- |
| `display` | 700 | 30 / 36 | -0.3 | Begrüßung auf „Heute“, Titel der Tabs. |
| `title` | 600 | 20 / 26 | – | Kartentitel, Partnername, Sheet-Titel. |
| `headline` | 600 | 17 / 22 | – | Zeilentitel, Tagesziele, Abschnittsüberschriften. |
| `body` | 400 | 16 / 22 | – | Fließtext und Beschreibungen. |
| `body-strong` | 600 | 16 / 22 | – | Hervorgehobene Werte im Fließtext. |
| `button` | 600 | 16 / 20 | – | Beschriftung von Buttons. |
| `label` | 500 | 14 / 18 | – | Beschriftungen, Chips, Datum, Feldnamen. |
| `caption` | 500 | 12 / 16 | – | Metadaten, Einheiten, Herkunft. |
| `tab-label` | 600 | 12 / 14 | – | Beschriftung der Tab-Leiste. |
| `number-xl` | 600 | 40 / 44 | -0.5 | Große Zahl im Kalorienring; Ziffern tabellarisch. |
| `number-m` | 600 | 20 / 24 | – | Werte in Mini-Trackern und Zusammenfassungen; Ziffern tabellarisch. |

**Schriftfamilien in `code/tokens.ts`** – **Annahme:** Exportnamen von `@expo-google-fonts/rubik`; auf Android wählt die Familie den Schnitt, deshalb setzt jeder Stil eine eigene `fontFamily` statt `fontWeight`. In der Umsetzung prüfen.

| Schlüssel | Familie |
| --- | --- |
| `fontFamily.regular` | `Rubik_400Regular` |
| `fontFamily.medium` | `Rubik_500Medium` |
| `fontFamily.semibold` | `Rubik_600SemiBold` |
| `fontFamily.bold` | `Rubik_700Bold` |

### Abstände

4-dp-Raster. Seitlicher Bildschirmrand, Abstand zwischen Karten und Innenabstand von Karten `space-4`; Elemente innerhalb einer Karte `space-3`; eng Verwandtes `space-2`; Sheets `space-5`. Inhalte enden über der Tab-Leiste plus sicherem Bereich.

| Token | Wert | Zweck |
| --- | --- | --- |
| `space-1` | `4` | Icon zu Beschriftung, innerhalb kleiner Elemente. |
| `space-2` | `8` | Lücke zwischen Chips, Mini-Trackern-Spalten und eng verwandten Zeilen. |
| `space-3` | `12` | Abstand zwischen Elementen innerhalb einer Karte. |
| `space-4` | `16` | Karten-Innenabstand, seitlicher Bildschirmrand, Abstand zwischen Karten. |
| `space-5` | `20` | Innenabstand von Sheets. |
| `space-6` | `24` | Abstand zwischen Abschnitten eines Bildschirms. |
| `space-8` | `32` | Leerzustände, Abstand über großen Titeln. |
| `space-10` | `40` | Oberer Abstand in Leerzuständen. |

### Radien

Karten `radius-lg`, Bedienelemente/Felder/Zeilen in Karten/Hinweise `radius-md`, Buttons/Chips/Avatare/Levelbalken `radius-pill`, obere Ecken von Sheets `radius-xl`. Innere Radien sind kleiner als äußere.

| Token | Wert | Zweck |
| --- | --- | --- |
| `radius-xs` | `6` | Füllung von Balken, kleine Badges. |
| `radius-sm` | `10` | Beschriftungsfelder, Tooltips. |
| `radius-md` | `16` | Bedienelemente, Eingabefelder, Zeilen in Karten, Hinweise, Mini-Tracker. |
| `radius-lg` | `24` | Karten. |
| `radius-xl` | `28` | Obere Ecken von Sheets. |
| `radius-pill` | `999` | Buttons, Chips, Avatare, Levelbalken. |

### Elevation: die Sockelkante

Karten und helle Buttons stehen auf einer **Sockelkante ohne Unschärfe** (`elevation-card`, `elevation-button-soft`), primäre Buttons auf `elevation-button` in `primary-pressed`. Beim Drücken sinkt das Element um `press-depth` (3 dp) und die Kante schrumpft auf 1 dp (`*-pressed`) – wie ein Inselfeld, das man eindrückt. Weiche Schatten gibt es nur für Schwebendes: ＋ (`elevation-floating`), Sheets und Tab-Leiste (`elevation-sheet`), Meldung (`elevation-toast`).

React Native nimmt `boxShadow` als Zeichenkette in Web-Syntax, auch mehrere Schatten, Spread und `inset`; nur mit New Architecture, auf Android ab Version 9 ([RN-Doku](https://reactnative.dev/docs/view-style-props#boxshadow), [BoxShadowValue](https://reactnative.dev/docs/boxshadowvalue)). Expo SDK 57 läuft nur mit New Architecture ([research/expo-bibliotheken.md](expo-bibliotheken.md)). **Prüfpunkt:** Die RN-Doku beschreibt ein positives `offsetY` als „nach oben“, entgegen der Web-Syntax – vor der Umsetzung auf dem Gerät prüfen, ob die Sockelkante unten erscheint (Annahme 10).

| Token | Wert | Zweck |
| --- | --- | --- |
| `elevation-card` | `0 4px 0 0 #E4D2B0` | Karte in Ruhe: Sockelkante in plinth, ohne Unschärfe. |
| `elevation-card-pressed` | `0 1px 0 0 #E4D2B0` | Antippbare Karte gedrückt; zusammen mit 3 dp Verschiebung nach unten. |
| `elevation-button` | `0 4px 0 0 #085B58` | Primär-Button und ＋ in Ruhe: Sockel in primary-pressed. |
| `elevation-button-pressed` | `0 1px 0 0 #085B58` | Primär-Button gedrückt (3 dp nach unten). |
| `elevation-button-soft` | `0 3px 0 0 #C6E6E2` | Sekundär-Button und Mini-Tracker-Aktion in Ruhe. |
| `elevation-button-soft-pressed` | `0 1px 0 0 #C6E6E2` | Sekundär-Button gedrückt (2 dp nach unten). |
| `elevation-floating` | `0 4px 0 0 #085B58, 0 10px 20px -6px #1D333240` | ＋ in der Tab-Leiste: Sockel plus weicher Schatten, weil er über der Leiste schwebt. |
| `elevation-sheet` | `0 -1px 0 0 #EAD9BC, 0 -10px 30px -10px #1D333233` | Sheets und Tab-Leiste: Kante nach oben. |
| `elevation-toast` | `0 4px 0 0 #0E1F1E, 0 12px 24px -10px #1D333259` | Meldung mit „Rückgängig“. |
| `focus-ring` | `0 0 0 2px #FFFCF6, 0 0 0 5px #0B7470` | Fokusring: 2 dp Abstand in surface-card, dann 3 dp primary. |

### Größen

| Token | Wert | Zweck |
| --- | --- | --- |
| `touch-min` | `48` | Mindest-Trefferfläche jedes Bedienelements auf beiden Plattformen (iOS 44 pt, Android 48 dp – der größere Wert gilt). |
| `button-height` | `52` | Primär- und Sekundär-Button. |
| `button-height-compact` | `44` | Kompakte Buttons in Mini-Trackern; Trefferfläche per hitSlop auf touch-min. |
| `chip-height` | `36` | Chips; Trefferfläche per hitSlop auf touch-min. |
| `field-height` | `52` | Eingabefelder. |
| `row-min` | `52` | Listenzeilen und Tagesziel-Zeilen. |
| `icon-sm` | `16` | Icons in Mini-Tracker-Köpfen und Chips. |
| `icon-md` | `20` | Icons in Zeilen, Hinweisen und Buttons. |
| `icon-lg` | `24` | Tab-Icons, Icon-Buttons. |
| `icon-stroke` | `2` | Strichstärke aller Linien-Icons (runde Enden). |
| `avatar` | `44` | Avatar in Partner-Karte und „Wir“. |
| `plus-button` | `56` | ＋ in der Tab-Leiste. |
| `ring-size` | `136` | Kalorienring auf „Heute“. |
| `ring-stroke` | `14` | Strichstärke des Kalorienrings. |
| `levelbar-height` | `14` | Höhe des 50/50-Levelbalkens. |
| `bar-height` | `6` | Höhe einfacher Fortschrittsbalken. |
| `plinth-depth` | `4` | Höhe der Sockelkante in Ruhe. |
| `press-depth` | `3` | Verschiebung nach unten beim Drücken. |
| `momo-today` | `104` | Momo im Momo-Bereich auf „Heute“. |
| `island-tile` | `64` | Breite eines Inselfelds bei Zoom 1 (Höhe = halbe Breite, Projektion 2:1). |

### Deckkraft

Die Deckkräfte steuern die Lichtregel der Insel (`opacity-shade-left`, `opacity-shade-right`), Schlagschatten, Momos Wangen, Abend und Nebel.

| Token | Wert | Zweck |
| --- | --- | --- |
| `opacity-shade-left` | `0.12` | Skia: Abdunklung der linken Seitenflächen (Licht von links oben). |
| `opacity-shade-right` | `0.24` | Skia: Abdunklung der rechten Seitenflächen. |
| `opacity-cast-shadow` | `0.16` | Skia: Schlagschatten von Objekten auf Feldern. |
| `opacity-cheek` | `0.55` | Skia: Momos Wangen. |
| `opacity-evening` | `0.45` | Skia: Abend-Überlagerung in island-night. |
| `opacity-fog` | `0.85` | Skia: Nebel über noch gesperrten Gebieten. |

### Bewegung

Federnd bei Erfolgen, ruhig bei allem anderen. Werte gelten für Reanimated (`withTiming` mit `Easing.bezier`, `withSpring`). **Alle Dauer-, Kurven- und Federwerte sind Designwerte (nicht belegt, Annahme 6).**

**Dauer**

| Token | Wert | Zweck |
| --- | --- | --- |
| `duration-instant` | `90ms` | Drücken: Sockel sinkt, Farbe wechselt. |
| `duration-fast` | `150ms` | Kleine Zustandswechsel: Chip auswählen, Häkchen erscheint. |
| `duration-base` | `240ms` | Standard-Übergänge, Meldung ein- und ausblenden, Balken wächst. |
| `duration-slow` | `400ms` | Ring und Levelbalken füllen sich, Sheet öffnet. |
| `duration-celebrate` | `1200ms` | Tagesbonus und Levelaufstieg: Momo-Reaktion und Funken. |

**Kurven**

| Token | Wert | Zweck |
| --- | --- | --- |
| `easing-standard` | `cubic-bezier(0.2, 0, 0, 1)` | Standardkurve für Bewegung innerhalb eines Bildschirms. |
| `easing-enter` | `cubic-bezier(0, 0, 0, 1)` | Elemente erscheinen (Meldung, Sheet). |
| `easing-exit` | `cubic-bezier(0.3, 0, 1, 1)` | Elemente verschwinden. |

**Federn** – stehen nicht in `tokens.json`, sondern in `1-tokens.md` und als `motion.spring` in `code/tokens.ts`:

| Token | Wert | Zweck |
| --- | --- | --- |
| `spring-bouncy` | `damping 11, stiffness 180, mass 1` | Häkchen ploppt, Momo hüpft, Energie-Funke |
| `spring-firm` | `damping 20, stiffness 260, mass 1` | Rückfedern nach dem Drücken, Chips |

- **Tagesziel erfüllt:** Häkchen mit `spring-bouncy`, Zeile färbt sich in `duration-fast`, Momo wechselt kurz auf „freut sich“.
- **Alle drei erfüllt / Levelaufstieg:** Momo „begeistert“ mit Hüpfer und drei Funken über `duration-celebrate`; nie Konfetti über den ganzen Bildschirm.
- **Seitenwechsel** folgen der Plattform (Expo Router).
- **Bewegung reduzieren:** Federn werden zu Überblendungen in `duration-fast`, Momo hüpft nicht, Wellen und Partikel der Insel stehen still. Abfrage über Reanimated `useReducedMotion` ([Doku](https://docs.swmansion.com/react-native-reanimated/docs/device/useReducedMotion/)) bzw. `AccessibilityInfo.isReduceMotionEnabled` ([RN-Doku](https://reactnative.dev/docs/accessibilityinfo)).

## Komponenten

Die Komponenten sind Entwurfsvorlagen, keine Bibliothek. **Gebrandet** heißt: eigene React-Native-Komponente mit `StyleSheet` und Tokens. **@expo/ui** heißt: natives SwiftUI- bzw. Jetpack-Compose-Element, wie in [#41](https://github.com/Yggras/abnehm-app/issues/41) festgelegt; Expo empfiehlt `@expo/ui` zuerst für Sheets, Picker, Slider, Schalter und Menüs ([research/expo-bibliotheken.md](expo-bibliotheken.md)). Welche `@expo/ui`-Bausteine genau (Namen, Parameter), wird mit der Umsetzung gewählt (Annahme 12).

| Komponente | Umsetzung | Varianten | Zustände |
| --- | --- | --- | --- |
| Button | gebrandet (`Pressable`) | Primär, Sekundär, Text, Icon, kompakt | Standard, gedrückt, deaktiviert, Laden; Fehler als Hinweis darunter |
| Chip | gebrandet | Auswahl, Mehrfachauswahl (Tage), Schnellwahl, Zeitraum, Kurzbotschaft | Standard, ausgewählt, gedrückt, deaktiviert |
| Karte | gebrandet | Standard, antippbar, antwortbedürftig | Standard, gedrückt, Laden, leer, Fehler (veraltet) |
| Listenzeile | gebrandet; Schalter und Kontextmenü darin @expo/ui | Eintrag, Import, ersetzt, Einstellung, Navigation | Standard, gedrückt, deaktiviert, Laden |
| Sheet | Container, Griff, Abdunklung und Wischgeste @expo/ui; Inhalt gebrandet | Auswahl („＋“), Formular, Ladeansicht | Standard, Laden, Hinweis, Fehler |
| Tab-Leiste | gebrandet (Annahme 11: eigene Tab-Bar in Expo Router) | Fünf Plätze mit ＋ in der Mitte | aktiv, inaktiv, gedrückt, Punkt |
| Meldung | gebrandet | Mit „Rückgängig“, reine Bestätigung | einblenden, sichtbar, ausblenden |
| Hinweis | gebrandet | Partner, Hinweis, Neutral, Erfolg, Problem | – |
| Kalorienring | gebrandet (Skia-Kreis oder View-basiert, Wahl in der Umsetzung) | – | leer, Teil, erreicht, drüber, Laden |
| Fortschrittsbalken | gebrandet | Wasser, Sport-Woche | leer, Teil, erreicht, über Ziel, Laden |
| Levelbalken 50/50 | gebrandet | – | neues Level, Teil, eine Hälfte voll, Levelaufstieg, Ei, Laden |
| Tagesziel | gebrandet | je Baustein | erfüllt, teilweise, offen, Tagesende, Laden |
| Mini-Tracker | gebrandet | Wasser, Sport, Gewicht | Teil, erreicht, gedrückt, Wiegetag, gewogen |
| Gewichtsverlauf | Victory Native 42 in dünner App-Hülle | 4 Wochen, 3 Monate, Alles | Verlauf, < 3 Tagesgewichte, steigender Trend, leer |
| Eingabefeld | gebrandet (`TextInput`); Datum/Uhrzeit über nativen Picker @expo/ui | Zahl mit Einheit, Text, Suche, Code | leer, fokussiert, gefüllt, Hinweis, Fehler, deaktiviert |
| Leerzustand | gebrandet | Protokoll, ohne Partner, Gewicht, Lager, offline, Ereignisse | – |
| Icons | gebrandet als Vektorpfade (Skia oder einfache SVG-Komponente, Wahl in der Umsetzung) | `icon-sm`, `icon-md`, `icon-lg` | Farbe vom Text: `ink`, aktiv `primary`, deaktiviert `ink-disabled`, Zustandsfarben |
| Schalter, Picker, Kontextmenü | @expo/ui | – | nativ |
| Momo | Skia | Stimmungen | siehe *Momo und Insel* |
| Insel | Skia 2 + Reanimated + Gesture Handler | Tag/Abend, Jahreszeiten | siehe *Momo und Insel* |

**Zustandsregeln für alle Komponenten:**

| Zustand | Regel |
| --- | --- |
| Standard | Ruhige Fläche, Sockelkante, Text in `ink`. |
| Gedrückt | Element sinkt um 3 dp, Kante auf 1 dp, Fläche einen Ton dunkler (`*-pressed`); `duration-instant`. Kein Ripple, kein Aufblitzen. |
| Deaktiviert | `fill-disabled` und `ink-disabled`, keine Kante. Nur wenn klar ist, warum – der Grund steht daneben („Braucht Internet“). Lieber ausblenden als deaktivieren. |
| Laden | Skelett in `surface-sunken` in der Form des Inhalts; Buttons zeigen drei Punkte und behalten ihre Breite. Keine Spinner über ganzen Bildschirmen. |
| Leer | Leerzustand mit Satz und genau einer Aktion; Momo nur dort, wo es um Momo oder die Insel geht. |
| Fehler | Offline-first ([#35](https://github.com/Yggras/abnehm-app/issues/35)): meist ist etwas *veraltet*, nicht kaputt – neutraler Hinweis mit Zeitstempel. `problem` nur, wenn eine Aktion wirklich gescheitert ist oder eine Eingabe ungültig ist; immer mit Lösungsweg. |

Jedes Bedienelement hat mindestens `touch-min` (48 × 48 dp); kleinere sichtbare Elemente (Chips 36, kompakte Buttons 44) erweitern ihre Trefferfläche mit `hitSlop` ([RN-Doku Pressable](https://reactnative.dev/docs/pressable#hitslop)).

**Wichtige Einzelregeln aus den Komponenten-READMEs:**

- **Button:** höchstens eine Primär-Aktion pro Bildschirm; kein Rot für „Löschen“ – Löschen läuft ohne Dialog mit „Rückgängig“ ([#38](https://github.com/Yggras/abnehm-app/issues/38)).
- **Karte:** *antwortbedürftig* mit 2-dp-Rahmen in `partner`, nur ganz oben auf „Wir“ ([#43](https://github.com/Yggras/abnehm-app/issues/43)); keine Karten in Karten, keine farbigen Randstreifen.
- **Kalorienring:** über dem Budget voller Ring plus zweiter Bogen in `neutral` (höchstens 30 %, Annahme 4), Text „kcal drüber“, nie Rot. Im Haltemodus gleicher Ring mit Gesamtumsatz als Budget ([#14](https://github.com/Yggras/abnehm-app/issues/14)).
- **Levelbalken:** linke Hälfte „Du“ in `self`, rechte Hälfte Partner in `partner`, beide füllen sich von außen zur Mitte (Annahme 3), Level als Abzeichen in der Mitte; keine Prozentzahlen nebeneinander, keine Rückstandsanzeige. Ohne Kopplung: Hinweis „Momo wartet im Ei“ ([#14](https://github.com/Yggras/abnehm-app/issues/14)).
- **Tagesziel:** „Im Kalorienbudget“ zeigt tagsüber den Zustand *Tagesende* (Mond, „am Tagesende“), nie erfüllt oder verfehlt. Ein erfülltes Tagesziel bleibt erfüllt, auch wenn später korrigiert wird ([#35](https://github.com/Yggras/abnehm-app/issues/35)).
- **Mini-Tracker:** Fläche antippen öffnet Details. Der Button bucht bei Wasser sofort, danach erscheint die Meldung mit „Rückgängig“; bei Sport und Gewicht öffnet er das Formular ([Spezifikation 3](https://github.com/Yggras/abnehm-app/issues/86), Abschnitt 4; die README im Artifact sagt noch „bucht sofort“). Das eigene Gewicht sieht nur die Person selbst ([#22](https://github.com/Yggras/abnehm-app/issues/22)).
- **Gewichtsverlauf:** Trendgewicht groß, Tagesgewicht klein; unter drei Tagesgewichten nur Punkte und „Ab drei Tagesgewichten zeigen wir deinen Trend.“; Prognose immer mit „Schätzung“ ([#38](https://github.com/Yggras/abnehm-app/issues/38)).
- **Meldung:** auf `surface-inverse` über der Tab-Leiste, Standzeit 5 s (Annahme 7), mit Screenreader länger.
- **Tab-Leiste:** Heute · Protokoll · ＋ · Momo · Wir ([#15](https://github.com/Yggras/abnehm-app/issues/15)); ＋ als 56-dp-Kreis ragt 14 dp über die Leiste; Punkt am Tab „Momo“ in `hint` für ein neues Insel-Ereignis ([#37](https://github.com/Yggras/abnehm-app/issues/37)).

### Referenzentwürfe

| Tab | Aufbau | Bausteine |
| --- | --- | --- |
| Heute | Momo-Zentrum nach [#15](https://github.com/Yggras/abnehm-app/issues/15): Begrüßung mit Wochentag und Zahnrad · Hinweis „Anna feuert dich an“ · Momo-Bereich (Momo, Energie, Levelbalken, „Neues auf der Insel“, drei Tagesziele) · Kalorienring mit Tagesprotokoll · Mini-Tracker Wasser, Sport, Gewicht · Partner-Karte mit „Anfeuern“ · Tab-Leiste | Hinweis, Levelbalken, Tagesziel, Kalorienring, Mini-Tracker, Button, Tab-Leiste |
| Momo | Insel bildschirmfüllend mit Momo, Besucher, Nebel und Gemeinschaftsprojekt ([#26](https://github.com/Yggras/abnehm-app/issues/26), [#28](https://github.com/Yggras/abnehm-app/issues/28)); oben Jahres- und Tageszeit, Energie, Bereiche einblenden, Levelbalken; unten Lager · Projekt · **Bauen** · Ereignisse | Insel, Momo, Levelbalken, Chip, Button, Tab-Leiste |
| Wir | Variante A „Überblick“ nach [#43](https://github.com/Yggras/abnehm-app/issues/43): antwortbedürftige Karte · Partnerübersicht mit Zusammenfassungen und Anfeuern · erhaltene Anfeuerung mit „Danke ❤️“ · aktive gemeinsame Challenge (eigener Stand exakt, gemeinsam nur als Stufe, [#19](https://github.com/Yggras/abnehm-app/issues/19)) · Gemeinschaftsprojekt · „Neu bei euch“; ohne Kopplung Leerzustand „Momo wartet im Ei“ | in der README nicht genannt |

**Vorrang bei Widersprüchen** ([#91](https://github.com/Yggras/abnehm-app/issues/91)): Bei Inhalten, Texten, Abläufen und Datenumfang gelten die Spezifikationen. Die Referenzentwürfe zeigen Komposition und Gestaltung. In der Artifact-Version `1792094930-af8a` weichen sie an diesen Stellen ab ([Einzelheiten](impeccable-review.md#prüfung-3-referenzentwurf-wir)):

- „Wir“ zeigt die Kurzbotschaften als Chips direkt auf der Seite, darunter „Kleiner Stups: Trink was 💧“. Es gilt das Sheet mit dem Katalog aus Spezifikation 5, ohne Zielbezug und ohne „Stupsen“.
- „Heute“ und „Wir“ zeigen „2 von 3 Tageszielen“. Es gilt der grobe Tageszielstand (Spezifikation 0, Abschnitt 5).
- Das Gewicht steht als „Trend −0,3 kg/Woche“. Es gilt „Trend −0,4 kg in 2 Wochen“.
- Das Gemeinschaftsprojekt zeigt „Annas Natur-Anteil · gut gefüllt“ mit Balken. Der Beitrag enthält nur den eigenen Stand und die gemeinsame Stufe.
- Die Partner-Karte auf „Heute“ zeigt Zusammenfassungen als 2 × 2-Kacheln. Es gelten nur Name, grober Tageszielstand und „Anfeuern“ (Spezifikation 5, Nutzerentscheidung in #91).
- Die Mini-Tracker-README sagt „der Button bucht sofort“. Das gilt nur für Wasser.

## Barrierefreiheit

**Nach V1 verschoben** ([#249](https://github.com/Yggras/abnehm-app/issues/249)): Die folgenden Werte bleiben als Entwurfsgrundlage erhalten, sind aber in V1 keine Abnahmekriterien, keine verpflichtenden Tests und kein Merge-Gate. Bereits implementierte Unterstützung bleibt erhalten. Visuelle und funktionale Prüfungen werden dadurch nicht aufgehoben.

Ziel für die Zeit nach V1 ist WCAG 2.2 Stufe AA, übertragen auf Mobil-Apps.

- **Kontrast:** Text mindestens 4,5:1, große Schrift 3:1 ([SC 1.4.3](https://www.w3.org/TR/WCAG22/#contrast-minimum)); Icons, Rahmen von Bedienelementen, Fokusring und Grafiken mit Bedeutung 3:1 ([SC 1.4.11](https://www.w3.org/TR/WCAG22/#non-text-contrast)). Laut Artifact bestehen alle 50 berechneten Token-Paare. Weiße Initiale auf `partner` (3,9:1) nur als großer, fetter Text (19 pt, 700). `energy` ist zu hell für Text und trägt die Kontur `energy-edge`. Deaktivierte Bedienelemente sind von der Kontrastpflicht ausgenommen; Inhalte stehen nie in `ink-disabled`.
- **Dynamische Schriftgröße:** Alle Texte skalieren mit (`allowFontScaling`, [RN-Doku Text](https://reactnative.dev/docs/text#allowfontscaling); Faktor über `useWindowDimensions().fontScale`, [RN-Doku](https://reactnative.dev/docs/usewindowdimensions)). Layouts funktionieren bis Faktor 2,0 ([SC 1.4.4](https://www.w3.org/TR/WCAG22/#resize-text)). Ab Faktor 1,3 stapeln sich Mini-Tracker, Momo steht über dem Levelbalken, Partner-Zusammenfassungen werden einspaltig; `display` ist auf 1,6, `number-xl` auf 1,4 und `tab-label` auf 1,3 begrenzt (`maxFontSizeMultiplier`, Annahme 8). Keine festen Höhen für Textcontainer.
- **Trefferflächen:** mindestens 48 × 48 dp – erfüllt Apples 44 × 44 pt ([HIG Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)) und Androids 48 × 48 dp ([Android-Doku](https://developer.android.com/guide/topics/ui/accessibility/apps)) und liegt über WCAG 2.2 SC 2.5.8.
- **Bedeutung nie nur über Farbe:** Tagesziele mit Häkchen + „erfüllt“, Teilring + Wert, gestrichelter Kreis + Wert, Mond + „am Tagesende“; Levelbalken über Position und Namen; ausgewählte Chips mit Fläche, 2-dp-Rahmen und Häkchen; aktiver Tab mit Farbe, Pille und fetter Beschriftung.
- **Screenreader:** Fortschrittsanzeigen mit `accessibilityRole="progressbar"` und `accessibilityValue` (`min`, `max`, `now`, `text`, [RN-Doku Accessibility](https://reactnative.dev/docs/accessibility)); der Levelbalken als ein Element mit Gesamtsatz; Momo und Insel als ein Bild mit beschreibendem `accessibilityLabel`; Gewichtsverlauf mit Textzusammenfassung; Meldungen werden angesagt.

### Kontrast nachgerechnet (*eigene Rechnung*)

#65 verlangt, die Kontrastwerte nach Phase 2 nachzumessen. Ich habe 41 Token-Paare aus den Hex-Werten mit der WCAG-Formel ([relative Leuchtdichte](https://www.w3.org/TR/WCAG22/#dfn-relative-luminance), [Kontrastverhältnis](https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio)) berechnet. Alle Werte, die das Artifact nennt, stimmen auf eine Nachkommastelle. Jedes Paar in der Tabelle erreicht die Schwelle seiner Verwendung (Text 4,5:1, Icons, Grafiken und Rahmen 3:1). Die Füllung `energy` hat auf `surface-card` nur 1,82:1; deshalb trägt das Energie-Symbol die Kontur `energy-edge`, wie im Artifact vorgesehen. Auf echten Geräten gemessen ist das weiterhin nicht.

| Paar | Verwendung | Verhältnis |
| --- | --- | --- |
| `ink` auf `surface-base` / `surface-card` / `surface-sunken` | Text | 12,21 / 13,05 / 11,29 |
| `ink` auf `*-soft` (primary, partner, success, hint, neutral, problem) | Text | 10,86 – 11,35 |
| `ink-muted` auf `surface-base` / `surface-card` / `surface-sunken` | Text | 5,82 / 6,22 / 5,38 |
| `on-primary` auf `primary` / `primary-pressed` | Text | 5,61 / 7,93 |
| `primary` auf `surface-card` / `surface-base` / `primary-soft` | Text, Fokusring | 5,47 / 5,12 / 4,74 |
| `primary-pressed` auf `primary-soft-pressed` | Text | 5,97 |
| `success` auf `surface-card` / `success-soft` | Text, Icon | 5,99 / 5,14 |
| `hint` auf `surface-card` / `hint-soft` | Text, Icon | 5,73 / 4,99 |
| `neutral` auf `surface-card` / `neutral-soft` | Text, Icon | 5,93 / 4,93 |
| `problem` auf `surface-card` / `problem-soft` | Text, Icon | 6,27 / 5,23 |
| `on-inverse` auf `surface-inverse` | Text | 13,05 |
| `self` auf `surface-sunken` / `surface-card` / `primary-soft` | Grafik | 3,79 / 4,38 / 3,79 |
| `partner` auf `surface-sunken` / `surface-card` / `partner-soft` | Grafik, Icon | 3,27 / 3,78 / 3,15 |
| `#FFFFFF` auf `partner` | nur großer, fetter Text | 3,88 |
| `energy-edge` auf `surface-card` / `energy` | Kontur | 5,73 / 3,16 |
| `line-strong` auf `surface-card` / `surface-base` | Rahmen | 3,99 / 3,73 |

## App-Name und App-Icon

Die App heißt **„Gemeinsam leichter“** (Nutzerentscheidung vom 16.10.2026 in [#70](https://github.com/Yggras/abnehm-app/issues/70)). Der Name verbindet das Gesundheits- und Abnehmziel mit der Unterstützung als Paar, ohne „Abnehmen“ oder „Gewicht“ ausdrücklich zu nennen.

Das App-Icon folgt **C · Umarmung** aus dem [ComfyUI-Prototyp](../prototypes/app-icon/README.md):

- Momo als freudige Kaulquappe in der Mitte;
- ein breites Band in `self` von links und eines in `partner` von rechts, die Momo als offenes Herz umfassen;
- ein einzelner Funke in `energy` über Momo;
- vollflächiger Hintergrund in `primary-soft`;
- kein Text und keine weiteren Symbole.

Das offene Herz steht nach der Nutzerentscheidung zugleich für partnerschaftliche Unterstützung und Fitness. Der Funke verbindet das Motiv mit Momos Energie-System. Der KI-generierte Entwurf ist eine Auswahlreferenz, kein Produktionsasset; die Umsetzung zeichnet ihn mit den festgelegten Token-Farben neu.

## iOS und Android

Grundsatz: **Alles Gebrandete ist auf beiden Plattformen gleich, alles Systemnahe folgt der Plattform.** Beide sehen dieselbe App und dieselbe Insel, bedienen sie aber mit den Gesten und Systemelementen, die sie kennen.

- **Gleich:** alle Tokens; Rubik statt Systemschrift; eigener Icon-Satz; eigene Tab-Leiste mit ＋ ([#15](https://github.com/Yggras/abnehm-app/issues/15)); gebrandete Karten, Tracker, Fortschrittsanzeigen, Hinweise, Meldungen ([#41](https://github.com/Yggras/abnehm-app/issues/41)); Momo, Insel und Gewichtsverlauf pixelgleich; Texte und Zahlenformat; Trefferflächen 48 dp.
- **Nach Plattform:** Sheets (SwiftUI-Sheet bzw. Compose-Bottom-Sheet über `@expo/ui`, Inhalt immer gebrandet); Schalter, Datum/Uhrzeit und Kontextmenü nativ über `@expo/ui`; Zurück (Wischen vom linken Rand bzw. System-Zurück); sichere Bereiche; Berechtigungsdialoge nach eigenem Erklär-Bildschirm ([#37](https://github.com/Yggras/abnehm-app/issues/37)); Einladungscode über das System-Teilen-Menü ([#14](https://github.com/Yggras/abnehm-app/issues/14)); Benachrichtigungen (iOS Interruption Level „active“, Android-Kanäle „Tages-Check-ins“ und „Partner & Momo“, [#37](https://github.com/Yggras/abnehm-app/issues/37)); Dynamic Type bzw. Systemschriftgröße; Apple Health bzw. Health Connect.

## Momo und Insel

Momo und die Insel werden mit Skia gezeichnet ([#41](https://github.com/Yggras/abnehm-app/issues/41), [#40](https://github.com/Yggras/abnehm-app/issues/40)) und sind das einzige Stück der App, das wirklich verspielt sein darf (Prinzip 6).

### Momo

- **Gestalt:** Momo ist ein **Lagunenling**, ein langes, amphibisches Lagunenwesen ([#72](https://github.com/Yggras/abnehm-app/issues/72), [#69](https://github.com/Yggras/abnehm-app/issues/69); Vorlagen in [prototypes/momo-lagunenling](../prototypes/momo-lagunenling/README.md)). Die Vorschauen des Artifacts zeichnen Form 1, die Kaulquappe; die Vorlagen aller acht Formen liegen dort als Asset-Gruppe **Momo**.
- **Konstante Merkmale auf jeder Form:** je drei runde, gewellte Kiemenwedel in `momo-frond` an beiden Kopfseiten; ein durchgehender Bauchstreifen in `momo-belly` vom Kinn bis zur Schwanzspitze; dasselbe Gesicht mit Wangen.
- **Zeichenstil:** flächig ohne Kontur (`momo-body`, `momo-belly`, `momo-frond`, `momo-cheek` mit `opacity-cheek`, Augen und Mund in `ink` mit weißem Lichtpunkt); zweitönig schattiert mit Licht von links oben (rechte Körperhälfte 10 % Schwarz, Glanz oben links 45 % Weiß), keine Verläufe; weich und rund, keine Zähne, keine Krallen. **Flossen, Kamm und Flügel in `momo-frond`, nie in Türkis**, damit Momo vor `momo-stage` und über der Lagune sichtbar bleibt (*eigene Einschätzung aus #69*).
- **Größen:** `momo-today` (104 dp) auf „Heute“, auf der Insel etwa ein Feld hoch, in Leerzuständen 80–96 dp. Jede Form ist etwa so breit wie hoch oder höher als breit, damit das Gesicht bei 104 dp lesbar bleibt; einzige Ausnahme ist der Krabbler.
- **Accessoires** ([#28](https://github.com/Yggras/abnehm-app/issues/28)) sitzen am Kopf oder Hals, folgen derselben Lichtregel und verdecken nie das Gesicht; Einzelheiten siehe unten.
- **Entwicklungsformen:** acht feste Formen, jede ab Level 4 mit einem neuen Gebiet ([#18](https://github.com/Yggras/abnehm-app/issues/18)). Jede Form wechselt Körperbau und Umriss, nicht nur Größe und Details. Ab Level 43 bleibt Momo in der Endform; weitere Gebiete alle 6 Level kommen ohne neue Form.

| Level | Form | Körperbau und Umriss |
| --- | --- | --- |
| 1 | Kaulquappe | großer runder Kopf, kurzer Flossenschwanz, keine Gliedmaßen; schwebt |
| 4 | Hüpfer | sitzt auf zwei Hinterbeinchen, winzige Ärmchen, Schwanz um die Füße |
| 8 | Krabbler | waagerecht auf vier kurzen Beinen wie ein junger Axolotl |
| 13 | Aufrechter | steht aufrecht wie ein Otter, Paddelflossen vor der Brust |
| 19 | Springer | C-Bogen wie ein springender Delfin, lange Flossen, Rückensaum, Schwanzfluke |
| 26 | Spirale | aufrechte Spirale wie ein Seepferdchen, gekräuselter Flossenkamm |
| 34 | Flügling | schwebt unter zwei rundlichen Flügelpaaren, Schwanz hängt in einer Welle |
| 43 | Lagunendrache | sitzt wie eine Katze, Flügelfächer hinter dem Rücken, Schwanz um die Füße, Kiemenwedel zur Krone gewachsen |

| Stimmung | Auslöser | Ausdruck |
| --- | --- | --- |
| zufrieden | Standard | offene Augen, kleines Lächeln |
| freut sich | ein Tagesziel erfüllt | Lachaugen, offener Mund, Ärmchen hoch (Formen ohne Arme: Kiemenwedel hoch, Schwanz schwingt), kurzer Hüpfer (`spring-bouncy`) |
| begeistert | alle drei Tagesziele (Tagesbonus), Levelaufstieg | großes Lachen, Sprung, drei Energie-Funken: Sie leuchten über `duration-celebrate` auf und bleiben danach funkelnd stehen, damit „begeistert“ auf einen Blick von „freut sich“ zu unterscheiden ist (Nutzerentscheidung in [#187](https://github.com/Yggras/abnehm-app/issues/187) nach der Impeccable-Prüfung) |
| neugierig | ein Insel-Ereignis wartet | große Augen, Brauen hoch, Fragezeichen in `hint` |
| döst | Pause, länger nichts erfasst | geschlossene Augen, „z z“ in `ink-muted` – neutral, nie traurig |
| schläft | Abend auf der Insel | geschlossene Augen, kleiner Mond |
| wartet im Ei | ohne Kopplung ([#14](https://github.com/Yggras/abnehm-app/issues/14)) | **Laichkugel**: runde Gallertkugel in `momo-belly`, darin die schlafende Kaulquappe in `momo-body` mit `momo-frond`-Kiemenwedeln; leichtes Wippen ([#69](https://github.com/Yggras/abnehm-app/issues/69)) |

**Nie:** traurig, krank, hungrig, enttäuscht, schwächer, weinend, schimpfend ([#12](https://github.com/Yggras/abnehm-app/issues/12)). Momo verliert nichts, wenn Ziele offen bleiben.

#### Momo-Accessoires

Festgelegt in [#69](https://github.com/Yggras/abnehm-app/issues/69):

- **Zwei Stellen:** Kopf (am Scheitel zwischen den Kiemenwedeln, bei Level 43 vor der Krone) und Hals (bei der Kaulquappe am Übergang von Kopf zu Körper). Höchstens ein Accessoire je Stelle.
- **Jedes Accessoire passt auf alle acht Formen.** Es wird einmal gezeichnet und je Form nur über Lage, Drehung und Größe angepasst, bei Bedarf mit Vorder- und Hinterteil ([Produktionsstrategie, Abschnitt 7.2](momo-animation-assets.md)).
- **Farbe:** Kopf-Accessoires nicht in `momo-frond`, damit sie sich von Kiemenwedeln und Krone abheben (*eigene Einschätzung*: Hibiskus in Koralle verschwand in der Probe auf dem Drachen).
- **Gemeinsamer Schrank:** Jedes Accessoire gehört dem Paar; beide können es Momo an- und ablegen, die letzte Änderung gilt, beide sehen denselben Momo (Nutzerentscheidung 15.10.2026).
- **V1-Katalog** (zwölf Stücke, Designvorschlag ohne Beleg): Kopf: Strohhütchen, Seestern-Spange, Hibiskusblüte, Seerosenblatt-Hut, Blütenkranz, Haarschleife. Hals: Muschelkette, Halstuch, Blumenkette, Halsglöckchen, Perlenkette, Strickschal.

### Insel

- **Projektion:** isometrisch 2:1 ([#28](https://github.com/Yggras/abnehm-app/issues/28)); ein Feld ist `island-tile` (64 dp) breit und 32 dp hoch; Inselränder zeigen eine Erdschicht (`island-earth`).
- **Licht immer von links oben:** Oberseiten in der Grundfarbe, linke Seiten `opacity-shade-left`, rechte Seiten `opacity-shade-right` Schwarz; Schlagschatten nach rechts unten (`opacity-cast-shadow`). **Keine Konturen, keine Verläufe, keine Texturen.**
- **Zeichenreihenfolge** von hinten nach vorn (Zeile + Spalte aufsteigend); Objekte stehen mittig auf ihrem Feld und sind höchstens zwei Felder hoch.
- **Jahreszeiten** tauschen nur Gras und Laub; Jahreszeiten-Deko kommt jedes Jahr wieder ([#28](https://github.com/Yggras/abnehm-app/issues/28)).
- **Farbe = Person** gilt auf der Insel nur in der Bereichsansicht (eigene Felder in `self`, die des Partners in `partner`, je 28 % Deckkraft). Objekte tragen feste Inselfarben, damit die gemeinsame Insel auf beiden Handys gleich aussieht.
- **Bau-Modus:** gültige Felder leuchten in `island-buildable` (pulsierend mit `duration-slow`). **Gesperrtes Gebiet** liegt unter Nebel (Weiß mit `opacity-fog`), der beim Freischalten über `duration-celebrate` abzieht. **Aufwerten** (Stufe 1–3): jede Stufe etwas größer mit einem Detail. **Insel-Ereignisse:** Besucher am Strand mit Sprechblase; Ereignisse verfallen nie. **Gemeinschaftsprojekt** wächst im Gerüst (`island-wood`).
- **Abend:** `island-night` mit `opacity-evening` über der Szene, Fenster und Laternen in `island-lamp`, Momo schläft (Annahme 13: Überlagerung, keine zweite Palette).
- **Last:** Wellen, Ruheatmung und Partikel laufen leise und langsam, bei „Bewegung reduzieren“ stehen sie still. Der Skia-Spike hat 1.382 Elemente mit 157 Animationen auf iPhone SE 3 und Fairphone 6 flüssig gezeigt ([spikes/insel-rendering/RESULTS.md](../spikes/insel-rendering/RESULTS.md)); dass die Stilregeln die Zeichenlast in diesem Rahmen halten, ist eine Annahme (15).

## Annahmen

1. Die Vorschauen zeichnen Momo als Kaulquappe (Form 1) im Raster 120 × 120; die übrigen Formen gibt es nur als Vorlagenbilder ([#69](https://github.com/Yggras/abnehm-app/issues/69)). Die Vektorfassung aller Formen entsteht mit Spezifikation 4.
2. Beispieldaten sind erfunden – Philipp und Anna (Name aus `prototypes/partner-bereich`), Mittwoch, 14. Oktober, Mittwoch als Sporttag, Kalorienbudget 1.850 kcal, Wasserziel 1,5 l, Sportziel 150 min, Level 6, 23 Energie, Gemeinschaftsprojekt „Leuchtturm“, Challenge „Gut getrunken“.
3. Beide Hälften des Levelbalkens füllen sich von außen zur Mitte; das Level steht als Abzeichen in der Mitte.
4. Der Überschuss über dem Kalorienbudget wird als zweiter Bogen in `neutral` gezeigt, höchstens 30 % des Rings.
5. Token-Bezeichner sind englische Code-Namen; die Fachbegriffe aus `CONTEXT.md` stehen in Beschreibungen und Oberfläche.
6. Alle Werte für Dauer, Kurven und Federn sind Designwerte ohne Beleg.
7. Meldungen mit „Rückgängig“ bleiben 5 Sekunden, mit Screenreader länger.
8. Ab `fontScale` 1,3 stapeln sich Mini-Tracker und Momo-Bereich; `number-xl` ist auf Faktor 1,4, `tab-label` auf 1,3 begrenzt. `display` ist auf 1,6 begrenzt, weil lange Wörter wie „Komponenten“ bei größeren Faktoren mitten im Wort umbrachen (Nutzerentscheidung vom 18.10.2026 in [#95](https://github.com/Yggras/abnehm-app/issues/95)).
9. Rubik wird über `@expo-google-fonts/rubik` mit den Exportnamen `Rubik_400Regular` bis `Rubik_700Bold` eingebunden; auf Android wählt die Familie den Schnitt.
10. Die Sockelkante erscheint mit `boxShadow` unten; die RN-Doku beschreibt positives `offsetY` als „nach oben“, das muss auf dem Gerät geprüft werden.
11. Die eigene Tab-Leiste mit ＋ lässt sich in Expo Router als eigene Tab-Bar-Komponente umsetzen.
12. Sheets, Schalter, Picker und Kontextmenüs kommen aus `@expo/ui`; welche Bausteine genau, wird mit der Umsetzung gewählt.
13. Abend auf der Insel ist eine Überlagerung der Tagesszene, keine zweite Farbpalette.
14. Ein Inselfeld ist bei Zoom 1 64 dp breit.
15. Die Stilregeln für die Insel halten die Zeichenlast im Rahmen des Skia-Spikes.

Die Annahmen 9, 10 und 11 sind technische Prüfpunkte für [#56](https://github.com/Yggras/abnehm-app/issues/56) (*eigene Einschätzung*).

## Offene Designfragen

Diese Fragen hat das Design-System nicht entschieden. Der Nutzer hat am 14.10.2026 über ihren Verbleib entschieden ([Kommentar in #65](https://github.com/Yggras/abnehm-app/issues/65#issuecomment-6177664253)).

1. **Wie sieht Momo aus?** Wesen, Merkmale, die großen Entwicklungsformen ab Level 4 ([#18](https://github.com/Yggras/abnehm-app/issues/18)) und der Katalog der Accessoires sind nirgends festgelegt. Die Figur im Design-System ist ein Platzhalter.
   → **Entschieden** in [Momos Gestalt und Entwicklungsformen festlegen (#69)](https://github.com/Yggras/abnehm-app/issues/69): Lagunenling mit acht Entwicklungsformen, Laichkugel, Accessoires an Kopf und Hals (siehe [Momo](#momo)).
2. **Dunkelmodus in V1?** Das System liefert nur die helle Fassung. Die semantischen Namen erlauben ein zweites Theme ohne Umbenennung.
   → **Nein**, nur hell; auf der Karte unter *Out of scope*.
3. **App-Name und App-Icon.** Bis zu einer Entscheidung hieß das System „Abnehm-App“.
   → **Entschieden** in [App-Name und App-Icon festlegen (#70)](https://github.com/Yggras/abnehm-app/issues/70): **„Gemeinsam leichter“**, Icon **C · Umarmung** mit Momo, zweifarbigem offenen Herz und goldenem Energie-Funken (siehe [App-Name und App-Icon](#app-name-und-app-icon)).
4. **Haptik bei Erfolgen?** Ein kurzes Vibrieren beim Erfüllen eines Tagesziels würde zur federnden Bewegung passen; eine Haptik-Bibliothek gehört nicht zum festgelegten Stack ([#10](https://github.com/Yggras/abnehm-app/issues/10), [#41](https://github.com/Yggras/abnehm-app/issues/41)).
   → **Ja, dezent** bei erfülltem Tagesziel, Tagesbonus und Levelaufstieg; die Bibliothek (z. B. [`expo-haptics`](https://docs.expo.dev/versions/latest/sdk/haptics/)) wählt [Spezifikation 0 (#56)](https://github.com/Yggras/abnehm-app/issues/56).
5. **Insel ohne Sehen bedienen.** Die Skia-Insel ist für Screenreader ein Bild. Braucht V1 eine Liste der eigenen Felder und Objekte als Alternative? Das wäre eine neue Funktion.
   → **Nicht in V1**; die Insel bleibt ein Bild mit beschreibendem `accessibilityLabel`. Auf der Karte unter *Out of scope*.
6. **Form der Rückmeldung beim Erfüllen eines Tagesziels.** [#12](https://github.com/Yggras/abnehm-app/issues/12) verlangt eine kleine positive Reaktion; das System schlägt Momo „freut sich“ plus die Meldung „Wasserziel erfüllt · +1 Energie“ vor.
   → **Vorschlag übernommen**; Vorgabe für [Spezifikation 4 (#60)](https://github.com/Yggras/abnehm-app/issues/60).
7. **Schwellen der Challenge-Stufen.** „gestartet · gut unterwegs · fast geschafft · geschafft“ stehen in [#19](https://github.com/Yggras/abnehm-app/issues/19) nur als Beispiele, ohne Grenzen in Prozent.
   → legt [Spezifikation 4 (#60)](https://github.com/Yggras/abnehm-app/issues/60) fest, kein eigenes Ticket.
8. **Zeigt der Hinweis auf „Heute“ den Text der Anfeuerung?** [#15](https://github.com/Yggras/abnehm-app/issues/15) nennt nur „Partner feuert dich an“; der Entwurf zeigt zusätzlich die zuletzt erhaltene Kurzbotschaft.
   → **Ja**, mit der zuletzt erhaltenen festen Kurzbotschaft; Vorgabe für [Spezifikation 5 (#61)](https://github.com/Yggras/abnehm-app/issues/61).

## Später

Nach den ersten React-Native-Komponenten prüfen, ob `/design-sync` mit React Native funktioniert; sonst das Design-System per „Remix“ von Hand nachziehen ([Help Center](https://support.claude.com/en/articles/14604397-set-up-your-design-system-in-claude-design), aus [#65](https://github.com/Yggras/abnehm-app/issues/65)).
