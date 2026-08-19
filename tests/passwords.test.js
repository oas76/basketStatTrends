const { hashPassword, verifyPassword, generatePassword } = require('../lib/passwords');

describe('passwords', () => {
  test('hashPassword produces a verifiable Argon2id hash', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(typeof hash).toBe('string');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(hash, 'correct horse battery staple')).toBe(true);
  });

  test('verifyPassword rejects a wrong password', async () => {
    const hash = await hashPassword('s3cret-password');
    expect(await verifyPassword(hash, 'wrong-password')).toBe(false);
  });

  test('verifyPassword returns false for a null/missing hash', async () => {
    expect(await verifyPassword(null, 'anything')).toBe(false);
    expect(await verifyPassword(undefined, 'anything')).toBe(false);
  });

  test('generatePassword returns readable, unambiguous passwords', () => {
    const pw = generatePassword(16);
    expect(pw).toHaveLength(16);
    // No ambiguous characters
    expect(pw).not.toMatch(/[0OlI1]/);
    // Enforces a minimum length
    expect(generatePassword(4).length).toBeGreaterThanOrEqual(12);
  });

  test('generatePassword is random across calls', () => {
    const a = generatePassword();
    const b = generatePassword();
    expect(a).not.toBe(b);
  });
});
