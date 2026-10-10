---
name: start
description: Session-Einstieg für die Abnehm-App. Lädt den aktuellen Projektstand (Wayfinder-Karte auf GitHub), fasst ihn kurz zusammen und macht beim nächsten offenen Ticket weiter. Verwenden, wenn der Nutzer "start" aufruft oder dort weitermachen will, wo zuletzt aufgehört wurde.
---

# start – dort weitermachen, wo wir aufgehört haben

Optionales Argument: ein Ticket (Nummer, Titel oder Stichwort, z. B. `start Gamification`). Ohne Argument wählst du das nächste Ticket.

## Ablauf

1. **Regeln laden:** `AGENTS.md` im Repo-Root gilt (Belegpflicht, selbstständig committen, nie KI als Co-Author, Deutsch).
2. **Karte laden** – nur den Body, nicht alle Tickets:
   `gh issue view 1 --repo Yggras/abnehm-app`
3. **Frontier bestimmen:** offene Sub-Issues von #1, die nicht zugewiesen sind und deren „blocked by“-Tickets alle geschlossen sind:
   - Sub-Issues: `gh api repos/Yggras/abnehm-app/issues/1/sub_issues --jq '.[] | select(.state=="open") | {number, title, assignees: [.assignees[].login], labels: [.labels[].name]}'`
   - Blocker je Ticket: `gh api repos/Yggras/abnehm-app/issues/<n>/dependencies/blocked_by --jq '.[] | {number, state}'`
4. **Stand kurz zusammenfassen** (max. ~10 Zeilen): Ziel, Anzahl getroffener Entscheidungen, die Frontier-Tickets **mit Namen** (nie nur Nummern), ggf. laufende/zugewiesene Tickets.
5. **Weitermachen:** den Skill `wayfinder` im Modus „Work through the map“ mit der Karte https://github.com/Yggras/abnehm-app/issues/1 ausführen – mit dem genannten Ticket bzw. dem ersten Frontier-Ticket. Pro Session höchstens ein Ticket (außer Recherche).

## Wenn die Karte abgeschlossen ist

Hat die Karte keine offenen Tickets mehr (Spezifikation fertig), sag das, nenne den Ort der Spezifikation und frag den Nutzer, wie es weitergehen soll (z. B. Umsetzung). Dieser Skill wird dann auf die nächste Phase umgestellt.
