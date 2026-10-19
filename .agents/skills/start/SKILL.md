---
name: start
description: Session-Einstieg für die Abnehm-App in der Umsetzungsphase. Ermittelt die freien Umsetzungstickets der Spezifikationen 0–5, greift sich das nächste (oder das genannte), legt dafür einen eigenen Worktree an und setzt es dort in derselben Session bis zum Pull Request um. Verwenden, wenn der Nutzer "start" aufruft oder dort weitermachen will, wo zuletzt aufgehört wurde.
---

# start – nächstes Umsetzungsticket greifen und im eigenen Worktree umsetzen

Optionales Argument: ein Ticket (Nummer, Titel oder Stichwort, z. B. `start Projektgerüst`). Ohne Argument wählst du das nächste freie Ticket. Der Nutzer muss nichts übergeben und keine Session neu starten. Mehrere `/start`-Sessions dürfen gleichzeitig laufen und greifen sich jeweils verschiedene Tickets.

Umsetzungstickets sind die Sub-Issues der sechs Spezifikationen. Spezifikation 0 blockiert 1–5 ([Entscheidung](https://github.com/Yggras/abnehm-app/issues/42)); die Abhängigkeiten sind native „blocked by“-Beziehungen, auch zwischen den Bereichen.

| Nr. | Spezifikation | Issue |
| --- | --- | --- |
| 0 | Fundament & Verträge | [#71](https://github.com/Yggras/abnehm-app/issues/71) |
| 1 | Ziele & Onboarding | [#82](https://github.com/Yggras/abnehm-app/issues/82) |
| 2 | Ernährung | [#81](https://github.com/Yggras/abnehm-app/issues/81) |
| 3 | Wasser, Sport, Gewicht & Health | [#86](https://github.com/Yggras/abnehm-app/issues/86) |
| 4 | Momo, Insel & Challenges | [#83](https://github.com/Yggras/abnehm-app/issues/83) |
| 5 | Partner & Benachrichtigungen | [#87](https://github.com/Yggras/abnehm-app/issues/87) |

## Ablauf

1. **Regeln und Arbeitsort prüfen** – immer mit echten Dateien und Befehlen, nie nur aus eingeblendetem Kontext:
   - `AGENTS.md` vollständig aus dem Repo-Root lesen.
   - `pwd`, `git status --short --branch` und `git worktree list` ausführen.
   - Läuft die Session bereits in einem Ticket-Worktree (`scripts/require-ticket-worktree` erfolgreich), die Schritte 4–6 überspringen. Das Ticket ergibt sich dann aus dem Branchnamen `work/<nummer>-…`.
2. **Frontier bestimmen:** `scripts/ticket-frontier`. Das Skript listet die offenen Tickets in der Reihenfolge Spezifikation 0–5, innerhalb einer Spezifikation in Sub-Issue-Reihenfolge:
   - `frei`: offen, nicht zugewiesen, alle Blocker geschlossen, Label `ready-for-agent`.
   - `belegt`: einer anderen Session oder Person zugewiesen. **Nie** übernehmen oder „wiederaufnehmen“.
   - `mensch`: frei, aber `ready-for-human`. Nicht von selbst greifen. Nennt der Nutzer ein solches Ticket ausdrücklich, zuerst mit ihm klären, welchen Teil die Session übernimmt.
   - Blockierte Tickets erscheinen nur als Summe.
3. **Ticket auswählen:** das genannte Ticket bzw. das erste `frei`.
   - Ein genanntes Ticket muss ein Sub-Issue einer der sechs Spezifikationen sein (`gh api repos/Yggras/abnehm-app/issues/<n> --jq .parent_issue_url`). Außerdem muss es offen, nicht zugewiesen und ohne offenen Blocker sein (`.issue_dependencies_summary.blocked_by == 0`).
   - Trifft das nicht zu, die Gründe mit Ticketnamen nennen und stoppen. Eine Spezifikation selbst ist kein Ticket.
4. **Claimen** (der erste Schreibvorgang der Session): `gh issue edit <nummer> --repo Yggras/abnehm-app --add-assignee @me`
5. **Worktree anlegen** – im primären Checkout:
   `scripts/start-ticket-worktree <nummer> <kurzname>`. Der Kurzname ist kleingeschrieben und besteht nur aus `a-z0-9-`, z. B. `projektgeruest`. Legen parallele Sessions gerade Worktrees an, wartet das Skript still auf seine Sperre; nicht abbrechen.
   - **Exit-Code 3 = belegt:** Eine parallele Session hat dieses Ticket gerade gegriffen. Beide Sessions laufen unter demselben GitHub-Konto, daher ist der Branch die eigentliche Sperre. Den Claim **nicht** zurücknehmen, zum nächsten freien Ticket gehen und ab Schritt 4 wiederholen.
   - Anderer Fehler: stoppen und dem Nutzer melden.
6. **Session in den Worktree verlegen** – in derselben Session, kein Neustart:
   - Claude Code: Werkzeug `EnterWorktree` mit `path` = ausgegebener Worktree-Pfad.
   - Andere Harnesses (z. B. pi): jeden Befehl mit `cd <worktree-pfad> && …` ausführen und Dateien nur über absolute Pfade im Worktree bearbeiten.
   - Danach im Worktree `scripts/require-ticket-worktree` ausführen. Nur bei Erfolg weiterarbeiten, sonst stoppen und melden.
7. **Kontext laden, bevor Code entsteht:**
   - Das Ticket mit Kommentaren: `gh issue view <nummer> --repo Yggras/abnehm-app --comments`.
   - Die Abschnitte der übergeordneten Spezifikation, auf die das Ticket verweist, dazu die genutzten Verträge aus Spezifikation 0 ([#71](https://github.com/Yggras/abnehm-app/issues/71)) samt Kommentaren. Diese Verträge werden genutzt, nicht neu entworfen.
   - Die Blocker-Tickets, deren Schnittstellen das Ticket nutzt, und den Code, den ihre Pull Requests geliefert haben.
   - `CONTEXT.md` (einziges Glossar), `docs/adr/` (falls vorhanden) und die im Ticket verlinkten Dateien unter `research/`, `prototypes/` und `spikes/`.
   - Gibt es Lücken oder Widersprüche zwischen Ticket, Spezifikation und Code, legst du sie dem Nutzer als Frage mit Empfehlung vor. Verträge aus Spezifikation 0 änderst du nicht eigenmächtig.
8. **Stand kurz zusammenfassen** (höchstens etwa 10 Zeilen):
   - das gegriffene Ticket **mit Namen** und was es liefert;
   - die übrigen freien Tickets mit Namen (nie nur Nummern);
   - die belegten Tickets.
9. **Umsetzen** nach dem Muster von `/implement`. Den Skill ruft nur der Nutzer auf, deshalb stehen seine Schritte hier:
   - Test-first mit dem Skill `tdd` an den Seams, die Ticket und Spezifikation festlegen.
   - Typecheck und einzelne Testdateien laufen regelmäßig, die komplette Testsuite einmal am Ende.
   - Jedes Akzeptanzkriterium belegst du so, wie das Ticket es verlangt: mit einem Test, einem Gerätelauf oder der Impeccable-Prüfung aus der Definition of Done bei Tickets mit Bildschirm.
   - Selbstständig committen, ohne KI als Co-Author.
   - Danach mit dem Skill `review-parallel` prüfen lassen und die Befunde beheben. Er startet zwei eigenständige Reviewer (Standards und Spec) in eigenen Herdr-Tabs, mit demselben Agenten wie diese Session. Ohne Herdr greift dessen Fallback auf `code-review`.
10. **Abschließen:**
    - Branch pushen und einen Pull Request gegen `main` öffnen, ohne KI-Attribution.
    - In den PR-Text kommt `Closes #<nummer>`. Wird der PR in den Standard-Branch gemergt, schließt GitHub das Ticket automatisch ([GitHub-Doku](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue)). Erst dann sind die davon blockierten Tickets frei.
    - Im PR-Text jedes Akzeptanzkriterium mit seinem Nachweis auflisten. Nicht erfüllte Kriterien nennst du ausdrücklich.
    - Den PR mergt der Nutzer nach seinem Review. Melde ihm den Link. Der Worktree bleibt bis zum Merge stehen und wird danach mit dem Nutzer aufgeräumt.

Im primären Checkout sind nur lesende Schritte erlaubt, dazu `scripts/ticket-frontier` und `scripts/start-ticket-worktree`. Das gilt auch, wenn voraussichtlich nur eine kleine Datei geändert wird.

## Wenn das Ticket stecken bleibt

Fehlt etwa ein Vertrag aus einem Blocker oder ist eine Produktfrage offen:

- Den Stand committen und pushen.
- Im Ticket kommentieren, was fehlt, und eine Empfehlung geben.
- Den Nutzer fragen.

Der Claim bleibt, solange die Session daran arbeitet. Gibt der Nutzer das Ticket frei, entfernst du die Zuweisung: `gh issue edit <nummer> --repo Yggras/abnehm-app --remove-assignee @me`.

## Wenn kein Ticket frei ist

- **Alle Umsetzungstickets geschlossen:** Sag das und frag den Nutzer, wie es weitergeht.
- **Alle offenen Tickets blockiert, belegt oder `mensch`:** Sag das und nenne die Tickets mit Namen. Bei blockierten Tickets nennst du, worauf sie warten, etwa einen offenen Pull Request, den der Nutzer mergen muss. Leg dann keinen Worktree an.
