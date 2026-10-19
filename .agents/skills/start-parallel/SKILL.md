---
name: start-parallel
description: Startet mehrere freie Umsetzungstickets in Herdr-Tabs, überwacht sie bis zum PR und merged nach Review und erfolgreicher CI nacheinander. Räumt nach bestätigtem Merge Worktrees auf und schließt Tabs. Nur auf ausdrücklichen Aufruf des Nutzers.
disable-model-invocation: true
---

# start-parallel – Tickets parallel umsetzen und abschließen

Argumente: Ticketnummern (z. B. `57 58`), optional `--agent claude|pi` (Standard: `claude`) und bei Pi `--model provider/id` (Standard: `openai-codex/gpt-6-sol`). Nach `--` folgen Optionen für den Agenten. Beispiele: `/start-parallel 57 58`, `/skill:start-parallel --agent pi 57 58`.

Die Hauptsession koordiniert, arbeitet aber nicht selbst an Tickets. **Sie bleibt bis zum Abschluss oder einem ausdrücklich gemeldeten Hindernis aktiv.** Ihr Git-Checkout bleibt `main`; alle Branch-Änderungen und Konfliktlösungen finden ausschließlich in Ticket-Worktrees statt. Keine Eingaben in fremde Tabs simulieren.

## Start

1. `AGENTS.md` aus dem Repo-Root lesen. `echo "$HERDR_ENV $HERDR_WORKSPACE_ID"` prüfen; ohne Herdr stoppen. `pwd`, `git status --short --branch` und `git worktree list` prüfen.
2. Mit Argumenten: genau diese Tickets. Ohne Argumente: `scripts/ticket-frontier` ausführen, freie Tickets mit Namen nennen und den Nutzer nach der Auswahl fragen.
3. `scripts/start-agent-tabs [--agent claude|pi] [--model provider/id] <tickets> [-- <Agent-Optionen>]` ausführen. Bei Vorabfehler startet kein Tab; Gründe nennen. Bei Teilfehler die bereits gestarteten Tabs aus dem ausgegebenen Manifest weiter beobachten, nicht blind neu starten.
4. Den **Manifest-Pfad** aus der Ausgabe aufbewahren (`<git-common-dir>/abnehm-app-parallel/run.*`). Jede Zeile enthält Ticketnummer, Tab-ID und Pane-ID. Nur diese Tabs gehören dieser Runde; nie fremde Tabs oder Worktrees aufräumen.
5. Einmalige Nutzerinteraktion erklären: Bei Claude muss der Nutzer nach etwa einer Minute den Wechsel in den externen Worktree in jedem Tab mit „1. Yes“ bestätigen ([Claude-Doku](https://code.claude.com/docs/en/worktrees#ask-claude-to-create-a-worktree)); bei Pi gegebenenfalls die Projektvertrauens-Abfrage prüfen. Wartende Tabs und Rückfragen melden. Diese Bestätigungen nie per `herdr pane send-keys` übernehmen.

## Beobachten und mergen

Für jede Manifest-Zeile regelmäßig `herdr agent get <pane>` bzw. `herdr agent wait <pane> --until done --until blocked --timeout 30000` nutzen; Zeitlimits bedeuten nur „noch in Arbeit“. `idle` bedeutet **nicht fertig**. Bei `blocked` oder verschwundenem Tab ohne PR den Grund mit `herdr agent read <pane>` prüfen und dem Nutzer melden; keine Eingabe vortäuschen. Während andere Tickets laufen, abgeschlossene Tickets nacheinander bearbeiten. Wenn diese Session unterbrochen wird, kann sie mit dem Manifest wiederaufgenommen werden; sie läuft nicht im Hintergrund weiter.

Erst bei `done` und einem offenen PR für den Ticket-Branch:

1. Ticket-Worktree anhand `git worktree list --porcelain` und Branch `work/<ticket>-…` eindeutig bestimmen; wenn nicht vorhanden oder mehrdeutig, stoppen. `pwd`, `git status --short --branch` und `git worktree list` prüfen, bevor Git-Operationen folgen. Den PR-Text einschließlich Akzeptanznachweisen und Review-Abschnitt sowie die beiden Berichte in `<git-common-dir>/abnehm-app-reviews/<ticket>/` lesen. Offene harte Befunde, nicht erfüllte Kriterien oder offene GitHub-Review-Anforderungen **nicht** automatisch mergen; zur Klärung melden. Das interne Review aus `review-parallel` ist die Mindestanforderung; `reviewDecision == CHANGES_REQUESTED` ist ein Stoppsignal.
2. `scripts/check-parallel-pr <ticket> <absoluter-worktree-pfad>` ausführen. Exit 3: später erneut prüfen (CI oder GitHub-Merge-Status ausstehend). Exit 1: Problem untersuchen; bei fehlgeschlagener CI oder unklarer Lage **nicht** mergen. Exit 0: beide CI-Jobs erfolgreich, Review abgeschlossen, sauberer Worktree, PR-Head und lokaler HEAD identisch. Vor jedem Merge erneut prüfen, da andere PRs inzwischen `main` verändert haben können.
3. Bei Mergekonflikt **nur wenn der Ticket-Agent fertig ist** im eigenen Worktree `git fetch origin main`, dann nach erneuter Prüfung von `pwd`, `git status --short --branch`, `git worktree list` den Branch mit `origin/main` aktualisieren. Für Konflikte den Skill `resolving-merge-conflicts` nutzen, keine Änderungen im primären Checkout. Typecheck, Lint und Tests ausführen, committen (ohne KI-Attribution), Branch pushen. Bei substanziellen Änderungen Review erneut durchführen und PR-Review-Abschnitt aktualisieren. Danach erneut auf die CI für den neuen Head warten. Bei Unsicherheit stoppen und Worktree erhalten.
4. `gh pr merge <PR-Nummer> --repo Yggras/abnehm-app --squash --match-head-commit <geprüfter-HEAD>` ausführen; **kein** `--admin`, `--auto` oder `--delete-branch`. Falls Merge nicht gelingt: Status neu laden und nur nach erneuter Prüfung wiederholen. Nach Merge `gh pr view <PR-Nummer> --repo Yggras/abnehm-app --json state,mergedAt` prüfen. Nicht allein dem Exit-Code vertrauen.
5. **Nur nach bestätigtem Merge:** `git status --short --branch` im Ticket-Worktree und `git worktree list` prüfen. Wenn sauber und der Pfad exakt der Manifest-Ticket-Zuordnung entspricht: vom primären Checkout aus `git worktree remove <absoluter-worktree-pfad>` (nie `--force`). Nur bei erfolgreichem Entfernen den zugehörigen Ticket-Tab mit `herdr tab close <tab-id>` schließen. Bei Problemen beides behalten und melden. Lokalen Branch nicht automatisch löschen. Reviewer-Tabs werden bereits durch `scripts/wait-review-reports` geschlossen.

Fortschritt je Ticket (läuft / wartet auf Mensch / PR & CI / Konflikt / gemergt / aufgeräumt) mit PR-Links nennen. Niemals allein wegen Zeitablauf, Agent-Idle, fehlender Checks oder vermeintlich erfolgreichem Push mergen. Wenn ein Ticket klemmt, andere unabhängig fertige Tickets weiter bearbeiten; den Rest mit konkretem Hindernis dem Nutzer übergeben.
