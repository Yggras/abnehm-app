# Backend-Image. Build-Kontext ist das Repo-Root (siehe compose.yaml).
# Node führt die TypeScript-Quellen direkt aus (Type Stripping); es gibt keinen Build-Schritt.
# Secrets kommen erst zur Laufzeit als Compose-Secret dazu und sind nie Teil des Images.
#
# Zwei Ziele (#112): `production` (Standard, letzte Stage) enthält nur `src/`; `development` legt
# die Testfähigkeiten dazu (Seed-Route und Seed-Kommando aus `apps/backend/dev/`, Manifeste aus
# `packages/contracts/seeds/`). compose.yaml baut für die lokale Entwicklung `development`.
# test/release-sperren.test.ts prüft, dass `production` keine Testfähigkeit kopiert.
FROM node:26.12.0-alpine AS base

ENV NODE_ENV=production
WORKDIR /app

# Nur die Manifeste, damit `npm ci` gecacht bleibt, solange sich keine Abhängigkeit ändert.
COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/
COPY apps/mobile/package.json apps/mobile/
COPY packages/contracts/package.json packages/contracts/
COPY packages/clock/package.json packages/clock/
COPY packages/game-rules/package.json packages/game-rules/
# drizzle-orm/better-auth deklarieren optionale Peers für Expo, Jest und Drizzle Kit.
# Ohne diese Option installiert npm sie trotz --workspace/--omit=dev ins Backend-Image.
# Alle zur Laufzeit verwendeten Peers (z. B. drizzle-orm) sind direkte Backend-Abhängigkeiten.
RUN npm ci --workspace @abnehm/backend --omit=dev --ignore-scripts --legacy-peer-deps \
    && test ! -d node_modules/expo \
    && test ! -d node_modules/jest \
    && test ! -d node_modules/drizzle-kit \
    && npm cache clean --force

COPY packages/contracts/src packages/contracts/src
COPY packages/clock/src packages/clock/src
# Spielregeln und ausgelieferter Spielkatalog; Fixtures und Versionsschnappschüsse nur in Tests.
COPY packages/game-rules/src packages/game-rules/src
COPY packages/game-rules/content packages/game-rules/content
COPY apps/backend/src apps/backend/src
# Migrationen laufen beim Start (src/main.ts) und per `npm run db:migrate`.
COPY apps/backend/drizzle apps/backend/drizzle

USER node
EXPOSE 8787

# Lokale Entwicklung: dieselbe App, davor die Testfähigkeiten.
FROM base AS development
ENV NODE_ENV=development
COPY packages/contracts/seeds packages/contracts/seeds
COPY apps/backend/dev apps/backend/dev
CMD ["node", "apps/backend/dev/main.ts"]

# Produktion: ohne Testfähigkeiten.
FROM base AS production
CMD ["node", "apps/backend/src/main.ts"]
