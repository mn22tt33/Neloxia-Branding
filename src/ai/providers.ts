import { AISolverRequest, AISolverResponse } from '../types';

export interface IAIProvider {
  name: string;
  generateAnswer(request: AISolverRequest): Promise<AISolverResponse>;
}

export class MockAIProvider implements IAIProvider {
  name = 'mock';

  async generateAnswer(request: AISolverRequest): Promise<AISolverResponse> {
    const textLower = request.questionText.toLowerCase();

    let answer = 'Based on the question analysis, option (A) is the correct answer.';
    let confidence = 0.94;

    if (request.options && request.options.length > 0) {
      // Pick the best match or first option intelligently
      const firstOpt = request.options[0];
      answer = `The recommended solution is: "${firstOpt}". It satisfies all given constraints.`;
    } else if (textLower.includes('true') || textLower.includes('false')) {
      answer = 'True. The statement is verified by the underlying definition.';
      confidence = 0.98;
    }

    return {
      answerText: answer,
      confidenceScore: confidence,
      explanation: 'Detailed step-by-step verified conceptual resolution.',
      modelName: 'mock-solver-v1',
      tokensUsed: {
        input: Math.ceil(request.questionText.length / 4) + 20,
        output: 45,
      },
    };
  }
}

export class GeminiAIProvider implements IAIProvider {
  name = 'gemini';
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model: string = 'gemini-1.5-pro') {
    this.apiKey = apiKey;
    this.model = model;
  }

  async generateAnswer(request: AISolverRequest): Promise<AISolverResponse> {
    const prompt = `You are an educational assistant helping a student learn and understand questions.
Analyze the following question and options, and identify the correct answer with a short explanation.

Question:
${request.questionText}

${request.options && request.options.length > 0 ? `Options:\n${request.options.map((o, i) => `${i + 1}. ${o}`).join('\n')}` : ''}

Respond STRICTLY in JSON format with this exact structure:
{
  "answer": "<concise answer text or chosen option>",
  "confidence": <number between 0.0 and 1.0>,
  "explanation": "<brief 1-2 sentence educational explanation>",
  "questionType": "<MULTIPLE_CHOICE | TRUE_FALSE | SHORT_ANSWER | FILL_IN_BLANK>"
}`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
    const payload: any = {
      contents: [
        {
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json"
      }
    };

    if (request.imageData) {
      const cleanBase64 = request.imageData.replace(/^data:image\/\w+;base64,/, '');
      payload.contents[0].parts.push({
        inlineData: {
          mimeType: 'image/png',
          data: cleanBase64,
        },
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (err: any) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') {
        throw new Error('Gemini API request timed out after 20 seconds');
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API returned error ${response.status}: ${errText}`);
    }

    const data: any = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    let parsed: any = {};
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = { answer: rawText, confidence: 0.9, explanation: 'Direct model output' };
    }

    const inputTokens = data.usageMetadata?.promptTokenCount || 50;
    const outputTokens = data.usageMetadata?.candidatesTokenCount || 30;
    // Gemini 1.5 Pro estimated cost: ~$0.00125 / 1K in, $0.005 / 1K out
    const estimatedCostUSD = (inputTokens / 1000) * 0.00125 + (outputTokens / 1000) * 0.005;

    return {
      answerText: parsed.answer || rawText,
      confidenceScore: typeof parsed.confidence === 'number' ? parsed.confidence : 0.95,
      explanation: parsed.explanation || '',
      questionType: parsed.questionType || 'MULTIPLE_CHOICE',
      modelName: this.model,
      estimatedCostUSD: Number(estimatedCostUSD.toFixed(6)),
      tokensUsed: {
        input: inputTokens,
        output: outputTokens,
      },
    };
  }
}

export class OpenAIAIProvider implements IAIProvider {
  name = 'openai';
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model: string = 'gpt-4o-mini') {
    this.apiKey = apiKey;
    this.model = model;
  }

  async generateAnswer(request: AISolverRequest): Promise<AISolverResponse> {
    const messages: any[] = [
      {
        role: 'system',
        content: 'You are an educational tutor assisting a student. Analyze the question and provide the answer in JSON format: {"answer": "...", "confidence": 0.95, "explanation": "...", "questionType": "MULTIPLE_CHOICE"}. Do not return Markdown wrappers.',
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Question: ${request.questionText}\n${request.options ? `Options: ${JSON.stringify(request.options)}` : ''}`,
          },
        ],
      },
    ];

    if (request.imageData) {
      messages[1].content.push({
        type: 'image_url',
        image_url: { url: request.imageData.startsWith('data:') ? request.imageData : `data:image/png;base64,${request.imageData}` },
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    let response: Response;
    try {
      response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          response_format: { type: 'json_object' },
          max_tokens: 350,
        }),
        signal: controller.signal,
      });
    } catch (err: any) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') {
        throw new Error('OpenAI API request timed out after 20 seconds');
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI API Error: ${err}`);
    }

    const resJson: any = await response.json();
    const rawContent = resJson.choices?.[0]?.message?.content || '{}';
    let parsed: any = {};
    try {
      parsed = JSON.parse(rawContent);
    } catch {
      parsed = { answer: rawContent, confidence: 0.95 };
    }

    const inputTokens = resJson.usage?.prompt_tokens || 40;
    const outputTokens = resJson.usage?.completion_tokens || 20;
    // gpt-4o-mini estimated cost: ~$0.00015 / 1K in, $0.0006 / 1K out
    const estimatedCostUSD = (inputTokens / 1000) * 0.00015 + (outputTokens / 1000) * 0.0006;

    return {
      answerText: parsed.answer || rawContent,
      confidenceScore: typeof parsed.confidence === 'number' ? parsed.confidence : 0.96,
      explanation: parsed.explanation || '',
      questionType: parsed.questionType || 'MULTIPLE_CHOICE',
      modelName: this.model,
      estimatedCostUSD: Number(estimatedCostUSD.toFixed(6)),
      tokensUsed: {
        input: inputTokens,
        output: outputTokens,
      },
    };
  }
}
