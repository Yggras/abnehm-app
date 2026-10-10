# Recherche: KI-Fotoerkennung von Mahlzeiten

Ticket: #5 · Stand der Recherche: 2026-10-10 · alle Quellen am 2026-10-10 abgerufen (Liste am Ende, Verweise als [Q1] usw.)

## Zusammenfassung

- **Zwei Wege:** (a) ein **multimodales LLM** (Claude, OpenAI GPT, Google Gemini), das per Prompt ein JSON mit Lebensmitteln, geschätzten Grammzahlen und Nährwerten zurückgibt, oder (b) eine **spezialisierte Food-Recognition-API** (z. B. Passio, LogMeal, fatsecret), die das Foto gegen eine Lebensmitteldatenbank abgleicht.
- **Genauigkeit:** Peer-reviewte Studien finden bei LLMs für die **Energie (kcal) einen mittleren absoluten Prozentfehler von ca. 36 %** (GPT-4o und Claude 3.5 Sonnet) [Q13]. Große Portionen werden **systematisch unterschätzt** [Q13][Q14]. Wenn das Gewicht oder die Zutaten mitgegeben werden, wird die Schätzung deutlich besser [Q15][Q16]. Kleinere, günstigere Modelle (Claude Haiku 4.5) waren deutlich schlechter als Sonnet und Opus, während Sonnet und Opus fast gleichauf lagen [Q17]. Die Erkennung *was* auf dem Teller liegt, klappt gut, die Schätzung *wie viel* ist die Schwachstelle [Q14][Q18].
- **Kosten:** Bei ca. 300 Fotos im Monat (10 pro Tag) kosten alle LLM-Varianten außer Claude Opus deutlich **unter 10 €** (eigene Rechnung, siehe Tabelle unten): etwa 0,10–0,30 € (Claude Haiku 5.5, GPT-6 Luna), etwa 0,80–1,70 € (Gemini 3.8 Flash) und etwa 2,30–6,30 € (Claude Sonnet 5.5). Die Spezial-API Passio liegt laut eigenen Angaben bei ca. **13–20 €** und damit über dem Budget [Q19].
- **Datenschutz:** Anthropic und OpenAI nutzen API-Daten standardmäßig nicht fürs Training [Q5][Q10]. Anthropic löscht Ein- und Ausgaben in der Regel innerhalb von 30 Tagen [Q4], OpenAI hält Logs zur Missbrauchserkennung bis zu 30 Tage vor [Q10]. Bei Google gelten **für Nutzer in EWR/Schweiz/UK auch im Gratis-Kontingent die Paid-Datenschutzregeln** (kein Training) [Q9].
- **Integration:** Alle drei LLM-Anbieter bieten **Structured Outputs** an, also eine Antwort, die garantiert einem vorgegebenen JSON-Schema folgt [Q6][Q11][Q12]. Das ist ideal für Kalorienwerte. Der Aufruf gehört serverseitig in eine kleine Backend-Funktion, damit der API-Key nicht in der App steckt.
- **Empfehlung (deutlich als solche markiert, siehe unten):** Für V1 ein multimodales LLM mit Structured Output nutzen, Start mit **Claude Sonnet 5.5** (`claude-sonnet-5-5`). Die Schätzung wird der Nutzerin bzw. dem Nutzer immer als **editierbarer Vorschlag** gezeigt. Gemini 3.8 Flash bzw. Claude Haiku 5.5 dienen als günstige Vergleichskandidaten in einem kleinen eigenen Test.

---

## 1. Ansätze im Überblick

| Ansatz | Prinzip | Beispiele |
|---|---|---|
| Multimodales LLM | Foto plus Text-Prompt gehen an ein allgemeines Modell, das Lebensmittel, Portion und Nährwerte direkt schätzt | Claude [Q2][Q3], OpenAI GPT [Q7][Q8], Gemini [Q1] |
| Spezialisierte Food-API | Bilderkennung plus Abgleich mit kuratierter Nährwertdatenbank | Passio Nutrition AI [Q19], LogMeal [Q20], fatsecret Image Recognition [Q21] |
| Hybrid | Das LLM erkennt die Lebensmittel und schätzt Gramm, die Nährwerte pro 100 g kommen aus einer Datenbank (z. B. Open Food Facts/BLS, eigenes Ticket) | Wissenschaftlich gestützt durch [Q15][Q16]: Mehr physische bzw. Zutateninfos verbessern das Ergebnis. Eine konkrete Fertiglösung wurde nicht geprüft |

