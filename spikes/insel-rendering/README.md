# Spike: Insel-Rendering auf Zielgeräten

Wegwerfbarer Expo-SDK-57-Spike für [„Spike: Inselansicht im Release-Build auf beiden Geräten“](https://github.com/Yggras/abnehm-app/issues/40). Er vergleicht die vorgeschlagene Skia-Lösung mit dem Plan B `react-native-svg`.

## Lastprofil

- 46 isometrische Landfelder im Zustand „voll bebaut, Abend“
- 1.382 gezeichnete Elemente (drei Feldflächen plus 27 Details je Feld, Hintergrund und Abend-Overlay)
- 157 einzeln über Reanimated bewegte Elemente
- Ziehen und Pinch-Zoom über Gesture Handler
- Umschaltbar zwischen `@shopify/react-native-skia` 2.6.2 und `react-native-svg` 15.15.4 (die von Expo SDK 57 gebündelten Versionen)

Das Lastprofil bildet Anzahl und Bewegungslast des Web-Prototyps nach, nicht dessen endgültige Grafik. Die Elementzahlen stammen aus [Recherche: Isometrische Inselansicht in Expo/React Native](https://github.com/Yggras/abnehm-app/blob/main/research/insel-rendering.md).

Die protokollierten Gerätetests stehen in [`RESULTS.md`](RESULTS.md).

## Testprotokoll

Auf **jedem** Zielgerät und mit **jedem** Renderer:

1. App vollständig beenden und neu öffnen.
2. Renderer wählen.
3. „15-Sekunden-Messung starten“ drücken.
4. Während der Messung die Insel durchgehend ziehen und hinein-/herauszoomen.
5. Durchschnitts-FPS, Minimum und größte Frame-Lücke notieren.
6. Subjektiv notieren: flüssig / gelegentliche Ruckler / deutlich störend sowie sichtbare Darstellungsfehler.
7. Den Durchlauf einmal wiederholen; bei stark abweichenden Ergebnissen einen dritten Durchlauf machen.

Die Anzeige misst Frames des Reanimated-UI-Threads mit `useFrameCallback`; sie ist eine reproduzierbare Vergleichsmetrik im Spike, kein System-Profiler. Expos Doku empfiehlt, Performance in Release-Builds zu prüfen: https://docs.expo.dev/debugging/runtime-issues/#production-errors

## Lokale Prüfung

```sh
npm install
npx tsc --noEmit
npx expo export --platform android
npx expo export --platform ios
```

## EAS-Release-Builds

```sh
npx eas-cli build --profile preview --platform android
npx eas-cli build --profile preview --platform ios
```

Der interne iOS-Build benötigt ein registriertes Gerät. Expo beschreibt Registrierung und Ad-hoc-Builds hier: https://docs.expo.dev/build/internal-distribution/#setting-up-internal-distribution-for-ios
