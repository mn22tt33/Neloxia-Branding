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

export type VerificationStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';
export type AnswerSource = 'AI_PROPOSED' | 'PLATFORM_CONFIRMED' | 'TEACHER_VERIFIED' | 'STUDENT_FEEDBACK' | 'HUMAN_REVIEW';

export interface QuestionKnowledgeRecord {
  id: string;
  questionHash: string;
  normalizedText: string;
  rawQuestionText: string;
  questionType: 'MULTIPLE_CHOICE' | 'TRUE_FALSE' | 'FILL_IN_BLANK' | 'SHORT_ANSWER' | 'ESSAY';
  options: string[];
  normalizedOptions: string[];
  proposedAnswer?: string | null;
  verifiedAnswer?: string | null;
  explanation?: string | null;
  platformName?: string | null;
  subjectName?: string | null;
  lessonName?: string | null;
  source: AnswerSource;
  confidenceScore: number;
  verificationStatus: VerificationStatus;
  occurrenceCount: number;
  retrievalCount: number;
  lastSeenAt: Date | string;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface QuestionCorrectionLogRecord {
  id: string;
  questionKnowledgeId: string;
  oldAnswer?: string | null;
  newAnswer: string;
  oldStatus: VerificationStatus;
  newStatus: VerificationStatus;
  source: AnswerSource;
  reason?: string | null;
  createdAt: Date | string;
}

export interface QuestionQuery {
  questionText: string;
  options?: string[];
  platformName?: string;
  subjectName?: string;
  lessonName?: string;
  questionType?: 'MULTIPLE_CHOICE' | 'TRUE_FALSE' | 'FILL_IN_BLANK' | 'SHORT_ANSWER' | 'ESSAY';
}

export interface SmartAnswerResult {
  answerText: string;
  confidenceScore: number;
  explanation?: string;
  isVerified: boolean;
  source: AnswerSource;
  fromKnowledgeBase: boolean;
  questionHash: string;
  matchedOptionIndex?: number;
  verificationStatus: VerificationStatus;
  latencyMs: number;
}

export interface LearningDashboardStats {
  totalQuestions: number;
  verifiedQuestions: number;
  pendingQuestions: number;
  rejectedQuestions: number;
  cacheHits: number;
  totalQueries: number;
  repetitionRate: number; // percentage 0 - 100
  avgResponseTimeMs: number;
  avgCacheLatencyMs: number;
  avgAILatencyMs: number;
  aiCallsSaved: number;
}
