-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'TRAINER', 'VIEWER');

-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('LEETCODE', 'CODECHEF', 'HACKERRANK', 'CODEFORCES');

-- CreateEnum
CREATE TYPE "DataStatus" AS ENUM ('PENDING', 'AVAILABLE', 'NOT_FOUND', 'PRIVATE', 'UNAVAILABLE', 'ERROR', 'RATE_LIMITED');

-- CreateEnum
CREATE TYPE "Difficulty" AS ENUM ('EASY', 'MEDIUM', 'HARD', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('UPLOAD_IMPORT', 'REFRESH_SELECTED', 'REFRESH_BATCH', 'REFRESH_ALL', 'REFRESH_PLATFORM', 'RETRY_FAILED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "JobItemStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'RATE_LIMITED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "SkillLevel" AS ENUM ('NONE', 'BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'VIEWER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "students" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "university" TEXT,
    "college" TEXT,
    "batch" TEXT,
    "branch" TEXT,
    "section" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_profiles" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "username" TEXT NOT NULL,
    "profileUrl" TEXT,
    "status" "DataStatus" NOT NULL DEFAULT 'PENDING',
    "statusMessage" TEXT,
    "lastFetchedAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "fetchDurationMs" INTEGER,
    "displayName" TEXT,
    "country" TEXT,
    "avatarUrl" TEXT,
    "rating" INTEGER,
    "maxRating" INTEGER,
    "rankTitle" TEXT,
    "maxRankTitle" TEXT,
    "globalRank" INTEGER,
    "countryRank" INTEGER,
    "stars" TEXT,
    "reputation" INTEGER,
    "contribution" INTEGER,
    "friendCount" INTEGER,
    "totalSolved" INTEGER,
    "easySolved" INTEGER,
    "mediumSolved" INTEGER,
    "hardSolved" INTEGER,
    "problemsAttempted" INTEGER,
    "totalSubmissions" INTEGER,
    "acceptedSubmissions" INTEGER,
    "acceptanceRate" DOUBLE PRECISION,
    "contestsAttended" INTEGER,
    "contestRating" INTEGER,
    "contestGlobalRanking" INTEGER,
    "contestTopPercentage" DOUBLE PRECISION,
    "problemSolvingScore" DOUBLE PRECISION,
    "badges" JSONB,
    "certificates" JSONB,
    "skills" JSONB,
    "domains" JSONB,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "problems" (
    "id" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT,
    "difficulty" "Difficulty" NOT NULL DEFAULT 'UNKNOWN',
    "points" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "problems_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "topics" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,

    CONSTRAINT "topics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "problem_topics" (
    "problemId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,

    CONSTRAINT "problem_topics_pkey" PRIMARY KEY ("problemId","topicId")
);

-- CreateTable
CREATE TABLE "student_problems" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "solvedAt" TIMESTAMP(3),
    "attempts" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_problems_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_topics" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "topic" TEXT NOT NULL,
    "problemsSolved" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_topics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contests" (
    "id" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startTime" TIMESTAMP(3),
    "url" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contest_results" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "rank" INTEGER,
    "ratingBefore" INTEGER,
    "ratingAfter" INTEGER,
    "ratingChange" INTEGER,
    "problemsSolved" INTEGER,
    "participatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contest_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rating_history" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "rating" INTEGER NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'snapshot',
    "contestName" TEXT,

    CONSTRAINT "rating_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_snapshots" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "platform" "Platform",
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalSolved" INTEGER,
    "easySolved" INTEGER,
    "mediumSolved" INTEGER,
    "hardSolved" INTEGER,
    "rating" INTEGER,
    "maxRating" INTEGER,
    "globalRank" INTEGER,
    "contestsAttended" INTEGER,
    "topicCount" INTEGER,
    "cpScore" DOUBLE PRECISION,
    "metrics" JSONB,

    CONSTRAINT "data_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "upload_batches" (
    "id" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "storedPath" TEXT,
    "sizeBytes" INTEGER NOT NULL,
    "sheetName" TEXT,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "validRows" INTEGER NOT NULL DEFAULT 0,
    "invalidRows" INTEGER NOT NULL DEFAULT 0,
    "duplicateRows" INTEGER NOT NULL DEFAULT 0,
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "mapping" JSONB,
    "headers" JSONB,
    "issues" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "upload_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processing_jobs" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "type" "JobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "platforms" "Platform"[],
    "totalStudents" INTEGER NOT NULL DEFAULT 0,
    "totalItems" INTEGER NOT NULL DEFAULT 0,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "successful" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "rateLimited" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "currentStudent" TEXT,
    "forceRefresh" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "options" JSONB,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "uploadBatchId" TEXT,

    CONSTRAINT "processing_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processing_job_items" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "status" "JobItemStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "dataStatus" "DataStatus",
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "processing_job_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_errors" (
    "id" TEXT NOT NULL,
    "studentId" TEXT,
    "jobId" TEXT,
    "platform" "Platform" NOT NULL,
    "status" "DataStatus" NOT NULL,
    "message" TEXT NOT NULL,
    "context" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_errors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_analytics" (
    "studentId" TEXT NOT NULL,
    "totalSolved" INTEGER NOT NULL DEFAULT 0,
    "easySolved" INTEGER NOT NULL DEFAULT 0,
    "mediumSolved" INTEGER NOT NULL DEFAULT 0,
    "hardSolved" INTEGER NOT NULL DEFAULT 0,
    "platformsActive" INTEGER NOT NULL DEFAULT 0,
    "totalContests" INTEGER NOT NULL DEFAULT 0,
    "bestRank" INTEGER,
    "avgRank" DOUBLE PRECISION,
    "bestRating" INTEGER,
    "currentRating" INTEGER,
    "topicCount" INTEGER NOT NULL DEFAULT 0,
    "topicCoverage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cpScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "scoreBreakdown" JSONB,
    "hasData" BOOLEAN NOT NULL DEFAULT false,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_analytics_pkey" PRIMARY KEY ("studentId")
);

-- CreateTable
CREATE TABLE "student_skills" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "level" "SkillLevel" NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "problemsSolved" INTEGER NOT NULL,
    "platformCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "platform_cache" (
    "key" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "DataStatus" NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_cache_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "students_studentId_key" ON "students"("studentId");

-- CreateIndex
CREATE INDEX "students_college_idx" ON "students"("college");

-- CreateIndex
CREATE INDEX "students_batch_idx" ON "students"("batch");

-- CreateIndex
CREATE INDEX "students_branch_idx" ON "students"("branch");

-- CreateIndex
CREATE INDEX "students_section_idx" ON "students"("section");

-- CreateIndex
CREATE INDEX "students_university_idx" ON "students"("university");

-- CreateIndex
CREATE INDEX "students_name_idx" ON "students"("name");

-- CreateIndex
CREATE INDEX "students_email_idx" ON "students"("email");

-- CreateIndex
CREATE INDEX "platform_profiles_platform_status_idx" ON "platform_profiles"("platform", "status");

-- CreateIndex
CREATE INDEX "platform_profiles_platform_username_idx" ON "platform_profiles"("platform", "username");

-- CreateIndex
CREATE INDEX "platform_profiles_rating_idx" ON "platform_profiles"("rating");

-- CreateIndex
CREATE INDEX "platform_profiles_totalSolved_idx" ON "platform_profiles"("totalSolved");

-- CreateIndex
CREATE UNIQUE INDEX "platform_profiles_studentId_platform_key" ON "platform_profiles"("studentId", "platform");

-- CreateIndex
CREATE INDEX "problems_platform_difficulty_idx" ON "problems"("platform", "difficulty");

-- CreateIndex
CREATE UNIQUE INDEX "problems_platform_externalId_key" ON "problems"("platform", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "topics_name_key" ON "topics"("name");

-- CreateIndex
CREATE UNIQUE INDEX "topics_slug_key" ON "topics"("slug");

-- CreateIndex
CREATE INDEX "problem_topics_topicId_idx" ON "problem_topics"("topicId");

-- CreateIndex
CREATE INDEX "student_problems_studentId_platform_idx" ON "student_problems"("studentId", "platform");

-- CreateIndex
CREATE INDEX "student_problems_studentId_solvedAt_idx" ON "student_problems"("studentId", "solvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "student_problems_studentId_problemId_key" ON "student_problems"("studentId", "problemId");

-- CreateIndex
CREATE INDEX "student_topics_topic_idx" ON "student_topics"("topic");

-- CreateIndex
CREATE INDEX "student_topics_studentId_idx" ON "student_topics"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "student_topics_studentId_platform_topic_key" ON "student_topics"("studentId", "platform", "topic");

-- CreateIndex
CREATE INDEX "contests_platform_startTime_idx" ON "contests"("platform", "startTime");

-- CreateIndex
CREATE UNIQUE INDEX "contests_platform_externalId_key" ON "contests"("platform", "externalId");

-- CreateIndex
CREATE INDEX "contest_results_studentId_platform_idx" ON "contest_results"("studentId", "platform");

-- CreateIndex
CREATE INDEX "contest_results_studentId_participatedAt_idx" ON "contest_results"("studentId", "participatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "contest_results_studentId_contestId_key" ON "contest_results"("studentId", "contestId");

-- CreateIndex
CREATE INDEX "rating_history_studentId_platform_recordedAt_idx" ON "rating_history"("studentId", "platform", "recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "rating_history_studentId_platform_recordedAt_source_key" ON "rating_history"("studentId", "platform", "recordedAt", "source");

-- CreateIndex
CREATE INDEX "data_snapshots_studentId_platform_capturedAt_idx" ON "data_snapshots"("studentId", "platform", "capturedAt");

-- CreateIndex
CREATE INDEX "data_snapshots_capturedAt_idx" ON "data_snapshots"("capturedAt");

-- CreateIndex
CREATE INDEX "upload_batches_createdAt_idx" ON "upload_batches"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "processing_jobs_number_key" ON "processing_jobs"("number");

-- CreateIndex
CREATE INDEX "processing_jobs_status_createdAt_idx" ON "processing_jobs"("status", "createdAt");

-- CreateIndex
CREATE INDEX "processing_job_items_jobId_status_idx" ON "processing_job_items"("jobId", "status");

-- CreateIndex
CREATE INDEX "processing_job_items_status_idx" ON "processing_job_items"("status");

-- CreateIndex
CREATE UNIQUE INDEX "processing_job_items_jobId_studentId_platform_key" ON "processing_job_items"("jobId", "studentId", "platform");

-- CreateIndex
CREATE INDEX "platform_errors_platform_occurredAt_idx" ON "platform_errors"("platform", "occurredAt");

-- CreateIndex
CREATE INDEX "platform_errors_studentId_idx" ON "platform_errors"("studentId");

-- CreateIndex
CREATE INDEX "platform_errors_jobId_idx" ON "platform_errors"("jobId");

-- CreateIndex
CREATE INDEX "student_analytics_cpScore_idx" ON "student_analytics"("cpScore");

-- CreateIndex
CREATE INDEX "student_analytics_totalSolved_idx" ON "student_analytics"("totalSolved");

-- CreateIndex
CREATE INDEX "student_analytics_currentRating_idx" ON "student_analytics"("currentRating");

-- CreateIndex
CREATE INDEX "student_skills_studentId_idx" ON "student_skills"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "student_skills_studentId_topic_key" ON "student_skills"("studentId", "topic");

-- CreateIndex
CREATE INDEX "platform_cache_platform_expiresAt_idx" ON "platform_cache"("platform", "expiresAt");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_profiles" ADD CONSTRAINT "platform_profiles_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "problem_topics" ADD CONSTRAINT "problem_topics_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "problems"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "problem_topics" ADD CONSTRAINT "problem_topics_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_problems" ADD CONSTRAINT "student_problems_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_problems" ADD CONSTRAINT "student_problems_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "problems"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_topics" ADD CONSTRAINT "student_topics_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_results" ADD CONSTRAINT "contest_results_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_results" ADD CONSTRAINT "contest_results_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "contests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rating_history" ADD CONSTRAINT "rating_history_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_snapshots" ADD CONSTRAINT "data_snapshots_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upload_batches" ADD CONSTRAINT "upload_batches_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_uploadBatchId_fkey" FOREIGN KEY ("uploadBatchId") REFERENCES "upload_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing_job_items" ADD CONSTRAINT "processing_job_items_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "processing_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing_job_items" ADD CONSTRAINT "processing_job_items_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_errors" ADD CONSTRAINT "platform_errors_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_errors" ADD CONSTRAINT "platform_errors_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "processing_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_analytics" ADD CONSTRAINT "student_analytics_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_skills" ADD CONSTRAINT "student_skills_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;
