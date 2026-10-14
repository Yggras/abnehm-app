# Messergebnisse

Zeiten in Ortszeit (MESZ). Quelle aller Werte: Protokoll der Spike-App (`health-spike-log.jsonl`), per `devicectl` vom Gerät gelesen.

## Ergebnis

**Hintergrund-Import bleibt in V1 – als Bonus, Import beim Öffnen bleibt der Grundweg** (wie in [Offline-Verhalten und Sync festlegen](https://github.com/Yggras/abnehm-app/issues/35) vorgesehen).

- **iOS: belegt.** HealthKit weckt die App auch aus dem beendeten Zustand und nach Force-Quit; Lesen + Speichern + Upload dauern ~1–4 s (Fenster 25 s). Ein Fitbit-Training war ≈ 40 s nach Trainingsende in der App. Weckungen fanden nur bei entsperrtem Gerät statt.
- **Android: nicht verifiziert.** Auf Wunsch von Philipp nicht auf dem Gerät getestet, um voranzukommen. Der Android-Teil der Spike-App (Health Connect + `expo-background-task` + Feature-Check-Modul) kompiliert als Release-APK. Da der Hintergrund-Import nur ein Bonus ist, betrifft ein Fehlschlag nur diesen Bonus, nicht Datenmodell oder Sync. → Gerätetest früh in der Umsetzung nachholen (Spike-App liegt bereit, Ablauf im README).
- Der geplante Messtag mit „stündlich“ entfällt: Apple begrenzt Schritte ohnehin auf höchstens stündlich, und die Weckungen hängen am Entsperren.

### Hinweise für die Spezifikation

- **Onboarding (iPhone + Fitbit):** Die Kopplung Uhr ↔ Google Health genügt nicht; zusätzlich in Google Health **Profil → Partner apps → Apple Health** verbinden. Die App sollte prüfen, ob Daten der Quelle `com.fitbit.FitbitMobile` ankommen, und sonst anleiten.
- **Quellen erkennen:** Fitbit-Einträge kommen in HealthKit mit `bundleIdentifier` `com.fitbit.FitbitMobile` (Name „Google Health“, Gerät „Sense 2“).
- **Doppelte Quellen:** iPhone und Google Health schreiben Schritte/aktive Energie/Strecke für dieselben Zeiträume; keine Rohsummen über alle Quellen.
- **Kleinst-Trainings:** Ein 0-Minuten-Training wird übertragen; nicht als Sport werten.
- **Importe serialisieren:** Google Health schreibt mehrere Typen gleichzeitig → mehrere fast gleichzeitige Weckungen.
- **Erste Abfrage ohne Anker** liefert die gesamte Historie; nur zählen bzw. begrenzen, nicht einzeln verarbeiten.
- **Beobachter erst nach erteilten Rechten anmelden**, sonst scheitern sie mit „Authorization not determined“.
- **Keine Abhängigkeit von der Health-App:** Gelesen wird HealthKit; die App muss nicht installiert sein (Apple: Daten und Zugriffe bleiben beim Löschen erhalten, [Integrierte Apps löschen](https://support.apple.com/en-us/118582)).

## iPhone SE (3. Generation), Nacht 13./14.10.2026 – ohne Uhr

Einstellung: Background Delivery „sofort“ für Workout, Gewicht, Schritte, aktive Kalorien, Trainingsminuten. Einzige Datenquelle: das iPhone selbst (`com.apple.health.<UUID>`).

| Wecken im Hintergrund | JS-Kaltstart? | neue Einträge | Ende des Eintrags → Import | Laufzeit | Upload |
|---|---|---|---|---|---|
| 13.10. 23:43 | nein (App lag noch im Speicher) | 0 | – | < 1,1 s | 5/5 ok |
| 14.10. 00:18 | **ja** | 2 (Schritte, aktive kcal) | 25,9 min | < 1,1 s | 5/5 ok |
| 14.10. 08:10 | **ja** | 5 (Schritte, aktive kcal) | 4,8–29,7 min | < 1,1 s | 5/5 ok |
| 14.10. 09:23 | **ja – nach Force-Quit** (weggewischt ca. 08:00–08:10) | 13 (Schritte, aktive kcal) | 18–76 min | < 1,1 s | ok |

Beobachtungen:

- **Wecken aus dem beendeten Zustand funktioniert**, auch **nach Force-Quit**. Das war in der [Recherche](https://github.com/Yggras/abnehm-app/blob/main/research/health-background.md) für Version 16.x als „nicht belegt“ markiert.
- Bei jedem Wecken melden alle fünf Beobachter gleichzeitig, auch Typen ohne neue Daten.
- Trotz „sofort“ kamen über den Tag nur etwa stündliche Weckungen; iPhone-Schritte waren beim Import bis zu 76 min (einmal 143 min) alt. Apple begrenzt Schritte auf höchstens stündlich ([Apple-Doku, über Recherche [5]](https://github.com/Yggras/abnehm-app/blob/main/research/health-background.md)). Wann das iPhone seine Schritte nach HealthKit schreibt, ist nicht messbar; die Abstände sind daher Obergrenzen.
- Lesen + Speichern + Upload brauchten höchstens 1,1 s (später bei gleichzeitigen Weckungen Uploads bis 4 s) – weit unter dem 25-s-Fenster der Bibliothek.
- **Gesperrtes Gerät:** Kein Wecken fand bei gesperrtem Gerät statt; Philipp beobachtet, dass die Spike-Mitteilungen beim Entsperren erscheinen. Passend dazu laut Apple: HealthKit-Daten liegen in der Klasse „Protected Unless Open“, „Access to the data is relinquished 10 minutes after the device locks“, und „Temporary journal files store health records that are generated when the device is locked“ ([Apple Platform Security](https://support.apple.com/guide/security/protecting-access-to-users-health-data-sec88be9900f/web)). Dass die Beobachter deshalb erst nach dem Entsperren feuern, ist eine Schlussfolgerung, nicht von Apple belegt; eine gezielte Gegenprobe wurde nicht gemacht.

## iPhone + Fitbit Sense 2 über Google Health, 14.10.2026 abends

**Einrichtung:** Die Kopplung Uhr ↔ Google Health allein reicht nicht. Bis Philipp in Google Health zusätzlich die Verbindung zu Apple Health eingerichtet hatte, schrieb Google Health nichts nach HealthKit (unter „Datenquellen & Zugriff“ stand nur die Spike-App). Pfad laut Philipp (Google Health, 14.10.2026): **Profil → Partner apps → Apple Health**; die Freigabe selbst war klar.

**Inventur 19:37** (Quelle „Google Health“, `bundleIdentifier` **`com.fitbit.FitbitMobile`** – bestätigt die Erwartung aus [Recherche #53](https://github.com/Yggras/abnehm-app/issues/53)):

| Typ | von Google Health |
|---|---|
| Schritte, aktive Energie, Strecke, Stockwerke | ja, als Minutenwerte |
| Herzfrequenz | ja |
| Gewicht | ja (ein Eintrag) |
| Workouts | ja (siehe unten) |
| Schlaf, Ruhepuls | zum Zeitpunkt der Inventur noch keine Nacht – nicht geprüft |
| HRV, SpO₂, Atemfrequenz | nein (HRV fehlt laut [TechTimes](https://www.techtimes.com/articles/322971/20260804/fitbit-reaches-apple-health-new-google-health-update-hrv-still-blocked.htm)) |

**Erstübertragung:** weckte die App um 19:35 im Hintergrund; neuester Fitbit-Eintrag beim Import 4,5 min alt.

**Doppelte Quellen:** iPhone und Google Health schreiben Schritte, aktive Energie und Strecke für dieselben Zeiträume. Apple-Statistikabfragen berücksichtigen die Quellenpriorität ([HKStatisticsQuery](https://developer.apple.com/documentation/healthkit/hkstatisticsquery)). V1 importiert laut [#38](https://github.com/Yggras/abnehm-app/issues/38) nur Trainings und Gewicht.

**Workout-Latenz (Kernmessung):** Testtraining auf der Uhr (Dauer 20 s, 0 Schritte), Ende 20:01:52 → als `HKWorkout` (Quelle Google Health `com.fitbit.FitbitMobile`, Gerät „Sense 2“, `workoutActivityType` 52, keine Kalorien) **im Hintergrund importiert um 20:02:31 – gesamte Kette Uhr → Google Health → HealthKit → App ≈ 40 s**. iPhone war entsperrt.

- Ob Dauer und Kalorien eines realen Trainings korrekt übertragen werden, ist nicht geprüft (nur Testtraining von 20 s).
- Google Health schreibt mehrere Typen in derselben Sekunde; das löste 7 fast gleichzeitige Weckungen aus, Uploads bis 4 s, alle erfolgreich.

## Android

Nicht auf dem Gerät getestet (siehe Ergebnis). Nicht belegt sind damit: Verfügbarkeit von `FEATURE_READ_HEALTH_DATA_IN_BACKGROUND` auf dem Zielgerät, tatsächlicher Takt des WorkManager-Jobs, Health-Connect-Lesen und Upload aus dem Headless-Task, Fitbit-Latenz bis Health Connect.
