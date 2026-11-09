import { SPXLearningSquareAdapter } from '../../src/browser/adapters';
import { isAllowedEducationalUrl } from '../../src/browser/security';

describe('SPX Learning Square Integration Unit Test', () => {
  const adapter = new SPXLearningSquareAdapter();

  test('should match SPX domain correctly', () => {
    expect(adapter.matchUrl('https://egy.app.spx-learning-square.com/')).toBe(true);
    expect(adapter.matchUrl('https://spx-learning-square.com/login')).toBe(true);
    expect(adapter.matchUrl('https://khanacademy.org')).toBe(false);
  });

  test('should allow SPX in SSRF security whitelist', () => {
    const res1 = isAllowedEducationalUrl('https://egy.app.spx-learning-square.com/');
    expect(res1.allowed).toBe(true);

    const res2 = isAllowedEducationalUrl('https://spx-learning-square.com/dashboard');
    expect(res2.allowed).toBe(true);
  });
});
