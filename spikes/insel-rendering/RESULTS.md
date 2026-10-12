# Messergebnisse

Stand: 12.10.2026. Gemessen wurde jeweils 15 Sekunden lang im lokal signierten iOS-Release-Build. Während jedes Durchlaufs wurde die Insel durchgehend gezogen sowie hinein- und herausgezoomt. Die App misst Frames des Reanimated-UI-Threads über `useFrameCallback`; die subjektive Bewertung stammt vom Nutzer am Gerät.

## iPhone SE (3. Generation), iOS 26.6.2

| Renderer | Durchlauf | Durchschnitt | Minimum (1-s-Fenster) | größte Frame-Lücke | subjektiv |
|---|---:|---:|---:|---:|---|
| Skia | 1 | 59,9 fps | 59,0 fps | 33,3 ms | flüssig |
| Skia | 2 | 59,9 fps | 59,0 fps | 33,3 ms | flüssig |
| SVG | 1 | 44,9 fps | 41,6 fps | 50,0 ms | flüssig |
| SVG | 2 (stärkerer Zoom) | 38,3 fps | 36,3 fps | 50,0 ms | flüssig |

**Zwischenergebnis:** Beide Renderer waren subjektiv flüssig. Skia hielt in beiden Durchläufen praktisch 60 fps, während SVG je nach Zoom auf durchschnittlich 38,3–44,9 fps fiel. Damit stützt der iPhone-Test Skia als primäre Lösung. Eine endgültige Entscheidung wartet auf den Android-Test.

## Android

Noch ausstehend. EAS-Build: https://expo.dev/accounts/yggras/projects/abnehm-app-insel-rendering-spike/builds/73d4529e-e326-4f67-a786-f73f9402d042
