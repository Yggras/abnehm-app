# Domain-Doku

Wie die Engineering-Skills die Fachdokumentation dieses Repos beim Erkunden lesen sollen.

## Vor dem Erkunden lesen

- **`CONTEXT.md`** im Repo-Root – das einzige Glossar des Projekts (siehe `AGENTS.md`).
- **`docs/adr/`** – ADRs, die den Bereich berühren, in dem gearbeitet wird.
- **Entscheidungen der Wayfinder-Karte** – bis zur Umsetzung stehen die Architektur- und Fachentscheidungen nicht als ADRs im Repo, sondern als geschlossene Tickets der [Karte](https://github.com/Yggras/abnehm-app/issues/1). Der Abschnitt „Decisions so far“ verlinkt sie; die Details stehen im Resolution-Kommentar des jeweiligen Tickets. Recherchen und Prototypen sind aus den Tickets verlinkt; laut `AGENTS.md` werden sie dauerhaft nach `research/` bzw. `prototypes/` auf `main` übernommen (Stand 2026-10-13: noch auf eigenen Branches `research/<name>` bzw. `prototype/<name>`).

Fehlt eine dieser Dateien, **ohne Meldung weitermachen**. Nicht auf das Fehlen hinweisen und nicht vorab vorschlagen, sie anzulegen. Der Skill `/domain-modeling` (erreichbar über `/grill-with-docs` und `/improve-codebase-architecture`) legt sie bei Bedarf an, wenn Begriffe oder Entscheidungen tatsächlich geklärt werden.

## Dateistruktur

Ein Kontext (dieses Repo):

```
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-event-sourced-orders.md
│   └── 0002-postgres-for-write-model.md
└── src/
```

## Das Vokabular des Glossars verwenden

Wenn eine Ausgabe einen Fachbegriff nennt (in einem Issue-Titel, einem Refactoring-Vorschlag, einer Hypothese, einem Testnamen), den Begriff so verwenden, wie `CONTEXT.md` ihn definiert. Nicht auf Synonyme ausweichen, die das Glossar ausdrücklich vermeidet.

Fehlt der benötigte Begriff im Glossar, ist das ein Signal: Entweder wird Sprache erfunden, die das Projekt nicht nutzt (überdenken), oder es gibt eine echte Lücke (für `/domain-modeling` vormerken).

## ADR-Konflikte melden

Widerspricht eine Ausgabe einem bestehenden ADR oder einer Entscheidung der Karte, das ausdrücklich benennen statt still zu überschreiben:

> _Widerspricht ADR-0007 (event-sourced orders) – sollte aber neu aufgerollt werden, weil …_
