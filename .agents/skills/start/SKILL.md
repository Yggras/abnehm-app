---
name: start
description: Session-Einstieg für die Abnehm-App. Lädt den aktuellen Projektstand (Wayfinder-Karte auf GitHub), fasst ihn kurz zusammen, greift sich das nächste freie Ticket, legt dafür einen eigenen Worktree an und bearbeitet es dort in derselben Session. Mit einer Spezifikation 1–5 als Argument bereitet er stattdessen das Schneiden der Umsetzungstickets per /to-tickets vor. Verwenden, wenn der Nutzer "start" aufruft oder dort weitermachen will, wo zuletzt aufgehört wurde.
---

# start – nächstes Ticket greifen und im eigenen Worktree bearbeiten

Optionales Argument: ein Ticket (Nummer, Titel oder Stichwort, z. B. `start Gamification`). Ohne Argument wählst du das nächste Ticket. Der Nutzer muss nichts übergeben und keine Session neu starten – mehrere `/start`-Sessions dürfen gleichzeitig laufen und greifen sich jeweils verschiedene Tickets.

Dieser Skill ist nur die **Vorbereitung** (Ticket wählen, claimen, Worktree). Die eigentliche Ticketarbeit macht ausschließlich der Skill `wayfinder` – dessen Regeln (Frontier-Reihenfolge, Claim vor jeder Arbeit, höchstens ein Ticket pro Session außer Recherche, Abschluss mit Resolution-Kommentar + Karten-Update) gelten unverändert und werden hier nicht ersetzt.

## Ablauf

1. **Regeln und Arbeitsort prüfen – immer mit echten Dateien/Befehlen, nie nur aus eingeblendetem Kontext:**
   - `AGENTS.md` vollständig aus dem Repo-Root lesen.
   - `pwd`, `git status --short --branch` und `git worktree list` ausführen.
   - Läuft die Session bereits in einem Ticket-Worktree (`scripts/require-ticket-worktree` erfolgreich), Schritte 5–7 überspringen: Ticket ist das aus dem Branchnamen `work/<nummer>-…`.
   - Ist das Argument eine Spezifikation (Titel „Spezifikation N · …“ mit N = 1–5), gilt nur der Abschnitt „Spezifikation in Umsetzungstickets zerlegen“ weiter unten; die Schritte 2–9 entfallen.
2. **Karte laden** – nur den Body, nicht alle Tickets:
   `gh issue view 1 --repo Yggras/abnehm-app`
3. **Frontier bestimmen:** offene Sub-Issues von #1, die nicht zugewiesen sind und deren „blocked by“-Tickets alle geschlossen sind:
   - Sub-Issues: `gh api repos/Yggras/abnehm-app/issues/1/sub_issues --jq '.[] | select(.state=="open") | {number, title, assignees: [.assignees[].login], labels: [.labels[].name]}'`
   - Blocker je Ticket: `gh api repos/Yggras/abnehm-app/issues/<n>/dependencies/blocked_by --jq '.[] | {number, state}'`
   - Zugewiesene Tickets sind von anderen Sessions belegt – **nie** übernehmen oder „wiederaufnehmen“.
4. **Ticket auswählen** (wie `wayfinder`): das genannte Ticket bzw. das erste Frontier-Ticket.
5. **Claimen** (wie `wayfinder`, vor jeder Arbeit): `gh issue edit <nummer> --repo Yggras/abnehm-app --add-assignee @me`
6. **Worktree anlegen** – im primären Checkout:
   `scripts/start-ticket-worktree <nummer> <kurzname>` (Kurzname: kleingeschrieben, `a-z0-9-`, z. B. `hauptbildschirm`). Legen parallele Sessions gerade Worktrees an, wartet das Skript still auf seine Sperre – nicht abbrechen.
   - **Exit-Code 3 = belegt:** Eine parallele Session hat dieses Ticket gerade gegriffen (beide Sessions laufen unter demselben GitHub-Konto, daher ist der Branch die eigentliche Sperre). Den Claim **nicht** zurücknehmen, zum nächsten Frontier-Ticket gehen und ab Schritt 5 wiederholen.
   - Anderer Fehler: stoppen und dem Nutzer melden.
