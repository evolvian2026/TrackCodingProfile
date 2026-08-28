-- CreateEnum
CREATE TYPE "GoalMetric" AS ENUM ('PROBLEMS_SOLVED', 'CONTESTS_ATTENDED', 'CP_SCORE', 'CONTEST_RATING', 'TOPICS_COVERED');

-- CreateTable
CREATE TABLE "goals" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "university" TEXT,
    "college" TEXT,
    "batch" TEXT,
    "branch" TEXT,
    "section" TEXT,
    "startsOn" TIMESTAMP(3) NOT NULL,
    "dueOn" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goal_targets" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "metric" "GoalMetric" NOT NULL,
    "target" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "goal_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_share_links" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "lastViewedAt" TIMESTAMP(3),
    "viewCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "student_share_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "goals_isActive_dueOn_idx" ON "goals"("isActive", "dueOn");

-- CreateIndex
CREATE INDEX "goals_batch_idx" ON "goals"("batch");

-- CreateIndex
CREATE INDEX "goals_college_idx" ON "goals"("college");

-- CreateIndex
CREATE UNIQUE INDEX "goal_targets_goalId_metric_key" ON "goal_targets"("goalId", "metric");

-- CreateIndex
CREATE UNIQUE INDEX "student_share_links_studentId_key" ON "student_share_links"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "student_share_links_tokenHash_key" ON "student_share_links"("tokenHash");

-- CreateIndex
CREATE INDEX "student_share_links_revokedAt_idx" ON "student_share_links"("revokedAt");

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_targets" ADD CONSTRAINT "goal_targets_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "goals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_share_links" ADD CONSTRAINT "student_share_links_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_share_links" ADD CONSTRAINT "student_share_links_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
