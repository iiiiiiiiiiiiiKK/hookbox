/**
 * Types shared by the Worker API and the React client.
 * Keep this file dependency-free so both build targets can import it.
 */

export type BodyKind = 'empty' | 'json' | 'xml' | 'form' | 'multipart' | 'text' | 'binary';

export type InboxStatus = 'active' | 'expired' | 'deleted';

/** `[key, value]` pair; order and original casing are preserved. */
export type Pair = [string, string];

export interface InboxPublic {
  id: string;
  label: string | null;
  createdAt: number;
  expiresAt: number;
  status: InboxStatus;
  requestCount: number;
  storageBytes: number;
  webhookUrl: string;
}

export interface MultipartPart {
  name: string;
  filename: string | null;
  contentType: string | null;
  size: number;
  preview: string;
  truncated: boolean;
}

export interface RequestBodyView {
  kind: BodyKind;
  /** Decoded UTF-8 payload (may be redacted when `revealed` is false). */
  text?: string;
  /** Base64 payload for binary bodies, only sent when explicitly revealed. */
  base64?: string;
  /** Parsed multipart parts (metadata only). */
  parts?: MultipartPart[];
  /** Hex preview for binary payloads. */
  hexPreview?: string;
  size: number;
  truncated: boolean;
  redacted: boolean;
}

export interface RequestSummary {
  id: string;
  method: string;
  path: string;
  receivedAt: number;
  bodyKind: BodyKind;
  bodySize: number;
  contentType: string | null;
  statusCode: number;
  queryPairCount: number;
  headerPairCount: number;
}

export interface RequestDetail extends RequestSummary {
  query: Pair[];
  headers: Pair[];
  body: RequestBodyView;
  sourceIp: string | null;
  userAgent: string | null;
  revealed: boolean;
  completed: boolean;
}

export interface ListRequestsResponse {
  requests: RequestSummary[];
  nextCursor: string | null;
  total: number;
  filtered: number;
}

export interface CreateInboxResponse {
  inbox: InboxPublic;
  /** Bearer token. Only ever returned once, at creation time. */
  token: string;
}

export interface ExtendInboxResponse {
  inbox: InboxPublic;
  extendedByMs: number;
  cappedAt: number;
}

export interface ReplayResult {
  status: number;
  statusText: string;
  durationMs: number;
  hops: number;
  finalUrl: string;
  requestHeaders: Pair[];
  responseHeaders: Pair[];
  bodyPreview: string;
  bodyPreviewTruncated: boolean;
  bodyBytes: number;
}

export interface LimitsInfo {
  maxBodyBytes: number;
  maxRequestsPerInbox: number;
  maxStoragePerInboxBytes: number;
  allowedTtlHours: number[];
  maxTtlHours: number;
  webhookPerInboxPerMinute: number;
  webhookPerIpPerMinute: number;
  inboxCreatePerIpPerHour: number;
  inboxCreatePerIpPerDay: number;
  replayPerInboxPerMinute: number;
  replayTimeoutMs: number;
  listPageSizeMax: number;
  sseMaxDurationMs: number;
}

export interface MetaResponse {
  name: string;
  version: string;
  serverTime: number;
  limits: LimitsInfo;
  features: {
    realtime: 'sse';
    replay: boolean;
    redaction: boolean;
    exports: boolean;
  };
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    retryAfterMs?: number;
    details?: Record<string, unknown>;
  };
}

export interface StreamHelloEvent {
  inboxId: string;
  serverTime: number;
  cursor: string | null;
  pollIntervalMs: number;
}

export interface StreamRequestsEvent {
  requests: RequestSummary[];
  cursor: string;
}
