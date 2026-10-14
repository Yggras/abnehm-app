# Messergebnisse

Zeiten in Ortszeit (MESZ). Quelle aller Werte: Protokoll der Spike-App (`health-spike-log.jsonl`), per `devicectl` vom Gerät gelesen.

## iPhone SE (3. Generation), Nacht 13./14.10.2026 – ohne Uhr

Einstellung: Background Delivery „sofort“ für Workout, Gewicht, Schritte, aktive Kalorien, Trainingsminuten. Einzige Datenquelle: das iPhone selbst (`com.apple.health.<UUID>`); von Google Health kam noch nichts an.

| Wecken im Hintergrund | JS-Kaltstart? | neue Einträge | Ende des neuesten Eintrags → Import | Laufzeit | Upload |
|---|---|---|---|---|---|
| 13.10. 23:43 | nein (App lag noch im Speicher) | 0 | – | < 1,1 s | 5/5 ok |
| 14.10. 00:18 | **ja** | 2 (Schritte, aktive kcal) | 25,9 min | < 1,1 s | 5/5 ok |
| 14.10. 08:10 | **ja** | 5 (Schritte, aktive kcal) | 4,8–29,7 min | < 1,1 s | 5/5 ok |

| 14.10. 09:23 | **ja – nach Force-Quit** (weggewischt ca. 08:00–08:10) | 13 (Schritte, aktive kcal) | 18–76 min | < 1,1 s | ok |

Beobachtungen:

- **Wecken nach Force-Quit funktioniert:** Die App wurde zwischen 08:00 und 08:10 weggewischt und um 09:23 von iOS im Hintergrund kaltgestartet; Import und Upload liefen.
- Zwischen 08:10 und 09:23 kam kein Wecken, obwohl ab 08:04 neue Schritte entstanden. Die Einträge waren beim Import bis zu 76 min alt – vereinbar mit Apples „höchstens stündlich“ für Schritte, aber die Schreibzeit des iPhones in HealthKit ist nicht messbar.

- **Wecken aus dem beendeten Zustand funktioniert:** Zweimal hat iOS die App ohne laufenden Prozess im Hintergrund gestartet (`jsStart` zeitgleich mit dem Wecken). Das war in der [Recherche](https://github.com/Yggras/abnehm-app/blob/main/research/health-background.md) für Version 16.x als „nicht belegt“ markiert.
- Bei jedem Wecken melden alle fünf Beobachter gleichzeitig, auch Typen ohne neue Daten.
- Trotz „sofort“ kamen nur 3 Weckungen in gut 8 Stunden. Die iPhone-Schritte lagen 5–30 min vor dem Wecken. Apple begrenzt Schritte auf höchstens stündlich ([Apple-Doku, über Recherche [5]](https://github.com/Yggras/abnehm-app/blob/main/research/health-background.md)). Wann das iPhone seine Schritte nach HealthKit schreibt, ist nicht messbar; der Abstand ist deshalb eine Obergrenze für die Weckverzögerung.
- Lesen + Speichern + Upload brauchten höchstens 1,1 s, der längste Upload 962 ms – weit unter dem 25-s-Fenster der Bibliothek.
- Alle Weckungen hatten Zugriff auf geschützte Daten; kein Wecken fand bei gesperrtem Gerät statt. Philipp beobachtet, dass die Spike-Mitteilungen beim Aufwecken bzw. Entsperren des iPhones erscheinen. Passend dazu laut Apple: HealthKit-Daten liegen in der Klasse „Protected Unless Open“, „Access to the data is relinquished 10 minutes after the device locks“, und „Temporary journal files store health records that are generated when the device is locked“ ([Apple Platform Security](https://support.apple.com/guide/security/protecting-access-to-users-health-data-sec88be9900f/web)). Dass die Beobachter deshalb erst nach dem Entsperren feuern, ist eine Schlussfolgerung, nicht von Apple belegt. Gegenprobe: > 10 min gesperrt gehen, dann entsperren, ohne die App zu öffnen.

## iPhone + Fitbit Sense 2 über Google Health, ab 14.10.2026 abends

**Einrichtung:** Die Kopplung Uhr ↔ Google Health allein reicht nicht. Bis Philipp in Google Health zusätzlich die Verbindung zu Apple Health eingerichtet hatte, schrieb Google Health nichts nach HealthKit (unter „Datenquellen & Zugriff“ stand nur die Spike-App). Das war nicht offensichtlich → Onboarding muss diesen zweiten Schritt ausdrücklich anleiten und prüfen. Pfad laut Philipp (Google Health, 14.10.2026): **Profil → Partner apps → Apple Health**; die Freigabe selbst war klar.

**Inventur 19:37** (Quelle „Google Health“, `bundleIdentifier` **`com.fitbit.FitbitMobile`** – bestätigt die Erwartung aus [Recherche #53](https://github.com/Yggras/abnehm-app/issues/53)):

| Typ | von Google Health |
|---|---|
| Schritte, aktive Energie, Strecke, Stockwerke | ja, als Minutenwerte |
| Herzfrequenz | ja |
| Gewicht | ja (ein Eintrag) |
| Workouts | noch keins aufgezeichnet |
| Schlaf, Ruhepuls | noch keine Nacht |
| HRV, SpO₂, Atemfrequenz | nein (HRV fehlt laut [TechTimes](https://www.techtimes.com/articles/322971/20260804/fitbit-reaches-apple-health-new-google-health-update-hrv-still-blocked.htm)) |

**Wecken:** Die erste Übertragung nach dem Verbinden weckte die App um 19:35 im Hintergrund; neuester Fitbit-Eintrag beim Import 4,5 min alt (Erstübertragung, kein Normalbetrieb).

**Doppelte Quellen:** iPhone und Google Health schreiben Schritte, aktive Energie und Strecke für dieselben Zeiträume. Summen dürfen nicht über alle Einträge gebildet werden; Apple-Statistikabfragen berücksichtigen die Quellenpriorität ([HKStatisticsQuery](https://developer.apple.com/documentation/healthkit/hkstatisticsquery)). V1 importiert laut [#38](https://github.com/Yggras/abnehm-app/issues/38) nur Trainings und Gewicht; dort ist die Doppelung noch zu prüfen.

**Workout-Latenz (Kernmessung):** Testtraining auf der Uhr (Dauer 20 s, 0 Schritte), Ende 20:01:52 → als `HKWorkout` (Quelle Google Health `com.fitbit.FitbitMobile`, Gerät „Sense 2“, `workoutActivityType` 52, keine Kalorien) **im Hintergrund importiert um 20:02:31 – gesamte Kette Uhr → Google Health → HealthKit → App ≈ 40 s**. iPhone war entsperrt.

- Auch ein 0-Minuten-Training wird übertragen → V1 sollte Kleinst-Trainings nicht als Sport werten (Hinweis für die Spezifikation).
- Google Health schreibt mehrere Typen in derselben Sekunde; das löste 7 fast gleichzeitige Weckungen aus, Uploads bis 4 s, alle erfolgreich. Die echte App sollte Importe serialisieren.

Offen: Workout mit realer Dauer (Dauer/Kalorien prüfen) (ab 14.10. abends), gesperrtes Gerät, Einstellung „stündlich“, Android.
