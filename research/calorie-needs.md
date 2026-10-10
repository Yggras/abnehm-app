# Recherche: Berechnung von Kalorienbedarf und sicherer Abnehmrate

Issue: #9 · Stand der Recherche: 2026-10-10

> **Hinweis:** Diese App und dieses Dokument ersetzen keine ärztliche oder ernährungstherapeutische Beratung. Alle Zielwerte sind Schätzungen für gesunde Erwachsene. Bei Vorerkrankungen (z. B. Diabetes, Nieren-, Herzerkrankungen), Schwangerschaft/Stillzeit, Essstörungen oder Medikamenteneinnahme gehört die Zielsetzung in ärztliche Hände.

Belegregel: Jede Sachaussage trägt eine Quellenangabe in eckigen Klammern, z. B. [S1]. Das Quellenverzeichnis steht am Ende. Abschnitte mit der Überschrift **„Empfehlung für die App“** sind eigene Schlussfolgerungen und keine Aussagen der zitierten Quellen.

## Zusammenfassung

- **Grundumsatz:** Mifflin-St Jeor ist die am besten validierte Formel mit Gewicht, Größe, Alter und Geschlecht. Im systematischen Review der American Dietetic Association lag sie bei mehr normal- und übergewichtigen Personen als jede andere Formel innerhalb von ±10 % des gemessenen Werts. Für Einzelpersonen bleiben aber deutliche Fehler möglich [S1, S2]. Die deutsche S3-Leitlinie Adipositas (2024) nennt für Menschen mit Übergewicht oder Adipositas die Formel von Müller et al. (2004), die an einer deutschen Datenbank abgeleitet wurde [S5, S6].
- **Gesamtumsatz** = Grundumsatz × PAL. Die DGE-Richtwerte arbeiten mit PAL 1,4, 1,6 und 1,8 [S7]. FAO/WHO/UNU ordnen 1,40–1,69 als „sitzend/leicht aktiv“ ein, 1,70–1,99 als „mäßig aktiv“ und 2,00–2,40 als „sehr aktiv“ [S8].
- **Defizit und Abnehmrate:** Die S3-Leitlinie empfiehlt ein Defizit von etwa **500–600 kcal/Tag** oder ein individuell ermitteltes Defizit. Zu erwarten sind etwa **0,5 kg pro Woche** über höchstens rund drei Monate, danach lässt der Gewichtsverlust nach [S5]. Die US-Leitlinie AHA/ACC/TOS empfiehlt ≥ 500 kcal/Tag Defizit, oft umgesetzt mit 1200–1500 kcal/Tag (Frauen) bzw. 1500–1800 kcal/Tag (Männer) [S10].
- **Untergrenze:** Kostformen mit **800–1200 kcal/Tag** (Formulaprodukte) gelten laut S3-Leitlinie nur zeitlich begrenzt (≤ 12 Wochen) und **unter medizinischer Betreuung**. NICE sieht Low-Energy- (800–1200 kcal) und Very-Low-Energy-Diäten (< 800 kcal) nur in spezialisierten Programmen vor [S5, S9]. Eine App ohne ärztliche Begleitung sollte daher nicht unter diese Werte gehen (eigene Ableitung, siehe unten).
- **Protein:** Die DGE empfiehlt 0,8 g/kg/Tag (ab 65 Jahren 1,0 g/kg), bei Übergewicht bezogen auf das **Normalgewicht** [S11]. Eine Meta-Analyse zeigt, dass eiweißreichere Reduktionskost etwas mehr fettfreie Masse erhält [S12].
- **Wasser:** Die DGE gibt für 19- bis unter 51-Jährige rund **1,4–1,5 l/Tag aus Getränken** an (Gesamtwasser 2,6–2,7 l, ca. 35 ml/kg). Ab 51 Jahren liegt der Wert bei 30 ml/kg [S13]. Die EFSA nennt als Gesamtwasser 2,0 l (Frauen) bzw. 2,5 l (Männer) [S14].
- **Sportkalorien:** Wearables schätzen den Energieverbrauch ungenau. In einer Laborstudie lag kein Gerät unter 20 % Fehler [S15, S16]. Zudem kompensiert der Körper teilweise [S17, S18, S19]. „Zurückessen“ der Trackerkalorien sollte daher höchstens teilweise erfolgen (eigene Empfehlung).
- **Adaptiv statt statisch:** Formeln liefern nur einen Startwert. Der Gewichtsverlust verlangsamt sich durch Anpassungen des Stoffwechsels, und die „3500-kcal-Regel“ überschätzt den Verlust [S3, S4, S5]. Eine Nachjustierung anhand des tatsächlichen Gewichtstrends ist sinnvoll. Regelmäßiges (wöchentliches) Wiegen empfiehlt die S3-Leitlinie [S5, S20].

