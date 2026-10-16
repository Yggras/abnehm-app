---
name: Gemeinsam leichter
description: "Design-System Lagune, helle Fassung (Momentaufnahme für Ticket #91)"
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
    height: "52px"
  button-primary-pressed:
    backgroundColor: "{colors.primary-pressed}"
    textColor: "{colors.on-primary}"
  button-secondary:
    backgroundColor: "{colors.primary-soft}"
    textColor: "{colors.primary}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    height: "52px"
  button-compact:
    backgroundColor: "{colors.primary-soft}"
    textColor: "{colors.primary}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    height: "44px"
  chip:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    height: "36px"
  card:
    backgroundColor: "{colors.surface-card}"
    rounded: "{rounded.lg}"
    padding: "{spacing.4}"
  input:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    height: "52px"
  toast:
    backgroundColor: "{colors.surface-inverse}"
    textColor: "{colors.on-inverse}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
  tab-bar:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.ink-muted}"
    typography: "{typography.tab-label}"
  plus-button:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.pill}"
    size: "56px"
---

<!-- MOMENTAUFNAHME für Ticket #91, nicht maßgeblich. Maßgeblich bleibt research/design-system.md (und mit der Umsetzung die Token-Datei der App). Erzeugt aus tokens.json der Artifact-Version 1792094930-af8a. -->

# Design System: Gemeinsam leichter

## Overview

**Creative North Star: „Lagune – wie aus Momos Insel geschnitzt“**

Sonnig, verspielt, aber erwachsen. Die App ist aus demselben Material wie die Insel: Sand als Grund, Lagune für alles Eigene und jede Hauptaktion, Sonne für den Partner, Gold für Energie. Karten stehen auf einer Sockelkante wie Inselfelder, nicht auf weichen Schatten. Die Sprache stammt aus dem Leitbild des Artifacts (`project/README.md`), nicht aus einer neuen Befragung.

**Key Characteristics:**
- Farbe = Person (`self`, `partner`), Kategorien nur über Icon und Name.
- Kein Fehler-Rot für Ziele; `problem` nur für Technik und ungültige Eingaben.
- Rubik in vier Schnitten, tabellarische Ziffern für Werte.
- Sockelkante ohne Unschärfe; weiche Schatten nur für Schwebendes.

## Colors

Warmer Sand mit einem kräftigen Lagunenton als einziger Aktionsfarbe, Sonne als zweite Personenfarbe.

