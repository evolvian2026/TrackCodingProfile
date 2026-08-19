-- AlterTable
ALTER TABLE "student_analytics" ADD COLUMN     "contestsKnown" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "difficultyKnown" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "topicsKnown" BOOLEAN NOT NULL DEFAULT false;
