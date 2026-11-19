import { z } from 'zod';

import type { ContractError } from './errors.ts';
import {
  ChallengeProposalPayload,
  EncouragementNotificationPayload,
  LevelUpPayload,
  RoleRequestPayload,
  UncouplingNotificationPayload,
} from './notifications.ts';
import type { EncouragementKey } from './partner.ts';

// Deutscher Textkatalog für Benachrichtigungen (Spezifikation 0, Abschnitt 2). App (Tages-Check-ins,
// In-App-Anzeige) und Server-Zusteller nutzen denselben Katalog: Expo Push nimmt Titel und Text nur
// als fertige Zeichenfolgen an. Die Einträge liefern die Spezifikationen 4 und 5.

export type NotificationText = Readonly<{ title: string; body: string }>;

/** Ein Katalogeintrag: Schema der Werte und daraus erzeugter Titel und Text. */
export type NotificationTextEntry<S extends z.ZodType = z.ZodType> = Readonly<{
  values: S;
  render: (values: z.output<S>) => NotificationText;
}>;

/** Typisiert einen Eintrag, sodass `render` die Werte aus dem Schema kennt. */
export function notificationText<S extends z.ZodType>(
  values: S,
  render: (values: z.output<S>) => NotificationText,
): NotificationTextEntry<S> {
  return { values, render };
}

type Entries = Readonly<Record<string, Readonly<{ values: z.ZodType; render: (values: never) => NotificationText }>>>;
type ValuesOf<E> = E extends { values: infer S extends z.ZodType } ? z.input<S> : never;

export type RenderResult =
  | { type: 'rendered'; text: NotificationText }
  | { type: 'contract_error'; error: ContractError };

export type NotificationTextCatalog<E extends Entries> = Readonly<{
  /** Schlüssel des Katalogs; ein anderer Schlüssel ist ein Typfehler. */
  render<K extends keyof E & string>(messageKey: K, values: ValuesOf<E[K]>): NotificationText;
  /** Für gespeicherte Intents: Schlüssel und Werte kommen ungeprüft aus der Datenbank. */
  renderStored(messageKey: string, values: unknown): RenderResult;
}>;

export function defineNotificationTexts<const E extends Entries>(entries: E): NotificationTextCatalog<E> {
  const renderStored = (messageKey: string, values: unknown): RenderResult => {
    if (!Object.prototype.hasOwnProperty.call(entries, messageKey)) {
      return { type: 'contract_error', error: { code: 'unknown_catalog_key', retryable: false } };
    }
    const entry = entries[messageKey] as unknown as NotificationTextEntry;
    const parsed = entry.values.safeParse(values);
    if (!parsed.success) return { type: 'contract_error', error: { code: 'invalid_payload', retryable: false } };
    return { type: 'rendered', text: entry.render(parsed.data) };
  };
  return {
    render(messageKey, values) {
      const result = renderStored(messageKey, values);
      if (result.type === 'contract_error') throw new Error(`Benachrichtigungstext ${messageKey}: ${result.error.code}`);
      return result.text;
    },
    renderStored,
  };
}

/**
 * Die festen Kurzbotschaften zum Anfeuern (Spezifikation 5, Abschnitt 4; Nutzerentscheidung vom
 * 15.10.2026). Das Sheet `partner.encourage` zeigt sie als Buttons, der Push als Text.
 */
export const encouragementMessages: Readonly<Record<EncouragementKey, string>> = {
  du_schaffst_das: 'Du schaffst das! 💪',
  ich_denk_an_dich: 'Ich denk an dich ❤️',
  stark_heute: 'Stark heute! 🎉',
  gemeinsam_fuer_momo: 'Gemeinsam für Momo 🐣',
  stolz_auf_dich: 'Bin stolz auf dich 🌟',
};

/**
 * Der gemeinsame Katalog; Schlüssel ist der `messageKey` des Intents, Werte sind seine Payload. Der
 * Push-Zusteller ergänzt zu jedem Katalogschlüssel `‹x›Key` der Payload dessen Namen als `‹x›Name`
 * (`withCatalogNames` im Spielkatalog). Ein Eintrag, der einen solchen Namen zeigt, nimmt ihn in sein
 * Werteschema auf (wie `challenge_vorschlag`); strikte Schemas ohne ihn weisen die Werte sonst ab. Die
 * Spieltexte sind Designwerte aus Spezifikation 4, Abschnitt 12 (nicht belegt), die Anfeuern-Texte stehen
 * in Spezifikation 5, Abschnitt 4. Weitere Einträge kommen mit den Tickets der Spezifikationen 4 und 5 hinzu.
 */
export const notificationTexts = defineNotificationTexts({
  /** Spezifikation 5, Abschnitt 4: „Anna feuert dich an“ mit der Kurzbotschaft (User Story 29). */
  anfeuern: notificationText(EncouragementNotificationPayload, ({ senderDisplayName, encouragementKey }) => ({
    title: `${senderDisplayName} feuert dich an`,
    body: encouragementMessages[encouragementKey],
  })),
  /** Spezifikation 4, Abschnitt 12: an beide, mit dem höchsten neuen Level (#200). */
  levelaufstieg: notificationText(LevelUpPayload, ({ level }) => ({
    title: `Momo ist jetzt auf Level ${level} 🎉`,
    body: 'Das habt ihr gemeinsam geschafft. Schaut auf eurer Insel vorbei.',
  })),
  'rollen_anfrage.rollenwahl': notificationText(
    RoleRequestPayload.extend({ kind: z.literal('rollenwahl') }),
    ({ senderDisplayName }) => ({ title: `${senderDisplayName} schlägt eure Rollen vor`, body: 'Wenn du zustimmst, schlüpft Momo 🐣' }),
  ),
  /**
   * Spezifikation 4, Abschnitt 12: an den Partner (#210). Den Namen der Vorlage ergänzt der Zusteller aus
   * dem Spielkatalog (`templateName`); die Payload selbst trägt nur den Schlüssel.
   */
  challenge_vorschlag: notificationText(
    ChallengeProposalPayload.extend({ templateName: z.string().min(1).max(80) }),
    ({ senderDisplayName, templateName }) => ({
      title: `${senderDisplayName} schlägt eine Challenge vor`,
      body: `${templateName} – sieben Tage gemeinsam. Magst du mitmachen?`,
    }),
  ),
  /** Spezifikation 5, Abschnitt 9: Information an den Partner, keine Anfrage. */
  entkopplung: notificationText(UncouplingNotificationPayload, ({ senderDisplayName }) => ({
    title: `${senderDisplayName} hat eure Kopplung beendet`,
    body: 'Momo und eure Insel sind archiviert.',
  })),
});
