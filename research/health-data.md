# Recherche: Gesundheitsdaten via HealthKit und Health Connect

Ticket: #6 · Stand der Recherche: 2026-10-10 · Alle Aussagen sind mit Quellen belegt (Nummern in eckigen Klammern verweisen auf die Quellenliste unten). Was sich nicht belegen ließ, ist ausdrücklich als **nicht verifiziert** markiert.

## Zusammenfassung

- **Alle benötigten Datentypen sind auf beiden Plattformen verfügbar** (lesen und schreiben): Schritte, Workouts/Trainingseinheiten, aktive Kalorien, Gewicht, Wasser, Ernährung. HealthKit: `stepCount`, `HKWorkout`, `activeEnergyBurned`, `bodyMass`, `dietaryWater`, `dietaryEnergyConsumed` usw. [1][2]. Health Connect: `StepsRecord`, `ExerciseSessionRecord`, `ActiveCaloriesBurnedRecord`, `WeightRecord`, `HydrationRecord`, `NutritionRecord` usw., jeweils mit einer eigenen READ_/WRITE_-Berechtigung [3].
- **Er (iPhone, keine Uhr):** Die Health-App zählt Schritte sowie Geh- und Laufstrecken automatisch [4]. Unsere App kann `stepCount` über HealthKit lesen.
- **Sie (Android + Fitbit):** Die Fitbit-App heißt in der Hilfe inzwischen „Google Health app“. Sie **schreibt** u. a. Schritte, Training (Exercise), **Gesamtkalorien** (Total calories burned), Schlaf, Gewicht, Wasser und Ernährung in Health Connect. **Aktive Kalorien („Active calories burned“) stehen nur in der Lese-Spalte, nicht in der Schreib-Spalte** [5]. Konsequenz: Auf Android eher mit `TotalCaloriesBurnedRecord` und `ExerciseSessionRecord` planen, nicht mit aktiven Kalorien.
- **Einschränkungen beim Synchronisieren:** Health Connect liefert standardmäßig nur Daten bis 30 Tage vor der ersten Berechtigung. Für ältere Daten braucht es `PERMISSION_READ_HEALTH_DATA_HISTORY`, für Lesen im Hintergrund `READ_HEALTH_DATA_IN_BACKGROUND` (vorher per Feature-Check prüfen) [6]. Change-Tokens verfallen nach 30 Tagen ohne Nutzung [7]. HealthKit weckt die App bei `stepCount` höchstens stündlich. Dafür braucht es das Entitlement `com.apple.developer.healthkit.background-delivery` [8]. Bei gesperrtem Gerät kann das Lesen im Hintergrund fehlschlagen [9].
- **Review bei privater Verteilung:**
  - Apple: Für interne TestFlight-Tester (bis 100) wird kein App Review genannt. Externe Tester erfordern ein Beta App Review [10][11]. HealthKit braucht die Capability, Usage-Strings und eine Datenschutzerklärung [9][12].
  - Google: Das Formular „Health apps declaration“ gilt laut Hilfe für Closed-, Open- und Production-Tracks. **Interne Tests sind dort nicht genannt** [13]. Interne Tests „might not be subject to standard Play policy or security reviews“ [14]. Die allgemeine Permissions-Declaration-Seite nennt Internal-Tracks dagegen ausdrücklich [15]. **Das Bild ist also nicht eindeutig.** Empfehlung: die Deklaration trotzdem ausfüllen.
- **Verfügbarkeit von Health Connect:** Ab Android 14 (API 34) ist Health Connect Teil des Frameworks. Unter Android 13 und älter muss die Health-Connect-App aus dem Play Store installiert werden (läuft ab Android 9) [16].

## 1. Datentypen

### Apple HealthKit

| Bedarf | HealthKit-Typ | Quelle |
|---|---|---|
| Schritte | `HKQuantityTypeIdentifier.stepCount` | [1] |
| Workouts | `HKWorkout` („A workout sample that stores information about a single physical activity“) | [2] |
| Aktive Kalorien | `activeEnergyBurned` (dazu `basalEnergyBurned` für Ruheenergie) | [1] |
| Gewicht | `bodyMass` („measures the user’s weight“) | [1] |
| Wasser | `dietaryWater` | [1] |
| Ernährung | `dietaryEnergyConsumed`, `dietaryProtein`, `dietaryCarbohydrates`, `dietaryFatTotal`. Werte lassen sich über die Korrelation `food` zu einem Lebensmittel bündeln | [1][17] |
| Strecke | `distanceWalkingRunning` | [1] |

