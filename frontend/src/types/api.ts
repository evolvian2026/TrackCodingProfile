export type Platform = 'LEETCODE' | 'CODECHEF' | 'HACKERRANK' | 'CODEFORCES';

export type DataStatus =
  | 'PENDING'
  | 'AVAILABLE'
  | 'NOT_FOUND'
  | 'PRIVATE'
  | 'UNAVAILABLE'
  | 'ERROR'
  | 'RATE_LIMITED';

export type SkillLevel = 'NONE' | 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED' | 'EXPERT';

export type Role = 'ADMIN' | 'TRAINER' | 'VIEWER';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  lastLoginAt: string | null;
}

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Paginated<T> {
  data: T[];
  pagination: Pagination;
}

export interface StudentAnalytics {
  totalSolved: number;
  easySolved: number;
  mediumSolved: number;
  hardSolved: number;
  platformsActive: number;
  totalContests: number;
  bestRank: number | null;
  avgRank: number | null;
  bestRating: number | null;
  currentRating: number | null;
  topicCount: number;
  topicCoverage: number;
  cpScore: number;
  /** False when no platform returned usable data — render N/A, not 0. */
  hasData: boolean;
  /**
   * Whether any platform that returned data actually publishes this metric.
   * A student whose only working platform is CodeChef has `difficultyKnown`
   * and `topicsKnown` false — their Easy/Medium/Hard and topic counts are
   * unknown, not zero, and must render as N/A.
   */
  difficultyKnown: boolean;
  topicsKnown: boolean;
  contestsKnown: boolean;
  computedAt: string;
  scoreBreakdown?: ScoreBreakdown | null;
}

export interface ScoreComponent {
  key: string;
  label: string;
  weight: number;
  achievement: number;
  points: number;
  detail: string;
}

export interface ScoreBreakdown {
  score: number;
  components: ScoreComponent[];
  inputs: Record<string, number | null>;
  targets: Record<string, unknown>;
}

export interface PlatformProfile {
  id: string;
  platform: Platform;
  label: string;
  color: string;
  username: string;
  profileUrl: string;
  status: DataStatus;
  statusMessage: string | null;
  lastFetchedAt: string | null;
  lastSuccessAt: string | null;
  displayName: string | null;
  country: string | null;
  rating: number | null;
  maxRating: number | null;
  rankTitle: string | null;
  globalRank: number | null;
  countryRank: number | null;
  stars: string | null;
  reputation: number | null;
  contribution: number | null;
  totalSolved: number | null;
  easySolved: number | null;
  mediumSolved: number | null;
  hardSolved: number | null;
  problemsAttempted: number | null;
  totalSubmissions: number | null;
  acceptedSubmissions: number | null;
  acceptanceRate: number | null;
  contestsAttended: number | null;
  contestRating: number | null;
  contestGlobalRanking: number | null;
  problemSolvingScore: number | null;
  badges: unknown;
  certificates: unknown;
  domains: unknown;
  raw: Record<string, unknown> | null;
  capabilities: {
    hasDifficultyBreakdown: boolean;
    hasContests: boolean;
    hasTopics: boolean;
  };
}

export interface StudentSummary {
  id: string;
  studentId: string;
  name: string;
  email: string | null;
  college: string | null;
  batch: string | null;
  branch: string | null;
  section: string | null;
  analytics: StudentAnalytics | null;
  platforms: {
    platform: Platform;
    label: string;
    username: string;
    status: DataStatus;
    statusMessage: string | null;
    totalSolved: number | null;
    rating: number | null;
    lastSuccessAt: string | null;
  }[];
}

export interface TopicCount {
  topic: string;
  problemsSolved: number;
}

export interface StudentSkill {
  id: string;
  topic: string;
  level: SkillLevel;
  score: number;
  problemsSolved: number;
  platformCount: number;
}

export interface StudentDetail {
  id: string;
  studentId: string;
  name: string;
  email: string | null;
  phone: string | null;
  university: string | null;
  college: string | null;
  batch: string | null;
  branch: string | null;
  section: string | null;
  notes: string | null;
  analytics: StudentAnalytics | null;
  platforms: PlatformProfile[];
  topics: TopicCount[];
  skills: StudentSkill[];
  contestCount: number;
  lastRefreshedAt: string | null;
}

