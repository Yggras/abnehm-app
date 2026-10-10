# Spielformen für ein Gesundheitsspiel zu zweit auf Basis von „Momo“

Recherche · Stand: 10.10.2026

**Frage:** Welche Spielformen kommen für ein **echtes Spiel** in Frage, das man **nur durch Fitness- und Ernährungsziele** voranbringt, für das man **einen Partner braucht** und das auf Momo aufbauen könnte? Der Bericht ist eine breite Übersicht als Entscheidungsgrundlage. Er empfiehlt keine einzelne Lösung.

**Konvention:**
- Jede Sachaussage ist mit `[n]` belegt (Liste am Ende, mit URL bzw. DOI).
- **Firmenquellen** (Herstellerseite, Hilfe-Center, Store-Text) sind in der Quellenliste mit *(Firma)* markiert. Sie belegen, was ein Produkt **anbietet**, nicht dass es **wirkt**.
- **(SA)** heißt: Die Seite blockierte den direkten Abruf (HTTP 403/402). Die Aussage stützt sich nur auf den Textauszug der Websuche und sollte vor einer Übernahme in die Spezifikation im Browser gegengeprüft werden.
- **Sekundärquellen** (Fan-Wikis, Presse, Nutzerrezensionen) sind als solche markiert.
- Abschnitte mit **„Einordnung“** sind meine Ableitungen aus den Quellen, keine Befunde.
- Apps wurden nicht installiert. Mechaniken reichen nur so weit, wie die Quellen sie beschreiben.
- Außerhalb des Rahmens: Aufwandsschätzungen und rechtliche Themen.
- Ergänzt die Berichte `research/gamification-evidence.md` (Branch `research/gamification-evidence`) und `research/partner-fitness-gamification.md` (Branch `research/partner-fitness-gamification`). Paar-Apps, die dort schon beschrieben sind, werden hier nur kurz aufgegriffen.

---

## 1. Zusammenfassung

1. **Reale Gesundheitsaktivität wird in bestehenden Spielen auf vier Arten in Spielfortschritt übersetzt:**
   - als **Energie**, die man im Spiel ausgibt: Finch [2], Walkr [21], Fitness RPG [47], STEPN [54];
   - als **Wachstum bzw. Zeit**: Pikmin-Setzlinge wachsen durch Schritte [10], Forest-Bäume durch Fokuszeit [1], Plant-Nanny-Pflanzen durch Wassertrinken [17];
   - als **Strecke auf einer Karte**: The Conqueror [18], Walkr [21];
   - als **Schaden bzw. Aktion in einem Kampf**: Habitica-Bosse [42], Ring-Fit-Übungen als Angriffe [28].
2. **Kooperation läuft in fast allen Beispielen asynchron und optional.** Typische Muster:
   - gemeinsame Wochenziele (Pikmin Bloom Weekly Challenge [13], Monster Hunter Now Friend Quests [49]);
   - gemeinsame Bosse (Habitica [42]);
   - tägliche Geschenke bzw. Anfeuern (Pokémon GO [35], Monster Hunter Now [50], Finch Good Vibes [5] (SA));
   - eine geteilte Strecke (Conqueror-Teams [18]).
   - Synchron sind nur Forest „Plant Together“ [1], Raids und Gruppenjagden vor Ort [36][48] sowie asymmetrische Koop-Spiele wie Keep Talking and Nobody Explodes [58].
3. **Ein Spiel, das den Partner zwingend braucht, ist selten.** Belegt sind:
   - **Rollenteilung:** FurTwo verteilt Pflegeaktionen auf die beiden Partner, „You cannot do everything alone“ [70]. Fitnessbezug hat FurTwo keinen.
   - **Gegenseitiges Freischalten:** Paired [65] und Agapé [66] zeigen die Antwort des Partners erst nach der eigenen.
   - **Gemeinsamer Verlust:** Couple Habits [80] und Forest Plant Together [1] lassen beide verlieren, wenn einer ausfällt. Das widerspricht den Momo-Leitplanken.
4. **Gegen den Neuheitseffekt setzen alle kommerziellen Beispiele auf laufenden neuen Inhalt:**
   - Saisons: Monster Hunter Now, 3 Monate [51];
   - Story-Staffeln: Zombies, Run!, 11 Staffeln mit über 500 Missionen [25];
   - monatliche Events und Community Days: Pikmin Bloom [16];
   - Saison-Events: Finch [8] (SA);
   - vier Galas pro Jahr: Habitica [46].
   - Ob das den Effektabfall bei Gesundheitsverhalten verhindert, ist **nicht belegt**. Die Pokémon-GO-Studien zeigen trotz laufender Events meist kurzlebige Effekte [86][87][113].
5. **Wirkung – was belegt ist:**
   - Kooperation zu zweit schnitt in kleinen Studien besser ab als Wettbewerb: HealthyTogether, 18 Dyaden, 2 Wochen [95]; Staiano-RCT mit Jugendlichen [96].
   - Exergames erhöhen die Aktivität klein bis mittel [92].
   - Ein Narrativ steigert nach Aussage der Nutzer das Engagement: Zombies, Run!, qualitativ [83].
   - Ein „Garten“ auf dem Sperrbildschirm hielt die Aktivität über die Feiertage: UbiFit, n = 28 [100].
6. **Wirkung – was nicht belegt ist:**
   - RCTs zu Zombies, Run!, Pikmin Bloom, Finch oder Habitica habe ich nicht gefunden.
   - Studien zu Paaren mit **ungleicher Spielmotivation** ebenfalls nicht.
7. **Fallstricke:**
   - Selbst eingetragene Kalorien werden systematisch zu niedrig angegeben, um 12–20 % im 24-h-Protokoll [106] und um 47 % in einer kleinen Studie [105]. Belohnt das Spiel niedrige Kalorienwerte, belohnt es auch Untertreiben bzw. extremes Defizit.
   - Strafmechaniken wie in Habitica führten in einer Feldstudie zu kontraproduktiven Ausweichstrategien [81].
   - Termin-Mechaniken („Playing by Appointment“) gelten in der Literatur nur dann als problematisch, wenn sie für den Fortschritt nötig sind [109].

---

## 2. Katalog der Spielformen

Für jede Form werden genannt: Beispiele mit belegter Mechanik, dann Kernschleife, Rolle der Gesundheitsziele, Rolle des Partners, tägliche Spielzeit, Umgang mit verpassten Tagen, Neuheitseffekt, und zuletzt eine **Einordnung** zu Leitplanken und 50/50-Levelbalken.

### 2.1 Aufbau-, Garten- und Insel-Spiele

**Beispiele:**
- **Forest** (Seekrtech) [1]:
  - Mechanik: Jede Minute Fokuszeit lässt einen Baum wachsen, dafür gibt es Coins. Mit Coins kauft man neue Baumarten oder lässt echte Bäume über Trees for the Future pflanzen.
  - Koop: „Plant Together“ ist eine **synchrone** gemeinsame Sitzung. „If anyone gives up, the whole forest falls.“
  - Verlust: Bestraft wird der Abbruch einer laufenden Sitzung (Baum stirbt bzw. verwelkt), nicht ein verpasster Tag. Tote Bäume bleiben im Wald stehen.
- **Finch** [2][3]:
  - Mechanik: Erledigte Ziele bzw. Self-Care-Übungen geben dem Vogel Energie. Mit voller Energie geht er auf ein Abenteuer und erzählt danach eine Geschichte [4] (SA).
  - Freunde: Man kann kostenlose „Good Vibes“ schicken [5] (SA).
  - Verpasste Tage: Es gibt Streak-Reparaturen und einen Pause-Modus, der den Streak einfriert [6][7] (SA). Laut Mission gilt „no guilt and no pressure“ [9] (SA).
  - „Tree Town“ als Freundesort ist offiziell **nicht belegt**; es gibt nur eine Sekundärquelle (siehe Abschnitt 6).
- **Pikmin Bloom** (Niantic/Scopely) [10][11][12]:
  - Kernschleife: Schritte erzeugen „step energy“. Damit wachsen Setzlinge zu Pikmin. Pikmin gehen auf Expeditionen und bringen Früchte zurück. Aus Früchten wird Nektar, aus Nektar werden Blütenblätter. Mit den Blüten pflanzt man beim Gehen Blumen.
  - Big Flowers sind gemeinsame Objekte auf der Karte [12].
  - Tagesobergrenze: 50.000 Schritte zählen höchstens [15].
- **Plant Nanny** (SPARKFUL) [17]:
  - Jedes Glas Wasser lässt Pflanzen wachsen.
  - Dass die Pflanze bei Vernachlässigung nur welkt und sich wieder erholt, statt zu sterben, ist **nur über Nutzerrezensionen belegt** [17].
- **UbiFit Garden** (Forschung) [100]:
  - Ein Garten auf dem Sperrbildschirm wächst durch Aktivität. In einem 3-Monats-Feldversuch (n = 28) blieb das Aktivitätsniveau damit über die Feiertage erhalten, ohne Display sank es.