Hinweis: Passio leitet Fotos laut eigener FAQ an ein LLM weiter, ggf. ein Drittanbieter-LLM wie GPT [Q19]. Spezial-APIs sind also nicht zwingend eine eigene Technik.

## 2. Belegte Genauigkeit (Studien)

| Studie | Modelle | Daten | Kernergebnis |
|---|---|---|---|
| Fridolfsson et al. 2025, *Current Developments in Nutrition* [Q13] | ChatGPT-4o, Claude 3.5 Sonnet, Gemini 1.5 Pro | 52 standardisierte Fotos, gewogen | MAPE Energie **35,8 %** (ChatGPT und Claude), Gemini 64,2–109,9 % über alle Nährstoffe. Korrelation 0,65–0,81. Systematische Unterschätzung, die mit der Portionsgröße zunimmt. Laut Autoren vergleichbar mit klassischen Selbstauskunfts-Methoden, aber nicht präzise genug für klinische Zwecke |
| O'Hara et al. 2025, *Nutrients* [Q14] | ChatGPT-4 | 114 Mahlzeitenfotos aus einer nationalen Ernährungserhebung | 93 % korrekte Lebensmittelerkennung. Gewicht bei kleinen Portionen gut, bei mittleren und großen schlecht. Bei 13 von 16 Nährstoffen über 10 % Abweichung, meist Unterschätzung |
| Isobe et al. 2026, *Nutrients* [Q22] | 10 KI-Modelle (u. a. ChatGPT-4o, Gemini 1.5 Pro) vs. 10 Diätassistent:innen | 15 standardisierte Krankenhausmahlzeiten | Energie und Kohlenhydrate bei den besten Modellen „praktisch genau“ (r > 0,8, oft innerhalb ±10 %). Fett wird systematisch überschätzt (Bias > +20 %), Protein ist ungenauer |
| Rodríguez-Jiménez et al. 2025, *Nutrients* [Q16] | ChatGPT-5 | 195 Gerichte, 4 Szenarien | Genauigkeit steigt, wenn zusätzlich Beschreibung bzw. Zutatenliste mitgegeben wird. Ohne Bild wird sie wieder schlechter, das Bild trägt also echte Information bei |
| Mu, Sun, He 2025, ACM-BCB [Q15] | 7 LMMs (GPT, Gemini, Llama) | Nutrition5k und 78 Handyfotos | Mit dem echten Gewicht als Eingabe sinkt der MAPE (Kohlenhydrate) auf 20,2 % (Gemini 2.5 Flash) bzw. 26,8 % (GPT-4.1) |
| Nakagawa, Yamamoto 2026, *Nutrients* [Q17] | Claude Haiku 4.5, Sonnet 4.6, Opus 4.6 | u. a. SNAPMe (1463 US-Fotos) | Sonnet und Opus deutlich besser als Haiku, Sonnet vs. Opus nur 1–3 Prozentpunkte MedAPE Unterschied. Das Prompt-Design wirkt nur bei ausreichend starken Modellen. Fazit der Autoren: Sonnet bietet die beste Kosten-Leistungs-Balance |
| Jiang et al. 2026, arXiv-Preprint (nicht peer-reviewed) [Q18] | 6 VLMs, u. a. gpt-5.1, gemini-3-flash | OmniFood-Bench | Gerichtsnamen werden nahezu auf menschlichem Niveau erkannt, bei der Massenschätzung (Gramm) versagen die Modelle aber deutlich |

**Einordnung:** Für die *aktuell* verfügbaren Modelle (Claude Sonnet 5.5, Haiku 5.5, GPT-6, Gemini 3.8) wurden **keine peer-reviewten Kalorien-Benchmarks gefunden**. Die Studien testen Vorgängergenerationen. Ob neuere Modelle besser sind, ist **nicht belegt** und sollte mit eigenen Testfotos geprüft werden.

**Konsequenzen für das App-Design (abgeleitet aus [Q13]–[Q17]):**
1. KI-Werte nur als Vorschlag anzeigen, Nutzer:in korrigiert Portion und Lebensmittel.
2. Optionale Zusatzangaben (Freitext, Gramm, „mit Öl gebraten“) mitschicken, weil Kontext die Genauigkeit verbessert [Q16][Q15][Q22].
3. Bei großen Portionen mit Unterschätzung rechnen [Q13][Q14].

## 3. Kosten pro Bild und pro Monat

