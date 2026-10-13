# Recherche: UI-Bibliothek, State-Management und Test-Setup für Expo

Ticket: [#39](https://github.com/Yggras/abnehm-app/issues/39) · Stand: 11.10.2026 · Versionen, Release-Daten, Lizenzen und npm-Downloads (Woche 04.–10.10.2026) am 11.10.2026 über die öffentlichen APIs von npm abgerufen, GitHub-Sterne und letzter Push über die GitHub-API [2][3].

Quellen-Nummern in eckigen Klammern [n] verweisen auf die Liste am Ende. Mit *eigene Einschätzung* markierte Stellen sind Bewertungen ohne Quelle. Nicht Belegbares ist als „nicht belegt“ gekennzeichnet.

Rahmen aus der Karte [#1](https://github.com/Yggras/abnehm-app/issues/1): Expo SDK 57, Expo Router, TypeScript strict, expo-sqlite + Drizzle, Inselansicht voraussichtlich mit Skia + Reanimated + Gesture Handler (Recherche #29), Backend Hono + Drizzle + Postgres.

## Zusammenfassung

- **Ausgangslage SDK 57:** `expo` 57.0.27 bündelt React Native 0.86.3, React 19.2.3, Reanimated 4.5.1, Worklets 0.10.1, Gesture Handler 2.32, Skia 2.6.2, `expo-sqlite` 57.0.4, `@expo/ui` 57.0.22 und `jest-expo` 57.0.5 [1]. Ab SDK 55 läuft Expo nur noch mit der New Architecture. Sie lässt sich nicht abschalten [13]. Reine JS-Bibliotheken (Zustand, TanStack Query, Zod …) sind davon nicht betroffen (*eigene Einschätzung*). Kritisch sind Bibliotheken mit nativem Code (Unistyles, Uniwind Pro, Komponentenbibliotheken).
- **Styling – was Expo sagt:** Die Expo-Doku nennt für Tailwind auf iOS/Android **NativeWind oder Uniwind** [4]. Gleichzeitig schreibt Expos eigener Agent-Skill `expo-native-ui` vor: Inline-Styles, „CSS and Tailwind are not supported“ [7]. Der Skill `expo-ui` lässt Agenten für Sheets, Picker, Slider, Switches und Menüs **zuerst `@expo/ui`** nehmen (echtes SwiftUI/Jetpack Compose) [6][9][12].
- **NativeWind:** Stabil ist v4.2.7. Diese Version unterstützt SDK 57, nutzt aber noch Tailwind v3 und ein Babel-Preset. v5 ist seit dem 13.09.2026 Release Candidate [2][14][15]. **Uniwind** (Tailwind v4, MIT) ist laut Hersteller 2× schneller als NativeWind (nicht unabhängig belegt). Die kostenlose Version kann keine Reanimated-Animationen über `className` [17][18].
- **State – drei Schichten:** (1) Lokale Daten liegen in SQLite. Drizzles `useLiveQuery` rendert bei Datenänderungen automatisch neu [25][26]. (2) Server-Daten: **TanStack Query** v5 (65,9 Mio. Downloads/Woche). Expos Skill `expo-data-fetching` empfiehlt es für komplexe Apps [2][10]. (3) Reiner UI-/App-Zustand: **Zustand** v5 (62,2 Mio./Woche, 58,8k Sterne). Persistenz ist über eine eigene Storage-Anbindung möglich, z. B. `expo-sqlite/kv-store` [2][3][25][27]. Formulare: React Hook Form + Zod. Zod lässt sich auch im Hono-Backend nutzen [32][33].
- **Legend-State scheidet aus:** Der npm-`latest`-Stand ist 2.1.15 vom 30.08.2024. v3 ist seit 2024 im Beta-Stadium (aktuell 3.0.0-beta.48 vom 12.07.2026) [2][29]. **Jotai** hat am 08.09.2026 v3 veröffentlicht. Am 29.09.2026 folgte ein Regressions-Fix [28].
- **Tests:** `jest-expo` + React Native Testing Library (RNTL) v14 + `expo-router/testing-library` sind der dokumentierte Expo-Weg [34][35]. **Wichtig:** `jest-expo` 57 hängt an **Jest 29**. Jest 30 bricht beim Laden ab. Erst `jest-expo` 58 wechselt auf Jest 30 [2][36]. RNTL v14 hat eine asynchrone API und eine eigene Seite mit Richtlinien für LLMs [37]. Reanimated und Skia liefern eigene Jest-Setups [38][39].
- **E2E:** **Maestro** ist der von Expo dokumentierte Weg, inkl. fertiger EAS-Workflow-Jobs [40][41]. Detox unterstützt Expo laut eigener Doku nicht offiziell. Das Expo-Tutorial, auf das Detox verweist, leitet inzwischen auf die Maestro-Anleitung weiter [42][43].
- **Vorschlag (Entscheidung beim Nutzer):** Styling mit **`StyleSheet` + eigenen Design-Tokens + `@expo/ui`**, Plan B **Uniwind**. State mit **Drizzle `useLiveQuery` + TanStack Query + Zustand**, Formulare mit **React Hook Form + Zod**. Tests mit **Jest 29 + `jest-expo` + RNTL v14**, E2E mit **Maestro**. Begründung siehe Abschnitt „Empfehlung“.

## 1. UI und Styling

### Kandidaten

**a) `StyleSheet` / Inline-Styles von React Native + eigene Design-Tokens (ohne Zusatzbibliothek)**
- Keine zusätzliche Abhängigkeit. Laut Expo-Skill `expo-design-system` ist `constants/Colors.ts` die Vorgabe von `create-expo-app` für Tokens [8].
- Expos Agent-Skills arbeiten genau so. `expo-native-ui` verlangt Inline-Styles (oder `StyleSheet.create` bei Wiederverwendung) und erklärt CSS/Tailwind für nicht unterstützt [7]. `expo-design-system` beschreibt einen Token-Aufbau (Farbe, Abstand, Typografie, Radius, Schatten, Bewegung) und verbietet ein zweites Styling-System neben einem bestehenden [8].
- Für helle und dunkle Farben gibt es die `Color`-API aus `expo-router` mit semantischen Systemfarben (iOS UIKit, Android Material 3) [7]. Den Modus legt `userInterfaceStyle` in der App-Config fest [45].

**b) Tailwind über NativeWind**
- `nativewind` 4.2.7 vom 14.09.2026, MIT, 1,93 Mio. Downloads/Woche, 8.109 Sterne, letzter Push 15.09.2026 [2][3].
- v4.2.7 „adds Expo SDK 57 support“. Die Version nutzt Tailwind CSS **v3**, ein Babel-Preset und `withNativeWind`. Auf SDK 57 werden `react-native-worklets` und Reanimated 4 mitinstalliert [14].
- v5 (`5.0.0-rc.0`, 13.09.2026) baut auf `react-native-css` und Tailwind v4 auf. Laut Doku bleibt v4 die stabile Version [2][15]. Expos offizielles Beispiel `with-tailwindcss` (SDK 57) nutzt bereits `nativewind` **5.0.0-preview.2** mit einem Nightly-Build von `react-native-css` [21].
- Die Doku ist auch als `llms.txt` bzw. Markdown abrufbar [16].