Berechtigungen: Lesen und Schreiben werden **pro Datentyp** einzeln erteilt. Die App erfährt nicht, ob der Lesezugriff verweigert wurde. Es sieht dann so aus, als gäbe es keine Daten [9][18]. Nutzer können außerdem nur ein begrenztes Zeitfenster der jüngsten Daten freigeben. Das lässt sich mit `getEarliestAuthorizedSampleDate(for:)` erkennen [18]. Ob die App schreiben darf, lässt sich über `authorizationStatus(for:)` prüfen [18].

### Android Health Connect

| Bedarf | Record-Klasse | Berechtigungen | Quelle |
|---|---|---|---|
| Schritte | `StepsRecord` | `READ_STEPS` / `WRITE_STEPS` | [3] |
| Training | `ExerciseSessionRecord` | `READ_EXERCISE` / `WRITE_EXERCISE` (Route separat: `READ_/WRITE_EXERCISE_ROUTE`) | [3] |
| Aktive Kalorien | `ActiveCaloriesBurnedRecord` | `READ_/WRITE_ACTIVE_CALORIES_BURNED` | [3] |
| Gesamtkalorien | `TotalCaloriesBurnedRecord` | `READ_/WRITE_TOTAL_CALORIES_BURNED` | [3] |
| Gewicht | `WeightRecord` | `READ_/WRITE_WEIGHT` | [3] |
| Wasser | `HydrationRecord` | `READ_/WRITE_HYDRATION` | [3] |
| Ernährung | `NutritionRecord` | `READ_/WRITE_NUTRITION` | [3] |
| Schlaf | `SleepSessionRecord` | `READ_/WRITE_SLEEP` | [3] |

(Die Berechtigungen haben das Präfix `android.permission.health.` [3].)

## 2. Fitbit und Health Connect

Quelle: Google-Health-/Fitbit-Hilfeseite „How do I use Health Connect with the Google Health app?“ [5]. Die Seite liegt unter support.google.com/fitbit, heißt die App inzwischen aber „Google Health app“. Die Anmeldung erfordert ein **erwachsenes Google-Konto** (mit Link zur Migration des Fitbit-Kontos) und **Android 9 oder neuer** [5].

Auszug aus der Tabelle auf dieser Seite (Spalten „can read“ / „can write“, direkt aus dem HTML abgeglichen):

| Kategorie | Google Health **schreibt** in Health Connect | Google Health **liest** aus Health Connect |
|---|---|---|
| Fitness | Steps, Speed, Step cadence, VO2 max, Floors, Distance, Elevation gained, Exercise, Exercise route, Total calories burned | Steps, VO2 max, Floors, **Active calories burned**, Distance, Exercise, Total calories burned |
| Schlaf | Sleep session, Sleep stages | Sleep session, Sleep stages |
| Körpermaße | Weight, Body fat percentage | Weight, Body fat percentage |
| Ernährung | Hydration, Nutrition (Food, Meal type, Energy, Macros) | Hydration, Nutrition |
| Vitalwerte | u. a. Heart rate, Resting heart rate, HRV | u. a. Heart rate, Oxygen saturation |

Folgerungen für unsere App:
- Für sie können wir Schritte, Trainingseinheiten, Gesamtkalorien, Gewicht, Schlaf und gegebenenfalls Wasser und Ernährung aus Health Connect lesen, **sofern sie Google Health die jeweilige Schreibberechtigung in Health Connect erteilt** [5].
- Aktive Kalorien werden laut Tabelle **nicht** von Google Health geschrieben [5]. Ein plattformübergreifender Kalorienvergleich sollte also entweder Gesamtkalorien nutzen (HealthKit: aktiv + basal [1]) oder auf Android die aktiven Kalorien selbst schätzen. Die genaue Rechenmethode gehört in ein Folgeticket.
- Schreibt unsere App manuell erfasste Gewichte in Health Connect, kann Google Health sie lesen (Weight steht in der Lese-Spalte) [5].
- **Nicht verifiziert:** Wie oft und wie schnell Google Health neue Uhrdaten nach Health Connect schreibt. Die Hilfeseite nennt keine Frequenz, nur eine manuelle Sync-Schaltfläche und den Status „Synced at XX:XX“ [5].

## 3. Hintergrund-Sync und Lese-Einschränkungen

