# Recherche: Private Verteilung der App an zwei Geräte (1x iPhone, 1x Android)

Issue: #8 · Stand der Recherche: 2026-10-10 · Alle Aussagen mit Quellennummer [n], Quellenliste am Ende.
Aussagen, die nicht belegt werden konnten, sind ausdrücklich als **„nicht verifiziert“** markiert.

## Zusammenfassung

| Option | Kosten | Gültigkeit pro Build | Update-Aufwand | Mac nötig? | HealthKit / Health Connect | Push |
|---|---|---|---|---|---|---|
| **iOS: TestFlight intern** | 99 USD/Jahr Apple Developer Program [1] | 90 Tage [2][3] | Build hochladen, Partnerin/Partner lädt per TestFlight-App [2] | Für den Build ja (Xcode), alternativ Cloud-Build (z. B. EAS Build auf macOS-VMs) [12][13] | HealthKit ja (Capability im ADP verfügbar) [5] | ja (ADP) [5] |
| iOS: TestFlight extern | 99 USD/Jahr [1] | 90 Tage [2] | Erster Build braucht App Review [2] | wie oben | wie oben | wie oben |
| iOS: Ad Hoc | 99 USD/Jahr [1] | Profil-Laufzeit: **nicht verifiziert** | IPA per Link/Firebase/EAS; Gerät muss per UDID registriert sein [6][9][14] | wie oben | ja [5] | ja [5] |
| iOS: kostenloses Apple-Konto (Personal Team) | 0 € | **7 Tage**, danach neu bauen und installieren [4] | jede Woche per Xcode neu installieren [4] | **ja** (Xcode, macOS) [4][15] | HealthKit ja [5] | **nein** [5] |
| **Android: Play Internal Testing** | 25 USD einmalig [7] | keine Ablauffrist dokumentiert | AAB hochladen, in Minuten verfügbar [8] | nein | Health-Connect-Deklaration in Play nötig [16] | nicht an Verteilweg geknüpft (nicht verifiziert) |
| Android: APK direkt | 0 € | unbegrenzt (keine Ablauffrist dokumentiert) | APK per Link/Mail schicken, „Unbekannte Apps installieren“ erlauben [17] | nein | **nicht verifiziert** | nicht verifiziert |
| Android: Firebase App Distribution | 0 € (Spark-Plan) [10] | 150 Tage im Firebase-Dashboard [11] | Upload per Konsole/CLI, Mail-Einladung [11][18] | nein | nicht verifiziert | nicht verifiziert |

**Empfehlung (Bewertung, keine Tatsachenaussage):**
- **iPhone: Apple Developer Program (99 USD/Jahr) + TestFlight mit internen Testern.** Kein App Review für interne Tester dokumentiert (Review wird von Apple nur für externe Tester genannt [2]), Push funktioniert, HealthKit funktioniert, Updates per TestFlight-App. Einziger Wartungspunkt: alle 90 Tage muss ein neuer Build hochgeladen werden [2]. Das kostenlose Personal Team scheidet praktisch aus (7-Tage-Ablauf, kein Push [4][5]).
- **Android: Google Play Internal Testing (25 USD einmalig).** Die 12-Tester-/14-Tage-Pflicht für neue Privatkonten gilt nur für den Weg in die **Produktion**, nicht für Internal Testing [19]. Updates kommen automatisch über den Play Store, und die Android-Entwicklerverifizierung (ab 2026/2027) ist über Play bereits abgedeckt [20]. Fallback: direktes APK, für Entwicklung per `adb` auch ohne Verifizierung [20].
- Kein eigener Mac nötig, wenn ein Cloud-Build-Dienst genutzt wird (z. B. EAS Build, das iOS-Builds auf macOS-VMs ausführt [13]). Ob das passt, hängt von der Technologie-Wahl ab (eigenes Issue).

---

## Details iOS

### TestFlight – interne Tester
- Bis zu **100 interne Tester**. Interne Tester müssen **App-Store-Connect-Benutzer mit Zugriff auf die Inhalte** sein [2]. Die zweite Person braucht also eine eigene Apple-ID und wird ins Team (App Store Connect) eingeladen [3].
- Interne Tester können alle Builds **90 Tage** lang herunterladen und testen [3]. „Your build becomes unavailable for testers after 90 days.“ [2]
- Installation über die kostenlose **TestFlight-App** [2].
- Review: Apple nennt eine Review-Pflicht ausdrücklich nur für externe Tester („If you invite external testers, your beta build may require review.“) [2]. Eine explizite Aussage „interne Builds ohne Review“ fand sich auf der Seite „Add internal testers“ nicht wörtlich [3]; das ergibt sich nur aus der Abgrenzung in [2].
- TestFlight setzt die Mitgliedschaft im Apple Developer Program voraus [1][4].