**Die Form im Überblick:**
- **Kernschleife:** Aktivität → Wachstum bzw. Bau → Sammlung oder Welt wird sichtbar größer.
- **Gesundheitsziele:** Zeit bzw. Energie fürs Wachstum (Pikmin, Forest) oder Währung (Forest-Coins).
- **Partner:** Synchron (Forest Plant Together), über ein gemeinsames Wochenziel (Pikmin [13]) oder über Ermutigung (Finch [5], SA).
- **Spielzeit:** Bei Pikmin passiv beim Gehen, bei Forest an die Fokuszeit gekoppelt. Eine harte Tagesgrenze für die Spielzeit ist nur als Schrittobergrenze belegt [15].
- **Verpasste Tage:** Pikmin, Forest und Finch bestrafen laut Quellen keine Tage ohne Nutzung (Pikmin: keine Strafe dokumentiert).
- **Neuheitseffekt:** Pikmin bringt monatliche Events und Community Days [16], Forest saisonale Events [1], Finch Saison-Events mit exklusivem Pet [8] (SA).

**Einordnung (eigene Ableitung):**
- Passt gut zu Momo: Ein gemeinsamer Garten bzw. eine Insel, deren zwei Hälften von je einer Person bewirtschaftet werden, ließe sich auf den 50/50-Balken abbilden.
- Das Forest-Muster „einer bricht ab, alles fällt“ verletzt die Leitplanke „kein Verlust“.
- Das reine Garten-Wachstum ist eher Fortschrittsanzeige als „echtes Spiel“. Spielerische Entscheidungen bringen erst Zusatzschleifen wie Pikmins Expeditionen und Blumenpflanzen.

### 2.2 Expeditionen und Reisen auf einer Karte

**Beispiele:**
- **The Conqueror Virtual Challenges** [18][19][20]:
  - Distanz wird manuell eingetragen oder automatisch aus Apple Health, Google Fit, Garmin, Fitbit u. a. übernommen. Das Icon rückt auf einer realen Route vor, am Ende gibt es eine echte Medaille.
  - Das Zeitziel wählt man selbst zwischen 1 Woche und 24 Monaten.
  - **Team:** Mitglieder teilen sich die Distanz (nicht zwingend gleich verteilt) und haben ein gemeinsames Icon auf der Karte. Das Zusammenspiel ist asynchron [18].
  - An Meilensteinen gibt es digitale Postkarten [20].
  - Street View ist nur durch eine Nutzerrezension belegt [19], Baumpflanzungen nur durch Sekundärquellen (nicht belegt).
- **Walkr** (SPARKFUL) [21][22]:
  - Schritte werden automatisch zu Energie für ein Raumschiff. Es gibt über 100 Planeten.
  - Freunde als Co-Piloten bringen Extra-Energie, außerdem gibt es Flotten und das „Planet Lab“, in dem man mit Freunden Energie teilt.
  - „Satellite Missions“ sind offiziell **nicht belegt**, nur in Rezensionen.
- **Walk With Friends!** [23]: Apple-Health-Schritte werden zu einer gemeinsamen virtuellen Reise mit Karten-Pins.
- **Pikmin-Expeditionen** [12]: eine Teilmechanik, bei der Pikmin losgeschickt werden und Gegenstände sowie Postkarten zurückbringen.

**Die Form im Überblick:**
- **Kernschleife:** Distanz bzw. Aktivität → Fortschritt auf der Route → Etappenbelohnung (Postkarte, Planet, Medaille).
- **Gesundheitsziele:** Treibstoff bzw. Strecke.
- **Partner:** Geteilte Strecke, asynchron (Conqueror-Team).
- **Spielzeit:** Minimal, die Aktivität selbst ist das „Spielen“.
- **Verpasste Tage:** Keine Strafe belegt, die Route wartet [18].
- **Neuheitseffekt:** Neue kaufbare Routen [18]; Walkr hat Events [22].

**Einordnung (eigene Ableitung):**
- Sehr gut mit „kein Verlust“ vereinbar. Eine gemeinsame Route lässt sich als Summe beider Hälften darstellen.
- Momo könnte das reisende Wesen sein, Etappen könnten kosmetische Souvenirs liefern.
- Risiko: Ist die Strecke das einzige Spielelement, fehlen Entscheidungen. Belegt ist nur der Fortschritt-Mechanismus, nicht seine Wirkung.
- Fitbit-Adventures, früher eine solche Form bei Fitbit, wurden am 27.03.2023 eingestellt [77] (Presse).

### 2.3 Story- und Narrativ-Spiele

**Beispiele:**
- **Zombies, Run!** (Six to Start) [24][25]:
  - Audio-Missionen begleiten den Lauf. Gesammelte Materialien bauen eine Basis aus.
  - Über 500 Missionen in 11 Staffeln [25]. Eine Mission pro Woche ist gratis, alles andere braucht ein Abo [24].
  - Zombie-Verfolgungen sind optional. Wer gefangen wird, verliert Vorräte, die Mission scheitert aber nicht [26] (SA).
  - Koop gibt es in der Lauf-App laut Quellen **nicht**. Die Entwickler erwogen um 2015 einen asynchronen Mehrspielermodus [27] (SA).
- **Finch:** Nach jedem Abenteuer bekommt man Geschichten [4] (SA).
- **Ring Fit Adventure** (Nintendo) [28]:
  - Ein RPG mit Story, in dem Übungen die Angriffe sind.
  - Nintendo empfiehlt Einsteigern etwa 30 Minuten pro Tag. Das Spiel erinnert an Pausen.

**Die Form im Überblick:**
- **Kernschleife:** Aktivität → nächstes Kapitel bzw. nächste Episode → Basis oder Welt wächst.
- **Gesundheitsziele:** Freischaltung von Kapiteln oder Rohstoffe für den Aufbau.
- **Partner:** In den Beispielen keine Koop-Story belegt. Für Paare denkbar: Kapitel werden erst freigeschaltet, wenn beide Hälften erfüllt sind (eigene Ableitung, nicht belegt).
- **Spielzeit:** An die Aktivitätsdauer gebunden.
- **Verpasste Tage:** Keine Strafe belegt.
- **Neuheitseffekt:** Neue Staffeln bzw. Story-Pakete [24].

**Belege zur Wirkung:**
- Zombies-Run!-Nutzer nannten das Eintauchen in die Erzählung als wichtigsten Motivator für längere Einheiten (qualitativ, n = 30) [83].
- Bei Kindern korrelierte Story-Immersion mit gesundheitsbezogener Motivation [93].
- Eine Narrativ-Cutscene erhöhte die Schritte während des Spielens (n = 40, Kinder) [94].
- RCTs mit Erwachsenen zu „Narrativ vs. kein Narrativ“: **nicht gefunden**.

**Einordnung (eigene Ableitung):**
- Story ist die einzige Form, deren Langzeitmittel (neue Kapitel) unmittelbar aus der Mechanik folgt. Sie ist aber inhaltsintensiv: Jedes Kapitel muss geschrieben werden.
- Gut vereinbar mit „kein Verlust“. Mit 50/50 vereinbar, wenn ein Kapitel an den gefüllten Balken gekoppelt wird.

### 2.4 Sammel- und Kreatur-Spiele

**Beispiele:**
- **Pokémon Sleep** [29][30]:
  - Aufgezeichneter Schlaf wird mit Snorlax' Stärke zur „Drowsy Power“ verrechnet. Diese lockt am Morgen Pokémon an.
  - Freunde sehen gegenseitig die Schlafforschung und bekommen dafür Belohnungen; das läuft asynchron [30].
  - Höchstens 2 Schlafsitzungen pro Tag. Verpasste Nächte lassen sich nur ohne Forschung nachtragen [31] (SA).
  - Der Wochenzyklus mit einem neuen Snorlax ist nur über Fan-Wikis belegt.
- **Pokémon GO Buddy** [32][33][34][35]:
  - Gemeinsames Laufen bringt Bonbons. Herzen gibt es für Gehen, Füttern, Spielen u. a. Adventure Sync zählt Kilometer bei geschlossener App.
  - **Buddy-Stufen sinken nicht** („much like Friendship levels“), nur Stimmung und Hunger sinken mit der Zeit [32].
  - Freundschaft: höchstens 1 Freundschaftspunkt pro Tag. Stufen bei 1, 7, 30, 90 und 180 Punkten [34]. Geschenke: 1 pro Freund und Tag [35].
- **Neko Atsume** (Hit-Point) als **Gegenbeispiel ohne Fitness** [37][38]:
  - „Place playthings and snacks in your yard … Wait for cats to visit!“ Laut offizieller Anleitung kann man das Spiel genießen „by only staring at the screen“.
  - In Neko Atsume 2 kann man Höfe anderer Spieler besuchen [37].
  - Dass Katzen ohne Futter einfach wegbleiben (statt einer Strafe), ist nur über Sekundärquellen belegt [39].
- **Wokamon / Stepets** [40][41]: Schritte füttern bzw. entwickeln die eigenen Wesen; das Wesen ist persönlich und nicht geteilt.

