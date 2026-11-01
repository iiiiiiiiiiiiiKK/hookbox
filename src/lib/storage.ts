export interface SavedInbox {
  id: string;
  token: string;
  createdAt: number;
  expiresAt: number;
  ttlHours: number;
  label: string | null;
}

const STORAGE_KEY = 'hookbox.inboxes.v1';
const MAX_SAVED = 8;

export function loadInboxes(): SavedInbox[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is SavedInbox => {
        if (!entry || typeof entry !== 'object') return false;
        const candidate = entry as Record<string, unknown>;
        return (
          typeof candidate.id === 'string' &&
          typeof candidate.token === 'string' &&
          typeof candidate.createdAt === 'number' &&
          typeof candidate.expiresAt === 'number'
        );
      })
      .map((entry) => ({
        ...entry,
        ttlHours: typeof entry.ttlHours === 'number' ? entry.ttlHours : 1,
        label: typeof entry.label === 'string' ? entry.label : null,
      }))
      .slice(0, MAX_SAVED);
  } catch {
    return [];
  }
}

export function persistInboxes(inboxes: SavedInbox[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(inboxes.slice(0, MAX_SAVED)));
  } catch {
    /* storage might be unavailable (private mode); the session still works */
  }
}

export function upsertInbox(inboxes: SavedInbox[], next: SavedInbox): SavedInbox[] {
  const without = inboxes.filter((entry) => entry.id !== next.id);
  return [next, ...without].slice(0, MAX_SAVED);
}

export function dropInbox(inboxes: SavedInbox[], id: string): SavedInbox[] {
  return inboxes.filter((entry) => entry.id !== id);
}