### TestFlight – externe Tester
- Bis zu 10.000 Personen. Der **erste Build**, der einer Gruppe hinzugefügt wird, geht durch App Review; Folge-Builds „may not require a full review“ [2].
- Auch hier 90 Tage Laufzeit pro Build [2].
- Für ein Paar ohne Mehrwert gegenüber intern, aber mit Review-Wartezeit.

### Ad Hoc
- Ad-Hoc-Profile erlauben, eine App ohne Xcode auf registrierten Geräten zu installieren. Dafür nötig sind App-ID, Distribution-Zertifikat und registrierte Geräte; die Rolle Account Holder oder Admin ist erforderlich [6].
- Bis zu **100 Geräte pro Produktfamilie und Mitgliedschaftsjahr**; Deaktivieren gibt kein Kontingent frei [9].
- Neue Geräte erfordern ein neues Profil und einen neuen Build bzw. Re-Signing [14][21].
- Laufzeit eines Ad-Hoc-Profils: in den geprüften Apple-Seiten **nicht dokumentiert, daher nicht verifiziert**.
- Verteilung der IPA z. B. über Firebase App Distribution oder EAS-Links [14][21].

### Kostenloses Apple-Konto (Personal Team)
Wörtlich laut Apple [4]: „You can register up to 10 App IDs, which expire after 7 days. You can register up to 3 devices, which expire after 7 days. You can install up to 3 apps per device. Provisioning profiles that enable apps to be installed on a device will expire 7 days from issuance. You'll need to rebuild and reinstall your app to your device after expiration.“
- Verwaltung „directly in Xcode“ [4], also Mac mit Xcode nötig. Aktuelles Xcode 27 verlangt macOS Tahoe 26.6 oder neuer [15].
- Capabilities: **HealthKit** ist auch für das kostenlose Konto („Apple Developer“) verfügbar, **Push Notifications nicht** (Spalte leer) [5].
- Kein TestFlight und kein App Store Connect ohne Programm-Mitgliedschaft [1].
- Fazit: wöchentliches Neuinstallieren per Kabel/Xcode am iPhone der zweiten Person. Für den Alltag ungeeignet (Bewertung).

### Neuere bzw. weitere Optionen (geprüft, für uns ungeeignet)
- **Unlisted App Distribution**: App ist nur per Link im App Store auffindbar, verlangt aber ein reguläres App Review, Beta-Apps werden abgelehnt, und jeder mit dem Link kann sie laden [22].
- **Web Distribution (EU, DMA)**: setzt u. a. > 1 Mio. Erstinstallationen im Vorjahr und 2 Jahre Mitgliedschaft voraus oder alternativ Finanz-/Unternehmenskriterien [23]. Für ein Privatprojekt nicht erreichbar.
- **Enterprise Program** (299 USD/Jahr) ist für die Verteilung an Mitarbeitende von Organisationen gedacht [1].

### Mac-Frage iOS
- Xcode wird vom Personal-Team-Weg direkt vorausgesetzt [4]. Systemvoraussetzung ist macOS [15].
- Cloud-Alternative: EAS Build erstellt jede iOS-Build-Instanz auf einer „fresh macOS VM“ [13]. Für Device-/Store-Builds braucht es ein Apple-Developer-Konto [12][13]. Ein lokaler Mac ist damit nicht nötig.

---

## Details Android

### Google Play – Internal Testing
- Registrierungsgebühr **25 USD einmalig** [7].
- Bis zu **100 Tester**, Einladung per E-Mail-Liste oder teilbarem Link. Neue Builds sind „within minutes“ verfügbar. Internal Tests „might not be subject to standard Play policy or security reviews“. Möglich, auch wenn die App „not fully configured“ ist [8].
- **Neue Privatkonten** (erstellt nach dem 13.11.2023) müssen vor **Produktion** einen Closed Test mit mindestens **12 Testern über 14 Tage** durchführen [19]. Das betrifft den Weg in die Produktion. Internal Testing ist laut derselben Seite optional und unterliegt dieser Anforderung nicht [19]. Für zwei Geräte reicht Internal Testing, also ist die Hürde irrelevant.
- Neue Privatkonten müssen zudem den Zugriff auf ein Android-Gerät über die Play-Console-App bestätigen [7].
- Health Connect: Die Deklaration der Datentypen „must be completed for all publishing requests“ [16]. Ob das für Internal-Testing-Releases genauso streng gilt, ist **nicht verifiziert**.

