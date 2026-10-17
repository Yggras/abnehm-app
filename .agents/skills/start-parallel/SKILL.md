---
name: start-parallel
description: Startet mehrere freie Tickets der Wayfinder-Karte oder Spezifikationen 1–5 (zum Schneiden der Umsetzungstickets) gleichzeitig, jedes als eigenständige Claude-Code-Session in einem eigenen Herdr-Tab. Jede Session arbeitet ihr Ticket bzw. ihre Spezifikation über den Skill `start` ab. Nur auf ausdrücklichen Aufruf des Nutzers, z. B. "/start-parallel 57 58 59 61" oder "/start-parallel 82 81 86 83 87".
disable-model-invocation: true
---

# start-parallel – Tickets parallel in Herdr-Tabs starten

Argumente: Ticket- oder Spezifikationsnummern (z. B. `57 58 59 61` oder `82 81 86 83 87`), optional gefolgt von `--` und zusätzlichen `claude`-Optionen (z. B. `-- --effort xhigh`).

Diese Session ist nur der **Starter**: Sie bearbeitet selbst kein Ticket, claimt nichts und legt keinen Worktree an. Alles läuft lesend im primären Checkout plus `scripts/start-agent-tabs`; einzige Ausnahme sind die offenen Kanten in Schritt 6.

## Ablauf

1. **Voraussetzungen prüfen** – mit echten Befehlen:
   - `AGENTS.md` aus dem Repo-Root lesen.
   - `echo "$HERDR_ENV $HERDR_WORKSPACE_ID"` – ist das leer, läuft die Session nicht in Herdr: stoppen und dem Nutzer sagen, dass er sie aus einem Herdr-Tab starten soll.
2. **Tickets bestimmen:**
   - Mit Argumenten: genau diese Tickets.
   - Ohne Argumente: die Frontier wie im Skill `start` ermitteln (Schritt 3; bei geschlossener Karte die Spezifikationen ohne Umsetzungstickets), **mit Namen** auflisten und den Nutzer fragen, welche gestartet werden sollen. Nicht selbst auswählen.
3. **Starten:** `scripts/start-agent-tabs <tickets> [-- <claude-Optionen>]`.
   - Das Skript prüft vorab jedes Ticket (offen, nicht zugewiesen, nicht blockiert, kein Branch/Worktree, nicht die Karte selbst; bei Spezifikationen statt „nicht blockiert“: noch ohne Umsetzungstickets) und startet bei einem Problem **gar keinen** Tab. Dann die gemeldeten Gründe mit Ticketnamen weitergeben und nachfragen.
   - Pro Ticket entsteht im aktuellen Herdr-Workspace ein Tab `#<n> <Titel>` (bei Spezifikationen `#<n> Tickets: <Bereich>`), darin `claude --permission-mode auto -n "<Tab-Name>" "/start <n>"` im primären Checkout. Jede Session claimt ihr Ticket und verlegt sich in ihren eigenen Worktree; `scripts/start-ticket-worktree` legt parallele Worktrees nacheinander an. Sessions für Spezifikationen bleiben im primären Checkout, weil sie nur GitHub-Issues schreiben.
4. **Übergeben** (kurz): die gestarteten Tabs mit Namen nennen und sagen, was der Nutzer tun muss:
   - Bei Tickets der Karte nach etwa einer Minute in **jedem** Tab den Wechsel in den Worktree mit „1. Yes“ bestätigen. Claude Code fragt bei `EnterWorktree` auf Pfade außerhalb von `.claude/worktrees/` immer nach; weder eine Erlaubnisregel noch „don't ask again“ unterdrückt das, nur `bypassPermissions` ([Doku](https://code.claude.com/docs/en/worktrees#ask-claude-to-create-a-worktree)). Diese Bestätigung nie stellvertretend per `herdr pane send-keys` geben.
   - Rückfragen beantworten, wenn Herdr einen Tab als wartend markiert.
   - Bei Spezifikations-Tickets `/to-spec` im Tab eingeben, sobald die Session „Bereit für /to-spec“ meldet (der Skill ist nur vom Nutzer aufrufbar).
   - Bei Spezifikationen 1–5 `/to-tickets <n>` im Tab eingeben, sobald die Session „Bereit für /to-tickets <n>“ meldet, und den vorgeschlagenen Zuschnitt dort freigeben oder korrigieren.
5. **Auf Wunsch beobachten:** `herdr agent list` (Status aller Agenten) und `herdr agent read <pane>` (letzte Ausgabe eines Tabs). Nie in fremde Tabs tippen, außer der Nutzer bittet ausdrücklich darum.
6. **Offene Kanten setzen** (nur nach `/to-tickets`, wenn alle Tabs fertig sind): an jeder gestarteten Spezifikation die Kommentare „Offene Kanten zu anderen Bereichen“ lesen (`gh issue view <n> --comments`) und jede Kante als native „blocked by“-Beziehung zwischen den Umsetzungstickets setzen (`docs/agents/issue-tracker.md`, Blocker). Kanten, die sich keinem Ticket eindeutig zuordnen lassen, dem Nutzer vorlegen.
