---
name: review-parallel
description: Lässt die Änderungen eines Ticket-Worktrees von zwei eigenständigen Reviewer-Sessions (Standards und Spec) in eigenen Herdr-Tabs prüfen, mit demselben Agenten wie die aktuelle Session (Claude Code oder Pi), und behebt danach die Befunde. Wird vom Skill `start` am Ende der Umsetzung genutzt; im Ticket-Worktree auch direkt aufrufbar.
---

# review-parallel – Review durch eigene Agenten in Herdr-Tabs

Das Review hat zwei Achsen, wie der Skill `code-review`:

- **Standards:** Folgt der Code den dokumentierten Regeln des Repos?
- **Spec:** Setzt er um, was Ticket und Spezifikation verlangen?

Jede Achse prüft ein eigener Reviewer in einer **eigenständigen Session** in einem eigenen Herdr-Tab, nicht als Subagent. So bleibt jeder Kontext frei vom Kontext der Umsetzung, und der Nutzer kann jedem Reviewer zusehen. Gestartet wird derselbe Agent wie die aktuelle Session: Claude Code startet Claude-Reviewer, Pi startet Pi-Reviewer mit demselben Modell.

## Ablauf

1. **Voraussetzungen:** Die Session läuft im Ticket-Worktree (`scripts/require-ticket-worktree`), und alle Änderungen sind committet. Die Reviewer prüfen nur Commits.
2. **Reviewer starten:** `scripts/start-review-tabs`.
   - Das Skript erkennt den Agenten über Herdr (`herdr pane current`), bei Pi auch das Modell aus dem Startbefehl (ohne `--model` beim Start nutzt auch der Reviewer Pis Standardmodell). Hast du das Modell in der Session gewechselt, gib es mit `--model provider/id` mit.
   - Es entstehen die Tabs `#<n> Review: Standards` und `#<n> Review: Spec`. Darin läuft der Skill `review-achse` (Claude: `/review-achse …`, Pi: `/skill:review-achse …`) im primären Checkout, nur lesend. Eine Worktree-Bestätigung braucht es dafür nicht.
   - **Meldung „Nicht in Herdr gestartet“:** Das ist der Fallback. Du prüfst wie bisher mit dem Skill `code-review` gegen `origin/main` und vermerkst im PR-Text „Review ohne Herdr mit code-review“.
   - **Jeder andere Fehler:** stoppen und dem Nutzer melden.
3. **Auf die Berichte warten:** `scripts/wait-review-reports`. Das Skript gibt beide Berichte unter `## Standards` und `## Spec` aus und schließt danach die Reviewer-Tabs.
   - **Claude Code:** den Befehl mit `run_in_background` starten und nicht pollen. Du wirst geweckt, wenn er endet.
   - **Pi:** im Vordergrund ausführen. Exit-Code 4 heißt „Zeitlimit, Reviewer arbeiten noch“: Dann rufst du ihn erneut auf.
   - **Hinweis „wartet auf Eingabe“:** dem Nutzer sagen, in welchem Tab. In fremde Tabs tippst du nicht.
   - **Fehler „ohne Bericht beendet“:** dem Nutzer melden und anbieten, die Runde neu zu starten (zurück zu Schritt 2).
4. **Auswerten und beheben:**
   - Die beiden Berichte gibst du getrennt wieder, ohne sie zusammenzuführen oder neu zu gewichten.
   - Harte Verstöße und Lücken gegenüber der Spezifikation behebst du.
   - Abwägungen (Smells) behebst du, wenn sie überzeugen; sonst begründest du im PR-Text, warum nicht.
   - Ein Befund, der einem Vertrag aus Spezifikation 0 widerspricht, ist eine Frage an den Nutzer, kein Auftrag.
   - Danach committen.
5. **Zweite Runde** nur, wenn die Korrekturen über kleine lokale Änderungen hinausgehen, etwa bei neuem Verhalten oder einem Umbau mehrerer Module. Dann wiederholst du die Schritte 2–4. Nach höchstens zwei Runden kommen verbleibende Befunde in den PR-Text.
6. **Im PR-Text** steht ein Abschnitt „Review“: die Zahl der Runden, die behobenen Befunde und die bewusst nicht behobenen mit Begründung.

Die Berichte liegen unter `<git-common-dir>/abnehm-app-reviews/<ticket>/`, also außerhalb jedes Worktrees und nie in einem Commit. Jeder Start einer neuen Runde ersetzt sie.