### Health Connect
- **Historie:** „By default, all applications can read data from Health Connect for up to 30 days prior to when any permission was first granted.“ Für ältere Daten ist `PERMISSION_READ_HEALTH_DATA_HISTORY` nötig. Ohne diese Berechtigung führt das Lesen älterer Datensätze zu einem Fehler [6]. Ab Android 14 gibt es keine Grenze für die **eigenen** Daten einer App, für fremde Daten gilt das 30-Tage-Limit. Unter Android 13 gilt das Limit für alle Daten [6].
- **Hintergrund:** Normalerweise wird im Vordergrund gelesen. Für das Lesen im Hintergrund braucht es `android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND` sowie eine Nutzerfreigabe. Die Verfügbarkeit wird über `getFeatureStatus(FEATURE_READ_HEALTH_DATA_IN_BACKGROUND)` geprüft, empfohlen ist die Umsetzung mit WorkManager [6].
- **Delta-Sync:** Mit `getChangesToken` und `getChanges` lassen sich Änderungen abrufen. Ein ungenutzter Token „expires within 30 days“ [7].
- **Rate Limits:** Es gibt feste Kontingente pro Zeitraum und pro Tag. Im Hintergrund sind sie strenger als im Vordergrund. Konkrete Zahlen werden nicht veröffentlicht [19].

### HealthKit
- **Background Delivery:** Ab iOS 15 ist das Entitlement `com.apple.developer.healthkit.background-delivery` Pflicht. Ohne es schlägt `enableBackgroundDelivery` fehl [8][20]. Die App wird höchstens einmal pro gewählter Frequenz geweckt, „on iOS, stepCount samples have an hourly maximum frequency“ [8]. Wird der Completion-Handler dreimal nicht aufgerufen, stoppt HealthKit die Hintergrund-Updates [8].
- **Gesperrtes Gerät:** Der HealthKit-Speicher ist bei Sperre verschlüsselt. Lesen im Hintergrund ist dann eventuell nicht möglich, Schreiben wird zwischengespeichert [9].

## 4. Berechtigungen und Review (auch bei privater Verteilung)

### Apple
- HealthKit-Capability in Xcode aktivieren. Die Clinical-Health-Records-Option nur anhaken, wenn sie wirklich gebraucht wird, sonst droht Ablehnung [12]. `isHealthDataAvailable()` vor allen anderen Aufrufen prüfen [12].
- `NSHealthShareUsageDescription` (Lesen) und `NSHealthUpdateUsageDescription` (Schreiben) sind Pflicht, sonst stürzt die App bei der Berechtigungsanfrage ab [9].
- Pflichten: Daten nur für Gesundheit und Fitness nutzen, keine Werbung, keine Weitergabe ohne Zustimmung, **Datenschutzerklärung erforderlich** [9]. App Review Guideline 5.1.3: keine falschen Daten in HealthKit schreiben, **keine persönlichen Gesundheitsdaten in iCloud speichern** [21]. Guideline 2.5.1: HealthKit nur für Gesundheit und Fitness nutzen [21].
- **TestFlight:** bis zu 100 interne Tester (Teammitglieder mit App-Store-Connect-Rolle) und bis zu 10.000 externe Tester [10]. Der erste Build für eine externe Gruppe geht ins App Review [11]. Für interne Tester wird in der Doku kein Review genannt [10][11]. Builds sind 90 Tage testbar [11]. Guideline 2.2: TestFlight-Apps „should be intended for public distribution and should comply with the App Review Guidelines“ [21].

### Google Play
- Im Manifest muss eine Activity die Datenschutzerklärung bzw. den Berechtigungszweck anzeigen (Android 13: `ACTION_SHOW_PERMISSIONS_RATIONALE`; Android 14+: `activity-alias` mit `VIEW_PERMISSION_USAGE`) [16].
- In der Play Console müssen die genutzten Health-Connect-Datentypen deklariert und begründet werden. Das gilt für alle Veröffentlichungsanfragen [22]. Alle Anfragen werden geprüft („subject to review“) [23]. Health-Connect-Daten gelten als „personal and sensitive user data“ [24].
- **Testing Tracks:** Die Health apps declaration gilt für „apps on closed testing, open testing, or production tracks“ [13]. Zu internen Tests: „Internal tests might not be subject to standard Play policy or security reviews“, bis zu 100 Tester [14]. Die Hilfe zur allgemeinen Permissions Declaration nennt dagegen auch „Internal test tracks“ [15]. **Fazit:** Für den Internal-Track ist eine Health-Connect-Prüfung nicht klar vorgeschrieben. Eindeutig belegen ließ sich das nicht.
- **Nicht verifiziert:** Ob Health Connect auf dem Gerät Berechtigungen für eine nicht freigegebene App (Debug-Build oder Internal Track) technisch verweigert. Dazu wurde keine Primärquelle gefunden. Das sollte mit einem Prototyp auf ihrem Gerät getestet werden.

## 5. Verfügbarkeit von Health Connect

