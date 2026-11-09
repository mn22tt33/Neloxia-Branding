-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AnswerSource" AS ENUM ('AI_PROPOSED', 'PLATFORM_CONFIRMED', 'TEACHER_VERIFIED', 'STUDENT_FEEDBACK', 'HUMAN_REVIEW');

-- CreateTable
CREATE TABLE "question_knowledge" (
    "id" UUID NOT NULL,
    "question_hash" VARCHAR(64) NOT NULL,
    "normalized_text" TEXT NOT NULL,
    "raw_question_text" TEXT NOT NULL,
    "question_type" "QuestionType" NOT NULL DEFAULT 'MULTIPLE_CHOICE',
    "options" JSONB NOT NULL,
    "normalized_options" JSONB NOT NULL,
    "proposed_answer" TEXT,
    "verified_answer" TEXT,
    "explanation" TEXT,
    "platform_name" VARCHAR(150),
    "subject_name" VARCHAR(150),
    "lesson_name" VARCHAR(150),
    "source" "AnswerSource" NOT NULL DEFAULT 'AI_PROPOSED',
    "confidence_score" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "verification_status" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "occurrence_count" INTEGER NOT NULL DEFAULT 1,
    "retrieval_count" INTEGER NOT NULL DEFAULT 0,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "question_knowledge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_correction_logs" (
    "id" UUID NOT NULL,
    "question_knowledge_id" UUID NOT NULL,
    "old_answer" TEXT,
    "new_answer" TEXT NOT NULL,
    "old_status" "VerificationStatus" NOT NULL,
    "new_status" "VerificationStatus" NOT NULL,
    "source" "AnswerSource" NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "question_correction_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "question_knowledge_question_hash_key" ON "question_knowledge"("question_hash");
CREATE INDEX "question_knowledge_question_hash_idx" ON "question_knowledge"("question_hash");
CREATE INDEX "question_knowledge_verification_status_idx" ON "question_knowledge"("verification_status");
CREATE INDEX "question_knowledge_platform_name_idx" ON "question_knowledge"("platform_name");
CREATE INDEX "question_knowledge_subject_name_lesson_name_idx" ON "question_knowledge"("subject_name", "lesson_name");

-- CreateIndex
CREATE INDEX "question_correction_logs_question_knowledge_id_idx" ON "question_correction_logs"("question_knowledge_id");

-- AddForeignKey
ALTER TABLE "question_correction_logs" ADD CONSTRAINT "question_correction_logs_question_knowledge_id_fkey" FOREIGN KEY ("question_knowledge_id") REFERENCES "question_knowledge"("id") ON DELETE CASCADE ON UPDATE CASCADE;