---

## 1. Formeln für Grundumsatz (GU / RMR) und Gesamtumsatz

### 1.1 Mifflin-St Jeor (1990)

- Abgeleitet an 498 gesunden Personen (19–78 Jahre; 264 normalgewichtig, 234 adipös), Ruheumsatz gemessen per indirekter Kalorimetrie [S2].
- Vereinfachte Formel (kcal/Tag) [S2]:
  - Männer: `10 × Gewicht (kg) + 6,25 × Größe (cm) − 5 × Alter (J) + 5`
  - Frauen: `10 × Gewicht (kg) + 6,25 × Größe (cm) − 5 × Alter (J) − 161`
- In der Ursprungsstudie überschätzte die alte Harris-Benedict-Formel (1919) den gemessenen Ruheumsatz um 5 % [S2].
- Die fettfreie Masse war der beste Einzelprädiktor: `RMR = 19,7 × FFM + 413` [S2].

### 1.2 Harris-Benedict (revidiert von Roza & Shizgal, 1984)

- Roza & Shizgal haben die Harris-Benedict-Gleichungen mit erweitertem Originaldatensatz neu ausgewertet. Die Formeln schätzen den Ruheumsatz einer gesunden Person mit einer **Präzision von ±14 %** [S21].
- Die Koeffizienten der revidierten Formel stehen nicht im frei zugänglichen Abstract. Sie wurden für diese Recherche nicht am Volltext verifiziert und werden hier deshalb nicht wiedergegeben.

### 1.3 Katch-McArdle / Cunningham (auf Basis fettfreier Masse)

- Cunningham (1980) hat die Harris-Benedict-Daten neu analysiert. Ergebnis: Die fettfreie Masse (LBM) ist der einzige nötige Prädiktor, `BMR (kcal/Tag) = 500 + 22 × LBM (kg)`. Geschlecht und Alter tragen danach kaum zusätzlich bei [S22].
- Die als „Katch-McArdle“ bekannte Variante (`370 + 21,6 × LBM`) wird einem Lehrbuch von McArdle, Katch & Katch zugeschrieben. **Eine peer-reviewte Primärquelle mit Validierung wurde für diese Recherche nicht gefunden. Die Aussage bleibt unverifiziert.**
- Beide Formeln brauchen die fettfreie Masse als Eingabe, also eine Körperfettmessung. Wie genau Körperfettwaagen messen, wurde in dieser Recherche nicht untersucht.

### 1.4 Formel der S3-Leitlinie (Müller et al. 2004)

- Die S3-Leitlinie „Prävention und Therapie der Adipositas“ (Version 5.0, 2024) gibt im Anhang folgende Formel für Menschen mit Übergewicht/Adipositas an [S5]:
  - BMI > 25 bis < 30: `GU (MJ/d) = 0,045 × Gewicht (kg) + 1,006 × Geschlecht − 0,015 × Alter (J) + 3,407`
  - BMI ≥ 30: `GU (MJ/d) = 0,05 × Gewicht (kg) + 1,103 × Geschlecht − 0,016 × Alter (J) + 2,924`
  - Geschlecht: weiblich = 0, männlich = 1; Umrechnung kJ → kcal mit Faktor 0,239 [S5].
- Die Quelle ist eine Auswertung von 2528 Personen aus 7 deutschen Zentren. Die WHO-Formeln von 1985 überschätzten den Ruheumsatz bei niedrigen Werten systematisch und unterschätzten ihn bei hohen. BMI-spezifische Formeln verringerten die Abweichungen [S6].

### 1.5 Wie genau sind die Formeln? (Validierung)