### Preisgrundlagen (offizielle Seiten)

| Modell (API-ID) | Input / Output pro 1 Mio. Tokens (USD) | Quelle |
|---|---|---|
| Claude Opus 5.5 (`claude-opus-5-5`) | $4 / $20 | [Q2] |
| Claude Sonnet 5.5 (`claude-sonnet-5-5`) | $2 / $10 | [Q2] |
| Claude Haiku 5.5 (`claude-haiku-5-5`), Prompts ≤ 100k Tokens | $0,10 / $0,50 | [Q2][Q3] |
| Claude Haiku 4.5 (`claude-haiku-4-5-20251001`, inzwischen „Legacy“) | $1 / $5 | [Q2][Q3] |
| Gemini 3.8 Flash | $0,75 / $3,75 bis 31.12.2026, **ab 1.1.2027 $1,50 / $7,50**. Gratis-Kontingent vorhanden | [Q1] |
| Gemini 3.5 Flash-Lite | $0,30 / $2,50. Gratis-Kontingent vorhanden | [Q1] |
| OpenAI GPT-6 Luna (`gpt-6-luna`) | $0,10 / $0,50 | [Q7][Q8] |
| OpenAI GPT-6.1 Sol (`gpt-6.1-sol`) | $2 / $10 | [Q7][Q8] |

Hinweis: Neben den vom Ticket genannten Claude-IDs listet Anthropic inzwischen auch **Claude Haiku 5.5** als aktuelles Modell, Haiku 4.5 läuft unter „Legacy“ [Q3]. Die Batch-API kostet 50 % weniger [Q2], passt aber nicht zum interaktiven Foto-Flow.

### Bild-Tokens

- **Claude:** `⌈Breite/28⌉ × ⌈Höhe/28⌉` Tokens. Ein Bild mit 1000×1000 px ergibt 1296 Tokens [Q6a].
- **Gemini 3:** Abhängig von `media_resolution`, Standard und `high` = 1120 Tokens, `low` = 280 [Q1b].
- **OpenAI (aktuelle Modelle):** `⌈B/32⌉ × ⌈H/32⌉` Patches × Modell-Multiplikator (1,2 für die meisten aktuellen Modelle). 1000×1000 px ergibt ca. 1229 Tokens [Q8b]. Ob der Faktor 1,2 auch für `gpt-6-luna` gilt, war nicht eindeutig zu verifizieren.

### Annahmen der Monatsrechnung (eigene Annahmen, nicht aus Quellen)

- 10 Fotos pro Tag, also **300 Fotos pro Monat**. Die App verkleinert jedes Foto vorher auf ca. 1000×1000 px.
- Pro Anfrage: Bild-Tokens (siehe oben) plus ca. 500 Tokens Text-Prompt und Schema.
- Output: **Szenario A** 500 Tokens (nur JSON), **Szenario B** 2000 Tokens (JSON plus Denk-Tokens). Denk-Tokens werden bei Claude als Output abgerechnet [Q23]. Sonnet 5.5 und Haiku 5.5 haben das Denken standardmäßig an. Bei Haiku 5.5 lässt es sich mit `thinking: {type: "disabled"}` abschalten, bei Sonnet 5.5 nur auf `between_tools` reduzieren [Q23].
- Umrechnung mit dem EZB-Referenzkurs vom 09.10.2026: 1 € = 1,1206 USD [Q24].

| Modell | Kosten pro Monat, Szenario A | Kosten pro Monat, Szenario B |
|---|---|---|
| Claude Haiku 5.5 | $0,13 ≈ **0,12 €** | $0,35 ≈ **0,32 €** |
| GPT-6 Luna | $0,13 ≈ **0,11 €** | ca. $0,35 ≈ 0,31 € |
| Gemini 3.5 Flash-Lite | $0,52 ≈ **0,46 €** | ca. $1,65 ≈ 1,47 € |
| Gemini 3.8 Flash (Preis 2026 / ab 2027) | $0,93 ≈ 0,83 € / $1,85 ≈ **1,65 €** | ca. $2,61 ≈ 2,33 € / $5,23 ≈ 4,67 € |
| Claude Haiku 4.5 | $1,29 ≈ 1,15 € | $3,54 ≈ 3,16 € |
| Claude Sonnet 5.5 | $2,58 ≈ **2,30 €** | $7,08 ≈ **6,32 €** |
| GPT-6.1 Sol | ca. $2,54 ≈ 2,26 € | ca. $7,04 ≈ 6,28 € |
| Claude Opus 5.5 | $5,16 ≈ 4,60 € | $14,16 ≈ 12,64 € (über Budget) |
| Passio Nutrition AI | 20–30k Tokens pro Foto × $2,50/Mio. [Q19] ergibt $15–22,50 ≈ **13,40–20,10 €** (über Budget, kein Gratis-Test laut FAQ) | |
| LogMeal | Preise nicht öffentlich ausgewiesen. 30 Tage bzw. 200 Anfragen gratis, Standardpläne bis 20 Bilder pro Tag und Nutzer [Q20] | |
| fatsecret Image Recognition | Preise nicht öffentlich ausgewiesen, 14-Tage-Test [Q21] | |

