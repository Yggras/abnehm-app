---
name: start-parallel
description: Startet mehrere freie Tickets der Wayfinder-Karte gleichzeitig, jedes als eigenständige Claude-Code-Session in einem eigenen Herdr-Tab. Jede Session arbeitet ihr Ticket über den Skill `start` in einem eigenen Worktree ab. Nur auf ausdrücklichen Aufruf des Nutzers, z. B. "/start-parallel 57 58 59 61".
disable-model-invocation: true
---

# start-parallel – Tickets parallel in Herdr-Tabs starten

Argumente: Ticketnummern (z. B. `57 58 59 61`), optional gefolgt von `--` und zusätzlichen `claude`-Optionen (z. B. `-- --effort xhigh`).

Diese Session ist nur der **Starter**: Sie bearbeitet selbst kein Ticket, claimt nichts und legt keinen Worktree an. Alles läuft lesend im primären Checkout plus `scripts/start-agent-tabs`.

## Ablauf

1. **Voraussetzungen prüfen** – mit echten Befehlen:
   - `AGENTS.md` aus dem Repo-Root lesen.
   - `echo "$HERDR_ENV $HERDR_WORKSPACE_ID"` – ist das leer, läuft die Session nicht in Herdr: stoppen und dem Nutzer sagen, dass er sie aus einem Herdr-Tab starten soll.
2. **Tickets bestimmen:**
   - Mit Argumenten: genau diese Tickets.
   - Ohne Argumente: die Frontier der Karte wie im Skill `start` (Schritt 3) ermitteln, **mit Namen** auflisten und den Nutzer fragen, welche gestartet werden sollen. Nicht selbst auswählen.
3. **Starten:** `scripts/start-agent-tabs <tickets> [-- <claude-Optionen>]`.
   - Das Skript prüft vorab jedes Ticket (offen, nicht zugewiesen, nicht blockiert, kein Branch/Worktree, nicht die Karte selbst) und startet bei einem Problem **gar keinen** Tab. Dann die gemeldeten Gründe mit Ticketnamen weitergeben und nachfragen.
   - Pro Ticket entsteht im aktuellen Herdr-Workspace ein Tab `#<n> <Titel>`, darin `claude --permission-mode auto -n "<Tab-Name>" "/start <n>"` im primären Checkout. Jede Session claimt ihr Ticket und verlegt sich in ihren eigenen Worktree; `scripts/start-ticket-worktree` legt parallele Worktrees nacheinander an.
4. **Übergeben** (kurz): die gestarteten Tabs mit Namen nennen und sagen, was der Nutzer tun muss:
   - Nach etwa einer Minute in **jedem** Tab den Wechsel in den Worktree mit „1. Yes“ bestätigen. Claude Code fragt bei `EnterWorktree` auf Pfade außerhalb von `.claude/worktrees/` immer nach; weder eine Erlaubnisregel noch „don't ask again“ unterdrückt das, nur `bypassPermissions` ([Doku](https://code.claude.com/docs/en/worktrees#ask-claude-to-create-a-worktree)). Diese Bestätigung nie stellvertretend per `herdr pane send-keys` geben.
   - Rückfragen beantworten, wenn Herdr einen Tab als wartend markiert.
   - Bei Spezifikations-Tickets `/to-spec` im Tab eingeben, sobald die Session „Bereit für /to-spec“ meldet (der Skill ist nur vom Nutzer aufrufbar).
5. **Auf Wunsch beobachten:** `herdr agent list` (Status aller Agenten) und `herdr agent read <pane>` (letzte Ausgabe eines Tabs). Nie in fremde Tabs tippen, außer der Nutzer bittet ausdrücklich darum.