**Die Form im Überblick:**
- **Kernschleife:** Aktivität → neue Kreaturen bzw. Entwicklungsstufen → Sammelbuch füllt sich.
- **Gesundheitsziele:** Anlockfaktor bzw. Währung.
- **Partner:** Geschenke, Freundschaftsstufen, Tausch; überwiegend asynchron und optional.
- **Spielzeit:** Bei Neko Atsume und Pokémon Sleep sehr kurze tägliche Sitzungen. Tagesobergrenzen gibt es bei GO und Sleep.
- **Verpasste Tage:** Bei GO sinken nur Stimmung und Hunger, keine Stufen [32].
- **Neuheitseffekt:** Laufende Events und neue Gebiete [29]; bei Neko Atsume neue Katzen und Gegenstände durch Updates [38].

**Einordnung (eigene Ableitung):**
- Ein Sammelbuch („Momos Freunde“ bzw. „Momos Formen“) ist mit „kein Verlust“ gut vereinbar.
- Das GO-Muster „Stimmung sinkt, Stufe bleibt“ ist ein Grenzfall zur Leitplanke „kein trauriges Pet“.
- Neko Atsume zeigt, dass schon sehr kurze, passive Sitzungen ein Spiel tragen können. Diese Aussage beruht auf der Spielanleitung, nicht auf Wirkungsdaten.

### 2.5 RPG- und Quest-Systeme mit Bossen

**Beispiele:**
- **Habitica** [42][43][44][45][46]:
  - Erledigte Dailies, positive Habits und To-Dos fügen dem Boss Schaden zu. Verrechnet wird beim nächsten Tageswechsel („Cron“) [42].
  - Verpasste Dailies lassen den Boss **die ganze Party** treffen [42].
  - Sammelquests verursachen keinen Zusatzschaden [43].
  - Alle Teilnehmer bekommen dieselbe Belohnung, unabhängig vom eigenen Beitrag [43].
  - Bei 0 HP verliert man ein Level, sein Gold und ein Ausrüstungsteil [45].
  - **„Rest in the Inn“** pausiert den eigenen Schaden. Der Schaden durch verpasste Dailies anderer trifft einen aber trotzdem [44].
  - Partys haben 1–30 Mitglieder. Langzeitinhalt sind vier „Grand Galas“ pro Jahr [46].
  - Quelle ist das offizielle Community-Wiki auf Fandom.
- **Fitness RPG** (Shikudo) [47]: Schritte werden zu Energie, mit der man Helden levelt und Monster bekämpft. Schritte kommen vom Handy, von Fitbit oder Google Fit. Mehrspieler gibt es als PvP-Arena.
- **Monster Hunter Now** (Niantic/Capcom) [48][49][50][51]:
  - Gruppenjagden mit bis zu 4 Spielern, synchron.
  - **Friend Quests:** wöchentliches Gemeinschaftsziel mit Meilensteinen, asynchron.
  - **Friend Cheering:** einmal täglich pro Freund, +1 maximale HP.
  - Saisons von 3 Monaten mit eigener Story.
- **Ring Fit Adventure** [28]: Übungen sind die Angriffe; je genauer die Ausführung, desto mehr Schaden.

**Die Form im Überblick:**
- **Kernschleife:** Ziele erfüllen → Schaden bzw. XP → Boss besiegt → Beute (Kosmetik, Pets).
- **Gesundheitsziele:** Schaden, Energie, XP.
- **Partner:** Gemeinsamer Boss, gemeinsames Ziel, Anfeuern.
- **Spielzeit:** Bei Habitica entsteht der Schaden durch die Aufgaben selbst. Eine Spielzeitgrenze ist **nicht belegt**.
- **Verpasste Tage:** Bei Habitica strafend, für den Einzelnen und für die Party [42][45].
- **Neuheitseffekt:** Saisons [51], Galas [46].

**Belege zur Wirkung:**
- In einer Feldstudie zu Habitica (n = 45, 2 Wochen) erlebten alle Teilnehmenden kontraproduktive Effekte. Beispiele: Strafe gerade in produktiven Phasen, Umbenennen von Aufgaben, um Strafen zu entgehen. Je unpassender das Belohnungs- und Strafsystem empfunden wurde, desto stärker sank die Motivation [81].

**Einordnung (eigene Ableitung):**
- Der gemeinsame Boss ist das klarste „Koop gegen etwas“-Muster.
- Habitica in Reinform verletzt die Leitplanken: Party-Schaden durch einzelne Versäumnisse und Verlust bei Tod.
- Eine leitplankenkonforme Variante wäre ein Boss, der nur Schaden **nimmt**, aber nie austeilt. Das entspricht dem Prinzip der Habitica-Sammelquests [43]. Zu erwartende Folge: weniger Spannung, das ist aber nicht belegt.
- 50/50-Balken: Der Boss-Lebensbalken könnte zur Hälfte von jeder Person abgebaut werden.

### 2.6 Idle- und Incremental-Spiele

**Beispiele:**
- **PaceQuest** [52]: „1 real-world step = 1 in-game energy point“. Ein Idle-Modus läuft bei geschlossener App weiter.
- **Prado** [53]: Schritte werden zu Energie. Es gibt Gruppen und Handel mit Freunden.
- **Neko Atsume** (siehe 2.4) als Idle-Muster ohne Fitness [38].
- „Walk Idle“, „Fitness Idle“ und „Pedometer RPG“: kein Store-Beleg gefunden.

**Die Form im Überblick:**
- **Kernschleife:** Aktivität → Ressource → automatische Produktion → Upgrades.
- **Gesundheitsziele:** Ressource bzw. Multiplikator.
- **Partner:** In den gefundenen Beispielen nur Freunde und Handel.
- **Spielzeit:** Sehr kurz, man schaut nur kurz vorbei.
- **Verpasste Tage:** Idle-Spiele laufen ohne Zutun weiter; für die Beispiele ist das nur beim Idle-Modus von PaceQuest belegt [52].

**Einordnung (eigene Ableitung):**
- Gut mit kurzer Spielzeit und „kein Verlust“ vereinbar.
- Risiko: Läuft die Produktion ohne Gesundheitsziele weiter, verletzt das die Vorgabe „nur durch Ziele voranbringen“. Die Produktion müsste deshalb ausschließlich aus Zielerfüllung gespeist werden.
- Wirkungsdaten: keine gefunden.

### 2.7 Ressourcen- bzw. Energie-Ökonomie mit begrenzter Spielzeit

Diese Form kommt der angedachten Richtung des Nutzers am nächsten.

**Beispiele:**
- **STEPN** [54]:
  - 1 Energie entspricht 5 Minuten Bewegung. Die Energie füllt sich alle 6 Stunden zu 25 % auf, ungenutzte Energie verfällt.
  - Kryptowährungs-Kontext; hier nur als Mechanikbeispiel genannt.
- **Finch:** Energie aus Zielen schickt den Vogel auf ein Abenteuer mit Timer [4] (SA).
- **Candy Crush:** 5 Leben, ein neues alle 30 Minuten. Nur über das Fan-Wiki belegt [56].
- **Dunwell, Dixon & Morosini 2015** [111]: Laut Alha (DiGRA 2019) übernahm dieses Serious Game die in Free-to-play-Spielen übliche Energie-Mechanik. Statt zu bezahlen, erledigte man gesunde Aufgaben. Den Volltext habe ich **nicht** eingesehen.
- **Wordle** [57]: kein Gesundheitsbezug, aber das bekannteste Beispiel für bewusst begrenzte Spielzeit. Ein Rätsel pro Tag. Der Entwickler sah gerade die Knappheit als Erfolgsfaktor, etwa 3 Minuten täglich (Presse).

**Design-Literatur:**
- **Zagal, Björk & Lewis 2013** [109] beschreiben „Playing by Appointment“ als dunkles Muster: Spieler müssen ihren Alltag nach dem Spiel ausrichten.
  - Wörtlich: „The darkness of this pattern is nullified if completing appointments is not required for progression.“
  - Energie-Verknappung, die zum Bezahlen drängt, nennen sie „Pay to Skip“.
- **Deterding, Stenros & Montola 2020** [110] kritisieren das Konzept der „dunklen Muster“: Es habe keine empirische Grundlage und keinen klaren ethischen Rahmen.
- **Biden 2015** [112] (Branchenblog):
  - Energie dient der Gewöhnung, dem Tempo der Inhalte und der Monetarisierung, wird aber als „arbitrary cap“ empfunden.
  - Mobile Sitzungen sollten 1–3 Minuten befriedigend sein.

**Die Form im Überblick:**
- **Kernschleife:** Gesundheitsziel → Energie → Energie in Spielzüge umsetzen (Kampf, Bau, Puzzle) → Fortschritt.
- **Gesundheitsziele:** Energie, die die Spielzeit begrenzt.
- **Partner:** Denkbar sind Energie verschenken (wie Walkrs Planet Lab [21]) oder ein gemeinsamer Energiepool (eigene Ableitung).
- **Spielzeit:** Von der Energiemenge begrenzt.
- **Verpasste Tage:** Hängt davon ab, ob die Energie verfällt (STEPN: ja [54]) oder sich ansammelt.
- **Neuheitseffekt:** Die Energie selbst hilft dagegen nicht. Es braucht Inhalte, für die man sie ausgibt.