**c) Tailwind über Uniwind**
- `uniwind` 1.12.2 vom 05.10.2026, 1,03 Mio. Downloads/Woche, 1.729 Sterne, letzter Push 09.10.2026 [2][3].
- Unterstützt Tailwind v4 vollständig, kommt ohne Babel-Preset aus und läuft mit Expo [17][19]. Die Doku nennt „2x faster than NativeWind“. Das ist eine Herstellerangabe (unabhängig nicht belegt) [17].
- Zwei Versionen: **Free** (MIT, läuft in Expo Go) und **Pro** (kommerziell, C++-Engine von Unistyles, braucht einen Development Build). Nur Pro animiert `className` über Reanimated 4. In der Free-Version muss man für Animationen `style` verwenden [18].
- Es gibt ein offizielles Expo-Beispiel `with-router-uniwind` (SDK 57, `uniwind ~1.0.0`) [21]. Uniwind bietet Agent-Skills und eine Migrationsanleitung von NativeWind an [17].

**d) Unistyles 3 (StyleSheet-Ersatz mit Themes/Varianten)**
- `react-native-unistyles` 3.5.2 vom 09.10.2026, 228k Downloads/Woche, 2.966 Sterne [2][3].
- Voraussetzungen: New Architecture, React Native 0.81+, Expo SDK 54+, **nur Development Builds, kein Expo Go**. Baut auf Nitro Modules auf (`react-native-nitro-modules` ≥ 0.37.1 ab Unistyles 3.4). Bringt eigene Agent-Skills mit [20].

**Komponentenbibliotheken (nur kurz betrachtet)**
- **`@expo/ui`** (Teil des SDK, in Expo Go enthalten): native SwiftUI-/Jetpack-Compose-Komponenten plus eine plattformübergreifende „Universal“-Ebene. Lässt sich mit RN-Komponenten und Skia mischen [12]. Laut Expo-Skill-Router läuft die Universal-Ebene ab SDK 56 [6].
- **React Native Paper** 5.15.3 (26.05.2026), Material Design, 448k Downloads/Woche, 14.468 Sterne, **500 offene Issues/PRs** [2][3].
- **HeroUI Native** 1.0.10 (21.09.2026), Apache-2.0, baut auf Uniwind/Tailwind auf (Peers: `tailwind-variants`, Reanimated, `@gorhom/bottom-sheet`) [2][22].
- **Tamagui** 3.0.3. v2.0.0 erschien am 23.05.2026, v3.0.0 am 10.10.2026, also zwei Major-Versionen in fünf Monaten [2]. **gluestack-ui** (`@gluestack-ui/core` 5.0.15, 25.06.2026, 95k/Woche) [2]. Beide wurden nicht vertieft geprüft.