- Frankenfield et al. (2005) verglichen in einem systematischen Review Harris-Benedict, Mifflin-St Jeor, Owen und WHO/FAO/UNU. **Mifflin-St Jeor war am zuverlässigsten**: Die Formel traf den gemessenen Ruheumsatz bei mehr normal- und übergewichtigen Personen als jede andere Formel auf ±10 % und hatte die engste Fehlerspanne [S1].
- Dieselbe Arbeit betont, dass bei einzelnen Personen „noteworthy errors“ bleiben. Ältere Menschen und ethnische Minderheiten waren in den Validierungsstudien unterrepräsentiert. Für die WHO/FAO/UNU-Formel fehlten Validierungen auf Individualebene [S1].
- Die genauen Prozentanteile (Anteil der Personen innerhalb ±10 %) stehen nicht im Abstract. Sie wurden nicht am Volltext verifiziert und werden daher nicht angegeben.

### 1.6 Gesamtumsatz über PAL

- Die DGE beschreibt den Energiebedarf als Summe aus Ruheenergieverbrauch und Verbrauch für körperliche Aktivität. Sie gibt Richtwerte für PAL 1,4, 1,6 und 1,8 an (Stand der Ableitung 2015) [S7].
- Die DGE weist ausdrücklich darauf hin: „Bei Abweichungen vom Normbereich, insbesondere bei Übergewicht und bei geringer körperlicher Aktivität, sind individuelle Anpassungen der Richtwerte notwendig. Entscheidender Kontrollparameter ist das aktuelle Körpergewicht.“ [S7]
- FAO/WHO/UNU (2004), Tabelle 5.3: sitzend/leicht aktiv 1,40–1,69; aktiv/mäßig aktiv 1,70–1,99; sehr aktiv 2,00–2,40. Werte über 2,40 sind langfristig schwer durchzuhalten [S8].

**Rechenbeispiel (nur Arithmetik):** Frau, 35 J., 168 cm, 80 kg → Mifflin: 800 + 1050 − 175 − 161 = **1514 kcal**. Mit PAL 1,4 ergibt das ≈ 2120 kcal. Minus 500 kcal Defizit ≈ **1620 kcal/Tag**.

## 2. Offizielle Empfehlungen

### 2.1 Energiedefizit und Abnehmrate

| Quelle | Defizit | Erwartete Rate / Hinweise |
|---|---|---|
| S3-Leitlinie Adipositas (DAG u. a., 2024), Empfehlung 5.11 | ca. 500–600 kcal/Tag oder individuell ermittelt | ca. 0,5 kg/Woche über max. ~3 Monate; danach Energiesparmechanismen, neues Gleichgewicht meist nach 3–6 Monaten; ca. 5–6 kg nach 12 Monaten [S5] |
| S3-Leitlinie, Checkliste Ernährungsberatung | Reduktion um 500–800 kcal/Tag | v. a. durch kleinere Portionen und energieärmere Lebensmittel [S5] |
| AHA/ACC/TOS 2013 (USA) | ≥ 500 kcal/Tag bzw. 500 oder 750 kcal/Tag | oft 1200–1500 kcal/Tag (Frauen), 1500–1800 kcal/Tag (Männer); Anfangsziel 5–10 % Gewichtsverlust in 6 Monaten [S10] |
| NICE NG246 (2025) | Energieaufnahme unter Energieverbrauch | Keine feste kcal-Zahl in den aktuellen Empfehlungen. Jede Diät mit Defizit soll mit Unterstützung und Nachsorge angeboten werden (Empf. 1.16.3, 1.16.5) [S9] |

Anmerkung: Häufig zitierte NICE-Werte („600 kcal Defizit, 0,5–1 kg/Woche“) stammen aus älteren, inzwischen ersetzten NICE-Dokumenten (CG189, PH53). In den aktuell gültigen NG246-Empfehlungen wurden diese Zahlen nicht gefunden [S9].

### 2.2 Mindest-Kalorienzufuhr

- **S3-Leitlinie, Empfehlung 5.14:** Formulaprodukte mit 800–1200 kcal/Tag *können* je nach Situation zeitlich begrenzt eingesetzt werden, in der Regel ≤ 12 Wochen. Dabei *soll* medizinische Betreuung gewährleistet sein. Bei solchen Kostformen ist auf mindestens 2–2,5 l Trinkmenge pro Tag zu achten. Bei sehr niedrigkalorischer und einseitiger Kost drohen Nährstoffdefizite [S5].
- **NICE NG246:** Low-Energy-Diäten (800–1200 kcal) und Very-Low-Energy-Diäten (< 800 kcal) nur in spezialisierten Programmen, ernährungsphysiologisch vollständig, höchstens 12 Wochen, mit klinischer Begleitung, nicht als Langzeitstrategie (Empf. 1.16.8–1.16.11) [S9].
- **AHA/ACC/TOS:** Diäten unter 800 kcal/Tag nur in eingeschränkten Fällen und unter medizinischer Überwachung [S10].
- Eine allgemeine, von einer Fachgesellschaft festgelegte „Mindestkalorienzahl“ für unbegleitetes Abnehmen wurde in den geprüften Quellen **nicht** gefunden. Die Grenzen oben gelten für ärztlich begleitete Kostformen.

