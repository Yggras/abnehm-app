# Abnehm-App

Gemeinsame Abnehm-App (iOS + Android) – Planung via Wayfinder.

## Lokale Einrichtung

Nach dem Klonen einmal die Git-Schutzmechanismen installieren:

```sh
scripts/install-git-guards
```

Neue Tickets werden aus dem primären Checkout in einem eigenen Worktree begonnen:

```sh
scripts/start-ticket-worktree <ticketnummer> <kurzname>
```

Die vollständigen Arbeitsregeln stehen in [`AGENTS.md`](AGENTS.md).
