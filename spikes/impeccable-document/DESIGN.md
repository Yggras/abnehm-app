(node:67988) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/drescherphilipp/personal/abnehm-app-worktrees/95-design-system/apps/mobile/src/design/tokens.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/drescherphilipp/personal/abnehm-app-worktrees/95-design-system/apps/mobile/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
---
name: Gemeinsam leichter
description: "Design-System Lagune, helle Fassung – Momentaufnahme aus apps/mobile/src/design/tokens.ts (#95)"
colors:
  surface-base: "#FBF4E6"
  surface-card: "#FFFCF6"
  surface-sunken: "#F4EBDA"
  surface-overlay: "#1D333266"
  surface-inverse: "#1D3332"
  on-inverse: "#FFFCF6"
  line: "#EAD9BC"
  line-strong: "#8F7B59"
  plinth: "#E4D2B0"
  ink: "#1D3332"
  ink-muted: "#55625E"
  ink-disabled: "#A2998A"
  on-primary: "#FFFFFF"
  primary: "#0B7470"
  primary-pressed: "#085B58"
  primary-soft: "#DDF0EE"
  primary-soft-pressed: "#C6E6E2"
  fill-disabled: "#EDE4D3"
  self: "#0E8580"
  partner: "#C9662B"
  partner-soft: "#F9E4D5"
  energy: "#F2B33D"
  energy-edge: "#8C5A00"
  success: "#256F3F"
  success-soft: "#DDF0E0"
  hint: "#8C5A00"
  hint-soft: "#FDEBC2"
  neutral: "#66625A"
  neutral-soft: "#EFE7D6"
  problem: "#A1401F"
  problem-soft: "#FBE3D9"
  momo-body: "#FFC56E"
  momo-belly: "#FFEBC4"
  momo-cheek: "#F48C73"
  island-grass: "#8BCB5E"
  island-grass-spring: "#9FD774"
  island-grass-autumn: "#B9C46A"
  island-grass-winter: "#EEF4F7"
  island-foliage: "#5FA44A"
  island-foliage-autumn: "#E8913A"
  island-water: "#3FB7D0"
  island-water-deep: "#2A93B3"
  island-sand: "#F3D9A4"
  island-earth: "#B07A48"
  island-wood: "#A86B3C"
  island-stone: "#CFC6B4"
  island-roof: "#D2693A"
  island-roof-alt: "#2E8C87"
  island-night: "#1E3557"
  island-lamp: "#FFD36A"
  island-buildable: "#FFF3B0"
typography:
  display:
    fontFamily: "Rubik"
    fontSize: "30px"
    fontWeight: 700
    lineHeight: "36px"
    letterSpacing: "-0.3px"
  title:
    fontFamily: "Rubik"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: "26px"
  headline:
    fontFamily: "Rubik"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: "22px"
  body:
    fontFamily: "Rubik"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: "22px"
  body-strong:
    fontFamily: "Rubik"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: "22px"
  button:
    fontFamily: "Rubik"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: "20px"
  label:
    fontFamily: "Rubik"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: "18px"
  caption:
    fontFamily: "Rubik"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: "16px"
  tab-label:
    fontFamily: "Rubik"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: "14px"
  number-xl:
    fontFamily: "Rubik"
    fontSize: "40px"
    fontWeight: 600
    lineHeight: "44px"
    letterSpacing: "-0.5px"
    fontFeature: "tnum"
  number-m:
    fontFamily: "Rubik"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: "24px"
    fontFeature: "tnum"
rounded:
  xs: "6px"
  sm: "10px"
  md: "16px"
  lg: "24px"
  xl: "28px"
  pill: "999px"