export interface ContestRow {
  id: string;
  platform: Platform;
  name: string;
  url: string | null;
  date: string | null;
  rank: number | null;
  ratingBefore: number | null;
  ratingAfter: number | null;
  ratingChange: number | null;
  problemsSolved: number | null;
}

export interface ContestResponse {
  data: ContestRow[];
  summary: {
    total: number;
    byPlatform: { platform: Platform; label: string; color: string; count: number }[];
    bestRank: number | null;
    averageRank: number | null;
  };
}

export interface RatingSeries {
  platform: Platform;
  label: string;
  color: string;
  points: { date: string; rating: number; contestName: string | null }[];
  current: number | null;
  peak: number | null;
}

export interface HistoryPoint {
  date: string;
  totalSolved: number | null;
  easySolved: number | null;
  mediumSolved: number | null;
  hardSolved: number | null;
  rating: number | null;
  contestsAttended: number | null;
  topicCount: number | null;
  cpScore: number | null;
}

export interface LeaderboardRow {
  rank: number;
  id: string;
  studentId: string;
  name: string;
  college: string | null;
  batch: string | null;
  branch: string | null;
  section: string | null;
  totalSolved: number;
  easySolved: number;
  mediumSolved: number;
  hardSolved: number;
  currentRating: number | null;
  bestRating: number | null;
  totalContests: number;
  topicCount: number;
  topicCoverage: number;
  cpScore: number;
  platformsActive: number;
  difficultyKnown: boolean;
  topicsKnown: boolean;
  contestsKnown: boolean;
  platforms: { platform: Platform; status: DataStatus; totalSolved: number | null; rating: number | null }[];
}

export interface Distribution {
  count: number;
  average: number | null;
  median: number | null;
  min: number | null;
  max: number | null;
}

export interface PlatformOverview {
  platform: Platform;
  label: string;
  color: string;
  linked: number;
  available: number;
  pending: number;
  notFound: number;
  private: number;
  unavailable: number;
  rateLimited: number;
  error: number;
  lastRefreshedAt: string | null;
}

export interface Overview {
  totalStudents: number;
  studentsWithData: number;
  studentsWithoutData: number;
  activeJobs: number;
  distributions: Record<string, Distribution>;
  platforms: PlatformOverview[];
  recentJobs: JobSummary[];
}

export type JobStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'COMPLETED_WITH_ERRORS' | 'FAILED' | 'CANCELLED';

export interface JobSummary {
  id: string;
  number: number;
  type: string;
  status: JobStatus;
  totalItems: number;
  processed: number;
  successful: number;
  failed: number;
  rateLimited: number;
  createdAt: string;
  percentage?: number;
}

export interface JobProgress {
  id: string;
  number: number;
  type: string;
  status: JobStatus;
  totalStudents: number;
  totalItems: number;
  processed: number;
  successful: number;
  failed: number;
  rateLimited: number;
  skipped: number;
  pending: number;
  percentage: number;
  currentStudent: string | null;
  studentsProcessed: number;
  studentsRemaining: number;
  platformStatus: {
    platform: Platform;
    label: string;
    color: string;
    total: number;
    successful: number;
    failed: number;
    rateLimited: number;
    pending: number;
  }[];
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  error: string | null;
}

export interface JobItem {
  id: string;
  student: { id: string; studentId: string; name: string };
  platform: Platform;
  platformLabel: string;
  status: string;
  dataStatus: DataStatus | null;
  attempts: number;
  error: string | null;
  durationMs: number | null;
  lastAttempt: string | null;
}

export interface BatchAnalytics {
  batch: string;
  studentCount: number;
  studentsWithData: number;
  averages: Record<string, Distribution>;
  highlights: {
    topStudent: LeaderboardSlice | null;
    mostProblemsSolved: LeaderboardSlice | null;
    highestRating: LeaderboardSlice | null;
  };
  top10: LeaderboardSlice[];
  bottom10: LeaderboardSlice[];
  platformAdoption: { platform: Platform; label: string; color: string; linked: number; available: number; adoptionRate: number }[];
  strengths: TopicAnalyticsRow[];
  weaknesses: TopicAnalyticsRow[];
}

