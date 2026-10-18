import { fixtureCases } from '@abnehm/contracts/fixtures';

// Vertragstests in der Testumgebung der App (#94): dieselben Fixtures wie im Backend, das sie über
// eine Hono-Validierung schickt. Gültige werden unverändert übernommen, ungültige abgewiesen.

describe.each(fixtureCases())('$name', ({ schema, value, valid }) => {
  if (valid) {
    it('ist gültig und wird unverändert übernommen', () => {
      const result = schema.safeParse(value);

      expect(result.error?.issues).toBeUndefined();
      expect(result.data).toStrictEqual(value);
    });
  } else {
    it('scheitert am Schema', () => {
      expect(schema.safeParse(value).success).toBe(false);
    });
  }
});
