/** Eine beobachtbare Quelle: meldet sofort den aktuellen Stand und jeden Wechsel; liefert die Abmeldung. */
export type Source<T> = Readonly<{ subscribe(listener: (state: T) => void): () => void }>;

/**
 * Eine Quelle, die der Quelle des jeweils geöffneten Kontos folgt. Die App-Sitzung meldet über
 * `opened` die Quelle eines geöffneten Kontos an und löst sie mit deren Rückgabe beim Sperren wieder;
 * ohne geöffnetes Konto meldet `source` den Zustand `idle`, etwa „lädt“. Beobachter bleiben über
 * Kontowechsel hinweg angemeldet. Gemeinsam genutzt von den Beiträgen an „Heute“ und „Wir“.
 */
export function followSource<T>(idle: T): Readonly<{ source: Source<T>; opened(source: Source<T>): () => void }> {
  let current: Source<T> | null = null;
  const followers = new Set<() => void>();
  const changed = () => {
    for (const follow of followers) follow();
  };
  return {
    source: {
      subscribe(listener) {
        let stop: (() => void) | null = null;
        const follow = () => {
          stop?.();
          stop = null;
          if (current === null) listener(idle);
          else stop = current.subscribe(listener);
        };
        followers.add(follow);
        follow();
        return () => {
          followers.delete(follow);
          stop?.();
        };
      },
    },
    opened(source) {
      current = source;
      changed();
      return () => {
        if (current !== source) return;
        current = null;
        changed();
      };
    },
  };
}
