# AGENTS.md

Anweisungen für alle Coding-Agenten in diesem Repo (Claude Code, pi + OpenAI, …). Diese Datei ist die **einzige Quelle**; `CLAUDE.md` importiert sie nur.

## Projekt

Abnehm-App (iOS + Android) für zwei Personen (Philipp: iPhone, seine Frau: Android + Fitbit): Kalorien-, Wasser-, Sport- und Gewichtstracker, Motivation/Gamification, gegenseitige Unterstützung. App-Sprache: nur Deutsch.

**Aktuelle Phase: Planung.** Ziel ist eine umsetzungsreife V1-Spezifikation. Die Planung läuft als Wayfinder-Karte auf GitHub:
- Karte: [Wayfinder: Abnehm-App V1-Spezifikation](https://github.com/Yggras/abnehm-app/issues/1) (Label `wayfinder:map`)
- Tickets: Sub-Issues der Karte; Abhängigkeiten über GitHubs native „blocked by“-Beziehung
- Recherche-Ergebnisse: `research/<name>.md` auf Branches `research/<name>`

## Session-Start

Zum Einstieg in eine neue Session den Skill **`start`** aufrufen (Claude Code: `/start`, pi: `/skill:start`). Er lädt den Stand der Karte und macht beim nächsten Ticket weiter.

## Parallele Sessions und Git-Worktrees

- Der primäre Repo-Checkout bleibt auf `main`. Dort **niemals den Branch wechseln**, wenn eine weitere Session laufen könnte.
- Jede parallele Session, die Dateien ändert oder auf einem eigenen Branch arbeitet, bekommt **vor Arbeitsbeginn einen eigenen Git-Worktree außerhalb des Repo-Verzeichnisses**. Beispiel:
  `git worktree add ../abnehm-app-worktrees/<ticket> -b <branch> origin/main`
- Den Agenten anschließend aus diesem Worktree starten. Alle Dateiänderungen, Commits und Branch-Operationen dieser Session finden nur dort statt.
- Vor `git switch`, `git checkout`, Rebase, Merge oder dem Entfernen eines Worktrees immer `pwd`, `git status --short --branch` und `git worktree list` prüfen.
- Niemals Änderungen, Branch oder Worktree einer anderen Session zurücksetzen, verschieben oder entfernen. Bei unklarer Zuordnung zuerst mit dem Nutzer abstimmen.
- Neue Ticket-Worktrees werden im primären Checkout mit `scripts/start-ticket-worktree <ticketnummer> <kurzname>` angelegt. `scripts/require-ticket-worktree` ist vor der Ticketarbeit die verbindliche maschinelle Prüfung. Der `start`-Skill muss im primären Checkout nach dem Anlegen stoppen; die Arbeit beginnt erst in einer neuen Session aus dem erzeugten Worktree.

### Technische Git-Schranken

- Nach dem Klonen einmal `scripts/install-git-guards` ausführen. Die installierten Hooks sperren Commits, Rebases und Merge-Commits im primären Checkout sowie direkte Pushes auf `main`.
- Ticket-Branches werden per Pull Request zusammengeführt; nicht direkt auf `main` pushen.
- Die Sperre darf nur in einem bewusst geprüften Notfall einmalig mit `ABNEHM_APP_ALLOW_PRIMARY_WRITE=I_KNOW_WHAT_I_AM_DOING` übergangen werden. Bequemlichkeit ist kein Notfall.
- Git-Hooks sind lokale Schutzmechanismen. Sie ersetzen weder den Ticket-Worktree noch die Prüfung von Arbeitsort und Status.

## Regeln

- **Keine unbelegten Aussagen.** Jede Faktenbehauptung braucht eine Quelle (bevorzugt Primärquelle, mit URL). Nicht Belegbares ausdrücklich als „nicht belegt“ kennzeichnen.
- **Selbstständig committen**, ohne nachzufragen.
- **Niemals einen Agenten/eine KI als Co-Author eintragen** – keine `Co-Authored-By`-Zeile, keine KI-Attribution in Commits oder PRs. Gilt auch für Subagenten.
- **Nicht betrachtet (vorerst):** Aufwandsschätzungen und rechtliche Themen (Legal, z. B. DSGVO, Datenschutzerklärung, Lizenzrecht).
- Kommunikation mit dem Nutzer auf Deutsch.

## Harness-neutrale Struktur

- Anweisungen gehören in **diese Datei**, nie nur in `CLAUDE.md` o. Ä.
- Allgemeine Workflow-Skills (u. a. `wayfinder`, `grilling`, `domain-modeling`, `prototype`, `research`) kommen **global** aus `~/.agents/skills/` (von pi direkt gelesen, für Claude Code über Symlinks in `~/.claude/skills/`). Sie werden **nicht** ins Repo kopiert.
- Projektspezifische Skills liegen in **`.agents/skills/<name>/SKILL.md`** (Agent-Skills-Standard; pi liest `.agents/skills/` – [pi-Doku](https://unpkg.com/@earendil-works/pi-coding-agent@0.80.9/README.md)).
- Claude Code liest `.agents/` nicht, folgt aber Symlinks pro Skill-Ordner ([Claude-Code-Doku](https://code.claude.com/docs/en/skills)). Für **jeden** neuen Skill daher einen Symlink anlegen:
  `ln -s ../../.agents/skills/<name> .claude/skills/<name>`
- `CLAUDE.md` enthält nur `@AGENTS.md` (Import, [Claude-Code-Doku](https://code.claude.com/docs/en/memory)).
- Keine harness-spezifischen Config-Dateien als einzige Quelle für Projektwissen.