spacing:
  1: "4px"
  2: "8px"
  3: "12px"
  4: "16px"
  5: "20px"
  6: "24px"
  8: "32px"
  10: "40px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: "8px 20px"
    height: "52px"
  button-primary-pressed:
    backgroundColor: "{colors.primary-pressed}"
    textColor: "{colors.on-primary}"
  button-secondary:
    backgroundColor: "{colors.primary-soft}"
    textColor: "{colors.primary}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: "8px 20px"
    height: "52px"
  button-secondary-pressed:
    backgroundColor: "{colors.primary-soft-pressed}"
    textColor: "{colors.primary-pressed}"
  button-text:
    textColor: "{colors.primary}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: "8px 12px"
    height: "48px"
  button-compact:
    backgroundColor: "{colors.primary-soft}"
    textColor: "{colors.primary}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: "8px 16px"
    height: "44px"
  button-icon:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    size: "48px"
  button-disabled:
    backgroundColor: "{colors.fill-disabled}"
    textColor: "{colors.ink-disabled}"
  chip:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 12px"
    height: "36px"
  chip-selected:
    backgroundColor: "{colors.primary-soft}"
    textColor: "{colors.primary}"
  card:
    backgroundColor: "{colors.surface-card}"
    rounded: "{rounded.lg}"
    padding: "{spacing.4}"
  list-row:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    padding: "8px 16px"
    height: "52px"
  notice-hint:
    backgroundColor: "{colors.hint-soft}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "12px 16px"
  toast:
    backgroundColor: "{colors.surface-inverse}"
    textColor: "{colors.on-inverse}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    height: "52px"
  progress-bar:
    backgroundColor: "{colors.surface-sunken}"
    rounded: "{rounded.pill}"
    height: "6px"
---

<!-- MOMENTAUFNAHME aus `/impeccable document` (Scan-Modus) über apps/mobile/src/design/tokens.ts, Ticket #95. Nicht maßgeblich: Maßgeblich sind research/design-system.md und die Token-Datei der App. Ob diese Datei research/design-system.md ablöst, entscheidet der Nutzer (Empfehlung im Pull Request zu #95). -->

# Design System: Gemeinsam leichter

## Overview

**Creative North Star: „Lagune – wie aus Momos Insel geschnitzt“**

Sonnig, verspielt, aber erwachsen. Die App ist aus demselben Material wie die Insel: Sand als Grund, Lagune für alles Eigene und jede Hauptaktion, Sonne für den Partner, Gold für Energie. Karten und Buttons stehen auf einer Sockelkante wie Inselfelder und sinken beim Drücken ein; weiche Schatten gibt es nur für Schwebendes.

Verspielt ist das Detail, nicht das Ganze: Illustration, Federn und Funken gehören Momo und der Insel. Die Bedienoberfläche bleibt ruhig, groß und eindeutig, mit einer Hauptaktion je Bildschirm. Die beschreibende Sprache stammt aus dem bestätigten Leitbild in research/design-system.md (Richtung A · Lagune, gewählt am 14.10.2026), nicht aus einer neuen Befragung.

**Key Characteristics:**
- Farbe = Person (`self`, `partner`); Kategorien erkennt man an Icon und Name, nicht an eigenen Farben.
- Kein Fehler-Rot für Ziele; `problem` nur für Technik und ungültige Eingaben.
- Rubik in vier Schnitten, tabellarische Ziffern für Werte.
- Sockelkante ohne Unschärfe; Drücken senkt das Element, statt es aufblitzen zu lassen.
- Bedeutung immer doppelt: Symbol und Wort, nie nur Farbe.

## Colors

Warmer Sand mit einem kräftigen Lagunenton als einziger Aktionsfarbe und Sonne als zweiter Personenfarbe; Gold bleibt dem Energie-Symbol vorbehalten.

### Primary
- **Lagune** (`primary`): Hauptaktion, Fokus, aktiver Tab, Links; als Text auf Karte, Sand und `primary-soft`.
- **Lagune hell** (`self`): alles Eigene in Grafiken, Balken und Ringen.

### Secondary
- **Sonne** (`partner`): alles vom Partner; Rahmen antwortbedürftiger Karten. Nie als Vergleich neben eigenen Werten.

### Tertiary
- **Gold** (`energy`, Kontur `energy-edge`): nur die Füllung des Energie-Symbols, nie Text.

### Neutral
- **Sand** (`surface-base`), **Karte** (`surface-card`), **Mulde** (`surface-sunken`), **Tinte** (`ink`), **Tinte gedämpft** (`ink-muted`), **Sockel** (`plinth`), **Linie** (`line`, nur dekorativ) und **Linie kräftig** (`line-strong`, Rahmen von Bedienelementen).