**Einordnung (eigene Ableitung):**
- Verfallende Energie ist ein Verlust und erzeugt Termin-Druck im Sinne von Zagal [109]. Leitplankenkonform wäre eine Energie, die sich ansammelt, mit einer Obergrenze gegen Horten bzw. Übertraining.
- Eine pro Tag gedeckelte Energie verhindert zugleich, dass extremes Verhalten mehr Spiel bringt (vgl. Pikmins 50.000-Schritte-Grenze [15]).
- Mit 50/50 vereinbar, wenn jede Person ihre eigene Energie mitbringt und ein Spielzug Energie **beider** braucht.

### 2.8 Kooperative Puzzle- und Minispiele

**Beispiele:**
- **Keep Talking and Nobody Explodes** [58]: Eine Person entschärft die Bombe, die anderen haben nur das Handbuch. Synchrone Kommunikation ist Pflicht.
- **We Were Here** [59]: zwei getrennte Spieler, verbunden nur per Walkie-Talkie.
- **It Takes Two** [60] (Presse): ausschließlich für zwei gebaut.
- **NEAT-o-Games** (Forschung) [101]: Ein Avatar-Rennen wird über einen Akzelerometer gesteuert. Überschüssige Aktivitätspunkte lassen sich gegen Hinweise in einem Sudoku eintauschen.
- **Pixel Pals** [68]: interaktive Widget-Minispiele (z. B. 2048) mit einem Pixel-Pet. Freunde kann man hinzufügen und gegen sie kämpfen. Wie das genau abläuft, ist **nicht belegt**.
- **Words with Friends** [78] (Presse): rundenbasiert asynchron mit Push-Benachrichtigung, wenn man dran ist.

**Die Form im Überblick:**
- **Kernschleife:** Gesundheitsziel → Spielzüge, Hinweise oder Puzzleteile → gemeinsames Rätsel lösen.
- **Gesundheitsziele:** Züge, Hinweise oder Teile (NEAT-o-Games: Hinweise [101]).
- **Partner:** Bei asymmetrischen Puzzles **Pflicht**, weil jede Person nur ihre Hälfte der Information hat. Diese Spiele sind meist synchron [58][59]. Eine asynchrone Variante wäre rundenbasiert, nach dem Muster von Words with Friends [78].
- **Spielzeit:** Ein Rätsel pro Tag nach dem Wordle-Muster [57].
- **Verpasste Tage:** Bei rundenbasiertem Spiel wartet das Spiel auf den Zug des anderen.

**Einordnung (eigene Ableitung):**
- Das stärkste „man braucht den Partner“-Muster.
- Risiko: Wartet eine Person auf den Zug der anderen, entsteht Druck auf den Partner (siehe Abschnitt 4.4).
- Inhaltsaufwand: Puzzles verbrauchen sich. Belegt ist das nicht, das Wordle-Prinzip (ein Rätsel pro Tag) [57] begrenzt aber den Verbrauch.
- Wirkungsdaten für Gesundheitsverhalten: keine gefunden.

### 2.9 Asynchrones Koop für zwei: Bausteine

Die folgenden Muster kommen als Baustein in jeder Form oben in Frage.

| Muster | Belegtes Beispiel | Mechanik | Verlust beim Ausbleiben? |
|---|---|---|---|
| Tägliches Geschenk | Pokémon GO [35]; Sky: Children of the Light [61]; Monster Hunter Now Cheering [50] | 1 Geschenk pro Freund und Tag; GO-Geschenke kann man nicht selbst öffnen, nur verschicken; Cheering gibt +1 max. HP | Nein |
| Gemeinsamer Boss | Habitica [42]; Clash of Clans Raid Weekend [62] | Schaden summiert sich; bei Clash macht ein Mitglied dort weiter, wo ein anderes aufgehört hat | Habitica: ja (Party-Schaden) [42] |
| Gemeinsames Wochenziel | Pikmin Bloom [13]; MH Now Friend Quests [49]; Strava Group Challenges [63] | Beiträge summieren sich; Pikmin gibt auch beim Scheitern einen Teilnahmepreis; Strava ohne Rangliste | Nein; bei MH Now werden nur Beitragende belohnt [49] |
| Geteilte Strecke | Conqueror-Team [18] | Gemeinsames Icon auf der Karte, ungleiche Verteilung erlaubt | Nein |
| Rollenteilung | FurTwo [70] | Partner A: spielen, trainieren, schlafen legen; Partner B: füttern, Hygiene, heilen | Laut Versionshinweisen sinken die Werte über Zeit, es gibt eine „Memorial“-Wiederbelebung [70]. Ursache nicht beschrieben |
| Gegenseitiges Freischalten | Paired [65]; Agapé [66] | Die Antwort des Partners wird erst nach der eigenen sichtbar | Nein |
| Gemeinsamer Streak | Couple Habits [80]; Couple Joy [67] | Fällt einer aus, verlieren beide; Couple Joy repariert gegen Geld | Ja |
| Gemeinsamer Bonus | Moove [79] | Bonus, wenn alle Teammitglieder an einem Tag 10 Punkte schaffen; ein Ruhetag pro Woche | Nein, nur kein Bonus |

**Einordnung (eigene Ableitung):** Leitplankenkonform sind Geschenke, gemeinsame Wochenziele mit Teilnahmepreis, geteilte Strecken, gegenseitiges Freischalten und Bonus-statt-Verlust (Moove). Nicht konform sind Party-Schaden, gemeinsamer Streak-Verlust und verfallende Pflegewerte.

### 2.10 Paar-Apps mit gemeinsamen Pets oder Gärten

**Was es wirklich gibt** (Stand 10/2026, Store-Texte, Firmenquellen):
- **Mit gemeinsamem Wesen, ohne Fitness:**
  - **Widgetable:** Pets gemeinsam „co-parenten“ [73].
  - **SumOne:** Das gemeinsame Wesen EggMon wächst durch tägliche Beziehungsfragen [74].
  - **Cozy Couples:** Bonsai, Katze oder Hund und ein gemeinsames Zuhause [75].
  - **FurTwo:** ein gemeinsames Pet mit Rollenteilung [70].
  - **Pookie:** Das Paar adoptiert gemeinsam ein Pet [71] (nicht vertieft geprüft).
  - **PrettyCat:** Katzen mit Partner oder Freunden [72] (nicht vertieft geprüft).
- **Ohne Pet:**
  - **Paired:** tägliche Fragen mit gegenseitigem Freischalten, Quiz und Spiele im Premium-Abo [65].
  - **Between:** privater Messenger für zwei, gemeinsamer Kalender. Spiele oder Pets sind nicht belegt [69].
  - **Couple Joy:** Fragen, Spiele, Zeichen-Challenges, gemeinsamer Streak mit kaufbarer Reparatur [67].
- **Pixel Pals** ist ein Einzel-Pet auf Home-Screen, Sperrbildschirm und Dynamic Island, mit Freundesfunktion. Eine Paar-Funktion gibt es nicht [68].
- **Gemeinsames Wesen + Gesundheitsbeiträge beider Partner:** Im untersuchten Korpus ist kein Produkt belegt, das beides kombiniert (siehe auch `research/partner-fitness-gamification.md`).

**Fitbit/Google Health (relevant für die Partnerin):**
- Fitbit-Challenges und -Adventures wurden am 27.03.2023 eingestellt [77] (Presse).
- In der heutigen Google-Health-App sind offiziell nur Freunde und ein wöchentliches Leaderboard für Schritte bzw. Cardio Load belegt [76].
- Eine plattformeigene Koop-Challenge, an die sich das Spiel hängen könnte, gibt es damit **nicht belegt**.

---

## 3. Belege zur Wirkung

