# Messergebnisse

Stand: 12.10.2026. Gemessen wurde jeweils 15 Sekunden lang im lokal signierten iOS-Release-Build. Während jedes Durchlaufs wurde die Insel durchgehend gezogen sowie hinein- und herausgezoomt. Die App misst Frames des Reanimated-UI-Threads über `useFrameCallback`; die subjektive Bewertung stammt vom Nutzer am Gerät.

## iPhone SE (3. Generation), iOS 26.6.2

| Renderer | Durchlauf | Durchschnitt | Minimum (1-s-Fenster) | größte Frame-Lücke | subjektiv |
|---|---:|---:|---:|---:|---|
| Skia | 1 | 59,9 fps | 59,0 fps | 33,3 ms | flüssig |
| Skia | 2 | 59,9 fps | 59,0 fps | 33,3 ms | flüssig |
| SVG | 1 | 44,9 fps | 41,6 fps | 50,0 ms | flüssig |
| SVG | 2 (stärkerer Zoom) | 38,3 fps | 36,3 fps | 50,0 ms | flüssig |

**iPhone-Ergebnis:** Beide Renderer waren subjektiv flüssig. Skia hielt in beiden Durchläufen praktisch 60 fps, während SVG je nach Zoom auf durchschnittlich 38,3–44,9 fps fiel.

## Fairphone 6, Android 16 (SM7635)

Getestet wurde der interne Android-EAS-Release-Build: https://expo.dev/accounts/yggras/projects/abnehm-app-insel-rendering-spike/builds/73d4529e-e326-4f67-a786-f73f9402d042

| Renderer | Durchlauf | Durchschnitt | Minimum (1-s-Fenster) | größte Frame-Lücke | subjektiv |
|---|---:|---:|---:|---:|---|
| Skia | 1 | 88,5 fps | 85,7 fps | 22,3 ms | flüssig |
| Skia | 2 | 89,0 fps | 85,8 fps | 55,7 ms | flüssig |
| SVG | 1 | 8,8 fps | 7,2 fps | 222,9 ms | starkes Ruckeln |
| SVG | 2 | 9,0 fps | 8,9 fps | 133,7 ms | starkes Ruckeln |

## Entscheidung

Die vorgeschlagene Lösung **Skia v2 aus Expo SDK 57 + Reanimated + Gesture Handler trägt das Lastprofil auf beiden Zielgeräten flüssig**. Sie wird für die Inselansicht festgelegt.

`react-native-svg` ist für die gleichwertige, dicht bebaute und dauerhaft animierte Inselansicht kein tragfähiger Plan B: Auf dem Fairphone fiel es reproduzierbar auf rund 9 fps und ruckelte stark. Es bleibt nur für wesentlich einfachere bzw. statische Darstellungen eine mögliche Option; diese wurden in diesem Spike nicht gemessen.

Die Messung beantwortet die Rendering-Frage für das nachgebildete Lastprofil. Sie ersetzt keine erneute Performance-Prüfung der späteren Produktgrafik, falls deren Zeichen- oder Animationslast deutlich davon abweicht.
