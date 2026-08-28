-- CreateEnum
CREATE TYPE "AlertType" AS ENUM ('NO_PROGRESS', 'RATING_DECLINE', 'CONTEST_INACTIVE', 'NO_DATA', 'PROFILE_UNAVAILABLE', 'NO_PLATFORM_HANDLES', 'STALE_DATA');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ScheduledRunStatus" AS ENUM ('CLAIMED', 'STARTED', 'COMPLETED', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "student_alerts" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "type" "AlertType" NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "message" TEXT NOT NULL,
    "evidence" JSONB,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedById" TEXT,

    CONSTRAINT "student_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_runs" (
    "id" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "status" "ScheduledRunStatus" NOT NULL DEFAULT 'CLAIMED',
    "jobId" TEXT,
    "note" TEXT,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "scheduled_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "student_alerts_type_severity_idx" ON "student_alerts"("type", "severity");

-- CreateIndex
CREATE INDEX "student_alerts_acknowledgedAt_idx" ON "student_alerts"("acknowledgedAt");

-- CreateIndex
CREATE UNIQUE INDEX "student_alerts_studentId_type_key" ON "student_alerts"("studentId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "scheduled_runs_scheduledFor_key" ON "scheduled_runs"("scheduledFor");

-- CreateIndex
CREATE INDEX "scheduled_runs_scheduledFor_idx" ON "scheduled_runs"("scheduledFor");

-- AddForeignKey
ALTER TABLE "student_alerts" ADD CONSTRAINT "student_alerts_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_alerts" ADD CONSTRAINT "student_alerts_acknowledgedById_fkey" FOREIGN KEY ("acknowledgedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
