# Spike: Hintergrund-Import von Health-Daten auf beiden Geräten

Wegwerf-App (Expo SDK 57) für [„Spike: Hintergrund-Import von Health-Daten auf beiden Geräten“](https://github.com/Yggras/abnehm-app/issues/47). Grundlage ist [Recherche: Hintergrund-Import von Health-Daten in Expo](https://github.com/Yggras/abnehm-app/blob/main/research/health-background.md).

Die App liest Health-Daten nur und protokolliert jeden Lauf lokal (`health-spike-log.jsonl`). Sie schreibt nichts nach Apple Health oder Health Connect.

## Was die App macht

| | iPhone | Android |
|---|---|---|
| Auslöser im Hintergrund | HealthKit weckt die App bei neuen Daten (`configureBackgroundTypes`, wahlweise „sofort“ oder „stündlich“) | `expo-background-task` (WorkManager), wahlweise alle 15 oder 60 min |
| Gelesen per Delta | Anker-Abfragen für Workouts, Gewicht, Schritte, aktive Kalorien, Trainingsminuten | Change-Token (`getChanges`) für ExerciseSession, Steps, Weight, Total-/ActiveCaloriesBurned |
| Je Lauf protokolliert | Zeitpunkt, App-Zustand, ob geschützte Daten verfügbar waren (gesperrtes Gerät), neue Einträge mit Quelle (`bundleIdentifier`), Abstand „Ende des Eintrags → Import“, Laufzeit | Zeitpunkt, neue Einträge mit `dataOrigin`, Abstand „Ende → in Health Connect geschrieben“ (`lastModifiedTime`) und „geschrieben → importiert“, Laufzeit |
| Test-Upload | `POST` an `https://httpbin.org/post`, nur Metadaten (Plattform, Auslöser, Anzahl) – **keine Gesundheitswerte** | wie iPhone |
| Sichtbar am Gerät | lokale Mitteilung bei jedem Hintergrund-Lauf | wie iPhone |
| Extra | Inventur: welche Typen kamen in den letzten 7 Tagen von welcher Quelle | Inventur wie iPhone; Feature-Check `FEATURE_READ_HEALTH_DATA_IN_BACKGROUND` über ein eigenes kleines Modul (`modules/hc-feature`) |

Wichtig: **„Jetzt importieren“ nur sparsam drücken.** Ein Import im Vordergrund verbraucht die neuen Einträge. Der nächste Hintergrund-Lauf sieht sie dann nicht mehr als neu.

## Testablauf iPhone (Philipp, Fitbit Sense 2)

Voraussetzung: In Google Health (≥ 5.05) unter Profil → „Partner apps“ → „Apple Health“ die Freigabe erteilt. Laut [TechTimes](https://www.techtimes.com/articles/322971/20260804/fitbit-reaches-apple-health-new-google-health-update-hrv-still-blocked.htm); eine offizielle Google-Doku wurde nicht gefunden.

1. App öffnen → **„1 · Rechte anfragen“** → alle Lesezugriffe und Mitteilungen erlauben.
2. **„2 · Hintergrund: sofort“** drücken. Die ersten Tage messen so die Fitbit-Kette möglichst genau.
3. **„Inventur“** drücken. Das beantwortet, welche Datentypen Google Health nach Apple Health schreibt und mit welcher Quelle.
4. App in den Hintergrund schicken (nicht wegwischen) und normal weiterleben. Uhr tragen.
5. Szenarien (je Szenario Uhrzeit notieren):
   - a) Training mit der Uhr aufzeichnen. Danach notieren: Trainingsende und wann Google Health „synchronisiert“ anzeigt. Wann kommt die Mitteilung?
   - b) App **wegwischen** (Force-Quit) und noch ein Training bzw. Schritte sammeln.
   - c) iPhone **gesperrt** in der Tasche lassen, während die Uhr synchronisiert.
   - d) Optional: wiegen bzw. ein Gewicht in Google Health eintragen.
6. Nach 2 Tagen auf **„Hintergrund: stündlich“** umstellen (die V1-Einstellung) und einen weiteren Tag laufen lassen.
7. **„Protokoll teilen“** und die Datei an die Session geben.

## Testablauf Android (Fitbit)

Voraussetzung: In Google Health unter „Connections“ → „Partner apps“ → „Sync your favorite health apps“ die Freigabe nach Health Connect eingeschaltet ([Google-Health-Hilfe](https://support.google.com/googlehealth/answer/14506680)).

1. APK installieren und öffnen.
2. **„Status prüfen“** → steht beim Feature-Check „verfügbar“?
3. **„1 · Rechte anfragen“** → im Health-Connect-Dialog alles erlauben, auch **„Im Hintergrund zugreifen“**. Mitteilungen erlauben.
4. **„2 · Hintergrund-Job alle 15 min“**. Akku-Optimierung **nicht** abschalten, damit der Test realistisch bleibt.
5. Normal weiterleben, Uhr tragen. Einmal die App aus den letzten Apps wegwischen. Das Handy auch gesperrt liegen lassen.
6. Nach 2 Tagen **„alle 60 min“** und einen weiteren Tag laufen lassen.
7. **„Protokoll teilen“**.

## Bauen

```sh
npm install
npx tsc --noEmit
npx expo prebuild --clean
# iPhone (lokal signiert, per Kabel/WLAN gekoppelt):
npx expo run:ios --configuration Release --device <UDID>
# Android (lokal, Release-APK):
android/gradlew -p android :app:assembleRelease
```

- iOS wird lokal mit dem Apple-Team aus `app.json` (`ios.appleTeamId`) signiert. Laut Apple ist HealthKit auch ohne bezahltes Developer Program verfügbar ([Supported capabilities (iOS)](https://developer.apple.com/help/account/reference/supported-capabilities-ios)). Für das Entitlement „Background Delivery“ nennt die Tabelle keinen eigenen Eintrag; ob es mit dem vorhandenen Team signiert, zeigt der Build.
- `plugins/without-push-entitlement.js` entfernt `aps-environment`, das `expo-notifications` automatisch setzt. Der Spike braucht nur lokale Mitteilungen.
- Laut [Recherche: Private Verteilung](https://github.com/Yggras/abnehm-app/issues/8) muss eine mit kostenlosem Konto signierte App nach 7 Tagen neu installiert werden. Für einen Spike von wenigen Tagen reicht das.

## Bekannte Grenzen der Messung

- Auf iOS gibt HealthKit keinen Zeitpunkt „in Apple Health geschrieben“ heraus. Mit „sofort“ ist der Weck-Zeitpunkt die beste Näherung. Der Abstand Uhr → Google Health → Apple Health lässt sich daher nur zusammen mit der Weckverzögerung messen, ergänzt um die notierte „synchronisiert“-Zeit aus Google Health.
- Die Bibliothek hält die App nach dem Wecken 25 s wach ([Recherche](https://github.com/Yggras/abnehm-app/blob/main/research/health-background.md)). „Längster Lauf“ in der Auswertung zeigt, wie viel davon gebraucht wird.
- Ergebnisse werden in `RESULTS.md` festgehalten.
