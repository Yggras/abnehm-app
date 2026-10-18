import { readFileSync } from 'node:fs';

/**
 * Häufige bzw. kompromittierte Passwörter (#22, angelehnt an NIST SP 800-63B,
 * https://pages.nist.gov/800-63-4/sp800-63b.html#passwordver). Quelle und Stand stehen im Kopf von
 * `password-blocklist.txt`. Verglichen wird ohne Rücksicht auf Groß- und Kleinschreibung.
 */
export type PasswordBlocklist = { includes(password: string): boolean };

export function createPasswordBlocklist(entries: Iterable<string>): PasswordBlocklist {
  const blocked = new Set([...entries].map((entry) => entry.toLowerCase()));
  return { includes: (password) => blocked.has(password.toLowerCase()) };
}

let bundled: PasswordBlocklist | null = null;

/** Die mitgelieferte Liste; einmal je Prozess gelesen. */
export function bundledPasswordBlocklist(): PasswordBlocklist {
  bundled ??= createPasswordBlocklist(
    readFileSync(new URL('./password-blocklist.txt', import.meta.url), 'utf8')
      .split('\n')
      .filter((line) => line !== '' && !line.startsWith('#')),
  );
  return bundled;
}
