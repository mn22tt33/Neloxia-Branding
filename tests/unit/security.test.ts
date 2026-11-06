import { encryptCredentials, decryptCredentials } from '../../src/utils/crypto';
import { isAllowedEducationalUrl } from '../../src/browser/security';

describe('Security & Encryption Utils', () => {
  test('should encrypt and decrypt sensitive student credentials correctly', () => {
    const rawSecret = 'StudentSecurePassword123!';
    const encrypted = encryptCredentials(rawSecret);

    expect(encrypted).not.toEqual(rawSecret);
    expect(encrypted.split(':').length).toBe(3); // iv:tag:data

    const decrypted = decryptCredentials(encrypted);
    expect(decrypted).toBe(rawSecret);
  });

  test('should block private/internal network addresses (SSRF Protection)', () => {
    const maliciousUrls = [
      'http://127.0.0.1:8080',
      'http://localhost/admin',
      'http://169.254.169.254/latest/meta-data/',
      'http://192.168.1.1/router',
      'http://10.0.0.1/internal',
    ];

    maliciousUrls.forEach((url) => {
      const res = isAllowedEducationalUrl(url);
      expect(res.allowed).toBe(false);
      expect(res.reason).toMatch(/forbidden/i);
    });
  });

  test('should allow whitelisted educational domains', () => {
    const allowedUrls = [
      'https://khanacademy.org/math',
      'https://www.coursera.org/learn',
      'https://en.wikipedia.org/wiki/Node.js',
    ];

    allowedUrls.forEach((url) => {
      const res = isAllowedEducationalUrl(url);
      expect(res.allowed).toBe(true);
    });
  });

  test('should block non-whitelisted external domains', () => {
    const randomSite = 'https://unauthorized-attacker-site.com';
    const res = isAllowedEducationalUrl(randomSite);
    expect(res.allowed).toBe(false);
  });
});