### 2.3 Protein während der Gewichtsabnahme

- DGE: 0,8 g/kg Körpergewicht/Tag für 19- bis unter 65-Jährige, 1,0 g/kg ab 65 Jahren (Schätzwert). Fußnote: „bei Übergewicht (BMI > 25 kg/m² bei Erwachsenen) sollte das Normalgewicht für die Berechnung zugrunde gelegt werden“ [S11].
- Meta-Analyse (24 RCTs, 1063 Personen): Eiweißreiche, fettarme Reduktionskost führte im Vergleich zu normaler Eiweißzufuhr zu etwas mehr Gewichtsverlust (−0,79 kg) und Fettverlust (−0,87 kg). Sie erhielt mehr fettfreie Masse (+0,43 kg) und milderte den Rückgang des Ruheumsatzes [S12].
- AHA/ACC/TOS: Eine erhöhte Proteinzufuhr (25 % der Energie) brachte bei gleichem Defizit einen gleich großen Gewichtsverlust wie 15 % [S10].
- Die S3-Leitlinie nennt 1,2–2 g/kg nur für Leistungssportler (> 5 h intensives Training/Woche) [S5].

### 2.4 Wasser

- DGE-Richtwerte (Stand der Ableitung 2000) [S13]:

| Alter | Getränke | feste Nahrung | Oxidationswasser | Gesamt | ml/kg/Tag |
|---|---|---|---|---|---|
| 19 bis < 25 J. | 1470 ml | 890 ml | 340 ml | 2700 ml | 35 |
| 25 bis < 51 J. | 1410 ml | 860 ml | 330 ml | 2600 ml | 35 |
| 51 bis < 65 J. | 1230 ml | 740 ml | 280 ml | 2250 ml | 30 |
| ≥ 65 J. | 1310 ml | 680 ml | 260 ml | 2250 ml | 30 |

- Die DGE-Werte gelten „bei bedarfsgerechter Energiezufuhr und durchschnittlichen Lebensbedingungen“. Erhöhter Bedarf besteht u. a. bei hohem Energieumsatz, Hitze, trockener kalter Luft, viel Kochsalz, hoher Proteinzufuhr, Fieber, Erbrechen und Durchfall [S13].
- EFSA (2010): angemessene Gesamtwasserzufuhr 2,0 l/Tag (Frauen) bzw. 2,5 l/Tag (Männer) [S14].

## 3. Sportkalorien: zurückessen oder nicht?

- **Genauigkeit von Wearables:** In einer Laborstudie mit 7 Handgelenk-Geräten (u. a. Apple Watch, Fitbit Surge) und 60 Personen erreichte **kein Gerät einen Fehler unter 20 %** beim Energieverbrauch. Die Herzfrequenz wurde meist gut gemessen. Die Fehler waren höher bei Männern, höherem BMI, dunklerer Haut und beim Gehen [S15].
- Eine Meta-Analyse (60 Studien) fand eine je nach Aktivität stark schwankende Genauigkeit mit großer Heterogenität (I² > 75 %). Zusätzliche Sensoren wie Herzfrequenz verbesserten die Schätzung [S16].
- **Kompensation:** In Bewegungsstudien fällt der Gewichtsverlust meist geringer aus als vorhergesagt, vor allem weil die Trainingsdosis gering war und gleichzeitig mehr gegessen wurde [S17]. Laut einer Analyse von 2026 stieg der Gesamtenergieverbrauch bei Ausdauertraining nur um etwa 30 % dessen, was additive Modelle erwarten. Die Kompensation war stärker, wenn Training mit Kalorienrestriktion kombiniert wurde [S18]. Doppelt markiertes Wasser bei 332 Erwachsenen zeigte, dass der Gesamtenergieverbrauch bei höherer Aktivität ein Plateau erreicht („constrained model“) [S19].
- Eine Empfehlung einer Fachgesellschaft (DGE, NICE, S3) speziell zum „Zurückessen“ von Trainingskalorien wurde **nicht gefunden**.

