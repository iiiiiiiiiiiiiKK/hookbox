/**
 * Opaque pagination cursor: `base64url(receivedAt:id)`.
 * Kept dependency-free so it can be unit tested in isolation.
 */
export function encodeCursor(receivedAt: number, id: string): string {
  const bytes = new TextEncoder().encode(`${receivedAt}:${id}`);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeCursor(cursor: string): { receivedAt: number; id: string } | null {
  try {
    const normalized = cursor.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    const text = new TextDecoder().decode(bytes);
    const separator = text.indexOf(':');
    if (separator <= 0) return null;
    const receivedAt = Number.parseInt(text.slice(0, separator), 10);
    const id = text.slice(separator + 1);
    if (!Number.isFinite(receivedAt) || id.length === 0) return null;
    return { receivedAt, id };
  } catch {
    return null;
  }
}
