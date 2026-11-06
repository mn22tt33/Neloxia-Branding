-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('STUDENT', 'ADMIN', 'INSTRUCTOR');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'INACTIVE');

-- CreateEnum
CREATE TYPE "PlatformStatus" AS ENUM ('ACTIVE', 'MAINTENANCE', 'DISABLED');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('INITIALIZING', 'RUNNING', 'IDLE', 'PAUSED', 'STOPPED', 'ERROR');

-- CreateEnum
CREATE TYPE "BrowserStatus" AS ENUM ('LAUNCHING', 'CONNECTED', 'BUSY', 'DISCONNECTED', 'CRASHED');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('MULTIPLE_CHOICE', 'TRUE_FALSE', 'FILL_IN_BLANK', 'SHORT_ANSWER', 'ESSAY');

-- CreateEnum
CREATE TYPE "AIRequestStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'RATE_LIMITED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'STUDENT',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "educational_platforms" (
    "id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "base_url" VARCHAR(500) NOT NULL,
    "login_url" VARCHAR(500) NOT NULL,
    "status" "PlatformStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "educational_platforms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_platform_accounts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "platform_id" UUID NOT NULL,
    "encrypted_credentials" TEXT,
    "credentials_reference" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_platform_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "browser_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "platform_id" UUID NOT NULL,
    "session_status" "SessionStatus" NOT NULL DEFAULT 'INITIALIZING',
    "browser_status" "BrowserStatus" NOT NULL DEFAULT 'LAUNCHING',
    "started_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "last_activity_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "browser_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "browser_events" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "event_type" VARCHAR(100) NOT NULL,
    "event_description" TEXT,
    "event_status" "EventStatus" NOT NULL DEFAULT 'SUCCESS',
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "browser_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "questions" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "question_text" TEXT NOT NULL,
    "question_type" "QuestionType" NOT NULL DEFAULT 'MULTIPLE_CHOICE',
    "question_image" TEXT,
    "extracted_options" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suggested_answers" (
    "id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "answer_text" TEXT NOT NULL,
    "confidence_score" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "ai_model" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suggested_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "model_name" VARCHAR(100) NOT NULL,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "request_status" "AIRequestStatus" NOT NULL DEFAULT 'SUCCESS',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "action" VARCHAR(150) NOT NULL,
    "ip_address" VARCHAR(45),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "student_platform_accounts_user_id_platform_id_key" ON "student_platform_accounts"("user_id", "platform_id");

-- CreateIndex
CREATE INDEX "browser_sessions_user_id_idx" ON "browser_sessions"("user_id");

-- CreateIndex
CREATE INDEX "browser_sessions_session_status_idx" ON "browser_sessions"("session_status");

-- CreateIndex
CREATE INDEX "browser_events_session_id_idx" ON "browser_events"("session_id");

-- CreateIndex
CREATE INDEX "browser_events_event_type_idx" ON "browser_events"("event_type");

-- CreateIndex
CREATE INDEX "questions_session_id_idx" ON "questions"("session_id");

-- CreateIndex
CREATE INDEX "suggested_answers_question_id_idx" ON "suggested_answers"("question_id");

-- CreateIndex
CREATE INDEX "ai_usage_user_id_idx" ON "ai_usage"("user_id");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs"("user_id");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- AddForeignKey
ALTER TABLE "student_platform_accounts" ADD CONSTRAINT "student_platform_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_platform_accounts" ADD CONSTRAINT "student_platform_accounts_platform_id_fkey" FOREIGN KEY ("platform_id") REFERENCES "educational_platforms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "browser_sessions" ADD CONSTRAINT "browser_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "browser_sessions" ADD CONSTRAINT "browser_sessions_platform_id_fkey" FOREIGN KEY ("platform_id") REFERENCES "educational_platforms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "browser_events" ADD CONSTRAINT "browser_events_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "browser_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "browser_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suggested_answers" ADD CONSTRAINT "suggested_answers_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
