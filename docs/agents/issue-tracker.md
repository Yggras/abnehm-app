# Issue-Tracker: GitHub

Issues und Spezifikationen (auch „PRD“) dieses Repos liegen als GitHub-Issues in [Yggras/abnehm-app](https://github.com/Yggras/abnehm-app/issues). Alle Operationen laufen über die `gh`-CLI.

## Konventionen

- **Issue anlegen**: `gh issue create --title "..." --body "..."`. Mehrzeilige Bodys per Heredoc.
- **Issue lesen**: `gh issue view <nummer> --comments`, Kommentare per `jq` filtern, Labels mitlesen.
- **Issues auflisten**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` mit passenden `--label`- und `--state`-Filtern.
- **Kommentieren**: `gh issue comment <nummer> --body "..."`
- **Labels setzen/entfernen**: `gh issue edit <nummer> --add-label "..."` / `--remove-label "..."`
- **Schließen**: `gh issue close <nummer> --comment "..."`

Das Repo leitet `gh` innerhalb eines Klons selbst aus `git remote -v` ab.

## Pull Requests als Triage-Fläche

**PRs als Anfragefläche: nein.** _(Auf `ja` setzen, wenn externe PRs als Feature-Anfragen gelten sollen; `/triage` liest diesen Schalter.)_

Bei `ja` laufen PRs durch dieselben Labels und Zustände wie Issues, mit den `gh pr`-Entsprechungen:

- **PR lesen**: `gh pr view <nummer> --comments` und `gh pr diff <nummer>` für den Diff.
- **Externe PRs für die Triage auflisten**: `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments`, dann nur `authorAssociation` = `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR` oder `NONE` behalten (`OWNER`/`MEMBER`/`COLLABORATOR` verwerfen).
- **Kommentieren / Labeln / Schließen**: `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, `gh pr close`.

GitHub nutzt einen gemeinsamen Nummernraum für Issues und PRs. Ein nacktes `#42` kann beides sein – mit `gh pr view 42` prüfen, sonst `gh issue view 42`.

## Wenn ein Skill „im Issue-Tracker veröffentlichen“ sagt

Ein GitHub-Issue anlegen.

## Wenn ein Skill „das zugehörige Ticket holen“ sagt

`gh issue view <nummer> --comments` ausführen.

## Spezifikationen und Umsetzungstickets (projektspezifisch)

Festgelegt in [Gliederung und Format der finalen Spezifikation festlegen](https://github.com/Yggras/abnehm-app/issues/42), Kurzfassung in `AGENTS.md`:

- **`/to-spec`** veröffentlicht jede Spezifikation als **eigenständiges Issue** – kein Sub-Issue der Wayfinder-Karte – mit dem Label `ready-for-agent`. Die Spezifikation **0 · Fundament & Verträge** blockiert die Spezifikationen 1–5 (native Blocker, siehe unten).
- **`/to-tickets`** legt Umsetzungstickets als **Sub-Issues der jeweiligen Spezifikation** an, mit Label `ready-for-agent`, Blocker als native Abhängigkeiten.
- **Bereichsübergreifende Blocker** nur gezielt auf das Fundament-Ticket, das den benötigten Vertrag liefert – nicht pauschal auf die ganze Spezifikation 0.
- **Sub-Issue anhängen**: `gh api --method POST repos/Yggras/abnehm-app/issues/<eltern-nummer>/sub_issues -F sub_issue_id=<kind-db-id>` ([GitHub-REST-Doku: Add sub-issue](https://docs.github.com/en/rest/issues/sub-issues#add-sub-issue)). `sub_issue_id` ist die numerische Datenbank-ID (`gh api repos/Yggras/abnehm-app/issues/<n> --jq .id`), nicht die `#nummer`; die Doku nennt das Feld nur „The id of the sub-issue“, im Issue-Schema ist `id` getrennt von `number`.

## Wayfinding-Operationen

Genutzt von `/wayfinder`. Die **Karte** ist ein einzelnes Issue mit **Kind-Issues** als Tickets.

- **Karte**: ein einzelnes Issue mit Label `wayfinder:map`, das Notes / Decisions so far / Fog enthält. `gh issue create --label wayfinder:map`.
- **Kind-Ticket**: ein Issue, das als GitHub-Sub-Issue an der Karte hängt (`gh api` auf den Sub-Issue-Endpunkt, siehe oben). Wo Sub-Issues nicht verfügbar sind: das Kind in eine Aufgabenliste im Body der Karte eintragen und `Part of #<karte>` an den Anfang des Kind-Bodys setzen. Labels: `wayfinder:<typ>` (`research`/`prototype`/`grilling`/`task`). Nach dem Claimen ist das Ticket dem treibenden Entwickler zugewiesen.
- **Blocker**: GitHubs **native Issue-Abhängigkeiten** – die kanonische, in der Oberfläche sichtbare Darstellung. Kante anlegen mit `gh api --method POST repos/Yggras/abnehm-app/issues/<kind>/dependencies/blocked_by -F issue_id=<blocker-db-id>` ([GitHub-REST-Doku: Issue dependencies](https://docs.github.com/en/rest/issues/issue-dependencies)), wobei `<blocker-db-id>` die numerische **Datenbank-ID** des Blockers ist (`gh api repos/Yggras/abnehm-app/issues/<n> --jq .id`, _nicht_ die `#nummer` oder `node_id`). GitHub meldet `issue_dependencies_summary.blocked_by` (nur offene Blocker – das eigentliche Tor). Wo Abhängigkeiten nicht verfügbar sind: Zeile `Blocked by: #<n>, #<n>` an den Anfang des Kind-Bodys. Ein Ticket ist frei, wenn alle Blocker geschlossen sind.
- **Frontier-Abfrage**: die offenen Kinder der Karte auflisten (`gh api repos/Yggras/abnehm-app/issues/1/sub_issues`), alle mit offenem Blocker (`issue_dependencies_summary.blocked_by > 0`) oder Assignee verwerfen; das erste in Kartenreihenfolge gewinnt.
- **Claimen**: `gh issue edit <n> --add-assignee @me` – der erste Schreibvorgang der Session.
- **Auflösen**: `gh issue comment <n> --body "<antwort>"`, dann `gh issue close <n>`, dann einen Kontextzeiger (Kurzfassung + Link) an „Decisions so far“ der Karte anhängen.