7. **Session in den Worktree verlegen** – in derselben Session, kein Neustart:
   - Claude Code: Werkzeug `EnterWorktree` mit `path` = ausgegebener Worktree-Pfad.
   - Andere Harnesses (z. B. pi): jeden Befehl mit `cd <worktree-pfad> && …` ausführen und Dateien nur über absolute Pfade im Worktree bearbeiten.
   - Danach im Worktree `scripts/require-ticket-worktree` ausführen. Nur bei Erfolg weiterarbeiten; sonst stoppen und melden.
8. **Stand kurz zusammenfassen** (max. ~10 Zeilen): Ziel, Anzahl getroffener Entscheidungen, die Frontier-Tickets **mit Namen** (nie nur Nummern), das gegriffene Ticket, ggf. von anderen Sessions belegte Tickets.
9. **Weitermachen:** den Skill `wayfinder` im Modus „Work through the map“ mit der Karte https://github.com/Yggras/abnehm-app/issues/1 und dem gegriffenen Ticket ausführen (Auswahl und Claim sind damit bereits erledigt). Alle Dateiänderungen, Commits und Pushes nur im Worktree; Zusammenführung per Pull Request.

Im primären Checkout sind ausschließlich lesende Schritte plus `scripts/start-ticket-worktree` erlaubt – auch wenn voraussichtlich nur eine kleine Dokumentationsdatei geändert wird.

## Karte ändern