| Thema | Quelle | Design | Befund | Evidenz (eigene Einordnung) |
|---|---|---|---|---|
| Gamification allgemein | Mazeas 2022 [115a]; Nishi 2024 [115b] | Meta-Analysen von RCTs | kleiner Effekt, im Follow-up kleiner; siehe `gamification-evidence.md` | stark |
| Pokémon GO kurzfristig | Althoff 2016 [84] | Beobachtung, 32.000 Nutzer | +1.473 Schritte/Tag über 30 Tage bei engagierten Spielern; erreichte auch wenig Aktive | mittel |
| Pokémon GO kurzfristig | Xian 2017 [85] | vorher/nachher, n = 167 | +1.976 Schritte/Tag; Dosis-Wirkung mit Spielfortschritt | schwach–mittel |
| Pokémon GO Verlauf | Howe 2016 [113] | Kohorte, n = 1.182 | +955 Schritte in Woche 1, nach 6 Wochen zurück auf Ausgangsniveau | mittel |
| Pokémon GO Verlauf | Hino 2019 [86] | gematchte Kohorte ≥ 40 J., 10 Monate | nur in 3 von 8 Monaten signifikant mehr Schritte | mittel |
| Pokémon GO Überblick | Koh 2026 [87] | Scoping Review, 186 Quellen | Effekte oft kurzlebig, länger bei Älteren und Bewegungsarmen; soziale Effekte (weniger Einsamkeit) | mittel |
| Pokémon GO in Dyaden | Wang 2022 [88] | 156 Mutter-Kind-Dyaden | spielende Mütter aktiver, Kinder nicht; zu wenige Spielende (6 Mütter) | schwach |
| Pikmin Bloom | Laato 2022 [89] | Autoethnografie, 8 Wochen | nur Design-Spannungen, keine Gesundheitsendpunkte; **Wirkung nicht belegt** | sehr schwach |
| Zombies, Run! | Farič 2021 [83] | qualitativ, n = 30 | Narrativ motiviert nach Selbstauskunft zu längeren Einheiten; **kein RCT gefunden** | schwach |
| Habitica | Diefenbach & Müssig 2019 [81] | Feldstudie n = 45, 2 Wochen | Strafen wirken kontraproduktiv, Nutzer weichen aus | schwach–mittel |
| Punkte für Wasser trinken | Lieder 2024 [82] | Feldexperiment, 40 Tage | häufiger getrunken, aber keine stärkere Gewohnheit (SRHI) | mittel |
| Exergames | Li 2025 [92] | Meta-Analyse, 20 RCTs | Aktivität SMD 0,19, MVPA 0,48, Schritte 0,54; allein oder mit anderen spielen moderiert die Wirkung | mittel–stark |
| Exergames | Street 2017 [91] | Review, 9 Studien, Erwachsene | kurzfristig mehr Bewegung; Langzeitdaten fehlen | schwach–mittel |
| Exergames Energieumsatz | Peng 2011 [90] | Meta-Analyse | meist leichte bis moderate Intensität | mittel |
| Koop vs. Wettbewerb | Chen & Pu 2014 [95] | 18 Dyaden, 2 Wochen | gegenüber allein: Koop +21 %, Hybrid +18 %, Wettbewerb +8 % | schwach |
| Koop vs. Wettbewerb | Staiano 2013 [96] | RCT, n = 54 Jugendliche, 20 Wochen | nur die kooperative Gruppe nahm signifikant mehr ab als die Kontrolle | mittel (Jugendliche) |
| Koop vs. Wettbewerb | Marker & Staiano 2015 [98] | narratives Review | Koop fördert Motivation und Weiterspielen, Wettbewerb kurzfristig Energieumsatz | schwach |
| Paar-Impulse per App | Höhener 2026 [99] | mikrorandomisiert, 38 Paare, 55 Tage | situative Paar-Impulse steigern MVPA bei Adressat **und** Partner (kein Spiel) | mittel |
| Paare mit Spielmechanik | Kurtzman 2018, LOSE IT [114] | RCT | Gamification ohne Zusatznutzen gegenüber gemeinsamem Tracking | mittel |
| Virtueller Garten | Consolvo 2008 [100] | Feldexperiment, n = 28, 3 Monate | mit Garten-Display blieb die Aktivität über die Feiertage erhalten | schwach–mittel |
| Virtuelles Pet | Lin 2006, Fish'n'Steps [116] | n = 19, 14 Wochen | Begeisterung ließ bei den meisten nach etwa 2 Wochen nach | schwach |
| Belohnung und Motivation | Deci 1999 [102] | Meta-Analyse, 128 Experimente | erwartete, an Leistung gekoppelte Belohnungen senken die intrinsische Motivation; positives Feedback steigert sie | stark (Labor) |
| Lotterie-Anreize | Volpp 2008 [103] | RCT, n = 57 | Abnahme während der Anreize, nach 7 Monaten nicht mehr signifikant | mittel |
| Lootboxen | Zendle 2018 [104] | Survey, n = 7.422 | Lootbox-Ausgaben hängen mit problematischem Spielen zusammen (Echtgeld) | mittel |
| Energie in Serious Games | Dunwell 2015 [111] | Konferenzbeitrag | Mechanik beschrieben; Wirkung: Volltext nicht eingesehen, **nicht belegt** | – |

**Was nicht belegt ist:**
- Wirkung von Energie-Mechaniken auf Gesundheitsverhalten.
- Lootbox-ähnliche Mechaniken in Gesundheits-Apps.
- Kooperative Puzzlespiele als Gesundheitsintervention.
- Ein Cochrane-Review zu Exergames bei Erwachsenen (keins gefunden).
- RCTs zu Finch, Pikmin Bloom, Zombies, Run! und Habitica.
- Paar-Gesundheitsspiele bei Erwachsenen.

---

## 4. Fallstricke

### 4.1 Belohnung von Kaloriendefizit
- Kalorien-Tracking ist mit Essstörungs-Symptomen assoziiert (Querschnitt) [118].
- In strukturierten Abnehmprogrammen sinkt das Essstörungsrisiko im Mittel, einzelne Personen entwickeln aber neue Symptome [117].
- **Einordnung (eigene Ableitung):**
  - Spielformen, bei denen „mehr Gesundheitsleistung = mehr Spiel“ gilt (Energie, Schaden, Strecke), belohnen ohne Obergrenze auch Extreme.
  - Belegte Vorbilder für Deckel: Pikmin zählt höchstens 50.000 Schritte pro Tag [15], Pokémon GO deckelt Herzen pro Aktivität täglich [32], Pokémon Sleep erlaubt höchstens 2 Sitzungen pro Tag [31] (SA).
  - Ein Kalorienziel als „im Korridor“ statt „möglichst wenig“ zu werten, wäre analog (nicht belegt).

### 4.2 Schummeln bei manueller Eingabe
- Selbst eingetragene Energieaufnahme wird systematisch zu niedrig angegeben: 12–20 % im 24-h-Protokoll, 31–38 % im Häufigkeitsfragebogen (Biomarker, n = 484) [106].
- Bei „diätresistenten“ Personen wurde die Aufnahme um 47 % unterschätzt und die Aktivität um 51 % überschätzt (n = 10) [105].
- Spiele mit realen Anreizen ziehen Manipulation an:
  - Bei Pokémon GO ist Standortfälschung (Spoofing) dokumentiert [107].
  - Sweatcoin zieht nach eigenen Angaben „shakes and bumps“ algorithmisch ab und wandelt im Schnitt etwa 65 % der Handy-Schritte um [55] (Firma).
- Peer-reviewte Studien zum Schrittzähler-Schütteln: **nicht gefunden**.
- **Einordnung (eigene Ableitung):** Für zwei Personen, die freiwillig zusammen spielen, ist Betrug ein geringeres Thema als bei Geldprämien. Die Untertreibung bei Kalorien ist aber auch ohne Absicht belegt [106]. Ein Spiel, das niedrige Kalorienwerte belohnt, verstärkt diese Verzerrung womöglich (nicht belegt).

### 4.3 Ungleiche Spielmotivation im Paar
- Spielertypen unterscheiden sich messbar und hängen mit Präferenzen für bestimmte Spielelemente zusammen (Hexad-Skala) [108].
- Auch die Empfänglichkeit für Überzeugungsstrategien unterscheidet sich nach Spielertyp: Orji et al. 2014, n = 1.108, DOI 10.1007/s11257-014-9149-8. Diese Angabe stammt aus einer Zusammenfassung, das Abstract wurde nicht direkt verifiziert.
- Individuelle Unterschiede (z. B. Wettbewerbsorientierung) moderieren, ob Koop oder Wettbewerb besser wirkt [98].
- Studien zu **Paaren mit ungleicher Spielmotivation**: **nicht gefunden**.
- **Einordnung (eigene Ableitung):**
  - Spielformen mit zwingend aktivem Spielzug beider Partner (Puzzle, rundenbasiert) sind am anfälligsten.
  - Formen, bei denen die Gesundheitsziele selbst der Beitrag sind und das „Spielen“ optional bleibt (Strecke, Garten, Boss ohne Gegenangriff), tolerieren eine nicht spielende Person besser. Bei ihnen bleibt der Partner über die Ziele beteiligt.

### 4.4 Druck auf den Partner
- Gesundheitsbezogene soziale Kontrolle in Paaren kann Reaktanz auslösen, ohne die Aktivität zu steigern [119].
- Positive, situative Paar-Impulse wirkten dagegen sogar auf beide [99].
- Synchrone Koop-Muster mit gemeinsamem Verlust (Forest Plant Together [1], Couple Habits [80]) machen den Partner zum Risiko für den eigenen Fortschritt.
- Termin-Mechaniken, die für den Fortschritt nötig sind, gelten als dunkles Muster [109].
- **Einordnung (eigene Ableitung):** Formen, bei denen man **auf den anderen wartet** (rundenbasiert, 50/50-Balken mit Pflichtanteil), erzeugen strukturell Wartedruck. Er lässt sich abmildern: durch Teilnahmepreise wie bei Pikmin [13], durch Ruhetage wie bei Moove [79] oder dadurch, dass der eigene Beitrag gespeichert bleibt, bis der andere nachzieht.

---

## 5. Vergleichstabelle

Legende: ✓ gut vereinbar · ~ mit Anpassung · ✗ in den Beispielen unvereinbar. Die Spalten zu Leitplanken und 50/50 sind **eigene Einordnung**.

