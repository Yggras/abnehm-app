---
name: start-parallel
description: Startet mehrere freie Umsetzungstickets gleichzeitig, jedes als eigenständige Claude-Code- oder Pi-Session in einem eigenen Herdr-Tab. Jede Session arbeitet ihr Ticket über den Skill `start` in einem eigenen Worktree ab. Nur auf ausdrücklichen Aufruf des Nutzers, z. B. "/start-parallel 57 58" oder "/skill:start-parallel --agent pi 57 58".
disable-model-invocation: true
---

# start-parallel – Tickets parallel in Herdr-Tabs starten

Argumente: Ticketnummern (z. B. `57 58 59 61`), optional `--agent claude|pi` (Standard: `claude`) und bei Pi `--model provider/id` (Standard: `openai-codex/gpt-6-sol`). Nach `--` folgen zusätzliche Optionen für den gewählten Agenten, z. B. `-- --effort xhigh` für Claude oder `-- --thinking high` für Pi. Beispiele: `/start-parallel 57 58` (Claude Code), `/skill:start-parallel --agent pi 57 58` (Pi).

Diese Session ist nur der **Starter**: Sie bearbeitet selbst kein Ticket, claimt nichts und legt keinen Worktree an. Alles läuft lesend im primären Checkout plus `scripts/start-agent-tabs`.

## Ablauf

1. **Voraussetzungen prüfen** – mit echten Befehlen:
   - `AGENTS.md` aus dem Repo-Root lesen.
   - `echo "$HERDR_ENV $HERDR_WORKSPACE_ID"` – ist das leer, läuft die Session nicht in Herdr: stoppen und dem Nutzer sagen, dass er sie aus einem Herdr-Tab starten soll.
2. **Tickets bestimmen:**
   - Mit Argumenten: genau diese Tickets.
   - Ohne Argumente: die freien Tickets mit `scripts/ticket-frontier` ermitteln (wie im Skill `start`, Schritt 2), **mit Namen** auflisten und den Nutzer fragen, welche gestartet werden sollen. Nicht selbst auswählen.
3. **Starten:** `scripts/start-agent-tabs [--agent claude|pi] [--model provider/id] <tickets> [-- <Agent-Optionen>]` (Nutzerwahl unverändert weiterreichen).
   - Das Skript prüft vorab jedes Ticket (offen, nicht zugewiesen, nicht blockiert, kein Branch/Worktree, nicht die Karte selbst) und startet bei einem Problem **gar keinen** Tab. Für Pi prüft es zusätzlich Modell und Zugang vorab. Dann die gemeldeten Gründe mit Ticketnamen weitergeben und nachfragen.
   - Pro Ticket entsteht im aktuellen Herdr-Workspace ein Tab `#<n> <Titel>` im primären Checkout. Claude startet mit `claude --permission-mode auto -n "<Tab-Name>" "/start <n>"`, Pi mit `pi --model openai-codex/gpt-6-sol --name "<Tab-Name>" "/skill:start <n>"` (bzw. gewähltem Modell). Jede Session claimt ihr Ticket und arbeitet danach im eigenen Worktree; `scripts/start-ticket-worktree` legt parallele Worktrees nacheinander an.
4. **Übergeben** (kurz): die gestarteten Tabs mit Namen nennen und sagen, was der Nutzer tun muss:
   - **Nur bei Claude Code:** Nach etwa einer Minute in **jedem** Tab den Wechsel in den Worktree mit „1. Yes“ bestätigen. Claude Code fragt bei `EnterWorktree` auf Pfade außerhalb von `.claude/worktrees/` immer nach; weder eine Erlaubnisregel noch „don't ask again“ unterdrückt das, nur `bypassPermissions` ([Doku](https://code.claude.com/docs/en/worktrees#ask-claude-to-create-a-worktree)). Diese Bestätigung nie stellvertretend per `herdr pane send-keys` geben.
   - **Bei Pi:** Falls beim Start die Projektvertrauens-Abfrage erscheint, im jeweiligen Tab prüfen und bestätigen. Pi nutzt kein `EnterWorktree`; der `start`-Skill verlangt nach dem Anlegen des Worktrees absolute Dateipfade und `cd <worktree> && …` für Befehle.
   - Rückfragen beantworten, wenn Herdr einen Tab als wartend markiert.
   - Gegen Ende öffnet jede Session über den Skill `review-parallel` zwei Reviewer-Tabs `#<n> Review: Standards` und `#<n> Review: Spec`. Sie schließen sich, sobald die Ticket-Session die Berichte gelesen hat.
   - Die Pull Requests der Sessions reviewen und mergen. Erst nach dem Merge schließt GitHub das Ticket, und die davon blockierten Tickets werden frei.
5. **Auf Wunsch beobachten:** `herdr agent list` (Status aller Agenten) und `herdr agent read <pane>` (letzte Ausgabe eines Tabs). Nie in fremde Tabs tippen, außer der Nutzer bittet ausdrücklich darum.
