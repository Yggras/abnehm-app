# Recherche: Cross-Platform-Tech-Stack für KI-gestützte Entwicklung

Ticket: [#2](https://github.com/Yggras/abnehm-app/issues/2) · Stand: 10.10.2026 · Kennzahlen (Stars, Downloads) am 10.10.2026 über die öffentlichen APIs von GitHub, npm und pub.dev abgerufen.

## Zusammenfassung

- **Kein eigener Mac nötig gibt es nur mit Cloud-Builds.** Flutter und Kotlin Multiplatform (KMP) setzen laut offizieller Doku für iOS-Builds macOS mit Xcode voraus [F1][K2]. Expo bietet mit EAS Build Cloud-Builds für iOS inkl. Verwaltung der Signierzertifikate [E2]. Codemagic stellt für Flutter, React Native und KMP Cloud-Macs bereit (500 Freiminuten pro Monat auf einem Mac mini M2) [C1][C2][C3].
- **HealthKit + Health Connect:** Flutter hat mit `health` (Publisher carp.dk) **ein** Paket für beide Plattformen [P1]. Expo/React Native nutzt **zwei** gepflegte Pakete: `@kingstinct/react-native-healthkit` und `react-native-health-connect`, beide mit Expo-Config-Plugin [R1][R2]. Bei KMP gibt es nur deutlich kleinere Community-Bibliotheken (unter 100 GitHub-Stars) [K3][K4].
- **Barcode, Kamera, Push:** Expo deckt alle drei mit eigenen SDK-Modulen ab (`expo-camera` scannt auch EAN-13/UPC-A, `expo-notifications` plus ein kostenloser Push-Dienst) [E3][E4][E5]. Flutter nutzt verbreitete Pakete (`mobile_scanner`, `camera`, `firebase_messaging`) [P2][P3][P4]. Für KMP gibt es nur kleinere Community-Bibliotheken [K5][K6].
- **KI-Tauglichkeit:** Expo und Flutter bieten beide offizielle Hilfen für KI-Agenten (Expo: llms.txt, Markdown-Doku, MCP-Server [E6]; Flutter: Dart/Flutter-MCP-Server und Agent-Regeln [F2]). TypeScript ist laut GitHub Octoverse 2025 die meistgenutzte Sprache auf GitHub [G1]. Daraus folgt eine *Vermutung*, keine belegte Tatsache: KI-Modelle haben vermutlich besonders viel TypeScript-/React-Code gesehen.
- **Kosten:** Für alle Frameworks fallen 99 USD pro Jahr für das Apple Developer Program an, sobald die App auf einem iPhone laufen soll (≈ 8,25 USD/Monat) [A1][E7]. Google Play kostet einmalig 25 USD [A2]. Die Free-Tiers von EAS (15 iOS- und 15 Android-Builds pro Monat) und Codemagic reichen für ein Zwei-Personen-Projekt voraussichtlich aus [E1][C1].
- **Empfehlung (die Entscheidung liegt beim Nutzer):** **Expo (React Native, TypeScript) mit EAS Build.** Knapp dahinter liegt Flutter mit Codemagic. KMP ist für dieses Projekt nicht zu empfehlen. Begründung siehe unten.

## Vergleichstabelle

| Kriterium | Expo / React Native | Flutter | Kotlin Multiplatform (+ Compose MP) |
|---|---|---|---|
| Sprache | TypeScript/JavaScript | Dart | Kotlin (iOS-Teile ggf. Swift) |
| Verbreitung (SO Survey 2024, alle Befragten) | React Native 8,4 % [S1] | 9,4 % [S1] | nicht aufgeführt [S1] |
| GitHub-Stars Framework | react-native: 126.613; expo: 52.617 [M1] | flutter: 179.270 [M1] | compose-multiplatform: 19.416 [M1] |
| Offizielle KI-Hilfen | llms.txt, `.md`-Doku, MCP-Server, Expo Skills [E6] | Dart/Flutter-MCP-Server, offizielle Agent-Regeln [F2] | keine offiziellen KI-Hilfen gefunden (nicht vertieft geprüft) |
| HealthKit (iOS) | `@kingstinct/react-native-healthkit` v16.1.0, 716 Stars, ~859k Downloads/Monat, Expo-Plugin, Wasser/Gewicht/Workouts vorhanden [R1][M1][M2][R3] | `health` v13.3.2 (beide Plattformen), 680 Likes, 160 Pub Points, ~196k Downloads/30 Tage; WATER, WEIGHT, WORKOUT, ACTIVE_ENERGY_BURNED, NUTRITION auf iOS und Android [P1][M3] | HealthKMP v1.7.0 (92 Stars), KHealth v2.1.0 (86 Stars) [K3][K4] |
| Health Connect (Android) | `react-native-health-connect` v4.1.3, 419 Stars, ~674k Downloads/Monat, Expo-Plugin eingebaut; Hydration, Weight, ExerciseSession, Nutrition, ActiveCaloriesBurned [R2][R4][M1][M2] | wie oben, im selben Paket `health` [P1] | wie oben |
| Barcode-Scanner | `expo-camera` (EAN-13, EAN-8, UPC-A/E u. a.) [E3] | `mobile_scanner` v7.4.2, 2.305 Likes, ~1,79 Mio. Downloads/30 Tage [P2][M3] | Community-Bibliotheken (z. B. KScan, zscanner) [K5] |
| Kamera (KI-Foto) | `expo-camera` [E3]; alternativ `react-native-vision-camera` v5.2.3, 9.648 Stars [M1][M2] | `camera` v0.12.1, 2.601 Likes [P3][M3] | keine etablierte Bibliothek verifiziert |
| Push | `expo-notifications` + Expo Push Service (kostenlos, 600 Nachrichten/s pro Projekt; nicht in Expo Go ab SDK 53) [E4][E5] | `firebase_messaging` v16.7.0, 3.950 Likes [P4][M3]; FCM ist kostenlos [FB1] | KMPNotifier (FCM, 663 Stars) [K6] |
| iOS-Build ohne Mac | Ja, EAS Build (Cloud, inkl. Signierung) [E2] | Lokal nur mit macOS + Xcode [F1]; in der Cloud über Codemagic [C2] | Lokal nur mit macOS + Xcode [K2]; in der Cloud über Codemagic [C3] |
| Cloud-Build Free-Tier | EAS: 15 iOS + 15 Android Builds/Monat; Starter 19 USD/Monat [E1] | Codemagic: 500 macOS-M2-Minuten/Monat, danach 0,095 USD/Min. [C1] | wie Flutter (Codemagic) [C1] |
| OTA-Updates | EAS Update, kostenlos bis 1.000 MAU [E1] | nicht untersucht | nicht untersucht |
| Reife | RN-Doku empfiehlt Expo für neue Apps [R5] | stabiles Ökosystem, alle relevanten Pakete mit 160/160 Pub Points [M3] | Compose MP für iOS erst seit Mai 2025 (v1.8.0) stabil [K1] |

## Details

### 1. Expo / React Native

- **Offizielle Empfehlung:** Die React-Native-Doku empfiehlt für neue Apps ein Framework und nennt Expo ausdrücklich [R5].
- **Builds ohne Mac:** EAS Build baut Android und iOS in der Cloud. Android-Keystores, iOS-Provisioning-Profile und Distributionszertifikate können automatisch erzeugt und verwaltet werden [E2]. Free-Tier: 15 iOS- und 15 Android-Builds pro Monat. Submit in die Stores ist enthalten. Der Starter-Plan kostet 19 USD/Monat [E1].
- **Expo Go reicht nicht:** Native Bibliotheken wie HealthKit/Health Connect und Push brauchen einen „Development Build“ [E7][R3][E5]. Jeder Build, der auf einem iPhone läuft, braucht einen kostenpflichtigen Apple-Developer-Account [E7]. Das gilt auch für die anderen Frameworks, denn iOS-Signierung erfordert die Mitgliedschaft im Apple Developer Program [C3].
- **HealthKit:** `@kingstinct/react-native-healthkit`
  - Über 100 Quantity Types, Workouts mit Abfragen, Speichern und Abonnieren, TypeScript, Expo-Config-Plugin [R1][R3]
  - Die Typen `HKQuantityTypeIdentifierDietaryWater` und `HKQuantityTypeIdentifierBodyMass` sind im Code vorhanden [R6]
  - Das Repo liefert eine eigene Agent-Skill-Datei mit (`skills/react-native-healthkit/SKILL.md`) [R6]
  - Das ältere `react-native-health` (1.164 Stars) nimmt derzeit nur kritische Bugfixes an und ist deshalb weniger geeignet [R7][M1]
- **Health Connect:** `react-native-health-connect`
  - Expo-Integration ist seit v4 eingebaut, das separate `expo-health-connect` ist deprecated [R2]
  - Voraussetzungen: Health-Connect-App (ab Android 14 eingebaut), minSdk 26 [R2]
- **Barcode/Kamera:** `expo-camera` scannt u. a. EAN-13, EAN-8, UPC-A und UPC-E auf Android und iOS [E3].
- **Push:** Expo kapselt APNs und FCM hinter einer gemeinsamen API [E4]. Der Expo Push Service ist kostenlos (Limit 600 Nachrichten/s pro Projekt) [E5].
- **KI-Freundlichkeit:** llms.txt (~54 kB), jede Doku-Seite als `.md`, MCP-Server und Expo Skills [E6].

### 2. Flutter

- **Builds:** Laut offizieller Doku wird für Build und Release einer iOS-App Xcode auf einem macOS-Gerät benötigt [F1]. Codemagic baut Flutter-Apps in der Cloud und veröffentlicht sie automatisch nach TestFlight/App Store [C2]. Free-Tier: 500 macOS-M2-Minuten pro Monat, 1 paralleler Build, nur ein Nutzer [C1].
- **Health:** Das Paket `health` (verifizierter Publisher carp.dk, MIT-Lizenz) ist ein Wrapper für HealthKit **und** Health Connect, mit Lesen und Schreiben, über 60 Datentypen und Workouts [P1]. Es setzt iOS 15+ und die Health-Connect-App voraus [P1]. Ein einziges Paket für beide Plattformen ist ein Vorteil gegenüber React Native, wo zwei Pakete nötig sind.
- **Barcode/Kamera/Push:** `mobile_scanner`, `camera`, `firebase_messaging`, alle mit 160/160 Pub Points und aktuellen Releases (Aug./Sep. 2026) [M3]. FCM ist in allen Firebase-Tarifen kostenlos [FB1].
- **KI-Freundlichkeit:** Der offizielle Dart/Flutter-MCP-Server gibt Agenten Zugriff auf Analyzer-Diagnosen, Symbolauflösung, Test-Runner und Laufzeit-Inspektion. Dazu kommen offizielle Agent-Regeln, u. a. für `CLAUDE.md` [F2].

### 3. Kotlin Multiplatform (mit Compose Multiplatform)

- **Reife:** Compose Multiplatform für iOS ist seit Version 1.8.0 (Mai 2025) stabil [K1].
- **Builds:** Laut offizieller Doku sind für iOS-Apps ein macOS-Rechner und Xcode nötig [K2]. Cloud-Builds sind über Codemagic möglich [C3]. EAS Build ist an Expo/React Native gebunden. Eine KMP-Unterstützung durch EAS wurde nicht gefunden (nicht verifiziert).
- **Health:** Die Bibliotheken sind klein: HealthKMP (92 Stars) und KHealth (86 Stars) [K3][K4][M1]. KHealth nennt Wasser, Gewicht, Workouts und Schreibzugriff [K4]. HealthKMP nennt Gewicht und Exercise, Wasser wird dort nicht aufgeführt [K3].
- **Barcode/Push:** Es gibt Community-Bibliotheken wie KScan und zscanner (Barcode) [K5] und KMPNotifier (Push über FCM, 663 Stars) [K6]. Kommerzielle SDKs gibt es ebenfalls (z. B. Scanbot) [K5].
- **Fazit:** Technisch machbar, aber das Ökosystem für die benötigten Module ist deutlich kleiner. Lokale iOS-Entwicklung braucht einen Mac.

### 4. Weitere Optionen (nur kurz betrachtet)

- **.NET MAUI** (3,1 %) und **Ionic** (2,5 %) liegen im SO Survey 2024 deutlich hinter Flutter und React Native [S1]. Ihre Health-Bibliotheken wurden **nicht** untersucht.
- **Zwei native Apps (Swift + Kotlin):** Doppelter Code für ein KI-gebautes Hobbyprojekt. Nicht weiter untersucht.

### 5. Nicht geklärt / offene Punkte

- Der Stack Overflow Survey 2025 ließ sich per Abruf nicht nach Mobile-Frameworks auswerten [S2]. Die Verbreitungszahlen stammen deshalb aus 2024 [S1].
- Ob Fitbit-Daten zuverlässig in Health Connect landen, ist für die Partnerin relevant, aber nicht Teil dieses Tickets und wurde **nicht** geprüft.
- Ob die Free-Tiers ausreichen, hängt von der Build-Frequenz der Agenten ab. Für Tests ohne neuen nativen Build steht bei Expo EAS Update bereit (kostenlos bis 1.000 MAU) [E1].
- Wie gut KI-Agenten in TypeScript gegenüber Dart programmieren, ist nicht direkt belegt. Die Octoverse-Zahl [G1] ist nur ein Indiz.

## Empfehlung (Vorschlag – die Entscheidung liegt beim Nutzer)

**Expo (React Native + TypeScript) mit EAS Build/Submit/Update**, aus diesen Gründen:

1. **Kein Mac nötig:** iOS-Builds inkl. Signierung laufen komplett in der Cloud, im Free-Tier mit 15 iOS-Builds pro Monat [E1][E2]. Das passt zur ungeklärten Mac-Frage.
2. **Alle Module abgedeckt:** Kamera/Barcode und Push kommen von Expo selbst [E3][E4]. Für HealthKit und Health Connect gibt es aktiv gepflegte Pakete mit Expo-Plugin und hohen Downloadzahlen [R1][R2][M2].
3. **Kosten im Budget:** Expo Push und FCM sind kostenlos [E5][FB1]. Fix bleibt nur die Apple-Gebühr von 99 USD/Jahr [A1], die bei jedem Framework anfällt.
4. **KI-tauglich:** Offizielle KI-Doku und MCP-Server [E6]. TypeScript ist die meistgenutzte Sprache auf GitHub [G1]. Die RN-Doku empfiehlt Expo als Standardweg [R5].

**Alternative: Flutter + Codemagic.** Sie wäre gleichwertig zu wählen, falls ein einzelnes Health-Paket für beide Plattformen [P1] oder Dart bevorzugt wird. Nachteil: iOS-Builds brauchen einen Mac oder Codemagic-Minuten [F1][C1].
**KMP** ist für dieses Projekt nicht zu empfehlen: kleinere Health-, Scanner- und Push-Bibliotheken [K3][K4][K5][K6] und Mac-Pflicht für lokale iOS-Builds [K2].

## Quellen

- [A1] Apple Developer – Program enrollment (99 USD/Jahr): https://developer.apple.com/help/account/membership/program-enrollment/ (abgerufen über https://developer.apple.com/support/enrollment/)
- [A2] Google Play Console Help – Registrierungsgebühr 25 USD einmalig: https://support.google.com/googleplay/android-developer/answer/6112435
- [C1] Codemagic Pricing: https://codemagic.io/pricing/
- [C2] Codemagic Docs – Flutter apps: https://docs.codemagic.io/yaml-quick-start/building-a-flutter-app/
- [C3] Codemagic Docs – Kotlin Multiplatform (KMM) apps: https://docs.codemagic.io/yaml-quick-start/building-a-kmm-app/
- [E1] Expo Pricing: https://expo.dev/pricing
- [E2] Expo Docs – EAS Build Introduction: https://docs.expo.dev/build/introduction/
- [E3] Expo Docs – Camera (SDK): https://docs.expo.dev/versions/latest/sdk/camera/
- [E4] Expo Docs – Push notifications overview: https://docs.expo.dev/push-notifications/overview/
- [E5] Expo Docs – Push notifications FAQ: https://docs.expo.dev/push-notifications/faq/
- [E6] Expo Docs – For AI agents and LLMs: https://docs.expo.dev/llms/
- [E7] Expo Docs – Development builds introduction: https://docs.expo.dev/develop/development-builds/introduction/
- [F1] Flutter Docs – Build and release an iOS app: https://docs.flutter.dev/deployment/ios
- [F2] Flutter Docs – Dart and Flutter MCP server / Get started with AI: https://docs.flutter.dev/ai/mcp-server, https://docs.flutter.dev/ai/get-started
- [FB1] Firebase Pricing (FCM „No-cost“): https://firebase.google.com/pricing
- [G1] GitHub Octoverse 2025: https://github.blog/news-insights/octoverse/octoverse-a-new-developer-joins-github-every-second-as-ai-leads-typescript-to-1/
- [K1] JetBrains Blog – Compose Multiplatform 1.8.0, iOS stable (Mai 2025): https://blog.jetbrains.com/kotlin/2025/05/compose-multiplatform-1-8-0-released-compose-multiplatform-for-ios-is-stable-and-production-ready/
- [K2] Kotlin Multiplatform Quickstart: https://kotlinlang.org/docs/multiplatform/quickstart.html
- [K3] HealthKMP: https://github.com/vitoksmile/HealthKMP
- [K4] KHealth: https://github.com/shubhamsinghshubham777/KHealth
- [K5] KMP-Barcode-Bibliotheken: https://klibs.io/project/NamanTonk/zscanner-kmp, https://central.sonatype.com/artifact/io.github.ismai117/KScan, https://docs.scanbot.io/kmp/barcode-scanner-sdk/introduction/
- [K6] KMPNotifier: https://github.com/mirzemehdi/KMPNotifier
- [M1] GitHub REST API, Repo-Metadaten (Stars) vom 10.10.2026, z. B. https://api.github.com/repos/react/react-native, …/flutter/flutter, …/JetBrains/compose-multiplatform, …/expo/expo, …/kingstinct/react-native-healthkit, …/matinzd/react-native-health-connect, …/agencyenterprise/react-native-health, …/margelo/react-native-vision-camera, …/vitoksmile/HealthKMP, …/shubhamsinghshubham777/KHealth
- [M2] npm Downloads API (Zeitraum 09.09.–08.10.2026) und Registry (aktuelle Versionen): https://api.npmjs.org/downloads/point/last-month/@kingstinct/react-native-healthkit (analog für react-native-health-connect, react-native-vision-camera), https://registry.npmjs.org/
- [M3] pub.dev API (Version, Likes, Pub Points, 30-Tage-Downloads) vom 10.10.2026: https://pub.dev/api/packages/health/score (analog mobile_scanner, camera, firebase_messaging)
- [P1] pub.dev – health: https://pub.dev/packages/health
- [P2] pub.dev – mobile_scanner: https://pub.dev/packages/mobile_scanner
- [P3] pub.dev – camera: https://pub.dev/packages/camera
- [P4] pub.dev – firebase_messaging: https://pub.dev/packages/firebase_messaging
- [R1] @kingstinct/react-native-healthkit: https://github.com/kingstinct/react-native-healthkit
- [R2] react-native-health-connect: https://github.com/matinzd/react-native-health-connect
- [R3] react-native-healthkit README: https://github.com/kingstinct/react-native-healthkit/blob/master/README.md
- [R4] react-native-health-connect – Permissions: https://matinzd.github.io/react-native-health-connect/docs/permissions
- [R5] React Native Docs – Get Started: https://reactnative.dev/docs/environment-setup
- [R6] react-native-healthkit Quellcode/Skill: https://github.com/kingstinct/react-native-healthkit/tree/master/skills/react-native-healthkit, https://github.com/kingstinct/react-native-healthkit/blob/master/packages/react-native-healthkit/src/generated/healthkit.generated.ts
- [R7] react-native-health (Wartungshinweis): https://github.com/agencyenterprise/react-native-health
- [S1] Stack Overflow Developer Survey 2024 – Other frameworks and libraries: https://survey.stackoverflow.co/2024/technology#most-popular-technologies-misc-tech
- [S2] Stack Overflow Developer Survey 2025 – Technology: https://survey.stackoverflow.co/2025/technology
