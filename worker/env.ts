import type { LimitsInfo } from '../shared/types';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Server-side pepper for token + IP hashing. Required. */
  AUTH_PEPPER: string;
  /** Optional origin override used when building public webhook URLs. */
  PUBLIC_ORIGIN?: string;
  /** Optional comma separated list of extra allowed browser origins. */
  EXTRA_CORS_ORIGINS?: string;
}

export const APP_NAME = 'HookBox';
export const APP_VERSION = '1.0.0';

export const LIMITS: LimitsInfo & {
  inboxCreatePerIpPerDayWindowMs: number;
  ssePollIntervalMs: number;
  replayMaxHops: number;
  replayMaxBodyBytes: number;
  replayMaxResponsePreview: number;
  searchMaxWindow: number;
  sweepBatchSize: number;
  rateLimitRetentionMs: number;
  maxLabelLength: number;
  binaryPreviewBytes: number;
} = {
  /** Maximum accepted webhook body (256 KiB). Larger payloads get HTTP 413. */
  maxBodyBytes: 256 * 1024,
  /** Hard cap of stored requests per inbox. */
  maxRequestsPerInbox: 500,
  /** Hard cap of stored bytes per inbox (20 MiB). */
  maxStoragePerInboxBytes: 20 * 1024 * 1024,
  allowedTtlHours: [1, 6, 24],
  maxTtlHours: 24,
  webhookPerInboxPerMinute: 120,
  webhookPerIpPerMinute: 120,
  inboxCreatePerIpPerHour: 30,
  inboxCreatePerIpPerDay: 60,
  replayPerInboxPerMinute: 10,
  replayTimeoutMs: 10_000,
  listPageSizeMax: 100,
  sseMaxDurationMs: 25_000,
  inboxCreatePerIpPerDayWindowMs: 24 * 60 * 60 * 1000,
  ssePollIntervalMs: 1_200,
  replayMaxHops: 3,
  replayMaxBodyBytes: 64 * 1024,
  replayMaxResponsePreview: 4_096,
  searchMaxWindow: 1_000,
  sweepBatchSize: 50,
  rateLimitRetentionMs: 3 * 60 * 60 * 1000,
  maxLabelLength: 48,
  binaryPreviewBytes: 64,
};

export const INBOX_ID_BYTES = 12; // 96 bits → 16 base64url chars
export const INBOX_TOKEN_BYTES = 32; // 256 bits → 43 base64url chars

export function ttlHoursToMs(hours: number): number {
  return Math.round(hours * 60 * 60 * 1000);
}
