# Backend-Image. Build-Kontext ist das Repo-Root (siehe compose.yaml).
# Node führt die TypeScript-Quellen direkt aus (Type Stripping); es gibt keinen Build-Schritt.
# Secrets kommen erst zur Laufzeit als Compose-Secret dazu und sind nie Teil des Images.
FROM node:26.12.0-alpine

ENV NODE_ENV=production
WORKDIR /app

# Nur die Manifeste, damit `npm ci` gecacht bleibt, solange sich keine Abhängigkeit ändert.
COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/
COPY apps/mobile/package.json apps/mobile/
COPY packages/contracts/package.json packages/contracts/
COPY packages/clock/package.json packages/clock/
RUN npm ci --workspace @abnehm/backend --omit=dev --ignore-scripts && npm cache clean --force

COPY packages/contracts/src packages/contracts/src
COPY packages/clock/src packages/clock/src
COPY apps/backend/src apps/backend/src

USER node
EXPOSE 8787
CMD ["node", "apps/backend/src/main.ts"]
