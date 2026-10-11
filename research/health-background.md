# Recherche: Hintergrund-Import von Health-Daten in Expo

Ticket: [#45](https://github.com/Yggras/abnehm-app/issues/45) · Stand: 11.10.2026 · Versionen und Release-Daten am 11.10.2026 über die öffentlichen APIs von npm und GitHub abgerufen [36][37]. Quellcode wurde auf festen Commits gelesen (Links in der Quellenliste).

Quellen-Nummern in eckigen Klammern [n] verweisen auf die Liste am Ende. Mit *eigene Einschätzung* markierte Stellen sind nicht durch eine Quelle belegt. **Nicht belegt** heißt: Ich habe keine Primärquelle gefunden. Rechtliche Fragen (u. a. Store-Richtlinien im Detail, Datenschutz) werden laut `AGENTS.md` vorerst nicht betrachtet.

## Ausgangslage

- **Entscheidung in #35:** Es gibt keinen allgemeinen Hintergrund-Sync. Einzige Ausnahme ist der Hintergrund-Import von Health-Daten (≈ stündlich, danach Push an das Backend). Rückfall, falls das nicht sauber machbar ist: Import nur beim Öffnen der App [2].
- **Festgelegter Stack (#10):** Expo mit Development Build/EAS, `@kingstinct/react-native-healthkit` (iOS) und `react-native-health-connect` (Android), beide mit Expo-Config-Plugin [3]. Expo SDK 57 ist aktuell (`expo` 57.0.27 vom 06.10.2026) [36].
- **Bekannt aus der Health-Recherche (#6):** Android braucht für Lesen im Hintergrund `READ_HEALTH_DATA_IN_BACKGROUND` plus Feature-Check. iOS braucht für Background Delivery das Entitlement `com.apple.developer.healthkit.background-delivery`. Bei gesperrtem iPhone kann Lesen im Hintergrund fehlschlagen [4].
- **Daten:** Trainings/aktive Minuten, ggf. Gewicht [1]. Die Fitbit-/Google-Health-App schreibt u. a. Exercise, Weight und Total calories burned nach Health Connect [34].

## Zusammenfassung

- **Antwort: machbar – mit Einschränkungen.** Beide Pakete decken den Hintergrund-Teil ab, aber unterschiedlich weit. Auf keiner Plattform ist der Takt garantiert. „Stündlich“ ist auf beiden Plattformen eine **Obergrenze bzw. ein Mindestabstand**, keine Zusage [5][28][31].
- **iOS (gut abgedeckt):**
  - `@kingstinct/react-native-healthkit` 16.1.0 (07.10.2026) bringt Background Delivery fertig mit [36]: `configureBackgroundTypes(types, UpdateFrequency.hourly)` registriert die Observer-Queries **nativ beim App-Start**, wie Apple es verlangt. Das Config-Plugin setzt das Entitlement standardmäßig [16][17][18].
  - Die Bibliothek hält die App nach dem Wecken **25 Sekunden** per `beginBackgroundTask` wach, damit JS starten und arbeiten kann [17]. In diesem Fenster sind Lesen, lokales Speichern und ein `/sync/push` grundsätzlich möglich (Apple zeigt genau dieses Muster für Server-Uploads) [13]. Ob 25 s in der Praxis reichen, ist **nicht belegt**. Der Autor nennt das Fenster selbst als ersten Kandidaten zum Nachjustieren [17].
  - Einschränkungen: Bei gesperrtem Gerät kann das Lesen fehlschlagen [11][18]. Der Simulator unterstützt das nicht [5][7]. Die native Startregistrierung gibt es erst seit 14.0.0 (08.04.2026), ein Folgefix kam in 14.1.0 (26.08.2026) [19].
- **Android (Baukasten, mehr Eigenarbeit):**
  - `react-native-health-connect` 4.1.3 (06.08.2026) kann die Berechtigung `BackgroundAccessPermission` (= `READ_HEALTH_DATA_IN_BACKGROUND`) anfragen, seit 3.4.0 (07.09.2025) [20][23][36].
  - Das Paket bietet aber **keinen Hintergrund-Job** und **keinen Feature-Check** (`getFeatureStatus` fehlt in der JS-API) [22]. Die Manifest-Berechtigung setzt das Config-Plugin **nicht**. Sie muss über `android.permissions` in `app.json` ergänzt werden [21][33].
  - Den periodischen Job liefert **`expo-background-task`** (SDK 57: 57.0.21). Es nutzt WorkManager, Mindestintervall 15 min, verlangt Netz und führt den JS-Task auch ohne laufende App aus (Headless-JS) [31][32][36].
  - Dass Health-Connect-Lesen aus so einem Hintergrund-Task mit diesem Paket funktioniert, ist nur durch einen **Erfahrungsbericht** in einem Issue gestützt (damals `expo-background-fetch`), nicht durch die Paket-Doku [24].
  - Einschränkungen: Hintergrund-Rate-Limits sind strenger als im Vordergrund, Zahlen werden nicht veröffentlicht [27]. App-Standby-Buckets drosseln Jobs bei selten genutzten Apps. Im Bucket „Rare“ wird auch der Internetzugang eingeschränkt [30].
- **Fitbit → Health Connect:** Wie zeitnah die Google-Health-App (früher Fitbit-App) nach Health Connect schreibt, ist **nicht belegt**. Die offizielle Hilfe nennt kein Intervall [34][35]. Selbst ein stündlicher Import kann also nur so frisch sein wie Fitbits eigener Sync.
- **`/sync/push` im Hintergrund:** auf beiden Wegen möglich. Android-Tasks laufen nur mit Netz (`NetworkType.CONNECTED`) [32]. iOS hat ein enges Zeitfenster (25 s aus der Bibliothek, das Apple-Budget ist nicht als Zahl dokumentiert) [12][17].
- **Vorschlag (Entscheidung beim Nutzer):** Hintergrund-Import **umsetzen, aber nur als Bonus**. Der Import beim Öffnen (Vordergrund) bleibt der verlässliche Grundweg und läuft immer. Im Hintergrund nur Delta lesen (Anker bzw. Change-Token), lokal speichern, einen `/sync/push` versuchen und bei Fehler still auf das nächste Öffnen warten. Details unten unter „Empfohlener Weg“.

## iOS: HealthKit Background Delivery

### Was Apple vorgibt

- **Entitlement:** Ab iOS 15 ist `com.apple.developer.healthkit.background-delivery` Pflicht. Ohne es schlägt `enableBackgroundDelivery` mit `errorAuthorizationDenied` fehl [5][6].
- **Frequenz:** HealthKit weckt die App, wenn ein Prozess Samples des Typs speichert oder löscht, „at most once per time period defined by the specified frequency“. Manche Typen haben als Maximum `hourly`, z. B. `stepCount` auf iOS [5]. Zur Wahl stehen `immediate`, `hourly`, `daily`, `weekly` [10][18].
- **Observer-Queries beim Start:** „set up all your observer queries in your app delegate’s `application(_:didFinishLaunchingWithOptions:)` method“, damit sie bereitstehen, bevor HealthKit die Updates zustellt [5][9].
- **Completion-Handler:** Nach der Verarbeitung muss der Completion-Handler aufgerufen werden. Sonst versucht HealthKit es mit wachsendem Abstand erneut. Nach drei ausbleibenden Antworten stoppt HealthKit die Hintergrund-Updates [5][8].
- **Kein Inhalt im Callback:** Der Observer meldet nur, *dass* sich etwas geändert hat. Die Daten muss man mit einer weiteren Query holen, z. B. `HKAnchoredObjectQuery` [9].
- **Simulator:** „Background server queries aren’t supported on the Simulator“ [5][7].
- **Gesperrtes Gerät:** Der HealthKit-Speicher ist bei Sperre verschlüsselt. Die App kann im Hintergrund dann eventuell nicht lesen [11].
- **Laufzeit:** Mit `beginBackgroundTask` bekommt die App zusätzliche Zeit. Die Restzeit steht in `backgroundTimeRemaining`, eine feste Zahl nennt Apple dort nicht. „System conditions may end background execution earlier“ [12]. Apple zeigt als Beispiel genau einen Server-Upload in so einem Task [13]. Feste 30 s nennt Apple nur für `BGAppRefreshTask` und Background-Pushes, nicht für HealthKit-Weckungen [14].

### Was `@kingstinct/react-native-healthkit` daraus macht

- **Version:** 16.1.0 vom 07.10.2026. Seit 16.0.0 (18.09.2026) werden `@kingstinct/react-native-healthkit`, `@react-native-healthkit/core` und `@react-native-healthkit/health-records` gemeinsam versioniert [19][36]. Peer-Dependencies: `react >=19`, `react-native >=0.79`, `react-native-nitro-modules >=0.35` [36].
- **Expo:** Läuft nicht in Expo Go, braucht einen eigenen Dev Client. Das Plugin wird in `app.json` eingetragen, Option `background` [15].
- **Config-Plugin:** Setzt `com.apple.developer.healthkit` und **standardmäßig** auch `com.apple.developer.healthkit.background-delivery`. Abschalten geht nur mit `background: false` [16].
- **Startregistrierung ohne AppDelegate-Änderung:** Der Pod hängt sich an `UIApplicationDidFinishLaunchingNotification`. UIKit sendet sie direkt nach `didFinishLaunchingWithOptions`, also noch während des Starts [17]. Die zu beobachtenden Typen und die Frequenz werden in `UserDefaults` gespeichert und bei jedem Kaltstart nativ neu registriert [17].
- **API:** `configureBackgroundTypes([...], UpdateFrequency.hourly)` einmal aufrufen (z. B. nach dem Onboarding). Danach `subscribeToChanges(type, handler)` **früh** registrieren (Modul-Ebene oder Root-Komponente). Ereignisse, die vor dem JS-Handler eintreffen, puffert die Bibliothek nativ [18]. Die rohen Aufrufe `enableBackgroundDelivery` usw. gibt es auch, sie wecken eine beendete App ohne Startregistrierung aber nicht [18].
- **Completion-Handler und Zeitfenster:** Die Bibliothek ruft HealthKits Completion-Handler **sofort** auf. Vorher öffnet sie einen `beginBackgroundTask` und beendet ihn pauschal nach **25 s** [17]. Ein Rückkanal „JS ist fertig“ fehlt bewusst („isn’t worth building yet“) [17]. Die App muss ihre Arbeit also in dieses Fenster legen.
- **Delta-Lesen:** Anker-Queries (`queryQuantitySamplesWithAnchor` u. a.) liefern Änderungen und Löschungen [15][18].
- **Gesperrtes Gerät:** Die Bibliotheks-Doku empfiehlt `isProtectedDataAvailable()` zu prüfen und beim nächsten Wecken erneut zu versuchen [18].
- **Reifegrad:** Die native Startregistrierung kam mit 14.0.0 (08.04.2026, „register observer queries in AppDelegate for background delivery“) [19]. 14.1.0 (26.08.2026) behob, dass sie bei Expo SDK 54+ wegen eines mehrzeiligen AppDelegate-Templates nicht eingefügt wurde [19]. Im aktuellen Code (16.1.0) läuft sie über den Notification-Hook statt über einen AppDelegate-Patch [17]. Issue #330 („Killing an app is the only way to get new samples“) wurde mit der Bitte geschlossen, 14.1.0 zu testen. Eine Bestätigung im Issue fehlt [19]. Unabhängige Berichte, dass das Wecken einer **beendeten** Expo-App inkl. JS-Start mit 16.x zuverlässig klappt, habe ich nicht gefunden: **nicht belegt**.

### Gewicht und Training auf iOS

- Typen wie `HKWorkoutTypeIdentifier` und Quantity-Typen lassen sich für Background Delivery konfigurieren (Beispiel in der Bibliotheks-Doku) [18]. Welches Maximum Apple für Workouts oder Gewicht erzwingt, ist nicht dokumentiert. Belegt ist nur `stepCount` = stündlich [5]. Die Bibliothek schreibt: „some types (e.g. steps) are capped at hourly regardless of what you request“ [18].

## Android: Health Connect im Hintergrund

### Was Android vorgibt

- **Standard ist Vordergrund:** „You can normally read data from Health Connect when your app is in the foreground.“ Für Hintergrund-Lesen braucht es eine zusätzliche Berechtigung [25].
- **Berechtigung:** `android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND` im Manifest deklarieren und vom Nutzer erteilen lassen. Fehlt sie, soll die App mit den übrigen Rechten weiterlaufen [25].
- **Feature-Check:** `getFeatureStatus(FEATURE_READ_HEALTH_DATA_IN_BACKGROUND)` muss `FEATURE_STATUS_AVAILABLE` liefern. Die Feature-API braucht `connect-client` ≥ 1.1.0-alpha08 [25][26]. Ein Update von Health Connect kann ein fehlendes Feature nachrüsten. Nutzer mit APK (Android 13 und älter) bekommen Funktionen nicht, die nur das Systemmodul ab Android 14 hat [26]. Ob Hintergrund-Lesen dazugehört, steht dort nicht: **nicht belegt**.
- **Doku-Beispiel:** `PeriodicWorkRequestBuilder<…>(1, TimeUnit.HOURS)` mit `enqueueUniquePeriodicWork(…, KEEP, …)` [25].
- **WorkManager-Takt:** Das Intervall ist ein Mindestabstand. Wann der Worker wirklich läuft, hängt von Bedingungen und Systemoptimierungen ab. Minimum sind 15 Minuten [28].
- **Laufzeit:** Die WorkManager-Doku grenzt lang laufende Worker mit „These Workers can run longer than 10 minutes“ ab [29]. Ein ausdrückliches Zeitlimit für normale Worker habe ich nicht im Wortlaut gefunden.
- **App-Standby-Buckets:** Häufig genutzte Apps werden mild gedrosselt, selten genutzte stark. Im Bucket „Rare“ wird auch der Internetzugang eingeschränkt. Im Bucket „Restricted“ laufen Jobs nur einmal am Tag in einer 10-Minuten-Sitzung. Die Einschränkungen gelten nur im Akkubetrieb (außer „Restricted“) [30].
- **Rate Limits:** Feste Kontingente pro Zeitraum und Tag, im Hintergrund strenger. Zahlen sind nicht veröffentlicht. Für Sync empfiehlt Google die Changelog-Funktion statt vieler roher Reads [27].

### Was `react-native-health-connect` abdeckt

- **Version:** 4.1.3 vom 06.08.2026. Peer-Dependencies u. a. `expo: *` und `@expo/config-plugins >= 6.0.2` [36]. Seit v4 ist die Expo-Integration im Paket, `expo-health-connect` ist veraltet [21].
- **Hintergrund-Berechtigung:** Seit 3.4.0 (07.09.2025) per `requestPermission([{ accessType: 'read', recordType: 'BackgroundAccessPermission' }])`. Prüfen über `getGrantedPermissions()` [20][23].
- **Manifest:** Die Doku verlangt den `<uses-permission>`-Eintrag selbst [20]. Das Config-Plugin patcht nur Rationale-Intent-Filter und Activity-Alias, **nicht** diese Berechtigung [21]. In Expo geht das über `android.permissions` in `app.json` („added … during prebuild“) [33].
- **Kein Feature-Check:** Die JS-API hat keine Funktion für `getFeatureStatus` [22]. Das Paket bindet `androidx.health.connect:connect-client:1.1.0` ein, die Feature-API wäre also nativ vorhanden [22][26]. Eine kleine eigene Erweiterung (z. B. lokales Expo-Modul) wäre nötig, wenn man den Check wie empfohlen vorschalten will (*eigene Einschätzung*).
- **Kein Hintergrund-Job:** Das Paket enthält keinen Scheduler. Ein Headless-Proof-of-Concept des Autors lag auf einem Branch (`headless_poc`), ist laut Issue aber nicht im veröffentlichten Paket [24].
- **Delta-Lesen:** `getChanges` (Change-Token) ist Teil der API [22]. Change-Tokens verfallen nach 30 Tagen ohne Nutzung [4].
- **Ohne Activity nutzbar:** Die nativen Lese-Funktionen nutzen den `ReactApplicationContext`. `currentActivity` wird nur zum Öffnen von Einstellungen gebraucht [22]. Das spricht dafür, dass Lesen aus einem Headless-Task geht (*eigene Einschätzung aus dem Code*).
- **Praxisbericht:** Ein Nutzer berichtet in Issue #83 (14.10.2024), dass er Schritte per Background-Fetch und per stillem Push im Hintergrund aus Health Connect lesen konnte [24]. Das ist ein Einzelbericht und nicht mit SDK 57 und `expo-background-task` getestet. Ein anderer Nutzer meldete Probleme beim **Schreiben** im Hintergrund [24].

### Hintergrund-Job aus Expo: `expo-background-task`

- **Version:** 57.0.21 vom 29.09.2026 (Tag `sdk-57`), ebenso `expo-task-manager` 57.0.21 [36].
- **Technik:** WorkManager auf Android, BGTaskScheduler auf iOS [31]. Der Task wird mit `TaskManager.defineTask` **im globalen Scope** definiert und mit `registerTaskAsync(…, { minimumInterval })` angemeldet [31].
- **Intervall:** Standard 12 Stunden, Minimum 15 Minuten. Der Wert ist ein Mindestabstand, das System steuert den Takt [31]. Im Code ist das Android-Intervall in Minuten angegeben. Ab Android O wird eine Kette aus Einmal-Jobs mit Startverzögerung genutzt, darunter `PeriodicWorkRequest` [32].
- **Bedingungen:** Der Android-Job verlangt `NetworkType.CONNECTED` [32]. Laut Doku läuft der Task nur mit ausreichend Akku und Netz [31]. Ohne Netz läuft also auch der Health-Import nicht.
- **Ohne laufende App:** `expo-task-manager` startet den JS-Teil über einen Headless-App-Loader [32]. Laut Doku werden Tasks gestoppt, wenn der Nutzer die App „killt“. Auf Android beendet das Wegwischen aus den letzten Apps sie aber nicht vollständig [31].
- **Testen:** `triggerTaskWorkerForTestingAsync` geht nur im Development-Modus [31].

### Fitbit: Wie zeitnah landen die Daten in Health Connect?

- Die offizielle Hilfe zur Google-Health-App (früher Fitbit-App) beschreibt Hintergrund-Zugriff, einen manuellen „Sync“-Knopf und Statusanzeigen wie „Synced 1 min ago“. **Ein Intervall nennt sie nicht** [34].
- Zum Gerät-zu-App-Sync sagt die Hilfe nur: „Your Fitbit usually syncs automatically when it's near your phone and you open the Google Health app.“ [35]
- Community-Beiträge nennen etwa 15 Minuten bei „All-Day Sync“. Das ist keine Primärquelle und wurde hier nicht verwendet: **nicht belegt**.
- Konsequenz (*eigene Einschätzung*): Die Verzögerung „Training beendet → in unserer App“ ist die Summe aus Fitbit-Gerät → Google-Health-App → Health Connect → unser Job. Nur der letzte Teil liegt bei uns. Das sollte der Prototyp auf ihrem Gerät messen (siehe auch Empfehlung in [4]).

## Vergleich

| Punkt | iOS (HealthKit) | Android (Health Connect) |
|---|---|---|
| Auslöser | Ereignis: HealthKit weckt die App bei neuen/gelöschten Samples [5] | Zeitplan: periodischer WorkManager-Job [25][31] |
| Häufigkeit | höchstens einmal je Frequenz, manche Typen höchstens stündlich [5] | Mindestabstand ≥ 15 min, Zeitpunkt bestimmt das System [28][31] |
| Berechtigung/Entitlement | Entitlement `…healthkit.background-delivery` (Plugin setzt es standardmäßig) [6][16] | `READ_HEALTH_DATA_IN_BACKGROUND` + Feature-Check [25][26] |
| Paket-Unterstützung | vollständig: Startregistrierung, Pufferung, Config-Plugin [16][17][18] | nur die Berechtigung; kein Job, kein Feature-Check, Manifest-Eintrag manuell [20][21][22] |
| Zusatzpaket | keins nötig | `expo-background-task` (+ `expo-task-manager`) [31] |
| Zeitbudget | 25 s (von der Bibliothek gesetzt); Apple nennt keine feste Zahl [12][17] | kein Limit genannt; lange Worker gelten ab > 10 min [29] |
| Netz für `/sync/push` | im Wach-Fenster möglich (Apple-Beispiel) [13] | Job läuft nur mit Netz [32] |
| Bekannte Bremsen | gesperrtes Gerät, Simulator, Backoff/Stopp nach 3 Fehlschlägen [5][11] | App-Standby-Buckets, strengere Rate Limits im Hintergrund [27][30] |
| Belegte Praxis mit diesem Paket | nicht belegt (Issue #330 ohne Bestätigung) [19] | Einzelbericht 2024 [24] |
| Frische der Quelldaten | abhängig von Apple-Geräten/Apps (nicht untersucht) | abhängig vom Fitbit-Sync, Intervall nicht belegt [34][35] |

## Antwort: machbar?

**Ja, mit Einschränkungen.**

- **Technisch umsetzbar** auf beiden Plattformen mit den festgelegten Paketen, auf Android ergänzt um `expo-background-task` und eine kleine native Erweiterung für den Feature-Check (*eigene Einschätzung* zum Umfang).
- **Nicht zusagbar:** ein fester Stundentakt. Beide Systeme behandeln die Frequenz als Obergrenze bzw. Mindestabstand und drosseln nach eigenen Regeln [5][28][30][31]. Auf iOS kommt das gesperrte Gerät dazu [11].
- **Daher:** Der Hintergrund-Import kann den Import beim Öffnen **ergänzen, aber nicht ersetzen**. Reminder dürfen sich nicht darauf verlassen (passt zu #35: Sport-Reminder dürfen nie hart „kein Sport“ behaupten [2]).

### Empfohlener Weg (Vorschlag)

1. **Grundweg bleibt Import beim Öffnen** (Vordergrund, beide Plattformen). Er ist der Rückfall aus #35 [2] und läuft immer zusätzlich.
2. **iOS:** Plugin mit `background: true` (Standard) [16]. Nach dem Health-Onboarding `configureBackgroundTypes([Workout, ggf. BodyMass, …], UpdateFrequency.hourly)` [18]. Handler per `subscribeToChanges` auf Modul-Ebene registrieren. Im Handler: `isProtectedDataAvailable()` prüfen → Anker-Query → in expo-sqlite schreiben → `/sync/push` mit kurzem Timeout. Alles muss in das 25-s-Fenster passen [17][18].
3. **Android:** `READ_HEALTH_DATA_IN_BACKGROUND` über `android.permissions` [33]. Feature-Check per kleinem lokalen Modul [26]. `BackgroundAccessPermission` nur anfragen, wenn verfügbar [20]. `expo-background-task` mit `minimumInterval: 60` [31]. Im Task `getChanges` (Change-Token) → expo-sqlite → `/sync/push` [22][27].
4. **Fehlerverhalten:** Hintergrund-Fehler still schlucken und beim nächsten Wecken oder Öffnen nachholen. Keine Nutzer-Meldung (*eigene Einschätzung*, passt zu „kein Dauer-Indikator“ in #35 [2]).
5. **Früher Prototyp auf beiden echten Geräten** (iPhone, Android + Fitbit) mit Zeitstempel-Log: Wie oft wird wirklich geweckt, reichen 25 s auf iOS, wie spät kommen Fitbit-Daten an? Erst danach den Hintergrund-Import fest einplanen. Fällt der Prototyp durch, gilt der Rückfall aus #35.

## Offene / nicht belegte Punkte

- **Fitbit-Latenz** nach Health Connect: nicht belegt [34][35]. Nur per Messung auf ihrem Gerät klärbar.
- **Wecken einer beendeten Expo-App auf iOS inkl. JS-Start mit Version 16.x:** in der Praxis nicht belegt [19]. Reichen die 25 s für Hermes-Start, Query, SQLite und HTTP? Nicht belegt [17].
- **Verhalten nach Force-Quit:** Für HealthKit Background Delivery dokumentiert Apple nichts dazu (nicht belegt). Für `expo-background-task` gilt laut Expo-Doku: Tasks stoppen, wenn der Nutzer die App killt [31].
- **Hintergrund-Lesen unter Android 13 und älter (Health-Connect-APK):** Verfügbarkeit nicht belegt. Der Feature-Check entscheidet zur Laufzeit [26].
- **Konkrete Health-Connect-Rate-Limits:** nicht veröffentlicht [27].
- **Health Connect aus `expo-background-task` mit `react-native-health-connect` 4.x:** nur durch einen älteren Einzelbericht gestützt [24].
- **expo-sqlite bei gesperrtem iPhone im Hintergrund:** nicht untersucht. Falls die Datenbankdatei bei Sperre nicht zugänglich ist, scheitert auch das lokale Speichern (*eigene Einschätzung*, im Prototyp prüfen).
- **Apple-Maximalfrequenz für Workouts und Gewicht:** nicht dokumentiert. Belegt ist nur `stepCount` = stündlich [5].
- **Store-Prüfung** (Begründung der Hintergrund-Berechtigung bei Google Play): rechtlich/organisatorisch, hier nicht betrachtet.

## Quellen

Abgerufen am 11.10.2026.

1. Ticket #45, Recherche: Hintergrund-Import von Health-Daten in Expo: https://github.com/Yggras/abnehm-app/issues/45 *(Projekt)*
2. Ticket #35, Offline-Verhalten und Sync festlegen (Abschnitt 5): https://github.com/Yggras/abnehm-app/issues/35 *(Projekt)*
3. Ticket #10, Tech-Stack festlegen: https://github.com/Yggras/abnehm-app/issues/10 *(Projekt)*
4. Health-Recherche (#6), `research/health-data.md` auf Branch `research/health-data`: https://github.com/Yggras/abnehm-app/blob/research/health-data/research/health-data.md *(Projekt)*
5. Apple, `enableBackgroundDelivery(for:frequency:withCompletion:)`: https://developer.apple.com/documentation/healthkit/hkhealthstore/enablebackgrounddelivery(for:frequency:withcompletion:) (JSON: https://developer.apple.com/tutorials/data/documentation/healthkit/hkhealthstore/enablebackgrounddelivery(for:frequency:withcompletion:).json) *(Doku)*
6. Apple, Entitlement `com.apple.developer.healthkit.background-delivery`: https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.healthkit.background-delivery *(Doku)*
7. Apple, `HKObserverQuery`: https://developer.apple.com/documentation/healthkit/hkobserverquery *(Doku)*
8. Apple, `HKObserverQueryCompletionHandler`: https://developer.apple.com/documentation/healthkit/hkobserverquerycompletionhandler *(Doku)*
9. Apple, Executing Observer Queries: https://developer.apple.com/documentation/healthkit/executing-observer-queries *(Doku)*
10. Apple, `HKUpdateFrequency`: https://developer.apple.com/documentation/healthkit/hkupdatefrequency *(Doku)*
11. Apple, Protecting user privacy (HealthKit): https://developer.apple.com/documentation/healthkit/protecting-user-privacy *(Doku)*
12. Apple, `beginBackgroundTask(withName:expirationHandler:)` und `backgroundTimeRemaining`: https://developer.apple.com/documentation/uikit/uiapplication/beginbackgroundtask(withname:expirationhandler:), https://developer.apple.com/documentation/uikit/uiapplication/backgroundtimeremaining *(Doku)*
13. Apple, Extending your app’s background execution time: https://developer.apple.com/documentation/uikit/extending-your-app-s-background-execution-time *(Doku)*
14. Apple, Choosing Background Strategies for Your App: https://developer.apple.com/documentation/backgroundtasks/choosing-background-strategies-for-your-app *(Doku)*
15. `react-native-healthkit`, README (Commit 6d3943a): https://github.com/kingstinct/react-native-healthkit/blob/6d3943a892f4c0463be1ffae41e3a7ed4a63a030/README.md *(GitHub)*
16. `react-native-healthkit`, Config-Plugin: https://github.com/kingstinct/react-native-healthkit/blob/6d3943a892f4c0463be1ffae41e3a7ed4a63a030/packages/core/src/plugin/index.ts, https://github.com/kingstinct/react-native-healthkit/blob/6d3943a892f4c0463be1ffae41e3a7ed4a63a030/packages/react-native-healthkit/app.plugin.ts *(GitHub, Quellcode)*
17. `react-native-healthkit`, `BackgroundDeliveryManager.swift` und `BackgroundLaunchHook.mm`: https://github.com/kingstinct/react-native-healthkit/blob/6d3943a892f4c0463be1ffae41e3a7ed4a63a030/packages/core/ios/BackgroundDeliveryManager.swift, https://github.com/kingstinct/react-native-healthkit/blob/6d3943a892f4c0463be1ffae41e3a7ed4a63a030/packages/core/ios/BackgroundLaunchHook.mm *(GitHub, Quellcode)*
18. `react-native-healthkit`, Doku „Subscriptions and background delivery“: https://github.com/kingstinct/react-native-healthkit/blob/6d3943a892f4c0463be1ffae41e3a7ed4a63a030/skills/react-native-healthkit/references/subscriptions-and-background.md *(GitHub, Doku)*
19. `react-native-healthkit`, Releases 14.0.0, 14.1.0, 16.0.0, 16.1.0 und Issues #51, #330: https://github.com/kingstinct/react-native-healthkit/releases, https://github.com/kingstinct/react-native-healthkit/issues/51, https://github.com/kingstinct/react-native-healthkit/issues/330 *(GitHub)*
20. `react-native-health-connect`, Doku Background Access Permission und Permissions (Commit 8d72b6a): https://github.com/matinzd/react-native-health-connect/blob/8d72b6a0774326059ce4f3854273a58b5f4d471f/docs/docs/api/methods/17-backgroundAccessPermission.md, https://github.com/matinzd/react-native-health-connect/blob/8d72b6a0774326059ce4f3854273a58b5f4d471f/docs/docs/permissions.md *(GitHub, Doku)*
21. `react-native-health-connect`, Config-Plugin und Expo-Notiz: https://github.com/matinzd/react-native-health-connect/blob/8d72b6a0774326059ce4f3854273a58b5f4d471f/app.plugin.js, https://github.com/matinzd/react-native-health-connect/blob/8d72b6a0774326059ce4f3854273a58b5f4d471f/.claude/docs/expo-and-linking.md *(GitHub, Quellcode)*
22. `react-native-health-connect`, JS-API und nativer Code: https://github.com/matinzd/react-native-health-connect/blob/8d72b6a0774326059ce4f3854273a58b5f4d471f/src/NativeHealthConnect.ts, https://github.com/matinzd/react-native-health-connect/blob/8d72b6a0774326059ce4f3854273a58b5f4d471f/android/src/main/java/dev/matinzd/healthconnect/HealthConnectManager.kt, https://github.com/matinzd/react-native-health-connect/blob/8d72b6a0774326059ce4f3854273a58b5f4d471f/android/build.gradle *(GitHub, Quellcode)*
23. `react-native-health-connect`, Release v3.4.0 und Issue #229: https://github.com/matinzd/react-native-health-connect/releases/tag/v3.4.0, https://github.com/matinzd/react-native-health-connect/issues/229 *(GitHub)*
24. `react-native-health-connect`, Issue #83 „Background Delivery“ (u. a. Kommentar vom 14.10.2024): https://github.com/matinzd/react-native-health-connect/issues/83#issuecomment-2411939740 *(GitHub, Erfahrungsbericht)*
25. Android Developers, Health Connect „Read raw data“ (Background reads, Beispiel mit WorkManager): https://developer.android.com/health-and-fitness/guides/health-connect/develop/read-data *(Doku)*
26. Android Developers, Health Connect „Check for feature availability“: https://developer.android.com/health-and-fitness/health-connect/features/availability *(Doku)*
27. Android Developers, Health Connect „Plan to avoid rate limiting“: https://developer.android.com/health-and-fitness/health-connect/rate-limiting *(Doku)*
28. Android Developers, WorkManager „Define work requests“: https://developer.android.com/develop/background-work/background-tasks/persistent/getting-started/define-work *(Doku)*
29. Android Developers, WorkManager „Support for long-running workers“: https://developer.android.com/develop/background-work/background-tasks/persistent/how-to/long-running *(Doku)*
30. Android Developers, App Standby Buckets: https://developer.android.com/topic/performance/appstandby *(Doku)*
31. Expo, BackgroundTask (`expo-background-task`, SDK 57): https://docs.expo.dev/versions/latest/sdk/background-task/ *(Doku)*
32. Expo-Quellcode (Branch `sdk-57`, Commit 4200838): https://github.com/expo/expo/blob/4200838af8de97fd20ab2fd092431ff41aa92406/packages/expo-background-task/android/src/main/java/expo/modules/backgroundtask/BackgroundTaskScheduler.kt, https://github.com/expo/expo/blob/4200838af8de97fd20ab2fd092431ff41aa92406/packages/expo-background-task/ios/BackgroundTaskScheduler.swift, https://github.com/expo/expo/blob/4200838af8de97fd20ab2fd092431ff41aa92406/packages/expo-task-manager/android/src/main/java/expo/modules/taskManager/TaskService.java *(GitHub, Quellcode)*
33. Expo, App-Config-Referenz `android.permissions`: https://docs.expo.dev/versions/latest/config/app/#permissions *(Doku)*
34. Google Health Help, How do I use Health Connect with the Google Health app?: https://support.google.com/googlehealth/answer/14506680 (früher https://support.google.com/fitbit/answer/14506680) *(Hersteller-Hilfe)*
35. Google Health Help, Track sleep with Google Health: https://support.google.com/googlehealth/answer/14236407 *(Hersteller-Hilfe)*
36. npm-Registry (abgerufen 11.10.2026): https://registry.npmjs.org/@kingstinct/react-native-healthkit, https://registry.npmjs.org/react-native-health-connect, https://registry.npmjs.org/expo-background-task, https://registry.npmjs.org/expo-task-manager, https://registry.npmjs.org/expo *(npm)*
37. GitHub-REST-API (abgerufen 11.10.2026), z. B. https://api.github.com/repos/kingstinct/react-native-healthkit/releases, https://api.github.com/repos/matinzd/react-native-health-connect/releases, https://api.github.com/repos/expo/expo/branches/sdk-57 *(GitHub)*