### Vergleich UI/Styling

| Kriterium | StyleSheet + Tokens | NativeWind | Uniwind (Free) | Unistyles 3 |
|---|---|---|---|---|
| Aktuelle Version | Teil von RN 0.86 [1] | 4.2.7 stabil (14.09.2026); v5 RC [2][15] | 1.12.2 (05.10.2026) [2] | 3.5.2 (09.10.2026) [2] |
| Downloads/Woche · Sterne | – | 1,93 Mio. · 8.109 [2][3] | 1,03 Mio. · 1.729 [2][3] | 228k · 2.966 [2][3] |
| In Expo-Doku genannt | Grundlage aller Expo-Beispiele und Skills [7][34] | ja, Tailwind-Guide [4] | ja, Tailwind-Guide [4] | nur als „bestehende Bibliothek“ im Skill [8] |
| Expo-Beispiel SDK 57 | – | `with-tailwindcss` (v5-Preview) [21] | `with-router-uniwind` [21] | nicht gefunden |
| Expo Go | ja | ja (laut RN Directory) [23] | ja [18] | **nein**, nur Development Build [20] |
| Tailwind-Version | – | v3 (stabil), v4 erst mit v5 [14][15] | v4 [17] | – |
| Reanimated-Animation per Klasse | – (Animation über `style`) | Reanimated ist Pflicht-Peer [14] | nur in Pro [18] | Reanimated ist Peer [2] |
| KI-Doku | Expo-Skills [7][8] | `llms.txt` [16] | `llms.txt` + Skills [17] | Agent-Skills im Repo [20] |
| Risiko | Tokens selbst pflegen (*eigene Einschätzung*) | Major-Wechsel v4→v5 steht bevor [15] | junges Projekt, Pro-Funktionen kostenpflichtig [18] | nativer Code, an Nitro-Versionen gebunden [20] |