| Spielform | Belegte Beispiele | Rolle der Gesundheitsziele | Rolle des Partners | Tägliche Spielzeit | Verpasste Tage in den Beispielen | Mittel gegen Neuheitseffekt (Beispiele) | Wirkungsbelege | Leitplanken | 50/50-Balken |
|---|---|---|---|---|---|---|---|---|---|
| Aufbau/Garten/Insel | Forest, Finch, Pikmin Bloom, Plant Nanny | Wachstum/Zeit, Währung, Energie | optional; synchron (Forest) oder Wochenziel (Pikmin) | kurz bis passiv | Forest: Abbruch tötet Baum; sonst keine Strafe belegt | Monats-Events, Community Days, Saisons | UbiFit (schwach–mittel); Pikmin nicht belegt | ✓ (ohne Forest-Abbruchlogik) | ✓ zwei Gartenhälften |
| Expedition/Karte | Conqueror, Walkr, Walk With Friends! | Strecke/Treibstoff | geteilte Strecke, asynchron | minimal | keine Strafe belegt | neue Routen, Events | nicht belegt | ✓ | ✓ Summe beider Hälften |
| Story/Narrativ | Zombies, Run!, Finch, Ring Fit | Kapitel-Freischaltung, Rohstoffe | in Beispielen kein Koop | an Aktivität gekoppelt (Ring Fit: ~30 min empfohlen) | keine Strafe belegt | neue Staffeln | qualitativ (Farič) | ✓ | ✓ Kapitel bei vollem Balken |
| Sammeln/Kreaturen | Pokémon Sleep, GO Buddy, Neko Atsume, Wokamon | Anlockfaktor, Währung | Geschenke, Freundschaft, asynchron | kurz; Tagesdeckel | GO: Stimmung sinkt, Stufen nie | Events, neue Gebiete/Kreaturen | Pokémon GO: kurzlebig | ✓ / ~ (Stimmung) | ✓ |
| RPG/Boss | Habitica, Fitness RPG, MH Now, Ring Fit | Schaden, XP, Energie | gemeinsamer Boss, Anfeuern, Friend Quests | Habitica: keine Grenze belegt | Habitica: Party-Schaden, Tod mit Verlust | Saisons, Galas | Habitica: kontraproduktive Effekte | ✗ in Reinform; ~ ohne Gegenangriff | ✓ Boss-Balken halb/halb |
| Idle/Incremental | PaceQuest, Prado, Neko Atsume | Ressource/Multiplikator | Handel, Freunde | sehr kurz | läuft weiter (PaceQuest) | nicht belegt | keine | ✓ wenn nur aus Zielen gespeist | ✓ |
| Energie-Ökonomie | STEPN, Finch, Candy Crush, Dunwell 2015 | Energie begrenzt Spielzeit | Energie schenken (Walkr), denkbar: Pool | per Energie gedeckelt | STEPN: Energie verfällt | erfordert eigenen Inhalt | nicht belegt | ~ (kein Verfall, Deckel) | ✓ Spielzug braucht beide |
| Koop-Puzzle/Minispiel | Keep Talking, We Were Here, NEAT-o-Games, Words with Friends | Züge, Hinweise, Puzzleteile | **Pflicht**, meist synchron; asynchron als Runden | 1 Rätsel/Tag (Wordle-Muster) | Spiel wartet | neue Rätsel | nicht belegt | ~ (Wartedruck) | ✓ je eine Hälfte |
| Async-Koop-Bausteine | GO-Geschenke, Pikmin-Wochenziel, Conqueror-Team, Paired, FurTwo | Beitrag zum gemeinsamen Ziel | asynchron, teils Pflicht (Rollen, Freischalten) | kurz | von „Teilnahmepreis“ bis „beide verlieren“ | wöchentliche Ziele | Chen & Pu (Koop, schwach) | je nach Muster | ✓ |
| Paar-App mit Pet | Widgetable, SumOne, Cozy Couples, FurTwo | in Beispielen **keine** Gesundheitsziele | gemeinsames Wesen | kurz | FurTwo: Werte sinken, „Memorial“ | nicht belegt | Agapé-Pilot (Beziehung, ohne Kontrollgruppe) | ~ | ✓ |

---

## 6. Offene bzw. nicht belegbare Punkte

- **Keine Wirkungsstudien** (RCTs) zu Pikmin Bloom, Zombies, Run!, Finch, Habitica, Energie-Mechaniken in Gesundheits-Apps oder kooperativen Puzzles als Gesundheitsintervention.
- **Keine Studie zu Paaren mit ungleicher Spielmotivation** und keine zu Paar-Gesundheitsspielen bei Erwachsenen. Die nächsten Annäherungen sind Chen & Pu 2014 (Dyaden, nicht Paare) [95] und Höhener 2026 (Paare, kein Spiel) [99].
- **Ob laufende Inhalte** (Saisons, Kapitel, Events) den Neuheitseffekt bei Gesundheitsverhalten verhindern, ist nicht belegt. Die Firmen belegen nur, dass sie solche Inhalte anbieten.
- **Nur über Suchauszüge (SA) belegt:** Finch (Energie, Good Vibes, Streak-Reparatur, Pause, Saison-Events), Zombies, Run! (Verfolgungen, Multiplayer-Pläne), Pokémon Sleep (2 Sitzungen pro Tag, Nachtragen). Vor einer Übernahme im Browser prüfen.
- **Nur über Sekundärquellen belegt:**
  - Finch „Tree Town“ als Freundesort: Universität Tennessee, https://cehhs.utk.edu/ero/managing-self-care-through-the-finch-app/
  - Plant Nanny „welkt statt stirbt“: Rezensionen [17]
  - Neko-Atsume-Besuchslogik [39]
  - Conqueror: Street View und Baumpflanzen
  - Pokémon-Sleep-Wochenzyklus
  - Candy-Crush-Leben [56]
- **Nicht bestätigbar:**
  - Walkr „Satellite Missions“
  - Pixel-Pals-Freundeskampf im Detail
  - Fitbit/Google-Health-Challenges heute
  - Ob „Pookie“ und „PrettyCat“ mehr als eine Pet-Mechanik haben
  - Eine App namens „Bondie“: belegt ist nur „Bondy“, ohne Pet
- **Volltexte nicht eingesehen:** Dunwell 2015 [111] (die direkteste Vorlage „Energie aus gesunden Aufgaben“), Mekler 2017, Orji 2014.
- Die Store-Recherche belegt keine vollständige Marktabdeckung.

---

## Quellen

Alle Web-Seiten abgerufen am 10.10.2026. *(Firma)* = Herstellerquelle. (SA) = nur Suchauszug.

**Aufbau, Garten, Insel**
1. Forest – Seekrtech *(Firma)*. https://www.forestapp.cc/
2. About Finch – Finch Care *(Firma)*. https://finchcare.com/about-finch
3. Finch: Self-Care Pet, App Store *(Firma)*. https://apps.apple.com/us/app/finch-self-care-pet/id1528595748
4. Finch Help: Going on an Adventure *(Firma, SA)*. https://help.finchcare.com/hc/en-us/articles/37779979512845-Going-on-an-Adventure
5. Finch Help: Sending Good Vibes *(Firma, SA)*. https://help.finchcare.com/hc/en-us/articles/37780369483533-Sending-Good-Vibes
6. Finch Help: Understanding Streaks *(Firma, SA)*. https://help.finchcare.com/hc/en-us/articles/37780736136205-Understanding-Streaks
7. Finch Help: Pause Mode *(Firma, SA)*. https://help.finchcare.com/hc/en-us/articles/37936144770701-Pause-Mode
8. Finch Help: Seasonal Event Overview *(Firma, SA)*. https://help.finchcare.com/hc/en-us/articles/37780438941965-Seasonal-Event-Overview
9. Finch Help: Our Mission *(Firma, SA)*. https://help.finchcare.com/hc/en-us/articles/37935669335309-Our-Mission
10. Pikmin Bloom Help: How to play *(Firma)*. https://niantic.helpshift.com/hc/en/23-pikmin-bloom/faq/2854-how-to-play-pikmin-bloom/
11. Pikmin Bloom Help: Planting flowers *(Firma)*. https://niantic.helpshift.com/hc/en/23-pikmin-bloom/faq/2855-planting-flowers/
12. Pikmin Bloom: Gameplay *(Firma)*. https://pikminbloom.com/gameplay
13. Pikmin Bloom Help: Weekly Challenges *(Firma)*. https://niantic.helpshift.com/hc/en/23-pikmin-bloom/faq/3404-weekly-challenges/
14. Pikmin Bloom Help: Mushrooms *(Firma)*. https://niantic.helpshift.com/hc/en/23-pikmin-bloom/faq/3039-mushrooms-1676271507/
15. Pikmin Bloom Help: FAQ about seedlings *(Firma)*. https://niantic.helpshift.com/hc/en/23-pikmin-bloom/faq/3343-faq-about-seedlings/
16. Pikmin Bloom News: Community Day November 2025 *(Firma)*. https://pikminbloom.com/en/news/nov25-communityday
17. Plant Nanny – SPARKFUL *(Firma)*. https://sparkful.app/plant-nanny · App Store inkl. Nutzerrezensionen: https://apps.apple.com/us/app/plant-nanny-cute-water-tracker/id1424178757

**Expedition, Karte**
18. The Conqueror: FAQ *(Firma)*. https://www.theconqueror.events/faq
19. The Conqueror Challenges, App Store *(Firma)*. https://apps.apple.com/us/app/the-conqueror-challenges/id1539543704
20. The Conqueror: llms.txt *(Firma)*. https://www.theconqueror.events/llms.txt
21. Walkr – SPARKFUL *(Firma)*. https://sparkful.app/walkr
22. Walkr, App Store *(Firma)*. https://apps.apple.com/us/app/walkr-fitness-space-adventure/id834805518
23. Walk With Friends!, App Store *(Firma)*. https://apps.apple.com/app/id1008343335

