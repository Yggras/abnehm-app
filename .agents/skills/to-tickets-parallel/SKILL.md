---
name: to-tickets-parallel
description: Zerlegt mehrere Spezifikationen gleichzeitig per /to-tickets in Umsetzungstickets, jede in einer eigenständigen Claude-Code-Session in einem eigenen Herdr-Tab. Nur auf ausdrücklichen Aufruf des Nutzers, z. B. "/to-tickets-parallel 82 81 86 83 87".
disable-model-invocation: true
---

# to-tickets-parallel – Spezifikationen parallel in Umsetzungstickets zerlegen

Argumente: Nummern der Spezifikations-Issues (z. B. `82 81 86 83 87`), optional gefolgt von `--` und zusätzlichen `claude`-Optionen (z. B. `-- --effort xhigh`).

Diese Session ist nur der **Starter**: Sie schneidet selbst keine Tickets und legt keinen Worktree an. Sie startet die Tabs im primären Checkout und setzt am Ende die offenen Kanten zwischen den Bereichen (Schritt 5).

## Ablauf

1. **Voraussetzungen prüfen** – mit echten Befehlen:
   - `AGENTS.md` aus dem Repo-Root lesen.
   - `echo "$HERDR_ENV $HERDR_WORKSPACE_ID"` – ist das leer, läuft die Session nicht in Herdr: stoppen und dem Nutzer sagen, dass er sie aus einem Herdr-Tab starten soll.
2. **Spezifikationen bestimmen:**
   - Mit Argumenten: genau diese.
   - Ohne Argumente: die Spezifikationen aus dem Abschnitt „Spezifikationen“ der Karte (`gh issue view 1 --repo Yggras/abnehm-app`) einzeln prüfen (`gh api repos/Yggras/abnehm-app/issues/<n> --jq '{title, state, assignees: [.assignees[].login], tickets: .sub_issues_summary.total}'`), die offenen, nicht zugewiesenen ohne Sub-Issues **mit Namen** auflisten und den Nutzer fragen, welche gestartet werden sollen. Nicht selbst auswählen.
3. **Starten:** `scripts/start-to-tickets-tabs <nummern> [-- <claude-Optionen>]`.
   - Das Skript prüft vorab jede Nummer (Spezifikations-Issue, offen, nicht zugewiesen, noch ohne Sub-Issues) und startet bei einem Problem **gar keinen** Tab. Dann die gemeldeten Gründe mit Namen weitergeben und nachfragen. Der native Blocker durch Spezifikation 0 zählt nicht: Er bleibt offen, bis das Fundament umgesetzt ist.
   - Pro Spezifikation entsteht im aktuellen Herdr-Workspace ein Tab `#<n> Tickets: <Bereich>`. Das Skript weist die Spezifikation dem Nutzer zu (Sperre gegen Doppelstart) und startet darin `claude --permission-mode auto -n "<Tab-Name>" "/to-tickets Issue #<n>. …"` im primären Checkout. Die Session folgt `/to-tickets` und zusätzlich [session.md](session.md).
4. **Übergeben** (kurz): die gestarteten Tabs mit Namen nennen und sagen, was der Nutzer tun muss:
   - In jedem Tab den vorgeschlagenen Zuschnitt prüfen und freigeben oder korrigieren (Schritt „Quiz the user“ von `/to-tickets`); erst danach veröffentlicht die Session.
   - Rückfragen beantworten, wenn Herdr einen Tab als wartend markiert.
   - Kein Worktree, also auch keine Worktree-Bestätigung: Die Sessions schreiben nur GitHub-Issues.
   - Beobachten auf Wunsch mit `herdr agent list` und `herdr agent read <pane>`. Nie in fremde Tabs tippen, außer der Nutzer bittet ausdrücklich darum.
5. **Offene Kanten setzen**, sobald alle Tabs fertig sind (jede gestartete Spezifikation hat Sub-Issues und ist nicht mehr zugewiesen): an jeder Spezifikation die Kommentare „Offene Kanten zu anderen Bereichen“ lesen (`gh issue view <n> --comments`) und jede Kante als native „blocked by“-Beziehung zwischen den Umsetzungstickets setzen (`docs/agents/issue-tracker.md`, Blocker). Kanten, die sich keinem Ticket eindeutig zuordnen lassen, dem Nutzer vorlegen. Danach kurz melden: Tickets je Spezifikation, gesetzte Kanten.