### Direkte APK-Installation (Sideloading)
- Offiziell vorgesehen: APK auf Website oder per E-Mail; Nutzer müssen „Install unknown apps“ erlauben [17].
- **Android-Entwicklerverifizierung**: Ab dem 30.09.2026 gelten Schutzmaßnahmen auf zertifizierten Geräten zunächst in Brasilien, Indonesien, Singapur und Thailand, **global ab 2027** [20][24]. Danach müssen auch außerhalb von Play verteilte Apps von verifizierten Entwicklern stammen. Ausnahmen bzw. Optionen:
  - Installation per **ADB** bleibt ohne Verifizierung erlaubt [20].
  - **Limited Distribution Account**: kostenlos, ohne Ausweis, für Hobbyisten „who share apps with family and friends“, bis zu **20 Geräte** per QR-Code/Link-Handshake [25].
  - Apps mit Play App Signing werden automatisch registriert [20].
  - Ein Full-Distribution-Konto in der Android Developer Console kostet 25 USD [20].
- Wann die Regel in Deutschland gilt: über „globale Expansion 2027“ hinaus **nicht genauer verifiziert** [24].
- Updates: jede neue APK manuell verteilen und installieren (ergibt sich aus [17]).

### Firebase App Distribution (Android und iOS)
- Auf dem kostenlosen Spark-Plan enthalten [10].
- Builds bleiben **150 Tage** im Dashboard, Einladungen verfallen nach 30 Tagen [11].
- iOS: nur Ad-Hoc- (oder Enterprise-) signierte Builds. Die UDID muss im Profil stehen; nach dem Registrieren neuer Geräte muss neu gebaut werden [21]. Damit gilt auch hier: Apple Developer Program nötig (Ad Hoc ist Teil davon [1][6]).

### Push (Android)
- Ob Push (FCM) vom Verteilweg abhängt, wurde in den geprüften Quellen nicht behandelt: **nicht verifiziert**.

---

## Quellen

1. Apple Developer Program, Preise und Mitgliedschaftsvergleich: https://developer.apple.com/programs/ · https://developer.apple.com/support/compare-memberships/
2. Apple, TestFlight overview: https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview
3. Apple, Add internal testers: https://developer.apple.com/help/app-store-connect/test-a-beta-version/add-internal-testers
4. Apple, Developer account overview (Personal Team, 7-Tage-Limits): https://developer.apple.com/help/account/basics/about-your-developer-account
5. Apple, Supported capabilities (iOS), Spalten ADP / ADEP / Apple Developer: https://developer.apple.com/help/account/reference/supported-capabilities-ios
6. Apple, Create an ad hoc provisioning profile: https://developer.apple.com/help/account/provisioning-profiles/create-an-ad-hoc-provisioning-profile
7. Google Play Console Help, Get started with Play Console (25 USD, Gerätenachweis): https://support.google.com/googleplay/android-developer/answer/6112435
8. Google Play Console Help, Set up an open, closed, or internal test: https://support.google.com/googleplay/android-developer/answer/9845334
9. Apple, Devices overview (100 Geräte pro Produktfamilie/Jahr): https://developer.apple.com/help/account/devices/devices-overview
10. Firebase Pricing: https://firebase.google.com/pricing
11. Firebase, Distribute iOS apps using the console (150 Tage, 30 Tage Einladung): https://firebase.google.com/docs/app-distribution/ios/distribute-console
12. Expo, Create your first build: https://docs.expo.dev/build/setup/
13. Expo, iOS build process (macOS-VM): https://docs.expo.dev/build-reference/ios-builds/
14. Expo, Internal distribution: https://docs.expo.dev/build/internal-distribution/
15. Apple, Xcode system requirements: https://developer.apple.com/xcode/system-requirements/
16. Android Developers, Health Connect – Declare access / publish: https://developer.android.com/health-and-fitness/guides/health-connect/publish/declare-access
17. Android Developers, Alternative distribution options: https://developer.android.com/distribute/marketing-tools/alternative-distribution
18. Firebase App Distribution Überblick: https://firebase.google.com/docs/app-distribution
19. Google Play Console Help, App testing requirements for new personal developer accounts: https://support.google.com/googleplay/android-developer/answer/14151465
20. Android Developers, Developer verification FAQ: https://developer.android.com/developer-verification/guides/faq
21. Firebase, Register additional iOS devices: https://firebase.google.com/docs/app-distribution/register-additional-devices
22. Apple, Unlisted app distribution: https://developer.apple.com/support/unlisted-app-distribution/
23. Apple, Web Distribution in the EU: https://developer.apple.com/support/web-distribution-eu/
24. Android Developers, Developer verification: https://developer.android.com/developer-verification
25. Android Developers, Limited distribution accounts: https://developer.android.com/developer-verification/guides/limited-distribution