**Story**
24. Get started with Zombies, Run! – Six to Start *(Firma)*. https://zombiesrungame.com/news/Get-started-with-zr
25. Zombies, Run!, App Store *(Firma)*. https://apps.apple.com/us/app/zombies-run/id503519713
26. Zombies, Run! Support: Zombie Chases *(Firma, SA)*. https://support.zombiesrungame.com/hc/en-us/articles/203780596
27. Zombies, Run! Blog, 24.06.2015 *(Firma, SA)*. https://blog.zombiesrungame.com/2015/06/24/hey-guys-just-wanted-to-let-you-know-how-much-im/
28. Beginner Basics for Ring Fit Adventure – Nintendo *(Firma)*. https://www.nintendo.com/jp/ichikara/al3pa/02_en.html

**Sammeln, Kreaturen**
29. Pokémon Sleep: Pokémon – The Pokémon Company *(Firma)*. https://www.pokemonsleep.net/en/pokemon/
30. Pokémon Sleep Is Now Available – Pokémon.com *(Firma)*. https://www.pokemon.com/us/pokemon-news/pokemon-sleep-is-now-available-on-the-app-store-and-google-play
31. Pokémon Sleep Gameplay FAQ *(Firma, SA)*. https://support.pokemon.com/hc/en-us/articles/17264561707796-Pok%C3%A9mon-Sleep-Gameplay-FAQ
32. Pokémon GO Help: Buddy Adventure – Niantic *(Firma)*. https://niantic.helpshift.com/hc/en/6-pokemon-go/faq/2155-buddy-adventure/
33. Pokémon GO Help: Adventure Sync *(Firma)*. https://niantic.helpshift.com/hc/en/6-pokemon-go/faq/3265-adventure-sync/
34. Pokémon GO Help: Friend List & Friendship Levels *(Firma)*. https://niantic.helpshift.com/hc/en/6-pokemon-go/faq/2847-friend-list-friendship-levels-1614900279/
35. Pokémon GO Help: Sending & Receiving Gifts *(Firma)*. https://niantic.helpshift.com/hc/en/6-pokemon-go/faq/85-sending-receiving-gifts/
36. Party Play – Pokémon GO *(Firma)*. https://pokemongo.com/news/partyplay
37. Neko Atsume 2, App Store – Hit-Point *(Firma)*. https://apps.apple.com/us/app/neko-atsume-2/id6499131935
38. Neko Atsume: How to Play – Hit-Point *(Firma)*. https://www.nekoatsume.com/en/about.html
39. Neko Atsume – Giant Bomb (Sekundärquelle). https://giantbomb.com/wiki/Games/Neko_Atsume
40. Wokamon, App Store – Shikudo *(Firma)*. https://apps.apple.com/us/app/wokamon-pedometer-tamagotchi/id686364904
41. Stepets, App Store – Platonic Games *(Firma)*. https://apps.apple.com/us/app/stepets-walking-pet-simulator/id1532881399

**RPG, Boss**
42. Boss – Habitica Wiki (offizielles Community-Wiki). https://habitica.fandom.com/wiki/Boss
43. Quests – Habitica Wiki. https://habitica.fandom.com/wiki/Quests
44. Rest in the Inn – Habitica Wiki. https://habitica.fandom.com/wiki/Rest_in_the_Inn
45. Death Mechanics – Habitica Wiki. https://habitica.fandom.com/wiki/Death_Mechanics
46. Grand Galas – Habitica Wiki. https://habitica.fandom.com/wiki/Grand_Galas
47. Fitness RPG, Google Play – Shikudo *(Firma)*. https://play.google.com/store/apps/details?id=com.shikudo.fitrpg.google&hl=en
48. Monster Hunter Now: Group Hunts – Niantic/Capcom *(Firma)*. https://monsterhunternow.com/howtoplay/group-hunt
49. Monster Hunter Now: Friend Quests *(Firma)*. https://monsterhunternow.com/howtoplay/friend-quest
50. Monster Hunter Now: Friend Cheering *(Firma)*. https://monsterhunternow.com/howtoplay/friend-cheering
51. Monster Hunter Now: Seasons *(Firma)*. https://monsterhunternow.com/howtoplay/seasons

**Idle, Energie, begrenzte Spielzeit**
52. PaceQuest, App Store *(Firma)*. https://apps.apple.com/us/app/pacequest/id6751749414
53. Prado, App Store *(Firma)*. https://apps.apple.com/us/app/prado-circle-slow-rpg/id6475605844
54. STEPN Whitepaper: Energy System *(Firma)*. https://whitepaper.stepn.com/running-module/energy-system
55. Sweatcoin: Verification Algorithm *(Firma)*. https://sweatco.in/verification-algorithm
56. Lives – Candy Crush Fan-Wiki (Sekundärquelle). https://candycrush.fandom.com/wiki/Lives
57. He made Wordle for his partner (NYT-Bericht, Nachdruck Boston.com, 04.01.2022; Presse). https://www.boston.com/news/national-news/2022/01/04/he-made-wordle-for-his-partner-now-its-an-online-hit/

**Koop-Spiele und asynchrone Muster**
58. Keep Talking and Nobody Explodes: How to play remotely – Steel Crate Games *(Firma)*. https://keeptalkinggame.com/how-to-play-remotely/
59. We Were Here, Steam – Total Mayhem Games *(Firma)*. https://store.steampowered.com/app/582500/We_Were_Here
60. Josef Fares It Takes Two interview – The Ringer (Presse). https://www.theringer.com/2021/4/22/22396763/josef-fares-it-takes-two-interview-co-op-gaming
61. Sky: Children of the Light, PlayStation Store *(Firma)*. https://store.playstation.com/en-cl/concept/10004206
62. Clan Capital Raids – Supercell *(Firma)*. https://supercell.com/en/games/clashofclans/blog/game-updates/clan-capital-raids
63. Group Challenges – Strava Support *(Firma)*. https://support.strava.com/hc/en-us/articles/360061360791
64. Apple Watch User Guide: Share activity / Compete *(Firma)*. https://support.apple.com/en-gw/guide/watch/apd68a69f5c7
65. Paired, App Store *(Firma)*. https://apps.apple.com/app/id1469609343
66. Can an app improve your romantic relationship? – University of Rochester; Studie: J Fam Psychol, https://doi.org/10.1037/fam0001166 (Pilot, 405 Paare, ohne Kontrollgruppe; Autoren mit Firmenbeteiligung). https://www.rochester.edu/newscenter/can-relationship-app-improve-romance-571032/
67. Couple Joy, App Store *(Firma)*. https://apps.apple.com/us/app/couple-joy-relationship-app/id1624758651
68. Pixel Pals, App Store – Christian Selig *(Firma)*. https://apps.apple.com/us/app/pixel-pals-widget-pet-game/id6443919232
69. Between, App Store *(Firma)*. https://apps.apple.com/us/app/between-the-app-couples-love/id458035189
70. FurTwo, App Store (Beschreibung und Versionsverlauf) *(Firma)*. https://apps.apple.com/app/id6759111831
71. Pookie, App Store *(Firma)*. https://apps.apple.com/app/id6756569878
72. PrettyCat, App Store *(Firma)*. https://apps.apple.com/lb/app/prettycat/id6654919294
73. Widgetable, App Store *(Firma)*. https://apps.apple.com/us/app/widgetable-besties-couples/id1641107226
74. SumOne, App Store *(Firma)*. https://apps.apple.com/us/app/sumone-for-relationships/id1469506430
75. Cozy Couples, App Store *(Firma)*. https://apps.apple.com/us/app/cozy-couples-relationship-app/id6463766369
76. Connect with friends on Google Health – Google *(Firma)*. https://support.google.com/googlehealth/answer/14237026?hl=en
77. Fitbit challenges/groups removed – 9to5Google, 27.03.2023 (Presse). https://9to5google.com/2023/03/27/fitbit-challenges-groups-removed/
78. Zynga brings Words With Friends to Facebook – GamesBeat (Presse). https://gamesbeat.com/words-with-friends-facebook/
79. Moove – Team-Based Fitness, App Store *(Firma)*. https://apps.apple.com/us/app/moove-team-based-fitness/id1619110905
80. Couple Habits, App Store *(Firma)*. https://apps.apple.com/us/app/couple-habits/id6683312277