export interface LeaderboardSlice {
  rank: number;
  id: string;
  studentId: string;
  name: string;
  college: string | null;
  batch: string | null;
  branch: string | null;
  cpScore: number;
  totalSolved: number;
  currentRating: number | null;
  bestRating: number | null;
  totalContests: number;
  topicCount: number;
}

export interface TopicAnalyticsRow {
  topic: string;
  problemsSolved: number;
  studentCount: number;
  share: number;
}

export interface TopicAnalytics {
  topics: TopicAnalyticsRow[];
  heatmap: { platform: Platform; label: string; color: string; topics: TopicCount[] }[];
  totalSolved: number;
}

export interface DifficultyAnalytics {
  difficulty: { easy: number; medium: number; hard: number; unclassified: number; total: number };
  byPlatform: {
    platform: Platform;
    label: string;
    color: string;
    studentsWithData: number;
    totalSolved: number | null;
    easySolved: number | null;
    mediumSolved: number | null;
    hardSolved: number | null;
    supportsDifficulty: boolean;
  }[];
}

export interface InstitutionRow {
  name: string;
  studentCount: number;
  studentsWithData: number;
  averageScore: number;
  averageProblemsSolved: number;
  averageRating: number | null;
  averageContests: number;
  averageTopicCoverage: number;
}

export interface FilterOptions {
  universities: string[];
  colleges: string[];
  batches: string[];
  branches: string[];
  sections: string[];
  platforms: { key: Platform; label: string; color: string }[];
}

export type StudentField =
  | 'student_id' | 'name' | 'email' | 'phone' | 'university' | 'college' | 'batch'
  | 'branch' | 'section' | 'leetcode_username' | 'codechef_username'
  | 'hackerrank_username' | 'codeforces_username';

export type ColumnMapping = Record<string, StudentField | null>;

export interface RowIssue {
  row: number;
  field?: string;
  severity: 'error' | 'warning';
  code: string;
  message: string;
}

export interface UploadPreview {
  uploadId: string;
  originalName: string;
  sheetName: string;
  availableSheets: string[];
  headerRowNumber: number;
  headers: string[];
  totalRows: number;
  previewRows: Record<string, string>[];
  suggestedMapping: ColumnMapping;
  mappingValidation: {
    valid: boolean;
    missingRequired: string[];
    duplicateTargets: string[];
    mappedPlatforms: string[];
    warnings: string[];
  };
  validation: {
    rows: { row: number; valid: boolean; errors: RowIssue[]; warnings: RowIssue[] }[];
    totalRows: number;
    validRows: number;
    invalidRows: number;
    duplicateStudentIds: string[];
    duplicateUsernames: { platform: Platform; username: string; rows: number[] }[];
    issues: RowIssue[];
    summary: {
      errorCount: number;
      warningCount: number;
      platformCounts: Record<Platform, number>;
      rowsWithNoPlatform: number;
    };
  };
}

export interface CommitResult {
  uploadId: string;
  created: number;
  updated: number;
  skipped: number;
  profilesLinked: number;
  job?: { jobId: string; number: number; totalStudents: number; totalItems: number };
  jobError?: string;
}

export interface FieldDefinition {
  field: StudentField;
  label: string;
  required: boolean;
  description: string;
  aliases: string[];
}

export interface AppSettings {
  'scoring.weights': Record<string, number>;
  'scoring.targets': Record<string, number | Record<string, number>>;
  'skills.thresholds': Record<string, number>;
  'processing.limits': Record<string, number | Record<string, number>>;
  'cache.settings': Record<string, number>;
  'ui.platformColors': Record<Platform, { light: string; dark: string }>;
}

export interface SettingsResponse {
  data: AppSettings;
  defaults: AppSettings;
  runtime: {
    dataSource: 'mock' | 'live';
    queueDriver: 'redis' | 'inline';
    maxUploadMb: number;
    maxUploadRows: number;
    rateLimiters: Record<string, { penaltyRemainingMs: number }>;
  };
}

export interface PlatformMeta {
  key: Platform;
  label: string;
  color: string;
  usernameField: string;
  capabilities: { hasDifficultyBreakdown: boolean; hasContests: boolean; hasTopics: boolean };
  defaultRateLimitPerMinute: number;
  dataSourceNote: string;
}