**Empfehlung für die App:** Den Aktivitätsfaktor (PAL) einmal realistisch wählen und Trackerkalorien standardmäßig **nicht** auf das Tagesbudget aufschlagen. Höchstens optional einen konservativen Teil gutschreiben (z. B. 25–50 %). Dieser Prozentsatz ist eine eigene Heuristik aus [S15]–[S18] und nicht offiziell belegt. Sonst wird die Aktivität doppelt gezählt (im PAL und im Tracker).

## 4. Adaptive Ansätze

- Gewicht reagiert verzögert auf eine geänderte Energiezufuhr (Halbwertszeit etwa 1 Jahr bis zum neuen Gleichgewicht). Personen mit mehr Körperfett verlieren bei gleicher Kalorienreduktion mehr Gewicht [S3].
- Die „3500-kcal-Regel“ (1 Pfund pro 3500 kcal Defizit) überschätzt den tatsächlichen Gewichtsverlust laut Vergleich mit sieben kontrollierten Studien deutlich. Dynamische Modelle sind genauer [S4]. Hall et al. stellen einen webbasierten Simulator bereit [S3].
- Die S3-Leitlinie beschreibt Anpassungen beim Abnehmen: sinkender Ruheumsatz durch Verlust fettfreier Masse, weniger Aktivitätsverbrauch, geringerer thermischer Effekt. Der Gewichtsverlust schwächt sich dadurch ab [S5].
- Ein dauerhafter Rückgang des Ruheumsatzes über die Körperzusammensetzung hinaus („metabolische Adaptation“) wurde bei extremen Interventionen gemessen, etwa −499 kcal/Tag sechs Jahre nach „The Biggest Loser“ [S23]. Diese Werte sind nicht auf moderate Diäten übertragbar [S24].
- Selbstwiegen: Die S3-Leitlinie empfiehlt zur Gewichtsstabilisierung regelmäßiges/wöchentliches Wiegen (Empf. 5.46, Grad B) [S5]. Ein systematischer Review fand verbesserte Gewichtsergebnisse ohne negative psychische Effekte, besonders bei täglichem oder wöchentlichem Wiegen [S20].

**Empfehlung für die App:** Startwert per Formel setzen und nach etwa 2–4 Wochen mit dem geglätteten Gewichtstrend abgleichen (z. B. gleitender 7-Tage-Mittelwert). Faustformel für die Rückrechnung: tatsächlicher Verbrauch ≈ Aufnahme + (Trendverlust × Energiegehalt pro kg). Das Ziel dann in kleinen Schritten anpassen. Der Energiegehalt pro kg ist wegen [S4] nur eine Näherung. Die Konkretisierung (Zeitfenster, Glättung, Schrittweite) ist eine eigene Designentscheidung und nicht aus Leitlinien abgeleitet.

## 5. Empfehlungen für die App (eigene Schlussfolgerungen)

Die folgenden Punkte sind **Empfehlungen** auf Basis der oben belegten Fakten. Sie sind keine Vorgaben der zitierten Stellen.