Rechenweg (Beispiel Sonnet 5.5, Szenario A): (1296 + 500) Input × $2/Mio. + 500 Output × $10/Mio. ≈ $0,0086 pro Foto, mal 300 ergibt ca. $2,58. Die Rundung auf ca. 1800 Input-Tokens ist bereits eingerechnet.

**Ergebnis:** Das 10-€-Budget wird selbst mit Sonnet 5.5 bei doppelter Nutzung kaum ausgeschöpft. Das Budget muss aber auch Backend und Hosting abdecken (eigenes Ticket).

## 4. Latenz

Die Anbieter veröffentlichen **keine verbindlichen Millisekunden-Werte** für Bildanfragen. Anthropic stuft relativ ein: Haiku 5.5 „Fastest“, Sonnet 5.5 „Fast“, Opus 5.5 „Moderate“. Die tatsächliche Latenz hängt von Prompt-Länge, Output-Länge und Denkaufwand ab [Q3]. Kleinere Bilder verringern laut Anthropic Request-Größe und Latenz [Q6a]. Belastbare Zahlen für unseren Fall gibt es **nur durch eigene Messung** im Prototyp. Unabhängige Messwerte wurden für diese Recherche nicht verifiziert.

## 5. Datenschutz und Datenaufbewahrung

| Anbieter | Training mit API-Daten? | Aufbewahrung | Quelle |
|---|---|---|---|
| Anthropic (Claude API) | Standardmäßig **nein** | Ein- und Ausgaben werden in der Regel innerhalb von 30 Tagen gelöscht (Ausnahmen: z. B. Files API, Richtlinienverstöße, gesetzliche Pflichten). Laut Vision-Doku werden Bilder nicht zum Training genutzt | [Q4][Q5][Q6a] |
| OpenAI API | Standardmäßig **nein** (seit 01.03.2023) | Missbrauchs-Logs bis zu 30 Tage. Zero Data Retention nur nach Genehmigung. EU-Datenresidenz (`eu.api.openai.com`) setzt besondere Retention-Vereinbarungen voraus | [Q10] |
| Google Gemini API | Paid: **nein**. Unpaid: ja, inkl. menschlicher Prüfung, **aber** in EWR/CH/UK gelten auch für das Gratis-Kontingent die Paid-Regeln | Paid: nur vorübergehende Speicherung zur Missbrauchserkennung bzw. aus rechtlichen Gründen. Nutzung ab 18 Jahren | [Q9] |
| Passio | Speichert laut FAQ keine identifizierenden Daten, leitet aber an ein ggf. fremdes LLM (z. B. GPT) weiter | nicht spezifiziert | [Q19] |

Mahlzeitenfotos können Gesundheitsbezug haben. Eine DSGVO-Bewertung (Auftragsverarbeitung, Art. 9) ist **nicht Teil dieser Recherche** und wurde nicht geprüft. Für eine private App für zwei Personen ist das vermutlich weniger kritisch, das ist aber eine Einschätzung und nicht belegt.

## 6. Integrationsaufwand und Structured Output