Aliase (in der Frontmatter weggelassen, weil Primitive sich nicht referenzieren dürfen):
- `focus` → `primary` (#0B7470)
- `tracker-calories` → `self` (#0E8580)
- `tracker-water` → `self` (#0E8580)
- `tracker-sport` → `self` (#0E8580)
- `chart-day` → `ink-muted` (#55625E)
- `chart-trend` → `self` (#0E8580)
- `chart-goal` → `neutral` (#66625A)
- `chart-grid` → `line` (#EAD9BC)
- `momo-frond` → `momo-cheek` (#F48C73)
- `momo-stage` → `primary-soft` (#DDF0EE)

### Named Rules
**The Farbe-ist-Person Rule.** Eigenes in `self`, Partner in `partner`; nie zwei vergleichbare Werte beider nebeneinander.
**The Kein-Rot Rule.** Offene oder überschrittene Gesundheitsziele bleiben `neutral`. Ein `problem`-Hinweis verlangt im Code seinen Anlass (`technik` oder `ungueltige_eingabe`).
**The Energie-ist-ein-Symbol Rule.** Energie erscheint als goldener Funke mit Kontur; die Zahl daneben steht in `ink`. Die Textfarben-Union der App kennt `energy` nicht.

## Typography

**Display Font:** Rubik · **Body Font:** Rubik

**Character:** Eine leicht gerundete Grotesk für Text und Zahlen; die Verspieltheit liegt in Momo und Insel, nicht in der Schrift.

Rollen und Größen stehen in der Frontmatter. `display` einmal je Bildschirm, höchstens drei Größen je Karte. Jeder Stil setzt eine eigene Rubik-Familie (`Rubik_400Regular` bis `Rubik_700Bold`) statt `fontWeight`, weil Android den Schnitt über die Familie wählt.

### Named Rules
**The Mitwachsen Rule.** Jeder Text skaliert mit der Systemschrift bis Faktor 2,0; `number-xl` ist auf 1,4 und `tab-label` auf 1,3 begrenzt. Textcontainer haben nie eine feste Höhe.

## Layout

4-dp-Raster. Bildschirmrand, Kartenabstand und Karteninnenabstand `space-4`, Elemente in Karten `space-3`, eng Verwandtes `space-2`, Sheets `space-5`, Abschnitte `space-6`. Ab Schriftfaktor 1,3 (`useLargeTextLayout()`) stapeln sich Mini-Tracker, Momo-Bereich und Partner-Zusammenfassungen; eine Komponente darf früher umbrechen, wenn sonst Inhalt abgeschnitten würde. Jedes Bedienelement hat mindestens 48 × 48 dp Trefferfläche; Chips (36) und kompakte Buttons (44) erweitern sie mit `hitSlop`.

## Elevation & Depth

Hybrid: Ruhende Flächen stehen auf einer Sockelkante ohne Unschärfe. Drücken senkt das Element um genau so viel, wie die Kante schrumpft (Karte und Primär-Button 4 → 1 dp, Sekundär-Button 3 → 1 dp), sodass die Unterkante stehen bleibt. Weiche Schatten tragen nur ＋, Sheets, Tab-Leiste und Meldung. In React Native übersetzt ein einziger Adapter (`boxShadow` in `elevation.ts`) die Web-Syntax in `BoxShadowValue`; liegt die Kante auf einem Gerät oben, wird nur dort die Richtung korrigiert.

### Shadow Vocabulary
- **elevation-card** (`0 4px 0 0 #E4D2B0`)
- **elevation-card-pressed** (`0 1px 0 0 #E4D2B0`)
- **elevation-button** (`0 4px 0 0 #085B58`)
- **elevation-button-pressed** (`0 1px 0 0 #085B58`)
- **elevation-button-soft** (`0 3px 0 0 #C6E6E2`)
- **elevation-button-soft-pressed** (`0 1px 0 0 #C6E6E2`)
- **elevation-floating** (`0 4px 0 0 #085B58, 0 10px 20px -6px #1D333240`)
- **elevation-sheet** (`0 -1px 0 0 #EAD9BC, 0 -10px 30px -10px #1D333233`)
- **elevation-toast** (`0 4px 0 0 #0E1F1E, 0 12px 24px -10px #1D333259`)
- **focus-ring** (`0 0 0 2px #FFFCF6, 0 0 0 5px #0B7470`)

### Named Rules
**The Sockel Rule.** Licht kommt von links oben, Kanten liegen unten, ohne Unschärfe. Kein Glas, keine Verläufe, keine kühlen grauen Schatten.

## Shapes

Weich und groß: Karten `radius-lg` (24), Bedienelemente, Hinweise und Zeilen in Karten `radius-md` (16), Buttons, Chips, Balken und Avatare als Pille, obere Sheet-Ecken `radius-xl` (28). Innere Radien sind kleiner als äußere. Icons sind Linien auf 24er Raster mit 2-dp-Strich und runden Enden; einzige gefüllte Form ist der Energie-Funke.

## Components

Gebrandet (React Native `StyleSheet`, nur Tokens): `Text`, `Icon`/`EnergySymbol`, `Button`/`IconButton`, `Chip`, `Card`, `Notice` (Hinweis), `ListRow`/`ListGroup`, `Toast` (Meldung), `ProgressBar`, `Skeleton`. Über `@expo/ui` kommen nur `Sheet`, `Switch`, `DateTimePicker` und `ContextMenu`, je als kleine Hülle in `design/native/`. Tab-Leiste, Kalorienring, Levelbalken, Tagesziel, Mini-Tracker, Gewichtsverlauf, Eingabefeld und Leerzustand folgen mit ihren Bereichen.

### Buttons
- **Shape:** Pille (`radius-pill`), 52 dp hoch, kompakt 44 dp.
- **Primary:** `primary` mit `on-primary`, Sockel `elevation-button`; gedrückt `primary-pressed`, 3 dp tiefer.
- **Secondary:** `primary-soft` mit `primary`, Sockel `elevation-button-soft`; gedrückt `primary-soft-pressed`, Text `primary-pressed`, 2 dp tiefer.
- **Text:** ohne Fläche, Text `primary`; gedrückt `primary-soft`.
- **Disabled / Loading:** `fill-disabled` mit `ink-disabled`, keine Kante; Laden zeigt drei Punkte bei gleicher Breite und meldet „beschäftigt“.

### Chips
- **Style:** `surface-card`, Rahmen 1,5 dp `line-strong`, Beschriftung `label`.
- **State:** ausgewählt `primary-soft`, 2-dp-Rahmen `primary`, Text `primary` und Häkchen; gedrückt `surface-sunken`; deaktiviert `fill-disabled`. Rollen: Radio, Checkbox oder Button.

### Cards / Containers
- **Corner Style:** `radius-lg`.
- **Background:** `surface-card` auf `surface-base`.
- **Shadow Strategy:** `elevation-card`, antippbar gedrückt `elevation-card-pressed`.
- **Border:** antwortbedürftig 2 dp `partner`; leer 2 dp `line` ohne Fläche.
- **Internal Padding:** `space-4`.

### Hinweis
Icon in der Zustandsfarbe, Satz in `ink` auf der `*-soft`-Fläche des Tons (Partner, Hinweis, Neutral, Erfolg, Problem), höchstens eine Text-Aktion.

### Meldung
`surface-inverse` mit `on-inverse`, `elevation-toast`, optional zweite Zeile mit Energie-Funke und „Rückgängig“ mit Icon.

## Do's and Don'ts

### Do:
- **Do** eine Primäraktion je Bildschirm in `primary`.
- **Do** jeden Zustand mit Symbol und Wort zeigen (Häkchen + „erreicht“, Mond + „am Tagesende“).
- **Do** Trefferflächen von mindestens 48 dp, kleinere sichtbare Elemente mit `hitSlop`.
- **Do** bei „Bewegung reduzieren“ Federn und Hüpfer durch kurze Überblendungen (`duration-fast`) ersetzen.

### Don't:
- **Don't** Rot, Kreuz oder „verfehlt“ bei Gesundheitszielen.
- **Don't** rohe Farbwerte außerhalb der Token-Datei (Lint-Regel `abnehm/token-farben`).
- **Don't** Glas, Verläufe oder kühle graue Schatten.
- **Don't** Konfetti über den ganzen Bildschirm; Funken gehören Momo.
