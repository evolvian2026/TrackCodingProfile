-- CreateEnum
CREATE TYPE "RunTrigger" AS ENUM ('SCHEDULED', 'MANUAL');

-- AlterTable
ALTER TABLE "scheduled_runs" ADD COLUMN     "trigger" "RunTrigger" NOT NULL DEFAULT 'SCHEDULED';