**Studien**
81. Diefenbach S, Müssig A. Counterproductive effects of gamification: An analysis on the example of the gamified task manager Habitica. *Int J Hum-Comput Stud.* 2019. https://doi.org/10.1016/j.ijhcs.2018.09.004
82. Lieder F, et al. Gamification of Behavior Change: Mathematical Principle and Proof-of-Concept Study. *JMIR Serious Games.* 2024. https://doi.org/10.2196/43078 (PMID 38517466)
83. Farič N, Potts HWW, Rowe S, et al. Running App "Zombies, Run!" Users' Engagement with Physical Activity: A Qualitative Study. *Games Health J.* 2021. https://doi.org/10.1089/g4h.2021.0060 (PMID 34813376)
84. Althoff T, White RW, Horvitz E. Influence of Pokémon Go on Physical Activity. *J Med Internet Res.* 2016. https://doi.org/10.2196/jmir.6759 (PMID 27923778)
85. Xian Y, et al. An Initial Evaluation of the Impact of Pokémon GO on Physical Activity. *J Am Heart Assoc.* 2017. https://doi.org/10.1161/JAHA.116.005341 (PMID 28512111)
86. Hino K, Asami Y, Lee JS. Step Counts of Middle-Aged and Elderly Adults for 10 Months Before and After the Release of Pokémon GO. *J Med Internet Res.* 2019. https://doi.org/10.2196/10724 (PMID 30720438)
87. Koh GK, et al. Motivational Factors, Physical Activity Impacts, and Sociopsychological Effects of Pokémon GO in Players Over the Years: Scoping Review. *J Med Internet Res.* 2026. https://doi.org/10.2196/89235 (PMID 42536111)
88. Wang SD, Dzubur E, Naya CH, Mason TB, Dunton GF. Dyadic Effects of Pokémon GO on Physical Activity and Sedentary Behavior in Mothers and Children. *Int J Exerc Sci.* 2022. https://doi.org/10.70252/gwxw4068 (PMID 36896453)
89. Laato S, Fernández Galeote D, Altarriba Bertran F, Hamari J. Balancing the Augmented Experience: Design Tensions in the Location-based Game Pikmin Bloom. *CHI EA '22.* https://doi.org/10.1145/3491101.3519785
90. Peng W, Lin JH, Crouse J. Is playing exergames really exercising? *Cyberpsychol Behav Soc Netw.* 2011. https://doi.org/10.1089/cyber.2010.0578 (PMID 21668370)
91. Street TD, Lacey SJ, Langdon RR. Gaming Your Way to Health: A Systematic Review of Exergaming Programs to Increase Health and Exercise Behaviors in Adults. *Games Health J.* 2017. https://doi.org/10.1089/g4h.2016.0102 (PMID 28448175)
92. Li SJ, et al. Exergame-Based Behavior Change Interventions for Promoting Physical Activity: Systematic Review and Meta-Analysis of RCTs. *J Med Internet Res.* 2025. https://doi.org/10.2196/62906 (PMID 40779747)
93. Lu AS, Thompson D, Baranowski J, Buday R, Baranowski T. Story Immersion in a Health Videogame for Childhood Obesity Prevention. *Games Health J.* 2012. https://doi.org/10.1089/g4h.2011.0011 (PMID 24066276)
94. Lu AS, et al. The Narrative Impact of Active Video Games on Physical Activity Among Children: A Feasibility Study. *J Med Internet Res.* 2016. https://doi.org/10.2196/jmir.6538 (PMID 27742605)
95. Chen Y, Pu P. HealthyTogether: exploring social incentives for mobile fitness applications. *Chinese CHI '14.* 2014. https://doi.org/10.1145/2592235.2592240
96. Staiano AE, Abraham AA, Calvert SL. Adolescent exergame play for weight loss and psychosocial improvement: A controlled physical activity intervention. *Obesity.* Online 2012, Heft 2013. https://doi.org/10.1038/oby.2012.143 · Heft-DOI: https://doi.org/10.1002/oby.20282 (PMID 23592669)
97. Staiano AE, Abraham AA, Calvert SL. Motivating effects of cooperative exergame play for overweight and obese adolescents. *J Diabetes Sci Technol.* 2012. https://doi.org/10.1177/193229681200600412 (PMID 22920807)
98. Marker AM, Staiano AE. Better Together: Outcomes of Cooperation Versus Competition in Social Exergaming. *Games Health J.* 2015. https://doi.org/10.1089/g4h.2014.0066 (PMID 26181677)
99. Höhener PS, Tobias R, Allen JM, Küng P, Scholz U. Effectiveness of Smartphone-Based Dyadic Interventions to Increase Physical Activity in Romantic Couples: Microrandomized Trial. *JMIR mHealth uHealth.* 2026. https://doi.org/10.2196/67136 (PMID 41592319)
100. Consolvo S, Klasnja P, McDonald DW, et al. Flowers or a robot army? Encouraging awareness & activity with personal, mobile displays. *UbiComp '08.* https://doi.org/10.1145/1409635.1409644
101. Fujiki Y, et al. NEAT-o-Games: blending physical activity and fun in the daily routine. *Comput Entertain.* 2008. https://doi.org/10.1145/1371216.1371224
102. Deci EL, Koestner R, Ryan RM. A meta-analytic review of experiments examining the effects of extrinsic rewards on intrinsic motivation. *Psychol Bull.* 1999. https://doi.org/10.1037/0033-2909.125.6.627 (PMID 10589297)
103. Volpp KG, et al. Financial Incentive-Based Approaches for Weight Loss: A Randomized Trial. *JAMA.* 2008. https://doi.org/10.1001/jama.2008.804 (PMID 19066383)
104. Zendle D, Cairns P. Video game loot boxes are linked to problem gambling. *PLoS One.* 2018. https://doi.org/10.1371/journal.pone.0206767 (PMID 30462669)
105. Lichtman SW, et al. Discrepancy between self-reported and actual caloric intake and exercise in obese subjects. *N Engl J Med.* 1992. https://doi.org/10.1056/NEJM199212313272701 (PMID 1454084)
106. Subar AF, et al. Using intake biomarkers to evaluate the extent of dietary misreporting in a large sample of adults: the OPEN study. *Am J Epidemiol.* 2003. https://doi.org/10.1093/aje/kwg092 (PMID 12835280)
107. Zhao B, Chen Q. Location Spoofing in a Location-Based Game: A Case Study of Pokémon Go. *Lecture Notes in Geoinformation and Cartography.* 2017. https://doi.org/10.1007/978-3-319-57336-6_2 (Befund laut Zusammenfassung, Volltext nicht eingesehen)
108. Tondello GF, et al. The Gamification User Types Hexad Scale. *CHI PLAY '16.* https://doi.org/10.1145/2967934.2968082
109. Zagal JP, Björk S, Lewis C. Dark Patterns in the Design of Games. *FDG 2013*, S. 39–46. http://www.fdg2013.org/program/papers/paper06_zagal_etal.pdf · https://research.chalmers.se/en/publication/177148
110. Deterding S, Stenros J, Montola M. Against "Dark Game Design Patterns". *DiGRA 2020.* https://eprints.whiterose.ac.uk/156460/1/DiGRA_2020_paper_189.pdf
111. Dunwell I, Dixon R, Morosini D. A mobile serious game for lifestyle change: Conveying nutritional knowledge and motivation through play. *IMCL 2015.* https://doi.org/10.1109/IMCTL.2015.7359599 (Volltext nicht eingesehen; Mechanik laut Alha, DiGRA 2019: https://dl.digra.org/index.php/dl/article/download/1097/1097/1094)
112. Biden E. Eliminating Energy. Mobile Free To Play, 2015 (Branchenblog). https://mobilefreetoplay.com/eliminating-energy/
113. Howe KB, Suharlim C, Ueda P, et al. Gotta catch'em all! Pokémon GO and physical activity among young adults: difference in differences study. *BMJ.* 2016;355:i6270. https://doi.org/10.1136/bmj.i6270 (PMID 27965211)
114. Kurtzman GW, Day SC, Small DS, et al. Social Incentives and Gamification to Promote Weight Loss: The LOSE IT Randomized, Controlled Trial. *J Gen Intern Med.* 2018. https://doi.org/10.1007/s11606-018-4552-1 (PMID 30003481)
115. a) Mazeas A, et al. Evaluating the Effectiveness of Gamification on Physical Activity: Systematic Review and Meta-analysis of RCTs. *J Med Internet Res.* 2022. https://doi.org/10.2196/26779 · b) Nishi SK, et al. Effect of digital health applications with or without gamification on physical activity and cardiometabolic risk factors. *eClinicalMedicine.* 2024. https://doi.org/10.1016/j.eclinm.2024.102798
116. Lin JJ, Mamykina L, Lindtner S, Delajoux G, Strub HB. Fish'n'Steps: Encouraging Physical Activity with an Interactive Computer Game. *UbiComp 2006*, LNCS 4206:261-278. https://doi.org/10.1007/11853565_16
117. Jebeile H, Libesman S, Melville H, et al. Eating disorder risk during behavioral weight management in adults with overweight or obesity: A systematic review with meta-analysis. *Obes Rev.* 2023. https://doi.org/10.1111/obr.13561 (PMID 36919475)
118. Simpson CC, Mazzeo SE. Calorie counting and fitness tracking technology: Associations with eating disorder symptomatology. *Eat Behav.* 2017. https://doi.org/10.1016/j.eatbeh.2017.02.002 (PMID 28214452)
119. Küng P, Berli C, Höhener PS, Tobias R, Scholz U. Health-related social control in overweight romantic couples: daily associations with physical activity and affect for targets and agents. *Ann Behav Med.* 2025. https://doi.org/10.1093/abm/kaae093 (PMID 39774604)

*Die DOIs der Studien wurden über die Crossref-API aufgelöst, Abstracts über Europe PMC, OpenAlex bzw. Semantic Scholar geprüft. Volltexte von ACM und Elsevier waren nicht zugänglich (Abruf 10.10.2026).*
