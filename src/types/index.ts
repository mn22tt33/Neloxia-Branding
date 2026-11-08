export interface JwtPayload {
  userId: string;
  email: string;
  role: string;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: string;
  status: string;
}

export interface ExtractedQuestionData {
  text: string;
  type: 'MULTIPLE_CHOICE' | 'TRUE_FALSE' | 'FILL_IN_BLANK' | 'SHORT_ANSWER' | 'ESSAY';
  options?: string[];
  image?: string; // Base64 or URL
}

export interface AISolverRequest {
  questionText: string;
  options?: string[];
  imageData?: string;
  context?: string;
}

export interface AISolverResponse {
  answerText: string;
  confidenceScore: number;
  explanation?: string;
  modelName: string;
  questionType?: string;
  estimatedCostUSD?: number;
  tokensUsed: {
    input: number;
    output: number;
  };
}

export interface BrowserInstanceInfo {
  sessionId: string;
  displayNumber: number;
  vncPort: number;
  novncPort: number;
  novncUrl: string;
  activeUrl: string;
  status: 'LAUNCHING' | 'CONNECTED' | 'BUSY' | 'DISCONNECTED' | 'CRASHED';
}