### Primary
- **Lagune** (#0B7470): Hauptaktion, Fokus, aktiver Tab.
- **Lagune hell** (#0E8580): alles Eigene in Grafiken.

### Secondary
- **Sonne** (#C9662B): alles vom Partner.

### Tertiary
- **Gold** (#F2B33D, Kontur #8C5A00): nur das Energie-Symbol, nie Text.

### Neutral
- **Sand** (#FBF4E6), **Karte** (#FFFCF6), **Mulde** (#F4EBDA), **Tinte** (#1D3332).

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
**The Kein-Rot Rule.** Offene oder überschrittene Gesundheitsziele bleiben `neutral`.

## Typography

**Display Font:** Rubik · **Body Font:** Rubik

**Character:** Eine leicht gerundete Grotesk für Text und Zahlen; die Verspieltheit liegt in Momo und Insel, nicht in der Schrift.

Rollen und Größen stehen in der Frontmatter. `display` einmal je Bildschirm, höchstens drei Größen je Karte.

## Layout

4-dp-Raster; Rand, Kartenabstand und Karteninnenabstand `space-4`, Elemente in Karten `space-3`, Sheets `space-5`. Ab Schriftfaktor 1,3 stapeln sich Mini-Tracker, Momo-Bereich und Partner-Zusammenfassungen.

## Elevation & Depth

Hybrid: Ruhende Flächen zeigen eine Sockelkante ohne Unschärfe; Drücken senkt das Element um 3 dp und verkürzt die Kante. Weiche Schatten tragen nur ＋, Sheets, Tab-Leiste und Meldung.

### Shadow Vocabulary
- **elevation-card** (`0 4px 0 0 #E4D2B0`): Karte in Ruhe: Sockelkante in plinth, ohne Unschärfe.
- **elevation-card-pressed** (`0 1px 0 0 #E4D2B0`): Antippbare Karte gedrückt; zusammen mit 3 dp Verschiebung nach unten.
- **elevation-button** (`0 4px 0 0 #085B58`): Primär-Button und ＋ in Ruhe: Sockel in primary-pressed.
- **elevation-button-pressed** (`0 1px 0 0 #085B58`): Primär-Button gedrückt (3 dp nach unten).
- **elevation-button-soft** (`0 3px 0 0 #C6E6E2`): Sekundär-Button und Mini-Tracker-Aktion in Ruhe.
- **elevation-button-soft-pressed** (`0 1px 0 0 #C6E6E2`): Sekundär-Button gedrückt (2 dp nach unten).
- **elevation-floating** (`0 4px 0 0 #085B58, 0 10px 20px -6px #1D333240`): ＋ in der Tab-Leiste: Sockel plus weicher Schatten, weil er über der Leiste schwebt.
- **elevation-sheet** (`0 -1px 0 0 #EAD9BC, 0 -10px 30px -10px #1D333233`): Sheets und Tab-Leiste: Kante nach oben.
- **elevation-toast** (`0 4px 0 0 #0E1F1E, 0 12px 24px -10px #1D333259`): Meldung mit „Rückgängig“.
- **focus-ring** (`0 0 0 2px #FFFCF6, 0 0 0 5px #0B7470`): Fokusring: 2 dp Abstand in surface-card, dann 3 dp primary.

## Shapes

Weich und groß: Karten 24, Bedienelemente 16, Buttons, Chips und Levelbalken als Pille; innere Radien kleiner als äußere.

## Components

Gebrandet sind Button, Chip, Karte, Listenzeile, Tab-Leiste, Meldung, Hinweis, Kalorienring, Fortschritts- und Levelbalken, Tagesziel, Mini-Tracker, Gewichtsverlauf-Hülle, Eingabefeld und Leerzustand. Über `@expo/ui` kommen nur Sheet-Container, Schalter, Datum-/Uhrzeit-Picker und Kontextmenüs. Varianten und Zustände: Komponenten-READMEs im Artifact bzw. `research/design-system.md` › Komponenten.

Bewegung (Sidecar-Inhalt, hier nur zum Nachschlagen):
- **duration-instant** (90ms): Drücken: Sockel sinkt, Farbe wechselt.
- **duration-fast** (150ms): Kleine Zustandswechsel: Chip auswählen, Häkchen erscheint.
- **duration-base** (240ms): Standard-Übergänge, Meldung ein- und ausblenden, Balken wächst.
- **duration-slow** (400ms): Ring und Levelbalken füllen sich, Sheet öffnet.
- **duration-celebrate** (1200ms): Tagesbonus und Levelaufstieg: Momo-Reaktion und Funken.
- **easing-standard** (cubic-bezier(0.2, 0, 0, 1)): Standardkurve für Bewegung innerhalb eines Bildschirms.
- **easing-enter** (cubic-bezier(0, 0, 0, 1)): Elemente erscheinen (Meldung, Sheet).
- **easing-exit** (cubic-bezier(0.3, 0, 1, 1)): Elemente verschwinden.

## Do's and Don'ts

### Do:
- **Do** eine Primäraktion je Bildschirm in `primary`.
- **Do** jeden Zustand mit Symbol und Wort zeigen.
- **Do** Trefferflächen von mindestens 48 dp, kleinere sichtbare Elemente mit `hitSlop`.

### Don't:
- **Don't** Rot, Kreuz oder „verfehlt“ bei Gesundheitszielen.
- **Don't** Glas, Verläufe oder kühle graue Schatten.
- **Don't** Konfetti über den ganzen Bildschirm.