Andere Sessions können gleichzeitig an der Karte arbeiten, und `gh issue edit --body` ersetzt den ganzen Text. Den Text der Karte (#1) daher **nie** direkt bearbeiten, sondern nur mit `scripts/update-map` (lädt frisch unter Sperre, ändert eine Zeile, idempotent):

- Kontextzeiger anhängen: `scripts/update-map append "Decisions so far" "- [<Tickettitel>](<url>) — <Kurzfassung>"`
- Zeile ersetzen, z. B. Fog oder Spezifikationsliste: `scripts/update-map replace "<alte Zeile exakt>" "<neue Zeile>"`

## Spezifikations-Tickets („Spezifikation erstellen: …“)

Zusätzlich zu den Regeln im Ticket selbst:

1. **Kontext vollständig laden, bevor geschrieben wird:** [Spezifikation 0 · Fundament & Verträge](https://github.com/Yggras/abnehm-app/issues/71) samt Kommentaren, `CONTEXT.md`, die Entscheidungstickets des eigenen Bereichs (aus dem Ticket und den passenden Zeilen unter „Decisions so far“, jeweils mit Resolution-Kommentar) sowie die dort verlinkten Dateien unter `research/`, `prototypes/` und `spikes/`. Die Verträge aus Spezifikation 0 werden genutzt, nicht neu entworfen; Lücken darin als offene Frage an den Nutzer melden.
2. **`/to-spec` ruft nur der Nutzer auf** (`disable-model-invocation`). Wenn der Kontext steht: in höchstens zehn Zeilen zusammenfassen, was die Spezifikation abdecken wird, dann **„Bereit für /to-spec“** melden und warten. Die Schritte von `/to-spec` nicht auf anderem Weg nachbauen.
3. **Nach dem Veröffentlichen:** das Spezifikations-Issue per nativer „blocked by“-Beziehung an Spezifikation 0 hängen (siehe `docs/agents/issue-tracker.md`, Blocker), kein Sub-Issue der Karte. In der Karte die Zeile unter „Spezifikationen“ mit `scripts/update-map replace` auf den Link umstellen und den Kontextzeiger mit `scripts/update-map append` anhängen; danach Resolution-Kommentar und Schließen wie bei `wayfinder`.
4. Entstehen keine Dateiänderungen, gibt es keinen Pull Request; der leere Worktree bleibt bis zur Aufräumung mit dem Nutzer stehen.

## Spezifikation in Umsetzungstickets zerlegen (`/to-tickets`)

Gilt für die Spezifikationen 1–5. Spezifikation 0 ist bereits zerlegt (Fundament-Tickets = Sub-Issues von [#71](https://github.com/Yggras/abnehm-app/issues/71)). Der Skill `wayfinder` ist hier nicht beteiligt.

1. **Prüfen:** `gh api repos/Yggras/abnehm-app/issues/<n> --jq '{title, state, assignees: [.assignees[].login], tickets: .sub_issues_summary.total}'`. Nur weiter, wenn die Spezifikation offen, nicht zugewiesen und noch ohne Sub-Issues ist; sonst stoppen und melden. Der native Blocker durch Spezifikation 0 bleibt bewusst offen, bis das Fundament umgesetzt ist, und hindert das Schneiden nicht.
2. **Claimen:** `gh issue edit <n> --repo Yggras/abnehm-app --add-assignee @me` – sperrt die Spezifikation gegen parallele Sessions.
3. **Kein Worktree:** Die Session liest im primären Checkout und schreibt nur GitHub-Issues. Wird doch eine Dateiänderung nötig (z. B. ein neuer Begriff in `CONTEXT.md`), erst dann wie in den Schritten 6–7 oben einen Worktree anlegen und hineinwechseln; die Änderung kommt per Pull Request.
4. **Kontext vollständig laden, bevor geschnitten wird:**
   - die eigene Spezifikation samt Kommentaren;
   - [Spezifikation 0 · Fundament & Verträge](https://github.com/Yggras/abnehm-app/issues/71): Maßgeblich ist der Text, als „Eingearbeitet“ markierte Kommentare sind nur Historie;
   - die Fundament-Tickets mit Akzeptanzkriterien (`gh api repos/Yggras/abnehm-app/issues/71/sub_issues --paginate --jq '.[] | {number, title}'`, dann je Ticket `gh issue view <nummer>`), damit jeder bereichsübergreifende Blocker auf genau das Fundament-Ticket zeigt, das den benötigten Vertrag liefert (Zuordnung in Abschnitt 13 von Spezifikation 0);
   - `CONTEXT.md`, `docs/adr/` und das Format der Umsetzungstickets in `docs/agents/issue-tracker.md`;
   - die in der eigenen Spezifikation verlinkten Dateien unter `research/`, `prototypes/` und `spikes/`.

   Lücken oder Widersprüche zwischen Spezifikation und Fundament-Tickets als offene Frage an den Nutzer melden, nicht still auflösen.
5. **`/to-tickets` ruft nur der Nutzer auf** (`disable-model-invocation`). Wenn der Kontext steht: in höchstens zehn Zeilen den geplanten Zuschnitt skizzieren (Tracer-Bullet-Pfade, absehbare Fundament-Blocker), dann **„Bereit für /to-tickets <n>“** melden und warten. Die Schritte von `/to-tickets` nicht auf anderem Weg nachbauen.
6. **Kanten zwischen den Spezifikationen 1–5:** Die Bereiche hängen nur über Verträge aus Spezifikation 0 zusammen. Gegen Ports eines anderen Bereichs wird mit den Fixtures und Test-Adaptern des Fundaments gebaut. Braucht ein Ticket trotzdem die echte Umsetzung eines anderen Bereichs, keine Ticketnummer raten, denn die anderen Bereiche werden gleichzeitig geschnitten. Stattdessen die Kante nach dem Veröffentlichen als Kommentar an der eigenen Spezifikation unter der Überschrift „Offene Kanten zu anderen Bereichen“ festhalten: eigenes Ticket → benötigtes Verhalten und Spezifikation. Gesetzt werden diese Kanten, sobald alle Spezifikationen zerlegt sind (Skill `start-parallel`, Schritt 6).
7. **Abschließen:** die eigene Zuweisung wieder entfernen (`gh issue edit <n> --repo Yggras/abnehm-app --remove-assignee @me`). Die Spezifikation bleibt offen. Kurz melden: Anzahl der Tickets, sofort startbare Tickets mit Namen und offene Kanten.

## Wenn kein Ticket frei ist

- **Karte abgeschlossen** (seit 16.10.2026 der Fall): Die aktuelle Phase ist das Schneiden der Umsetzungstickets. Die Spezifikationen aus dem Abschnitt „Spezifikationen“ der Karte prüfen wie im vorigen Abschnitt, Schritt 1, und die erste offene, nicht zugewiesene ohne Sub-Issues dort zerlegen. Haben alle Spezifikationen Umsetzungstickets: sag das und frag den Nutzer, wie es weitergehen soll (Umsetzung). Dieser Skill wird dann auf die Umsetzung umgestellt.
- **Alle offenen Tickets blockiert oder belegt:** sag das mit Ticketnamen und wer/was blockiert, und lege keinen Worktree an.
