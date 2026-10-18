---
name: ticket-uebersicht
description: Zeigt zu Sessionbeginn die offenen Umsetzungstickets der Spezifikationen 0–5, empfiehlt eine Reihenfolge und unabhängige Tickets für parallele Sessions. Nur lesend: claimt nichts und startet keine Arbeit. Verwenden, wenn der Nutzer nach Ticketübersicht, Priorisierung oder Parallelisierung fragt.
---

# ticket-uebersicht – lesen, einordnen, empfehlen

Dieser Skill ist eine **Momentaufnahme**, kein Arbeitsstart. Er verändert weder GitHub noch Dateien, erstellt keinen Worktree und startet keine Tabs. `/start` übernimmt genau ein Ticket zur Umsetzung; `/start-parallel <nummern>` startet nur auf ausdrücklichen Wunsch des Nutzers mehrere Sessions in Herdr.

## Daten erheben

1. `AGENTS.md` und `docs/agents/issue-tracker.md` lesen. `pwd`, `git status --short --branch` und `git worktree list` prüfen. Nur lesende Befehle ausführen.
2. `scripts/ticket-frontier` ausführen: Es zeigt **freie**, **belegte**, **menschliche** und **ohne Label** offene Tickets mit Namen in Spezifikations-/Sub-Issue-Reihenfolge; blockierte Tickets erscheinen dort **nur als Anzahl**. Fehler der Abfrage melden, keine vermeintlich vollständige Übersicht aus Teilresultaten ableiten.
3. Für die vollständige Übersicht die Sub-Issues von #71, #82, #81, #86, #83 und #87 mit `gh api --paginate 'repos/Yggras/abnehm-app/issues/<spec>/sub_issues?per_page=100'` lesen. Offene Tickets, Titel, Labels, Assignees und `issue_dependencies_summary.blocked_by` erfassen. Für jedes offene Ticket mit `blocked_by > 0` die konkreten Blocker via `gh api --paginate 'repos/Yggras/abnehm-app/issues/<ticket>/dependencies/blocked_by?per_page=100'` abfragen; nur **offene** Blocker als noch ausstehend ausgeben. Stimmen Anzahl und Details nicht überein, Daten als unvollständig kennzeichnen und keine sichere Freigabe behaupten. Bei Bedarf die betreffenden Issue-Bodys (`gh issue view <n> --repo Yggras/abnehm-app`) und verknüpfte offene PRs lesen, um Liefergegenstand, gemeinsame Dateien und Freigabeschritte zu beurteilen. Die native GitHub-Abhängigkeit ist für die Startbarkeit maßgeblich, nicht nur eine Liste im Body.
4. Aktive Branches/Worktrees aus `git worktree list` und offene PRs bei Bedarf berücksichtigen. Ein zugewiesenes Ticket bleibt **belegt**, auch wenn es keinen lokalen Worktree gibt; ein scheinbar freies Ticket mit vorhandenem `work/<nummer>-…`-Branch/Worktree nicht als sofort startbar empfehlen. Unbekannte Fremd-Worktrees nicht anfassen.

## Einordnen und Reihenfolge bilden

- **Jetzt startbar:** offen, ohne Assignee, `ready-for-agent`, ohne offene Blocker und ohne existierenden Ticket-Branch/-Worktree. `ready-for-human` nicht eigenständig empfehlen; unlabeled oder unklare Tickets gesondert nennen. Zuweisungen nie übergehen.
- **Parallel jetzt:** nur aus jetzt startbaren Tickets wählen, zwischen denen keine Abhängigkeit besteht. Die wahrscheinlichen Berührungspunkte anhand der Tickettexte/Verträge prüfen; gemeinsame Schemas, Migrationen, Routen oder Dateien als Konfliktrisiko kennzeichnen und gegebenenfalls nacheinander empfehlen. Unabhängigkeit in GitHubs Blockergraph allein garantiert keine konfliktfreie Umsetzung. Mehrere Sessions brauchen jeweils eigene Worktrees.
- **Reihenfolge danach:** offene Blocker-Ketten aus den GitHub-Daten bilden: zuerst die jetzt startbaren Voraussetzungen, danach Tickets, deren **sämtliche** Blocker nach einem Merge geschlossen wären. Bei mehreren Kandidaten zuerst jene empfehlen, die weitere Tickets freischalten (insbesondere Fundament-Verträge); bei Gleichstand Spezifikations- und Sub-Issue-Reihenfolge von `ticket-frontier` nutzen. Keine Aufwandsschätzungen oder fiktiven Fälligkeitsdaten. Zukünftige Wellen sind **bedingt**: ein PR allein schließt den Blocker nicht; erst der Merge in `main`/das geschlossene Issue gibt Nachfolger frei.
- Sind Blocker außerhalb der sechs Spezifikationen, fehlende Abhängigkeitsdetails oder Widersprüche vorhanden, diese explizit als Unsicherheit ausweisen statt die betroffenen Tickets in eine sichere Welle einzuordnen. Falls alles belegt/blockiert ist, statt einer Startempfehlung den konkreten nächsten Freigabeschritt nennen (z. B. ausstehenden PR reviewen/mergen); keinen Schreibvorgang vornehmen.

## Antwortformat

Kurz, aber mit Namen und Links (`https://github.com/Yggras/abnehm-app/issues/<n>`):

1. **Jetzt parallel empfohlen:** geordnete Gruppen von Ticketnummer + Titel, je Gruppe kurze Begründung und mögliche Konflikte. Wenn nur eines passt, klar sagen, dass derzeit nur eine Session sinnvoll ist.
2. **Danach (nach Merge):** nächste bedingte Wellen mit konkreten Blockern; nicht alle blockierten Tickets einzeln ausbreiten, wenn es viele sind.
3. **Übrige offene Tickets:** belegte, `ready-for-human`, ohne Label sowie blockierte Tickets mit Blocker/Status – bei vielen als kompakte Tabelle nach Spezifikation, ohne offene Tickets zu verschweigen.
4. **Nächster Schritt:** optional `/start <nummer>` oder `/start-parallel <nummern>` (nur in Herdr), aber **nicht selbst ausführen**. Datenstand als Momentaufnahme und GitHub-Issue-Links als Belege nennen; dynamische Angaben vor dem tatsächlichen Start erneut prüfen.