1. **Formel:** Mifflin-St Jeor als Standard [S1, S2]. Optional die S3-/Müller-Formel für BMI > 25 [S5, S6]. Ohne zuverlässigen Körperfettwert kein Katch-McArdle.
2. **PAL-Auswahl:** 3–4 verständliche Stufen, angelehnt an DGE/FAO (1,4 / 1,6 / 1,8 ggf. 2,0) [S7, S8]. Im Zweifel die niedrigere Stufe wählen, weil die DGE bei Übergewicht und geringer Aktivität Anpassungen verlangt [S7].
3. **Defizit:** Standard 500 kcal/Tag. Wählbar bis maximal etwa 600–750 kcal/Tag [S5, S10]. Als Zielrate etwa 0,5 kg/Woche kommunizieren, nicht mehr [S5].
4. **Untergrenze (harte Sperre):** Kein Ziel unter **1200 kcal/Tag**, außerdem nicht unter dem berechneten Grundumsatz. Begründung: 800–1200 kcal sind laut S3/NICE ärztlich begleiteten Programmen vorbehalten [S5, S9]. Die Grundumsatz-Grenze ist eine zusätzliche eigene Sicherheitsheuristik. Unterhalb der Sperre erscheint ein Hinweis auf ärztliche Begleitung.
5. **Protein:** Mindestens 0,8 g/kg (≥ 65 J.: 1,0 g/kg), bezogen auf Normalgewicht (z. B. Gewicht bei BMI 25) [S11]. Optional ein höheres Ziel mit Verweis auf [S12].
6. **Wasser:** Getränkeziel nach DGE-Altersgruppe (ca. 1,2–1,5 l), alternativ 30–35 ml/kg Gesamtwasser, davon gut die Hälfte aus Getränken [S13]. Hinweis auf Mehrbedarf bei Hitze und Sport [S13].
7. **Sport:** Trackerkalorien standardmäßig nicht oder nur teilweise anrechnen (siehe Abschnitt 3).
8. **Adaptiv:** Ziel nach Gewichtstrend nachjustieren. Wöchentliches Wiegen anbieten [S3, S4, S5, S20].
9. **Ausschlüsse/Warnungen im Onboarding:** Schwangerschaft/Stillzeit, unter 18 Jahre, BMI < 18,5, bekannte Essstörung, chronische Erkrankungen → keine Defizitberechnung, stattdessen Hinweis auf ärztliche Beratung. (Eigene Sicherheitsempfehlung. Die Leitlinien richten sich an begleitete Therapie und decken Selbsthilfe-Apps nicht explizit ab.)
10. **Disclaimer** sichtbar im Onboarding: „Die App gibt keine medizinische Beratung; alle Werte sind Schätzungen.“

## Offene Punkte / nicht verifiziert

- Koeffizienten der revidierten Harris-Benedict-Formel (Roza & Shizgal) und die genauen Trefferquoten aus Frankenfield 2005: Volltexte nicht frei zugänglich, daher nicht wiedergegeben.
- Primärquelle der Katch-McArdle-Formel: nicht gefunden.
- WHO: Eine konsumentennahe WHO-Empfehlung zu Abnehmrate oder Defizit wurde nicht gefunden. Herangezogen wurde nur der FAO/WHO/UNU-Bericht zum Energiebedarf [S8].

## Quellen

