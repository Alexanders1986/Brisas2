import { randomBytes } from 'node:crypto';
import {
  base32Decode,
  base32Encode,
  decryptSecret,
  encryptSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  totpCode,
  verifyTotp,
} from './crypto';

describe('TOTP (RFC 6238)', () => {
  // Vectores de prueba del anexo B del RFC para SHA-1 (se comparan los últimos 6 dígitos).
  const rfcSecret = base32Encode(Buffer.from('12345678901234567890', 'ascii'));

  it.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ])('genera el código esperado en t=%i', (seconds, expected) => {
    expect(totpCode(rfcSecret, seconds * 1000)).toBe(expected);
  });

  it('acepta el intervalo anterior y el siguiente, pero no más lejos', () => {
    const secret = generateTotpSecret();
    const now = 1_700_000_000_000;
    expect(verifyTotp(secret, totpCode(secret, now - 30_000), now)).toBe(true);
    expect(verifyTotp(secret, totpCode(secret, now + 30_000), now)).toBe(true);
    expect(verifyTotp(secret, totpCode(secret, now - 90_000), now)).toBe(false);
  });

  it('codifica y decodifica base32 sin pérdida', () => {
    const bytes = randomBytes(20);
    expect(base32Decode(base32Encode(bytes)).equals(bytes)).toBe(true);
  });
});

describe('cifrado de secretos', () => {
  const key = randomBytes(32);

  it('recupera el valor original', () => {
    expect(decryptSecret(encryptSecret('JBSWY3DPEHPK3PXP', key), key)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('produce un texto cifrado distinto cada vez', () => {
    expect(encryptSecret('secreto', key)).not.toBe(encryptSecret('secreto', key));
  });

  it('rechaza datos alterados o una clave distinta', () => {
    const encrypted = encryptSecret('secreto', key);
    const parts = encrypted.split('.');
    parts[3] = `${parts[3]![0] === 'A' ? 'B' : 'A'}${parts[3]!.slice(1)}`;
    const tampered = parts.join('.');
    expect(() => decryptSecret(tampered, key)).toThrow();
    expect(() => decryptSecret(encrypted, randomBytes(32))).toThrow();
  });
});

describe('códigos de recuperación', () => {
  it('son únicos, con formato XXXXX-XXXXX, y su hash ignora mayúsculas y espacios', () => {
    const codes = generateRecoveryCodes();
    expect(new Set(codes).size).toBe(8);
    for (const code of codes) expect(code).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    expect(hashRecoveryCode(` ${codes[0]!.toLowerCase()} `)).toBe(hashRecoveryCode(codes[0]!));
  });
});