- Ab Android 14 (API 34) ist Health Connect ein Framework-Modul, eine Einrichtung ist nicht nötig. Unter Android 13 und älter muss die Health-Connect-App aus dem Play Store installiert werden [16].
- Das SDK unterstützt Android 8 (API 26) und neuer, die Health-Connect-App selbst Android 9 (API 28) und neuer [16]. Die Verfügbarkeit wird mit `HealthConnectClient.getSdkStatus()` geprüft [16].

## 6. Hinweis zu Cross-Platform-Stacks (nur kurz, Details in einem eigenen Ticket)

- Flutter: Das Paket `health` beschreibt sich als „Wrapper for Apple's HealthKit on iOS and Google's Health Connect on Android“ [25].
- React Native/Expo: `react-native-health-connect` ist ein Android-only-Wrapper mit Expo-Config-Plugin. Es läuft nicht in Expo Go, nur in Custom Builds [26]. Für iOS wäre eine eigene HealthKit-Bibliothek nötig.

## Offene Punkte / Empfehlungen

1. Prototyp auf ihrem Gerät bauen: Prüfen, welche Fitbit-Daten tatsächlich in Health Connect ankommen und wie oft. Die Häufigkeit ist nicht dokumentiert [5].
2. Für die Kalorienlogik Gesamtkalorien als gemeinsame Basis prüfen (siehe Abschnitt 2).
3. Eine kurze Datenschutzerklärung ist auf beiden Plattformen nötig [9][16][22].
4. Gesundheitsdaten nicht in iCloud speichern (Guideline 5.1.3(ii)) [21]. Das ist für das Backend-/Sync-Ticket relevant.

## Quellen

1. Apple, HKQuantityTypeIdentifier: https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier
2. Apple, HKWorkout: https://developer.apple.com/documentation/healthkit/hkworkout
3. Android Developers, Health Connect data types: https://developer.android.com/health-and-fitness/guides/health-connect/plan/data-types
4. Apple Support, Use the Health app on your iPhone or iPad („Health automatically counts your steps, walking, and running distances.“): https://support.apple.com/en-us/104997
5. Google Health/Fitbit Help, How do I use Health Connect with the Google Health app?: https://support.google.com/fitbit/answer/14506680?hl=en
6. Android Developers, Read raw data: https://developer.android.com/health-and-fitness/guides/health-connect/develop/read-data
7. Android Developers, Synchronize data: https://developer.android.com/health-and-fitness/guides/health-connect/develop/sync-data
8. Apple, enableBackgroundDelivery(for:frequency:withCompletion:): https://developer.apple.com/documentation/healthkit/hkhealthstore/enablebackgrounddelivery(for:frequency:withcompletion:)
9. Apple, Protecting user privacy: https://developer.apple.com/documentation/healthkit/protecting-user-privacy
10. Apple, TestFlight: https://developer.apple.com/testflight/
11. Apple, TestFlight overview (App Store Connect Help): https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/
12. Apple, Setting up HealthKit: https://developer.apple.com/documentation/healthkit/setting-up-healthkit
13. Play Console Help, Provide information for the Health apps declaration form: https://support.google.com/googleplay/android-developer/answer/14738291?hl=en
14. Play Console Help, Set up an open, closed, or internal test: https://support.google.com/googleplay/android-developer/answer/9845334?hl=en
15. Play Console Help, Declare permissions for your app: https://support.google.com/googleplay/android-developer/answer/9214102?hl=en
16. Android Developers, Get started with Health Connect: https://developer.android.com/health-and-fitness/guides/health-connect/develop/get-started
17. Apple, HKCorrelationTypeIdentifier.food: https://developer.apple.com/documentation/healthkit/hkcorrelationtypeidentifier/food
18. Apple, Authorizing access to health data: https://developer.apple.com/documentation/healthkit/authorizing-access-to-health-data
19. Android Developers, Plan to avoid rate limiting: https://developer.android.com/health-and-fitness/guides/health-connect/plan/rate-limiting
20. Apple, HealthKit Background Delivery Entitlement: https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.healthkit.background-delivery
21. Apple, App Review Guidelines (2.2, 2.5.1, 5.1.3): https://developer.apple.com/app-store/review/guidelines/
22. Android Developers, Declare access to Health Connect data types / Publish your health app: https://developer.android.com/health-and-fitness/guides/health-connect/publish/declare-access
23. Play Console Help, Android Health Permissions: Guidance and FAQs: https://support.google.com/googleplay/android-developer/answer/12991134
24. Play Console Help, Health Content and Services: https://support.google.com/googleplay/android-developer/answer/16679511?hl=en
25. pub.dev, health (Flutter): https://pub.dev/packages/health
26. GitHub, matinzd/react-native-health-connect: https://github.com/matinzd/react-native-health-connect