**Zusammenspiel mit Skia/Reanimated (eigene Einschätzung):** Die Inselansicht zeichnet in einem Skia-`Canvas`. Farben und Formen kommen dort über Skia-Props, nicht über Styles oder `className` (vgl. Recherche #29 [46]). Eine Styling-Bibliothek hilft nur bei den normalen Screens (Tracker, Formulare, Listen). Animationen laufen ohnehin über Reanimated-`style`. Der fehlende `className`-Support für Animationen in Uniwind Free ist daher kein Ausschlussgrund.

## 2. State-Management

### Aufteilung (eigene Einschätzung)

Die App hat drei Arten von Zustand. Dafür braucht es unterschiedliche Werkzeuge:

1. **Lokale, persistente Daten** (Mahlzeiten, Wasser, Gewicht, Insel): `expo-sqlite` + Drizzle. Mit `enableChangeListener: true` und `useLiveQuery` rendern Komponenten bei Datenänderungen automatisch neu [25][26]. Ein zusätzlicher globaler Store für dieselben Daten wäre doppelte Datenhaltung.
2. **Server-Daten** (Partnerdaten, Sync, KI-Foto-Erkennung über das Hono-Backend): TanStack Query.
3. **Flüchtiger UI-/App-Zustand** (z. B. offene Sheets, Onboarding-Flag, Einstellungen): ein kleiner Client-Store.

### Kandidaten

**Server-State: TanStack Query** (`@tanstack/react-query` 5.104.1, 02.10.2026)
- 65,9 Mio. Downloads/Woche, 50.415 Sterne, letzter Push 11.10.2026 [2][3].
- Laut Doku „designed to work out of the box with React Native“. Für Online-Status und App-Fokus braucht es kleine Adapter: `onlineManager` (auch mit `expo-network`) und `focusManager` mit `AppState` [30].
- Laut eigener Beschreibung für **Server-State** gedacht, nicht für Client-State [31]. Netzwerkmodi (`online`, `always`, `offlineFirst`) regeln, was ohne Verbindung passiert. Ohne Netz werden Abfragen pausiert [31].
- Expos Skill `expo-data-fetching`: „Complex app -> React Query (TanStack Query)“ [10].
- Wer die Daten ohnehin lokal in SQLite hält, kann alternativ mit eigenen `fetch`-Aufrufen synchronisieren. Das hängt vom Offline-/Sync-Ticket ab (*eigene Einschätzung*).

**Client-State: Zustand** (`zustand` 5.0.15, 13.08.2026)
- 62,2 Mio. Downloads/Woche, 58.809 Sterne, 7 offene Issues/PRs, MIT. v5.0.0 erschien am 14.10.2024 [2][3].
- `persist`-Middleware mit frei wählbarem Storage über `createJSONStorage` [27]. `expo-sqlite/kv-store` ist laut Expo ein Drop-in-Ersatz für AsyncStorage mit zusätzlichen synchronen APIs [25]. Eine eigene AsyncStorage-Abhängigkeit ist damit nicht nötig.
- Doku als `llms.txt` [50]. Das offizielle Expo-Beispiel `with-zustand` ist zwar auf SDK 57 aktualisiert, pinnt aber noch `zustand ^3.6.7` [21]. Agenten sollten es deshalb nicht als Vorlage nehmen (*eigene Einschätzung*).

**Client-State: Jotai** (`jotai` 3.0.1, 29.09.2026)
- 6,7 Mio. Downloads/Woche, 21.291 Sterne [2][3]. v3.0.0 vom 08.09.2026 ist laut Release-Notes „mostly backward-compatible“ und entfernt Altlasten (u. a. Node 20). v3.0.1 behebt eine Regression in `useAtomValue` [28].
- Atom-Modell statt Store. Für den kleinen Rest-Zustand dieser App sehe ich keinen Vorteil gegenüber Zustand. Die frische Major-Version spricht eher dagegen (*eigene Einschätzung*).

**Client-State: Redux Toolkit** (`@reduxjs/toolkit` 2.13.0, 29.09.2026)
- 33,4 Mio. Downloads/Woche, 11.228 Sterne [2][3]. Laut Zustand-Doku ist das State-Modell ähnlich (immutabel), Redux braucht aber einen Provider um die App [27].
- Für zwei Nutzer und wenig globalen Zustand vermutlich überdimensioniert (*eigene Einschätzung*).

**Legend-State** (nicht empfohlen)
- npm-`latest` ist 2.1.15 vom 30.08.2024. Der `main`-Branch steht auf `3.0.0-beta.48` (12.07.2026). v3 ist also seit rund zwei Jahren Beta [2][29]. 223 offene Issues/PRs [3].
- Hat ein eingebautes Persistenz-Plugin für `expo-sqlite` und Sync-Plugins (u. a. Supabase, TanStack Query) [29]. Fachlich interessant, aber ohne stabile v3 für Agenten ein Risiko (*eigene Einschätzung*).

**Formulare: React Hook Form + Zod**
- `react-hook-form` 7.90.0 (11.10.2026), 54,5 Mio./Woche, 44.860 Sterne. `zod` 4.6.6 (11.10.2026), 341,7 Mio./Woche. `@hookform/resolvers` 5.9.1 unterstützt Zod `^3.25 || ^4` [2][3][32].
- Hono hat eine eigene Zod-Validator-Middleware (`@hono/zod-validator`). Über Hono-RPC kann der Client die Ein- und Ausgabetypen des Servers ableiten, wenn `strict: true` gesetzt ist [33]. Damit können App und Backend dieselben Zod-Schemas nutzen (*eigene Einschätzung*).

### Vergleich State

| Kriterium | TanStack Query | Zustand | Jotai | Redux Toolkit | Legend-State |
|---|---|---|---|---|---|
| Zweck | Server-State [31] | Client-State | Client-State | Client-State (+ RTK Query) | Client-State + Sync |
| Version (Datum) | 5.104.1 (02.10.2026) | 5.0.15 (13.08.2026) | 3.0.1 (29.09.2026) | 2.13.0 (29.09.2026) | 2.1.15 (30.08.2024), v3 Beta [2] |
| Downloads/Woche | 65,9 Mio. | 62,2 Mio. | 6,7 Mio. | 33,4 Mio. | 120k [2] |
| Sterne · offene Issues/PRs | 50.415 · 168 | 58.809 · 7 | 21.291 · 1 | 11.228 · 280 | 4.217 · 223 [3] |
| Expo-Bezug | im Expo-Skill empfohlen [10] | Expo-Beispiel (veraltet) [21] | – | – | Expo-Beispiel mit Supabase [21] |
| Persistenz lokal | über Persister (nicht vertieft) | `persist` + `expo-sqlite/kv-store` [25][27] | nicht vertieft | nicht vertieft | Plugin `expo-sqlite` [29] |

**Zusammenspiel mit Reanimated/Skia (eigene Einschätzung):** Animationswerte gehören in Reanimated-Shared-Values und nicht in einen React-Store, weil Skia-Animationsframes ohne React-Render auskommen (Recherche #29 [46]). Der Store liefert nur den fachlichen Zustand der Insel (z. B. gebaute Felder). Dieser kommt ohnehin aus SQLite (`useLiveQuery`).

## 3. Tests

### Unit- und Komponententests

**Jest + `jest-expo`**
- Laut Expo-Doku ein Jest-Preset, das „the native part of the Expo SDK“ mockt und den Großteil der Konfiguration übernimmt. Installation per `npx expo install jest-expo jest @types/jest --dev` [34].
- **Versionsfalle:** `jest-expo` 57.0.5 hängt von `babel-jest`, `@jest/globals` usw. in Version `^29.2.1` ab [2]. Mit Jest 30 schlägt das Laden fehl (`clearMocksOnScope is not a function`) [36]. Die Umstellung auf Jest 30 wurde am 02.10.2026 gemergt (PR #50427). `jest-expo` 58.0.9 (`next`) hängt dann an Jest `^30` [2][36]. Das Expo-Beispiel `with-maestro` (SDK 57) nutzt `jest ^29.2.1` [21]. **Für SDK 57 also Jest 29 pinnen.** Jest-npm-`latest` ist 30.5.2 [2].
- Downloads/Woche: `jest` 47,1 Mio., `jest-expo` 3,4 Mio. [2].

**React Native Testing Library (RNTL)**
- `@testing-library/react-native` 14.1.0 (08.10.2026), 4,3 Mio. Downloads/Woche, 3.420 Sterne, 8 offene Issues/PRs [2][3].
- Laut Expo-Doku der Ersatz für das veraltete `react-test-renderer` [34]. v14 verlangt React 19, RN 0.78+ und Node `^22.13 || >=24`. `render`, `fireEvent` und `act` sind jetzt **async**. Für die Migration gibt es Codemods [37]. Es gibt eine eigene Seite „LLM Guidelines for React Native Testing Library“ [37].
- `expo-router/testing-library` (`renderRouter`, Matcher wie `toHavePathname`) setzt RNTL ≥ 14 voraus. Testdateien gehören nicht in das `app`-Verzeichnis [35].

**Bibliotheksspezifische Jest-Setups**
- Reanimated: eigener Jest-Resolver (`react-native-reanimated/jest/resolver`), vorher das Worklets-Testing-Setup, Matcher `toHaveAnimatedStyle` [38].
- Skia: Mocks auf Basis der Web-Implementierung (CanvasKit). Dafür `testEnvironment: ".../jestEnv.js"` und `setupFilesAfterEnv: [".../jestSetup.js"]` setzen [39]. Die aktuelle Doku nutzt bereits den neuen Paketnamen `react-native-skia`. SDK 57 bündelt noch `@shopify/react-native-skia` [1][39]. Ob die Pfade unter `@shopify/react-native-skia/…` gleich lauten, ist **nicht belegt**.
- `expo-sqlite`/Drizzle: Im Expo-Repo gibt es seit Juni 2026 einen Mock auf Basis von `node:sqlite`. Er gehört aber zu den Tests des Pakets und ist im veröffentlichten Paket `expo-sqlite@57.0.4` nicht enthalten (Tarball geprüft) [47]. Datenbanklogik lässt sich daher am einfachsten mit einem Node-SQLite-Treiber testen, z. B. `better-sqlite3`, den Drizzle unterstützt [2]. Das ist eine *eigene Einschätzung*, nicht ausprobiert.

### E2E-Tests

**Maestro** (CLI `cli-2.11.0` vom 29.09.2026, Apache-2.0, 16.013 Sterne) [3][48]
- Die Expo-Doku hat eine eigene Anleitung „Run E2E tests on EAS Workflows with Maestro“. Ein Build-Profil `e2e-test` erzeugt APK bzw. Simulator-`.app`, dazu kommt ein fertiger Job-Typ `type: maestro` [40]. Es gibt ein offizielles Beispiel `with-maestro` [21] und ein EAS-Insights-Dashboard für Maestro [45].
- Laut Maestro-Doku: keine npm-Abhängigkeit in der App, Tests laufen gegen das fertige Binary. Zugriff per Text oder `testID`, kompatibel mit Expo Go, Development Builds und EAS Workflows [41]. Flows sind YAML-Dateien [40]. Doku als `llms.txt` [50].

**Detox** (`detox` 20.51.4 vom 16.06.2026, MIT, 12.035 Sterne, 473k Downloads/Woche) [2][3]
- Laut Detox-Doku ist Expo-Integration „entirely a community-driven effort“. Es gibt „no special support for Expo projects“ [42]. Das dort verlinkte Expo-Tutorial (`docs.expo.dev/build-reference/e2e-tests/`) leitet am 11.10.2026 auf die Maestro-Anleitung weiter [43].
- Braucht ein Jest-Test-Runner-Setup (Peer `jest`) und native Anpassungen [2]. Für dieses Projekt nicht empfohlen (*eigene Einschätzung*).

**TesterArmy `e2e`** (nur erwähnt): Expo listet unter „Testing“ eine Anleitung für dieses Open-Source-Framework. Es kombiniert exakte Schritte mit KI-„Agent Steps“. Für Agent Steps braucht es ein Modell-Abo oder einen API-Key [44][45]. Nicht vertieft geprüft.

### Vergleich Tests

| Ebene | Kandidat | Version | Expo-Doku | Bemerkung |
|---|---|---|---|---|
| Runner | Jest 29 + `jest-expo` 57 | `jest-expo` 57.0.5 [2] | Standardweg [34] | Jest 30 erst mit SDK 58 [36] |
| Komponenten | RNTL v14 | 14.1.0 [2] | empfohlen [34], Pflicht für Router-Tests [35] | async API, LLM-Guidelines [37] |
| Navigation | `expo-router/testing-library` | Teil von `expo-router` | [35] | In-Memory-Router |
| E2E | Maestro | cli-2.11.0 [48] | Anleitung + EAS-Job [40] | YAML, keine App-Abhängigkeit [41] |
| E2E | Detox | 20.51.4 [2] | keine eigene Anleitung mehr [43] | Expo nur Community-Support [42] |

## Eignung für die Umsetzung durch KI-Agenten

- Expo liefert offizielle Agent-Skills (u. a. `expo-native-ui`, `expo-ui`, `expo-design-system`, `expo-data-fetching`, `expo-animation`) und einen MCP-Server [5][49]. Wer gegen die Skills arbeitet (Inline-Styles/`StyleSheet`, `@expo/ui`, React Query), hat weniger Reibung (*eigene Einschätzung*).
- **Widerspruch in den Expo-Skills:** Der Router-Skill `expo-overview` verweist auf einen Skill `expo-tailwind-setup` [6]. Im Repo `expo/skills` gab es diesen am 11.10.2026 nicht [11]. `expo-native-ui` erklärt Tailwind zugleich für nicht unterstützt [7]. Wer Tailwind wählt, muss diese Regel in `AGENTS.md` ausdrücklich überschreiben (*eigene Einschätzung*).
- `llms.txt` bzw. Markdown-Doku gibt es für Expo, NativeWind, Uniwind, Zustand, TanStack, Drizzle, Reanimated, Maestro und RNTL [16][17][45][50][37]. Für Jotai lieferte `jotai.org/llms.txt` am 11.10.2026 HTTP 404 (abgerufen).

## Empfehlung (Vorschlag – die Entscheidung liegt beim Nutzer)

**UI/Styling: `StyleSheet`/Inline-Styles + Design-Tokens (`src/theme/`) + `@expo/ui` für native Bedienelemente.**
- Keine zusätzliche Build-Schicht (Babel-Preset/Metro-Plugin), läuft mit New Architecture und Expo Go [1][12].
- Passt zu Expos eigenen Agent-Skills, die Agenten ohnehin laden [6][7][8][9].
- Die Inselansicht (Skia) profitiert nicht von Tailwind (*eigene Einschätzung*).
- **Plan B: Uniwind (Free)**, falls Tailwind-Klassen gewünscht sind: Tailwind v4, MIT, Expo-Beispiel für SDK 57, Agent-Skills [17][18][21]. NativeWind erst nach dem stabilen v5-Release erneut prüfen, um den Wechsel von Tailwind v3 auf v4 nicht mitten im Projekt zu machen [14][15].

**State: Drizzle `useLiveQuery` (lokale Daten) + TanStack Query v5 (Server) + Zustand v5 (UI-Rest, persistiert über `expo-sqlite/kv-store`). Formulare: React Hook Form + Zod, Schemas gemeinsam mit dem Hono-Backend.**
- Alle Bausteine sind verbreitet, aktiv gepflegt, als reines JS unabhängig von der New Architecture und in Expo-Doku oder -Skills genannt [2][3][10][25][26][27][32][33].

**Tests: Jest 29 + `jest-expo` 57 + RNTL v14 + `expo-router/testing-library`. Reanimated- und Skia-Jest-Setups nach Herstellerdoku. E2E mit Maestro, lokal und später optional als EAS-Workflow.**
- Das ist der dokumentierte Expo-Weg [34][35][40]. Beim Upgrade auf SDK 58 auf Jest 30 wechseln [36].

## Offene bzw. nicht belegbare Punkte

- **Performance-Angaben** („2x faster“ bei Uniwind, „under 0.1 ms“ bei Unistyles) sind Herstellerangaben. Unabhängige Benchmarks wurden nicht gesucht (nicht belegt) [17][20].
- **Reifegrad von `@expo/ui`:** Die hohe Downloadzahl (5,2 Mio./Woche) lässt sich nicht von transitiven Installationen trennen [2]. Wie vollständig die Universal-Komponenten für Formulare dieser App sind, wurde nicht geprüft.
- **Skia-Jest-Pfade** für das gebündelte `@shopify/react-native-skia` 2.6.2 sind nicht belegt [39].
- **Drizzle-Tests in Jest** (Node-Treiber statt `expo-sqlite`) wurden nicht ausprobiert. Die Drizzle-Anleitung für Expo installiert aktuell `drizzle-orm@rc` und `expo-sqlite@next` [26]. Welche Drizzle-Version zu SDK 57 passt, gehört zum Datenmodell-Ticket.
- **Offline/Sync:** Ob TanStack Query überhaupt nötig ist oder eigene Sync-Logik über SQLite reicht, hängt vom Offline-Ticket der Karte ab.
- **Kosten von Maestro auf EAS Workflows** wurden nicht geprüft. Lokal läuft die Maestro-CLI ohne Konto [40][41].
- **NativeWind v5:** Termin für die stabile Version nicht belegt.

## Quellen

1. Expo SDK 57, `bundledNativeModules.json` (`expo@57.0.27`): https://unpkg.com/expo@57.0.27/bundledNativeModules.json *(Expo/npm)*
2. npm-Registry (Versionen, Release-Daten, Lizenzen, Peer-Dependencies, Dependencies von `jest-expo` 57.0.5/58.0.9): `https://registry.npmjs.org/<paket>`; Downloads: `https://api.npmjs.org/downloads/point/2026-10-04:2026-10-10/<paket>` (abgerufen 11.10.2026) *(npm)*
3. GitHub-REST-API (Sterne, offene Issues/PRs, letzter Push): `https://api.github.com/repos/<owner>/<repo>` (abgerufen 11.10.2026) *(GitHub)*
4. Expo-Doku „Tailwind CSS“: https://docs.expo.dev/guides/tailwind/ *(Doku)*
5. Expo-Doku „Expo Skills“: https://docs.expo.dev/skills/ *(Doku)*
6. Expo-Skill `expo-overview`: https://github.com/expo/skills/blob/main/plugins/expo/skills/expo-overview/SKILL.md *(Expo)*
7. Expo-Skill `expo-native-ui` (Abschnitt Styling): https://github.com/expo/skills/blob/main/plugins/expo/skills/expo-native-ui/SKILL.md *(Expo)*
8. Expo-Skill `expo-design-system`: https://github.com/expo/skills/blob/main/plugins/expo/skills/expo-design-system/SKILL.md *(Expo)*
9. Expo-Skill `expo-ui`: https://github.com/expo/skills/blob/main/plugins/expo/skills/expo-ui/SKILL.md *(Expo)*
10. Expo-Skill `expo-data-fetching`: https://github.com/expo/skills/blob/main/plugins/expo/skills/expo-data-fetching/SKILL.md *(Expo)*
11. Verzeichnis der Expo-Skills (kein `expo-tailwind-setup`, abgerufen 11.10.2026): https://github.com/expo/skills/tree/main/plugins/expo/skills *(Expo)*
12. Expo-Doku `@expo/ui`: https://docs.expo.dev/versions/latest/sdk/ui/ *(Doku)*
13. Expo-Doku „React Native's New Architecture“: https://docs.expo.dev/guides/new-architecture/ *(Doku)*
14. NativeWind-Installation (v4.2.7): https://www.nativewind.dev/docs/getting-started/installation *(Doku)*
15. NativeWind-v5-Installation (RC0): https://www.nativewind.dev/v5/getting-started/installation *(Doku)*
16. NativeWind `llms.txt`: https://www.nativewind.dev/llms.txt *(Doku)*
17. Uniwind `llms.txt` / Einführung: https://docs.uniwind.dev/llms.txt, https://docs.uniwind.dev/ *(Doku)*
18. Uniwind „Pro Version“ (Vergleich Free/Pro): https://docs.uniwind.dev/pro-version *(Doku)*
19. Uniwind „Quickstart“: https://docs.uniwind.dev/quickstart *(Doku)*
20. Unistyles README (Voraussetzungen, Nitro-Versionen, Skills): https://github.com/jpudysz/react-native-unistyles *(GitHub)*
21. Expo-Beispiele (`package.json` von `with-tailwindcss`, `with-router-uniwind`, `with-zustand`, `with-maestro`; Liste inkl. `with-legend-state-supabase`): https://github.com/expo/examples *(Expo)*
22. HeroUI Native README: https://github.com/heroui-inc/heroui-native *(GitHub)*
23. React Native Directory API (Expo-Go-/New-Arch-Flags): https://reactnative.directory/api/libraries?search=nativewind *(RN Directory)*
24. Expo-Doku „Store data“: https://docs.expo.dev/develop/user-interface/store-data/ *(Doku)*
25. Expo-Doku `expo-sqlite` (kv-store, localStorage, Drizzle, `enableChangeListener`): https://docs.expo.dev/versions/latest/sdk/sqlite/ *(Doku)*
26. Drizzle „Expo SQLite“ (Live Queries, Installation): https://orm.drizzle.team/docs/connect-expo-sqlite *(Doku)*
27. Zustand-Doku `persist`: https://zustand.docs.pmnd.rs/reference/middlewares/persist; Vergleich: https://zustand.docs.pmnd.rs/learn/getting-started/comparison *(Doku)*
28. Jotai-Releases v3.0.0 und v3.0.1: https://github.com/pmndrs/jotai/releases *(GitHub)*
29. Legend-State Repo (`package.json` 3.0.0-beta.48, `src/persist-plugins/`, `src/sync-plugins/`): https://github.com/LegendApp/legend-state *(GitHub)*
30. TanStack Query „React Native“: https://tanstack.com/query/latest/docs/framework/react/react-native *(Doku)*
31. TanStack Query „Overview“ und „Network Mode“: https://tanstack.com/query/latest/docs/framework/react/overview, https://tanstack.com/query/latest/docs/framework/react/guides/network-mode *(Doku)*
32. `@hookform/resolvers` README: https://github.com/react-hook-form/resolvers *(GitHub)*
33. Hono-Doku „Validation“ (Zod Validator) und „RPC“: https://hono.dev/docs/guides/validation, https://hono.dev/docs/guides/rpc *(Doku)*
34. Expo-Doku „Unit testing with Jest“: https://docs.expo.dev/develop/unit-testing/ *(Doku)*
35. Expo-Doku „Testing configuration for Expo Router“: https://docs.expo.dev/router/reference/testing/ *(Doku)*
36. expo/expo Issue #48808 „jest-expo: no Jest 30 support path“ und PR #50427 „Upgrade jest to ^30.0.0“ (gemergt 02.10.2026): https://github.com/expo/expo/issues/48808, https://github.com/expo/expo/pull/50427 *(GitHub)*
37. RNTL „Migration to 14.x“ und „LLM Guidelines“: https://callstack.github.io/react-native-testing-library/docs/start/migration-v14, https://callstack.github.io/react-native-testing-library/docs/guides/llm-guidelines *(Doku)*
38. Reanimated „Testing with Jest“: https://docs.swmansion.com/react-native-reanimated/docs/guides/testing-with-jest *(Doku)*
39. React Native Skia, Installationsdoku (Abschnitt „Testing with Jest“): https://github.com/wcandillon/react-native-skia/blob/main/apps/docs/docs/getting-started/installation.md *(GitHub)*
40. Expo-Doku „Run E2E tests on EAS Workflows with Maestro“: https://docs.expo.dev/eas/workflows/examples/e2e-tests/ *(Doku)*
41. Maestro-Doku „React Native“: https://docs.maestro.dev/get-started/supported-platform/react-native *(Doku)*
42. Detox-Doku, Expo-Hinweis: https://github.com/wix/Detox/blob/master/docs/introduction/partials/_getting-started-expo.md *(GitHub)*
43. Weiterleitung https://docs.expo.dev/build-reference/e2e-tests/ → https://docs.expo.dev/eas/workflows/examples/e2e-tests/ (abgerufen 11.10.2026) *(Expo)*
44. Expo-Doku „Using e2e by TesterArmy“: https://docs.expo.dev/guides/using-e2e/ *(Doku)*
45. Expo `llms.txt` (u. a. Abschnitte Testing, Maestro Insights, Color Themes): https://docs.expo.dev/llms.txt; Color Themes: https://docs.expo.dev/develop/user-interface/color-themes/ *(Doku)*
46. Recherche Inselansicht (#29): https://github.com/Yggras/abnehm-app/blob/main/research/insel-rendering.md *(Projekt)*
47. Commit „test(expo-sqlite): Replace better-sqlite3 with node:sqlite“: https://github.com/expo/expo/commit/b85691550a991139ecb1b50e656328fd54621ecb; Inhalt von `npm pack expo-sqlite@57.0.4` (ohne `__mocks__`, geprüft 11.10.2026) *(GitHub/npm)*
48. Maestro-Release `cli-2.11.0`: https://github.com/mobile-dev-inc/Maestro/releases/tag/cli-2.11.0 *(GitHub)*
49. Expo-Doku „AI agents and Expo“: https://docs.expo.dev/agents/ *(Doku)*
50. `llms.txt` von Zustand, TanStack, Drizzle, Reanimated, Maestro: https://zustand.docs.pmnd.rs/llms.txt, https://tanstack.com/llms.txt, https://orm.drizzle.team/llms.txt, https://docs.swmansion.com/react-native-reanimated/llms.txt, https://docs.maestro.dev/llms.txt *(Doku)*