- **Serverseitig aufrufen:** Der API-Key darf nicht in die iOS- bzw. Android-App. Ablauf: Die App lädt das verkleinerte Foto zum eigenen Backend hoch, das Backend ruft die LLM-API auf und gibt das validierte JSON zurück. (Allgemeine Sicherheitspraxis. Die konkrete Backend-Wahl ist eigenes Ticket.)
- **Claude:** Bild als `image`-Block (base64, URL oder Files-API-`file_id`). Formate JPEG/PNG/GIF/WebP, max. 10 MB per API [Q6a]. Structured Outputs sind **GA** über `output_config.format` mit `type: "json_schema"`, unterstützt u. a. von `claude-haiku-5-5`, `claude-haiku-4-5-20251001`, `claude-sonnet-5-5`, `claude-opus-5-5` [Q6]. Offizielle SDKs u. a. für Python und TypeScript [Q6a].
- **OpenAI:** Structured Outputs mit `json_schema` und `strict: true`, verfügbar ab GPT-4o in den neueren Modellen [Q11].
- **Gemini:** JSON-Schema über `response_format` mit `mime_type: application/json`. Laut Doku „Preview“ und nur für Gemini-3-Modelle [Q12].
- **Spezial-APIs:** Passio bietet mobile SDKs [Q19], LogMeal und fatsecret liefern JSON mit Nährwerten [Q20][Q21]. Die Antwortformate sind anbieterspezifisch, ohne frei definierbares Schema.

Grob geschätzter Aufwand (Einschätzung, nicht belegt): Eine Backend-Funktion plus Prompt plus JSON-Schema plus Validierung. Bei allen drei LLM-Anbietern ist das ähnlich, weil das Grundmuster identisch ist (Bild + Prompt + Schema → JSON).

## 7. Lernwert

(Einschätzung, keine Quelle möglich.) Ein multimodales LLM vermittelt die übertragbaren Grundlagen der KI-API-Integration: API-Keys und Server-Proxy, Prompting, Bild-Vorverarbeitung und Token-Kosten, Structured Outputs bzw. JSON-Schema, Fehlerbehandlung und Kostenkontrolle sowie Evaluierung mit eigenen Testfotos. Eine Spezial-API lehrt eher „klassische REST-Integration“ und ist weniger übertragbar. Ein eigenes Vision-Modell zu trainieren wäre für V1 überdimensioniert.

## 8. Empfehlung

> **EMPFEHLUNG** (Abwägung auf Basis der obigen Belege, keine objektive Tatsache):
>
> 1. **V1 mit einem multimodalen LLM und Structured Output umsetzen, serverseitig.** Grund: höchster Lernwert, Kosten weit unter Budget (Abschnitt 3), Genauigkeit für Kalorien grob auf Niveau von Selbstauskunft [Q13]. Spezial-APIs sind entweder teurer als das Budget (Passio [Q19]) oder ohne öffentliche Preise (LogMeal, fatsecret [Q20][Q21]).
> 2. **Startmodell: Claude Sonnet 5.5 (`claude-sonnet-5-5`).** Grund: Bei Claude-Modellen hatte Sonnet die beste Kosten-Leistungs-Balance, Haiku war deutlich schwächer [Q17]. Claude bzw. GPT schnitten in [Q13] gleichauf ab. Ca. 2–6 €/Monat bei 300 Fotos. Structured Outputs sind GA [Q6].
> 3. **Günstige Vergleichskandidaten** in einem kleinen Eigen-Test (z. B. 20–30 gewogene Mahlzeiten) prüfen: **Gemini 3.8 Flash** (Gratis-Kontingent mit EWR-Datenschutzregeln [Q9], aber Preisverdopplung ab 2027 [Q1]) und **Claude Haiku 5.5** (sehr günstig [Q2]). Für die aktuellen Modelle gibt es keine Studien, daher lohnt sich der Eigen-Test.
> 4. **UX:** KI-Ergebnis immer als editierbaren Vorschlag (Lebensmittel, Gramm, kcal) zeigen und optionalen Kontext („ca. 300 g“, „mit Sahnesoße“) mitsenden [Q15][Q16].
> 5. Das Modell als Konfigurationswert halten, damit ein Wechsel (z. B. bei Preisänderungen) ohne App-Update möglich ist.

## Offene Punkte / nicht verifiziert

- Genauigkeit der aktuellen Modellgenerationen (Sonnet 5.5, Haiku 5.5, GPT-6, Gemini 3.8) für Kalorienschätzung: keine Studien gefunden.
- Konkrete Latenzwerte: nicht offiziell publiziert, muss gemessen werden.
- Preise von LogMeal und fatsecret: nicht öffentlich.
- Free-Tier-Rate-Limits von Gemini: nur in AI Studio einsehbar [Q1c].
- Bild-Multiplikator für `gpt-6-luna`: nicht eindeutig belegt.
- Monatskosten beruhen auf eigenen Token-Annahmen (Abschnitt 3).

---

## Quellen (alle abgerufen am 2026-10-10)

