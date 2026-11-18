import {
  AreaUnlockRecord,
  BlueprintUnlockRecord,
  CommunityProjectRecord,
  IslandEventRecord,
  IslandFieldRecord,
  IslandObjectOrigin,
  IslandObjectRecord,
} from '../src/island-records.ts';
import { fixtures } from './define.ts';
import { coupling, island, islandField, now, philipp } from './ids.ts';

const owned = { islandId: island, couplingId: coupling };

const project = {
  ...owned,
  sequenceNumber: 1,
  templateKey: 'gartenhaeuschen',
  buildNeed: 20,
  natureNeed: 20,
  status: 'aktiv',
  completedAt: null,
  createdAt: now,
  updatedAt: now,
} as const;

const builtLantern = {
  ...owned,
  ownerPersonId: philipp,
  catalogKey: 'laterne',
  origin: 'gebaut',
  level: 1,
  fieldId: islandField,
  createdAt: now,
  updatedAt: now,
} as const;

const hatched = {
  ...owned,
  type: 'momo_geschluepft',
  templateKey: null,
  responsiblePersonId: null,
  occasionKey: 'geschluepft',
  status: 'abgeschlossen',
  reward: null,
  occurredAt: now,
  createdAt: now,
  updatedAt: now,
} as const;

export const islandRecordFixtures = {
  BlueprintUnlockRecord: fixtures(BlueprintUnlockRecord, {
    valid: { 'Start-Bauplan beim Schlüpfen': { ...owned, catalogKey: 'laterne', reason: 'start', unlockedAt: now, createdAt: now } },
    invalid: { 'unbekannter Grund': { ...owned, catalogKey: 'laterne', reason: 'gekauft', unlockedAt: now, createdAt: now } },
  }),
  AreaUnlockRecord: fixtures(AreaUnlockRecord, {
    valid: { 'erstes Gebiet auf Level 4': { ...owned, areaKey: 'mooswald', level: 4, unlockedAt: now, createdAt: now } },
    invalid: { 'Gebiet vor Level 4': { ...owned, areaKey: 'mooswald', level: 3, unlockedAt: now, createdAt: now } },
  }),
  IslandFieldRecord: fixtures(IslandFieldRecord, {
    valid: {
      'Ecke einer Person': { ...owned, fieldKey: 'grundinsel:0:0', ownerPersonId: philipp, createdAt: now },
      'Gebietsfeld über der Grundinsel': { ...owned, fieldKey: 'mooswald:3:-5', ownerPersonId: philipp, createdAt: now },
      'Lichtung ohne Besitzer': { ...owned, fieldKey: 'grundinsel:7:7', ownerPersonId: null, createdAt: now },
    },
    invalid: { 'Schlüssel ohne Koordinaten': { ...owned, fieldKey: 'grundinsel', ownerPersonId: null, createdAt: now } },
  }),
  IslandObjectOrigin: fixtures(IslandObjectOrigin, {
    valid: { 'gebaut': 'gebaut', 'Deko aus einer Challenge': 'challenge' },
    invalid: { 'gekauft': 'gekauft' },
  }),
  IslandObjectRecord: fixtures(IslandObjectRecord, {
    valid: {
      'gebaute Laterne auf einem Feld': builtLantern,
      'Deko im Lager': { ...builtLantern, catalogKey: 'muschelkranz', origin: 'besucher', fieldId: null },
    },
    invalid: {
      'Stufe 4': { ...builtLantern, level: 4 },
      'unbekannte Herkunft': { ...builtLantern, origin: 'gekauft' },
      'ohne Besitzer': { ...builtLantern, ownerPersonId: null },
    },
  }),
  CommunityProjectRecord: fixtures(CommunityProjectRecord, {
    valid: {
      'aktives Projekt 1': project,
      'fertiges Projekt': { ...project, status: 'fertig', completedAt: now },
    },
    invalid: {
      'fertig ohne Abschlusszeitpunkt': { ...project, status: 'fertig' },
      'aktiv mit Abschlusszeitpunkt': { ...project, completedAt: now },
    },
  }),
  IslandEventRecord: fixtures(IslandEventRecord, {
    valid: {
      'Momo geschlüpft': hatched,
      'Besuch für Philipp': { ...hatched, type: 'besuch', templateKey: 'igel', responsiblePersonId: philipp, occasionKey: 'tag:2026-10-14:1', status: 'offen' },
    },
    invalid: {
      'individueller Bau ist kein Ereignis': { ...hatched, type: 'objekt_gebaut' },
      'leerer Anlassschlüssel': { ...hatched, occasionKey: '' },
    },
  }),
};
