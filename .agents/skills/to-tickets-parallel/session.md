# Zusatzregeln für eine Session aus `/to-tickets-parallel`

Du zerlegst genau eine Spezifikation mit `/to-tickets`. Parallele Sessions zerlegen gleichzeitig die anderen Spezifikationen. Diese Regeln ergänzen `/to-tickets` und ersetzen keinen seiner Schritte, auch nicht die Freigabe des Zuschnitts durch den Nutzer.

1. **Arbeitsort:** primärer Checkout, keine Dateiänderungen. Die Session schreibt nur GitHub-Issues. Fällt eine nötige Dateiänderung auf (z. B. ein neuer Begriff in `CONTEXT.md`), sie nicht selbst machen, sondern am Ende als Vorschlag melden.
2. **Kontext, bevor geschnitten wird** (zusätzlich zur eigenen Spezifikation samt Kommentaren):
   - [Spezifikation 0 · Fundament & Verträge](https://github.com/Yggras/abnehm-app/issues/71): Maßgeblich ist der Text, als „Eingearbeitet“ markierte Kommentare sind nur Historie.
   - die Fundament-Tickets mit Akzeptanzkriterien (`gh api repos/Yggras/abnehm-app/issues/71/sub_issues --paginate --jq '.[] | {number, title}'`, dann je Ticket `gh issue view <nummer>`); die Zuordnung Vertrag → Fundament-Ticket steht in Abschnitt 13 von Spezifikation 0;
   - `CONTEXT.md`, `docs/adr/` und `docs/agents/issue-tracker.md` (Ticketformat, Sub-Issues, Blocker);
   - die in der eigenen Spezifikation verlinkten Dateien unter `research/`, `prototypes/` und `spikes/`.

   Lücken oder Widersprüche zwischen Spezifikation und Fundament-Tickets als offene Frage an den Nutzer melden, nicht still auflösen.
3. **Blocker:** innerhalb der eigenen Spezifikation frei. Bereichsübergreifend nur auf das Fundament-Ticket, das den benötigten Vertrag liefert ([#42](https://github.com/Yggras/abnehm-app/issues/42)), nicht pauschal auf Spezifikation 0.
4. **Kanten zu anderen Spezifikationen 1–5:** Die Bereiche hängen nur über Verträge aus Spezifikation 0 zusammen. Gegen Ports eines anderen Bereichs wird mit den Fixtures und Test-Adaptern des Fundaments gebaut. Braucht ein Ticket trotzdem die echte Umsetzung eines anderen Bereichs, keine Ticketnummer raten, denn dessen Tickets entstehen gerade erst. Stattdessen nach dem Veröffentlichen einen Kommentar an der eigenen Spezifikation mit der Überschrift „Offene Kanten zu anderen Bereichen“ schreiben: eigenes Ticket → benötigtes Verhalten und Spezifikation. Die Starter-Session setzt diese Kanten, wenn alle fertig sind.
5. **Abschließen:** die Zuweisung der Spezifikation entfernen (`gh issue edit <n> --repo Yggras/abnehm-app --remove-assignee @me`). Die Spezifikation bleibt offen. Kurz melden: Anzahl der Tickets, sofort startbare Tickets mit Namen, offene Kanten und Vorschläge für Dateiänderungen.