- [S1] Frankenfield D, Roth-Yousey L, Compher C. Comparison of predictive equations for resting metabolic rate in healthy nonobese and obese adults: a systematic review. *J Am Diet Assoc* 2005;105(5):775–789. https://doi.org/10.1016/j.jada.2005.02.005 (PubMed: https://pubmed.ncbi.nlm.nih.gov/15883556/)
- [S2] Mifflin MD, St Jeor ST, Hill LA et al. A new predictive equation for resting energy expenditure in healthy individuals. *Am J Clin Nutr* 1990;51(2):241–247. https://doi.org/10.1093/ajcn/51.2.241
- [S3] Hall KD, Sacks G, Chandramohan D et al. Quantification of the effect of energy imbalance on bodyweight. *Lancet* 2011;378(9793):826–837. https://doi.org/10.1016/S0140-6736(11)60812-X
- [S4] Thomas DM, Martin CK, Lettieri S et al. Can a weight loss of one pound a week be achieved with a 3500-kcal deficit? Commentary on a commonly accepted rule. *Int J Obes* 2013;37:1611–1613. https://doi.org/10.1038/ijo.2013.51
- [S5] Deutsche Adipositas-Gesellschaft (DAG) et al. Interdisziplinäre S3-Leitlinie „Prävention und Therapie der Adipositas“, Version 5.0, Oktober 2024, AWMF-Register 050-001. Empfehlungen 5.11, 5.14, 5.46; Anhang „Berechnung des Ruheenergieverbrauchs“ und „Checkliste zur Ernährungsberatung“. https://register.awmf.org/assets/guidelines/050-001l_S3_Praevention-Therapie-Adipositas_2024-10.pdf · Registereintrag: https://register.awmf.org/de/leitlinien/detail/050-001
- [S6] Müller MJ, Bosy-Westphal A, Klaus S et al. World Health Organization equations have shortcomings for predicting resting energy expenditure in persons from a modern, affluent population: generation of a new reference standard from a retrospective analysis of a German database of resting energy expenditure. *Am J Clin Nutr* 2004;80(5):1379–1390. https://doi.org/10.1093/ajcn/80.5.1379
- [S7] DGE. Referenzwerte: Energie (Stand der Ableitung 2015). https://www.dge.de/wissenschaft/referenzwerte/energie/
- [S8] FAO/WHO/UNU. Human energy requirements. Report of a Joint FAO/WHO/UNU Expert Consultation, Rome 2001 (publ. 2004), Kap. 5, Tabelle 5.3. https://www.fao.org/4/y5686e/y5686e07.htm
- [S9] NICE. Overweight and obesity management (NG246), 2025. Kapitel „Physical activity and diet“, Empf. 1.16.3, 1.16.5, 1.16.8–1.16.12. https://www.nice.org.uk/guidance/ng246/chapter/Physical-activity-and-diet
- [S10] Jensen MD, Ryan DH, Apovian CM et al. 2013 AHA/ACC/TOS guideline for the management of overweight and obesity in adults. *Circulation* 2014;129(25 Suppl 2). https://doi.org/10.1161/01.cir.0000437739.71477.ee (Open Access: https://europepmc.org/articles/PMC5819889)
- [S11] DGE. Referenzwerte: Protein (Stand der Ableitung 2017). https://www.dge.de/wissenschaft/referenzwerte/protein/
- [S12] Wycherley TP, Moran LJ, Clifton PM et al. Effects of energy-restricted high-protein, low-fat compared with standard-protein, low-fat diets: a meta-analysis of randomized controlled trials. *Am J Clin Nutr* 2012;96(6):1281–1298. https://doi.org/10.3945/ajcn.112.044321
- [S13] DGE. Referenzwerte: Wasser (Stand der Ableitung 2000). https://www.dge.de/wissenschaft/referenzwerte/wasser/
- [S14] EFSA NDA Panel. Scientific Opinion on Dietary Reference Values for water. *EFSA Journal* 2010;8(3):1459. https://doi.org/10.2903/j.efsa.2010.1459 · Pressemitteilung mit den Werten: https://www.efsa.europa.eu/en/press/news/nda100326
- [S15] Shcherbina A, Mattsson CM, Waggott D et al. Accuracy in wrist-worn, sensor-based measurements of heart rate and energy expenditure in a diverse cohort. *J Pers Med* 2017;7(2):3. https://doi.org/10.3390/jpm7020003
- [S16] O'Driscoll R, Turicchi J, Beaulieu K et al. How well do activity monitors estimate energy expenditure? A systematic review and meta-analysis of the validity of current technologies. *Br J Sports Med* 2020;54(6):332–340. https://doi.org/10.1136/bjsports-2018-099643
- [S17] Thomas DM, Bouchard C, Church T et al. Why do individuals not lose more weight from an exercise intervention at a defined dose? An energy balance analysis. *Obes Rev* 2012;13(10):835–847. https://doi.org/10.1111/j.1467-789X.2012.01012.x
- [S18] Pontzer H, Trexler ET. The evidence for constrained total energy expenditure in humans and other animals. *Curr Biol* 2026;36(4):1013–1025.e4. https://doi.org/10.1016/j.cub.2026.01.025
- [S19] Pontzer H, Durazo-Arvizu R, Dugas LR et al. Constrained total energy expenditure and metabolic adaptation to physical activity in adult humans. *Curr Biol* 2016;26(3):410–417. https://doi.org/10.1016/j.cub.2015.12.046
- [S20] Shieh C, Knisely MR, Clark D, Carpenter JS. Self-weighing in weight management interventions: a systematic review of literature. *Obes Res Clin Pract* 2016;10(5):493–519. https://doi.org/10.1016/j.orcp.2016.01.004
- [S21] Roza AM, Shizgal HM. The Harris Benedict equation reevaluated: resting energy requirements and the body cell mass. *Am J Clin Nutr* 1984;40(1):168–182. https://doi.org/10.1093/ajcn/40.1.168
- [S22] Cunningham JJ. A reanalysis of the factors influencing basal metabolic rate in normal adults. *Am J Clin Nutr* 1980;33(11):2372–2374. https://doi.org/10.1093/ajcn/33.11.2372
- [S23] Fothergill E, Guo J, Howard L et al. Persistent metabolic adaptation 6 years after "The Biggest Loser" competition. *Obesity* 2016;24(8):1612–1619. https://doi.org/10.1002/oby.21538
- [S24] Hall KD. Energy compensation and metabolic adaptation: "The Biggest Loser" study reinterpreted. *Obesity* 2022;30(1):11–13. https://doi.org/10.1002/oby.23308