- [Q1] Google: Gemini API Pricing – https://ai.google.dev/gemini-api/docs/pricing
- [Q1b] Google: Media resolution – https://ai.google.dev/gemini-api/docs/media-resolution
- [Q1c] Google: Rate limits – https://ai.google.dev/gemini-api/docs/rate-limits
- [Q2] Anthropic: Pricing – https://platform.claude.com/docs/en/about-claude/pricing
- [Q3] Anthropic: Models overview – https://platform.claude.com/docs/en/about-claude/models/overview
- [Q4] Anthropic Privacy Center: How long do you store my organization's data? – https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data
- [Q5] Anthropic Privacy Center: Is my data used for model training? – https://privacy.claude.com/en/articles/7996868-is-my-data-used-for-model-training
- [Q6] Anthropic: Structured outputs – https://platform.claude.com/docs/en/build-with-claude/structured-outputs
- [Q6a] Anthropic: Vision – https://platform.claude.com/docs/en/build-with-claude/vision
- [Q7] OpenAI: API Pricing – https://developers.openai.com/api/docs/pricing
- [Q8] OpenAI: Models – https://developers.openai.com/api/docs/models
- [Q8b] OpenAI: Images and vision – https://developers.openai.com/api/docs/guides/images-vision
- [Q9] Google: Gemini API Additional Terms of Service – https://ai.google.dev/gemini-api/terms
- [Q10] OpenAI: Data controls in the OpenAI platform – https://developers.openai.com/api/docs/guides/your-data
- [Q11] OpenAI: Structured Outputs – https://developers.openai.com/api/docs/guides/structured-outputs
- [Q12] Google: Structured output – https://ai.google.dev/gemini-api/docs/structured-output
- [Q13] Fridolfsson J, Sjöberg E, Thiwång M, Pettersson S. Performance Evaluation of 3 Large Language Models for Nutritional Content Estimation from Food Images. *Curr Dev Nutr* 2025. DOI: 10.1016/j.cdnut.2025.107556 – https://doi.org/10.1016/j.cdnut.2025.107556 (Abstract via Europe PMC, PMID 41081011)
- [Q14] O'Hara C, Kent G, Flynn AC, Gibney ER, Timon CM. An Evaluation of ChatGPT for Nutrient Content Estimation from Meal Photographs. *Nutrients* 2025;17(4):607. DOI: 10.3390/nu17040607 – https://doi.org/10.3390/nu17040607
- [Q15] Mu Y, Sun J, He J. Benchmarking and Improving Foundation Model Dietary Estimates from Meal Images. ACM-BCB 2025. DOI: 10.1145/3765612.3767255 – https://doi.org/10.1145/3765612.3767255
- [Q16] Rodríguez-Jiménez M et al. Image-Based Dietary Energy and Macronutrients Estimation with ChatGPT-5. *Nutrients* 2025. DOI: 10.3390/nu17223613 – https://doi.org/10.3390/nu17223613
- [Q17] Nakagawa S, Yamamoto A. Prompt Engineering and Model Selection for LLM-Based Nutritional Estimation from Food Images: A Multi-Dataset Investigation. *Nutrients* 2026. DOI: 10.3390/nu18122017 – https://doi.org/10.3390/nu18122017
- [Q18] Jiang Q et al. OmniFood-Bench: Evaluating VLMs for Nutrient Reasoning and Personalized Health Advice. arXiv:2607.08423 (Preprint, 2026) – https://arxiv.org/abs/2607.08423
- [Q19] Passio: FAQ – https://passio.ai/faq
- [Q20] LogMeal: Food AI Engine Pricing – https://logmeal.com/api/pricing/
- [Q21] fatsecret Platform: Image Recognition and NLP – https://platform.fatsecret.com/features/image-recognition-and-nlp
- [Q22] Isobe T et al. Accuracy of AI-Based Nutrient Estimation from Standardized Hospital Meal Images: A Comparison with Registered Dietitians. *Nutrients* 2026. DOI: 10.3390/nu18060966 – https://doi.org/10.3390/nu18060966
- [Q23] Anthropic: Thinking – https://platform.claude.com/docs/en/build-with-claude/thinking
- [Q24] EZB: Euro-Referenzkurse (Tageskurs 09.10.2026) – https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml

Studien-Abstracts wurden über die Europe-PMC-REST-API abgerufen (https://www.ebi.ac.uk/europepmc/webservices/rest/search), da PMC/PubMed direkt nicht abrufbar war. Die Ergebnisse aus Studien sind den Abstracts entnommen, die Volltexte wurden nicht gelesen.
