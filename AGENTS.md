# AGENTS.md

Anweisungen für alle Coding-Agenten in diesem Repo (Claude Code, pi + OpenAI, …). Diese Datei ist die **einzige Quelle**; `CLAUDE.md` importiert sie nur.

## Projekt

Abnehm-App (iOS + Android) für zwei Personen (Philipp: iPhone, seine Frau: Android + Fitbit): Kalorien-, Wasser-, Sport- und Gewichtstracker, Motivation/Gamification, gegenseitige Unterstützung. App-Sprache: nur Deutsch.

**Aktuelle Phase: Umsetzung.** Die Planung ist abgeschlossen: Die Wayfinder-Karte ist seit 16.10.2026 geschlossen, die V1-Spezifikation liegt als sechs Spezifikations-Issues vor (Abschnitt „Spezifikationen“ der Karte). Seit 17.10.2026 sind alle sechs in Umsetzungstickets zerlegt (Sub-Issues der jeweiligen Spezifikation, Abhängigkeiten als native „blocked by“-Beziehungen, auch zwischen den Bereichen). Zuerst wird das Fundament (Spezifikation 0) umgesetzt, weil es die Spezifikationen 1–5 blockiert. Die Planung lief als Wayfinder-Karte auf GitHub:
- Karte: [Wayfinder: Abnehm-App V1-Spezifikation](https://github.com/Yggras/abnehm-app/issues/1) (Label `wayfinder:map`)
- Tickets: Sub-Issues der Karte; Abhängigkeiten über GitHubs native „blocked by“-Beziehung
- Recherche-Ergebnisse liegen dauerhaft unter `research/<name>.md`, Prototypen unter `prototypes/<name>/`, Spikes unter `spikes/<name>/` auf `main` ([übernommen](https://github.com/Yggras/abnehm-app/issues/55)). Neue Ergebnisse entstehen auf einem eigenen Branch und kommen per Pull Request nach `main`; Links in Tickets und Dateien zeigen immer auf `main`.
- Übergabe an die Umsetzung ([Entscheidung](https://github.com/Yggras/abnehm-app/issues/42)): Die Spezifikation entsteht per `/to-spec` als sechs eigenständige Spezifikations-Issues (0 Fundament & Verträge blockiert 1–5). `/to-tickets` macht daraus Umsetzungstickets als Sub-Issues der jeweiligen Spezifikation. Bereichsübergreifende Blocker nur gezielt auf das Fundament-Ticket, das den benötigten Vertrag liefert. `CONTEXT.md` bleibt das einzige Glossar.

## Session-Start

Für eine **rein lesende Übersicht** über offene Tickets, sinnvolle parallele Gruppen und die Reihenfolge den Skill **`ticket-uebersicht`** aufrufen (Claude Code: `/ticket-uebersicht`, pi: `/skill:ticket-uebersicht`). Er claimt nichts und startet keine Session.

Zum unmittelbaren Einstieg in die Umsetzung den Skill **`start`** aufrufen (Claude Code: `/start`, pi: `/skill:start`). Er ermittelt mit `scripts/ticket-frontier` die freien Umsetzungstickets der Spezifikationen 0–5. Dann greift er sich das nächste und setzt es in einem eigenen Worktree bis zum Pull Request um. Das geht ohne Neustart, und mehrere Sessions können parallel laufen.

Am Ende jedes Tickets prüft `start` die Änderungen mit dem Skill **`review-parallel`**. Den Ablauf übernehmen Skripte:

- `scripts/start-review-tabs` öffnet zwei Herdr-Tabs mit eigenständigen Reviewer-Sessions (Standards und Spec, Skill `review-achse`). Gestartet wird derselbe Agent wie die Ticket-Session: Claude Code oder Pi mit demselben Modell.
- Die Reviewer reichen ihre Berichte mit `scripts/submit-review` ein.
- `scripts/wait-review-reports` gibt die Berichte an die Ticket-Session zurück, die die Befunde behebt.

Ohne Herdr läuft das Review wie bisher mit `code-review`.

Mehrere Tickets auf einmal startet der Nutzer mit dem Skill **`start-parallel`** (Claude Code: `/start-parallel 57 58`, pi: `/skill:start-parallel --agent pi 57 58`) aus einer Session in [Herdr](https://herdr.dev): `scripts/start-agent-tabs` öffnet je Ticket einen eigenen Herdr-Tab mit einer eigenständigen Claude-Code-Session (Standard, `/start <ticket>`) oder Pi-Session (`--agent pi`, standardmäßig `openai-codex/gpt-6-sol`, `/skill:start <ticket>`).

Spezifikationen zerlegt der Nutzer parallel mit dem Skill **`to-tickets-parallel`** (Claude Code: `/to-tickets-parallel 82 81 86 83 87`): `scripts/start-to-tickets-tabs` öffnet je Spezifikation einen Herdr-Tab, in dem eine eigenständige Session `/to-tickets` ausführt.

## Codebasis

Aufbau (npm-Workspace mit `apps/mobile`, `apps/backend`, `packages/contracts`, `packages/clock`, `packages/game-rules`), Befehle, Secrets und der Ablauf für Simulatoren und echte Geräte stehen in [`docs/entwicklung.md`](docs/entwicklung.md). Für jede Änderung gilt:

- Native App-Abhängigkeiten nur per `npx expo install` aus `apps/mobile`. `ios/` und `android/` werden generiert und nie von Hand bearbeitet. Vor Code gegen Expo- oder React-Native-APIs die Doku der genutzten SDK-Version lesen (`https://docs.expo.dev/versions/v58.0.0/`), nicht aus dem Gedächtnis arbeiten.
- Zeitpunkt, Zeitzone und lokaler Tag kommen nur aus der `Clock`-Schnittstelle von `@abnehm/clock`, nie aus `Date.now()`, `new Date()` oder `Intl`. Das prüft `npm run lint`, ebenso die Importgrenzen des Vertragsmoduls.
- Zod-Schemas und Typen, die App und Backend teilen, liegen nur im Vertragsmodul `@abnehm/contracts`. Einzige Ausnahme sind die Spielregeln samt Katalogformat und Spielkatalog im reinen Paket `@abnehm/game-rules` ([Spezifikation 4](https://github.com/Yggras/abnehm-app/issues/83), Abschnitt 1); Spielformeln stehen nur dort.
- Das Datenmodell ändert sich nur in beiden Drizzle-Schemas zugleich (Postgres und SQLite), samt mit `drizzle-kit generate` erzeugter Migration je Workspace. Bereichscode schreibt lokal nur über `LocalDatabase.transaction` aus `apps/mobile/src/local-db/`.
- Vor dem Pull Request laufen `npm run typecheck`, `npm run lint` und `npm test`; die CI wiederholt sie.

## Parallele Sessions und Git-Worktrees

- Der primäre Repo-Checkout bleibt auf `main`. Dort **niemals den Branch wechseln**, wenn eine weitere Session laufen könnte.
- Jede parallele Session, die Dateien ändert oder auf einem eigenen Branch arbeitet, bekommt **vor Arbeitsbeginn einen eigenen Git-Worktree außerhalb des Repo-Verzeichnisses**. Beispiel:
  `git worktree add ../abnehm-app-worktrees/<ticket> -b <branch> origin/main`
- Den Agenten anschließend aus diesem Worktree starten oder die laufende Session dorthin verlegen. Alle Dateiänderungen, Commits und Branch-Operationen dieser Session finden nur dort statt.
- Vor `git switch`, `git checkout`, Rebase, Merge oder dem Entfernen eines Worktrees immer `pwd`, `git status --short --branch` und `git worktree list` prüfen.
- Niemals Änderungen, Branch oder Worktree einer anderen Session zurücksetzen, verschieben oder entfernen. Bei unklarer Zuordnung zuerst mit dem Nutzer abstimmen.
- Neue Ticket-Worktrees werden im primären Checkout mit `scripts/start-ticket-worktree <ticketnummer> <kurzname>` angelegt. `scripts/require-ticket-worktree` ist vor der Ticketarbeit die verbindliche maschinelle Prüfung. Der `start`-Skill claimt das Ticket, legt den Worktree an und verlegt **dieselbe Session** hinein (Claude Code: `EnterWorktree` mit `path`; andere Harnesses: Befehle per `cd <worktree> && …`); erst danach beginnt die Ticketarbeit. Das Skript sperrt pro Ticketnummer (Exit-Code 3 = von einer parallelen Session belegt) und legt gleichzeitig angeforderte Worktrees nacheinander an (Dateisperre im gemeinsamen Git-Verzeichnis), weil parallele `git worktree add -b` sonst an der Sperre von `.git/config` scheitern.
- Den Text der Karte (#1) ändern Agenten nur mit `scripts/update-map` (frisch laden, eine Zeile ändern, zurückschreiben – unter Sperre), weil `gh issue edit --body` den ganzen Text ersetzt und parallele Sessions sich sonst gegenseitig Zeilen löschen.

### Technische Git-Schranken

- Nach dem Klonen einmal `scripts/install-git-guards` ausführen. Die installierten Hooks sperren Commits, Rebases und Merge-Commits im primären Checkout sowie direkte Pushes auf `main`.
- Ticket-Branches werden per Pull Request zusammengeführt; nicht direkt auf `main` pushen.
- Die Sperre darf nur in einem bewusst geprüften Notfall einmalig mit `ABNEHM_APP_ALLOW_PRIMARY_WRITE=I_KNOW_WHAT_I_AM_DOING` übergangen werden. Bequemlichkeit ist kein Notfall.
- Git-Hooks sind lokale Schutzmechanismen. Sie ersetzen weder den Ticket-Worktree noch die Prüfung von Arbeitsort und Status.

## Agent skills

Konfiguration für die Engineering-Skills (`to-spec`, `to-tickets`, `triage`, `wayfinder`, …), angelegt mit `/setup-matt-pocock-skills`.

### Issue tracker

GitHub-Issues in Yggras/abnehm-app über die `gh`-CLI; Spezifikationen als eigenständige Issues, Umsetzungstickets als deren Sub-Issues. Siehe `docs/agents/issue-tracker.md`.

### Triage labels

Standard-Vokabular: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. Siehe `docs/agents/triage-labels.md`.

### Domain docs

Ein Kontext: `CONTEXT.md` + `docs/adr/` im Repo-Root, bis zur Umsetzung ergänzt durch die Entscheidungen der Wayfinder-Karte. Siehe `docs/agents/domain.md`.

## Regeln

- **Keine unbelegten Aussagen.** Jede Faktenbehauptung braucht eine Quelle (bevorzugt Primärquelle, mit URL). Nicht Belegbares ausdrücklich als „nicht belegt“ kennzeichnen.
- **Entscheidungen selbstständig treffen:** Wenn der Nutzer keine abweichende Präferenz nennt, die begründete Empfehlung wählen und weiterarbeiten; nur bei echter Produktpräferenz, fehlender Information oder schwer reversibler externer Wirkung nachfragen.
- **Codebase-Qualität priorisieren:** Eine hervorragende, erweiterbare Codebasis mit tiefen Modulen und kleinen Interfaces bauen; Seams nur für echte Varianten oder Test-Adapter einführen, Fachdaten nicht zwischen Bibliotheks-Stores duplizieren und Verhalten an Modul-Interfaces testen.
- **Selbstständig committen**, ohne nachzufragen.
- **Niemals einen Agenten/eine KI als Co-Author eintragen** – keine `Co-Authored-By`-Zeile, keine KI-Attribution in Commits oder PRs. Gilt auch für Subagenten.
- **Nicht betrachtet (vorerst):** Aufwandsschätzungen und rechtliche Themen (Legal, z. B. DSGVO, Datenschutzerklärung, Lizenzrecht).
- Kommunikation mit dem Nutzer auf Deutsch.

## Harness-neutrale Struktur

- Anweisungen gehören in **diese Datei**, nie nur in `CLAUDE.md` o. Ä.
- Allgemeine Workflow-Skills (u. a. `wayfinder`, `grilling`, `domain-modeling`, `prototype`, `research`) kommen **global** aus `~/.agents/skills/` (von pi direkt gelesen, für Claude Code über Symlinks in `~/.claude/skills/`). Sie werden **nicht** ins Repo kopiert.
- **Ausnahme Impeccable** (Design-Skill, Nutzerentscheidung 16.10.2026, [#91](https://github.com/Yggras/abnehm-app/issues/91)): Impeccable wird ins Projekt installiert, nicht global.
  - Installation: `npx impeccable@<version> install -y --providers=claude,pi --scope=project --no-hooks`, danach einmalig `npx impeccable telemetry off`.
  - Der Installer legt je Harness eine eigene Fassung an, unter `.claude/skills/impeccable/` (dazu `.claude/agents/impeccable-*.md`) und `.pi/skills/impeccable/`. Es gibt keinen Symlink, weil sich die Fassungen in Pfaden und Frontmatter unterscheiden.
  - Die Engine-Binaries unter `scripts/bin/` sind per `.gitignore` ausgeschlossen. Der Launcher lädt sie beim ersten Aufruf nach `~/.impeccable/bin/`.
  - Aktualisieren: denselben Befehl mit neuer Version und `--force` ausführen.
  - Produktkontext liegt in `docs/PRODUCT.md`; Ergebnis und Vorgehen der ersten Prüfung stehen in `research/impeccable-review.md`.
- Projektspezifische Skills liegen in **`.agents/skills/<name>/SKILL.md`** (Agent-Skills-Standard; pi liest `.agents/skills/` – [pi-Doku](https://unpkg.com/@earendil-works/pi-coding-agent@0.80.9/README.md)).
- Claude Code liest `.agents/` nicht, folgt aber Symlinks pro Skill-Ordner ([Claude-Code-Doku](https://code.claude.com/docs/en/skills)). Für **jeden** neuen Skill daher einen Symlink anlegen:
  `ln -s ../../.agents/skills/<name> .claude/skills/<name>`
- `CLAUDE.md` enthält nur `@AGENTS.md` (Import, [Claude-Code-Doku](https://code.claude.com/docs/en/memory)).
- Keine harness-spezifischen Config-Dateien als einzige Quelle für Projektwissen.
