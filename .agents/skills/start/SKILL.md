---
name: start
description: Session-Einstieg für die Abnehm-App. Lädt den aktuellen Projektstand (Wayfinder-Karte auf GitHub), fasst ihn kurz zusammen und macht beim nächsten offenen Ticket weiter. Verwenden, wenn der Nutzer "start" aufruft oder dort weitermachen will, wo zuletzt aufgehört wurde.
---

# start – dort weitermachen, wo wir aufgehört haben

Optionales Argument: ein Ticket (Nummer, Titel oder Stichwort, z. B. `start Gamification`). Ohne Argument wählst du das nächste Ticket.

## Ablauf

1. **Regeln und Arbeitsort prüfen – immer mit echten Dateien/Befehlen, nie nur aus eingeblendetem Kontext:**
   - `AGENTS.md` vollständig aus dem Repo-Root lesen.
   - `pwd`, `git status --short --branch` und `git worktree list` ausführen.
2. **Karte laden** – nur den Body, nicht alle Tickets:
   `gh issue view 1 --repo Yggras/abnehm-app`
3. **Frontier bestimmen:** offene Sub-Issues von #1, die nicht zugewiesen sind und deren „blocked by“-Tickets alle geschlossen sind:
   - Sub-Issues: `gh api repos/Yggras/abnehm-app/issues/1/sub_issues --jq '.[] | select(.state=="open") | {number, title, assignees: [.assignees[].login], labels: [.labels[].name]}'`
   - Blocker je Ticket: `gh api repos/Yggras/abnehm-app/issues/<n>/dependencies/blocked_by --jq '.[] | {number, state}'`
4. **Ticket auswählen:** das genannte Ticket bzw. das erste Frontier-Ticket. Noch nicht claimen und noch keine Datei ändern.
5. **Harte Worktree-Schranke:** `scripts/require-ticket-worktree` ausführen.
   - Meldet das Skript den primären Checkout, dort mit `scripts/start-ticket-worktree <nummer> <kurzname>` einen Ticket-Worktree erstellen und **sofort stoppen**. Dem Nutzer Pfad und den Befehl `/skill:start <nummer>` für eine neu aus diesem Worktree gestartete Session nennen. In dieser Session weder das Ticket claimen noch weiterarbeiten.
   - Meldet das Skript einen fehlenden Ticket-Branch, ebenfalls stoppen. Nur bei erfolgreicher Prüfung weiterarbeiten.
6. **Stand kurz zusammenfassen** (max. ~10 Zeilen): Ziel, Anzahl getroffener Entscheidungen, die Frontier-Tickets **mit Namen** (nie nur Nummern), ggf. laufende/zugewiesene Tickets.
7. **Weitermachen:** den Skill `wayfinder` im Modus „Work through the map“ mit der Karte https://github.com/Yggras/abnehm-app/issues/1 ausführen. Erst jetzt das Ticket claimen. Pro Session höchstens ein Ticket (außer Recherche).

Die Worktree-Schranke gilt auch dann, wenn voraussichtlich nur eine kleine Dokumentationsdatei geändert wird. Im primären Checkout sind ausschließlich lesende Schritte erlaubt.

## Wenn die Karte abgeschlossen ist

Hat die Karte keine offenen Tickets mehr (Spezifikation fertig), sag das, nenne den Ort der Spezifikation und frag den Nutzer, wie es weitergehen soll (z. B. Umsetzung). Dieser Skill wird dann auf die nächste Phase umgestellt.
