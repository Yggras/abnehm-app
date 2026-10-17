// Einziger Export des Backends an die App: der Typ für den Hono-RPC-Client.
// Die App darf ihn nur als `import type` nutzen; Laufzeitcode des Backends gelangt nie ins App-Bundle.
export type { App as AppType } from './app.ts';
