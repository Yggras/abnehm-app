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

Offen: Fitbit-Daten über Google Health (ab 14.10. abends), gesperrtes Gerät, Einstellung „stündlich“, Android.
