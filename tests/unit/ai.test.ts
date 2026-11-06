import { MockAIProvider } from '../../src/ai/providers';

describe('AI Solver Unit Test', () => {
  const provider = new MockAIProvider();

  test('should return recommended answer for multiple choice question', async () => {
    const result = await provider.generateAnswer({
      questionText: 'What is the capital of France?',
      options: ['Paris', 'Berlin', 'Madrid', 'Rome'],
    });

    expect(result.answerText).toContain('Paris');
    expect(result.confidenceScore).toBeGreaterThan(0.9);
    expect(result.tokensUsed.input).toBeGreaterThan(0);
  });

  test('should accurately process True/False questions', async () => {
    const result = await provider.generateAnswer({
      questionText: 'Is the earth revolving around the sun? True or False?',
    });

    expect(result.answerText).toContain('True');
    expect(result.confidenceScore).toBeCloseTo(0.98);
  });
});
