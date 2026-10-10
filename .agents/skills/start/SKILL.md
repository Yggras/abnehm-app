---
name: start
description: Session-Einstieg für die Abnehm-App. Lädt den aktuellen Projektstand (Wayfinder-Karte auf GitHub), fasst ihn kurz zusammen, greift sich das nächste freie Ticket, legt dafür einen eigenen Worktree an und bearbeitet es dort in derselben Session. Verwenden, wenn der Nutzer "start" aufruft oder dort weitermachen will, wo zuletzt aufgehört wurde.
---

# start – nächstes Ticket greifen und im eigenen Worktree bearbeiten

Optionales Argument: ein Ticket (Nummer, Titel oder Stichwort, z. B. `start Gamification`). Ohne Argument wählst du das nächste Ticket. Der Nutzer muss nichts übergeben und keine Session neu starten – mehrere `/start`-Sessions dürfen gleichzeitig laufen und greifen sich jeweils verschiedene Tickets.

Dieser Skill ist nur die **Vorbereitung** (Ticket wählen, claimen, Worktree). Die eigentliche Ticketarbeit macht ausschließlich der Skill `wayfinder` – dessen Regeln (Frontier-Reihenfolge, Claim vor jeder Arbeit, höchstens ein Ticket pro Session außer Recherche, Abschluss mit Resolution-Kommentar + Karten-Update) gelten unverändert und werden hier nicht ersetzt.

## Ablauf

1. **Regeln und Arbeitsort prüfen – immer mit echten Dateien/Befehlen, nie nur aus eingeblendetem Kontext:**
   - `AGENTS.md` vollständig aus dem Repo-Root lesen.
   - `pwd`, `git status --short --branch` und `git worktree list` ausführen.
   - Läuft die Session bereits in einem Ticket-Worktree (`scripts/require-ticket-worktree` erfolgreich), Schritte 5–7 überspringen: Ticket ist das aus dem Branchnamen `work/<nummer>-…`.
2. **Karte laden** – nur den Body, nicht alle Tickets:
   `gh issue view 1 --repo Yggras/abnehm-app`
3. **Frontier bestimmen:** offene Sub-Issues von #1, die nicht zugewiesen sind und deren „blocked by“-Tickets alle geschlossen sind:
   - Sub-Issues: `gh api repos/Yggras/abnehm-app/issues/1/sub_issues --jq '.[] | select(.state=="open") | {number, title, assignees: [.assignees[].login], labels: [.labels[].name]}'`
   - Blocker je Ticket: `gh api repos/Yggras/abnehm-app/issues/<n>/dependencies/blocked_by --jq '.[] | {number, state}'`
   - Zugewiesene Tickets sind von anderen Sessions belegt – **nie** übernehmen oder „wiederaufnehmen“.
4. **Ticket auswählen** (wie `wayfinder`): das genannte Ticket bzw. das erste Frontier-Ticket.
5. **Claimen** (wie `wayfinder`, vor jeder Arbeit): `gh issue edit <nummer> --repo Yggras/abnehm-app --add-assignee @me`
6. **Worktree anlegen** – im primären Checkout:
   `scripts/start-ticket-worktree <nummer> <kurzname>` (Kurzname: kleingeschrieben, `a-z0-9-`, z. B. `hauptbildschirm`).
   - **Exit-Code 3 = belegt:** Eine parallele Session hat dieses Ticket gerade gegriffen (beide Sessions laufen unter demselben GitHub-Konto, daher ist der Branch die eigentliche Sperre). Den Claim **nicht** zurücknehmen, zum nächsten Frontier-Ticket gehen und ab Schritt 5 wiederholen.
   - Anderer Fehler: stoppen und dem Nutzer melden.
7. **Session in den Worktree verlegen** – in derselben Session, kein Neustart:
   - Claude Code: Werkzeug `EnterWorktree` mit `path` = ausgegebener Worktree-Pfad.
   - Andere Harnesses (z. B. pi): jeden Befehl mit `cd <worktree-pfad> && …` ausführen und Dateien nur über absolute Pfade im Worktree bearbeiten.
   - Danach im Worktree `scripts/require-ticket-worktree` ausführen. Nur bei Erfolg weiterarbeiten; sonst stoppen und melden.
8. **Stand kurz zusammenfassen** (max. ~10 Zeilen): Ziel, Anzahl getroffener Entscheidungen, die Frontier-Tickets **mit Namen** (nie nur Nummern), das gegriffene Ticket, ggf. von anderen Sessions belegte Tickets.
9. **Weitermachen:** den Skill `wayfinder` im Modus „Work through the map“ mit der Karte https://github.com/Yggras/abnehm-app/issues/1 und dem gegriffenen Ticket ausführen (Auswahl und Claim sind damit bereits erledigt). Alle Dateiänderungen, Commits und Pushes nur im Worktree; Zusammenführung per Pull Request.

Im primären Checkout sind ausschließlich lesende Schritte plus `scripts/start-ticket-worktree` erlaubt – auch wenn voraussichtlich nur eine kleine Dokumentationsdatei geändert wird.

## Wenn kein Ticket frei ist

- **Karte abgeschlossen** (keine offenen Tickets mehr): sag das, nenne den Ort der Spezifikation und frag den Nutzer, wie es weitergehen soll (z. B. Umsetzung). Dieser Skill wird dann auf die nächste Phase umgestellt.
- **Alle offenen Tickets blockiert oder belegt:** sag das mit Ticketnamen und wer/was blockiert, und lege keinen Worktree an.
