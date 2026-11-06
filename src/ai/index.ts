import { config } from '../config';
import { prisma } from '../database/prisma';
import { logger } from '../utils/logger';
import { IAIProvider, MockAIProvider, GeminiAIProvider, OpenAIAIProvider } from './providers';
import { AISolverRequest, AISolverResponse } from '../types';

export class AIService {
  private provider: IAIProvider;

  constructor() {
    this.provider = this.createProvider(config.ai.provider);
  }

  private createProvider(providerName: string): IAIProvider {
    switch (providerName) {
      case 'gemini':
        return new GeminiAIProvider(config.ai.apiKey, config.ai.modelName);
      case 'openai':
        return new OpenAIAIProvider(config.ai.apiKey, config.ai.modelName);
      case 'mock':
      default:
        return new MockAIProvider();
    }
  }

  /**
   * Dynamically switch AI provider at runtime
   */
  public setProvider(provider: IAIProvider) {
    this.provider = provider;
  }

  /**
   * Analyze question and record AI consumption in the ai_usage table
   */
  public async solveQuestion(
    userId: string,
    request: AISolverRequest,
    questionId?: string
  ): Promise<AISolverResponse> {
    const startTime = Date.now();
    try {
      const response = await this.provider.generateAnswer(request);

      // Record AI usage statistics
      await (prisma as any).aiUsage.create({
        data: {
          userId,
          modelName: response.modelName,
          inputTokens: response.tokensUsed.input,
          outputTokens: response.tokensUsed.output,
          requestStatus: 'SUCCESS',
        },
      });

      // If questionId provided, store suggested answer in suggested_answers table
      if (questionId) {
        await prisma.suggestedAnswer.create({
          data: {
            questionId,
            answerText: response.answerText,
            confidenceScore: response.confidenceScore,
            aiModel: response.modelName,
          },
        });
      }

      logger.info(
        `AI solved question for user ${userId} using ${response.modelName} in ${Date.now() - startTime}ms`
      );

      return response;
    } catch (error: any) {
      logger.error(`AI Service failed: ${error.message}`);

      // Record failed attempt
      await (prisma as any).aiUsage.create({
        data: {
          userId,
          modelName: config.ai.modelName,
          inputTokens: 0,
          outputTokens: 0,
          requestStatus: 'FAILED',
        },
      });

      throw error;
    }
  }
}

export const aiService = new AIService();
