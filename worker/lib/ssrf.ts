import { HttpError } from './http';

/**
 * SSRF protection for the replay feature.
 *
 * HookBox is *not* an open proxy: a replay target must be a public HTTP(S)
 * endpoint. The checks below run on the literal host, then again on every DNS
 * answer, and every redirect hop is re-validated from scratch.
 */

const BLOCKED_V4: Array<[string, number]> = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local + cloud metadata
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast
];

const ALLOWED_PORTS = new Set([80, 443]);

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
  'kubernetes.default',
  'kubernetes.default.svc',
  'host.docker.internal',
  'gateway.docker.internal',
]);

export function parseIpv4(input: string): number | null {
  const parts = input.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = value * 256 + n;
  }
  return value >>> 0;
}

function ipv4InCidr(ip: number, base: string, bits: number): boolean {
  const baseValue = parseIpv4(base);
  if (baseValue === null) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ip & mask) === (baseValue & mask);
}

export function isBlockedIpv4(ip: string): boolean {
  const value = parseIpv4(ip);
  if (value === null) return true;
  return BLOCKED_V4.some(([base, bits]) => ipv4InCidr(value, base, bits));
}

export function isBlockedIpv6(input: string): boolean {
  const ip = input.trim().toLowerCase().split('%')[0]!;
  if (ip === '::' || ip === '::1') return true;

  // IPv4-mapped (::ffff:127.0.0.1) and NAT64 (64:ff9b::7f00:1) forms.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (mapped) return isBlockedIpv4(mapped[1]!);
  const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(ip);
  if (mappedHex) {
    const hi = Number.parseInt(mappedHex[1]!, 16);
    const lo = Number.parseInt(mappedHex[2]!, 16);
    return isBlockedIpv4(`${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`);
  }
  const nat64 = /^64:ff9b::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(ip);
  if (nat64) {
    const hi = Number.parseInt(nat64[1]!, 16);
    const lo = Number.parseInt(nat64[2]!, 16);
    return isBlockedIpv4(`${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`);
  }
  // NAT64 / IPv4-embedded forms written with a dotted quad.
  const embeddedV4 = /^(?:64:ff9b::|::ffff:)(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (embeddedV4) return isBlockedIpv4(embeddedV4[1]!);

  if (ip.startsWith('fc') || ip.startsWith('fd')) return true; // unique local fc00::/7
  if (/^fe[89ab]/.test(ip)) return true; // link local fe80::/10
  if (ip.startsWith('ff')) return true; // multicast
  if (ip.startsWith('2001:db8')) return true; // documentation
  if (ip.startsWith('::')) return true; // unspecified / other short forms
  return false;
}

export function isBlockedAddress(address: string): boolean {
  return address.includes(':') ? isBlockedIpv6(address) : isBlockedIpv4(address);
}

interface DohAnswer {
  Answer?: Array<{ name: string; type: number; data: string }>;
}

async function queryDoh(hostname: string, type: 'A' | 'AAAA'): Promise<string[]> {
  const endpoints = [
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=${type}`,
    `https://dns.google/resolve?name=${encodeURIComponent(hostname)}&type=${type}`,
  ];
  let lastError: unknown = null;
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        headers: { accept: 'application/dns-json' },
        signal: AbortSignal.timeout(4_000),
      });
      if (!response.ok) {
        lastError = new Error(`DNS resolver returned ${response.status}`);
        continue;
      }
      const payload = (await response.json()) as DohAnswer;
      const answers = (payload.Answer ?? [])
        .filter((entry) => (type === 'A' ? entry.type === 1 : entry.type === 28))
        .map((entry) => entry.data.trim());
      if (answers.length > 0) return answers;
    } catch (error) {
      lastError = error;
    }
  }
  throw new HttpError(
    400,
    'unresolvable_target',
    `Could not resolve host "${hostname}"${lastError instanceof Error ? `: ${lastError.message}` : ''}`,
  );
}

export async function resolveHostAddresses(hostname: string): Promise<string[]> {
  const literalV4 = parseIpv4(hostname);
  if (literalV4 !== null) return [hostname];
  if (hostname.includes(':')) return [hostname];

  const [v4, v6] = await Promise.all([
    queryDoh(hostname, 'A').catch(() => [] as string[]),
    queryDoh(hostname, 'AAAA').catch(() => [] as string[]),
  ]);
  const addresses = [...v4, ...v6];
  if (addresses.length === 0) {
    throw new HttpError(
      400,
      'unresolvable_target',
      `Host "${hostname}" did not resolve to any address`,
    );
  }
  return addresses;
}

export interface ValidatedTarget {
  url: URL;
  addresses: string[];
}

/**
 * Validates a replay target. Throws `HttpError` with a user facing message when
 * the target is not a public HTTP(S) endpoint.
 */
export async function validateTarget(rawUrl: string): Promise<ValidatedTarget> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new HttpError(
      400,
      'invalid_target_url',
      'Target URL must be an absolute http:// or https:// URL',
    );
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new HttpError(400, 'blocked_scheme', 'Only http:// and https:// targets are allowed');
  }
  if (url.username || url.password) {
    throw new HttpError(
      400,
      'blocked_credentials',
      'Credentials in the target URL are not allowed',
    );
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!hostname) throw new HttpError(400, 'invalid_target_url', 'Target URL is missing a hostname');

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new HttpError(400, 'blocked_host', `Target host "${hostname}" is not allowed`);
  }
  if (
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.home.arpa')
  ) {
    throw new HttpError(400, 'blocked_host', `Target host "${hostname}" is not allowed`);
  }

  // Cheap checks before spending a DNS round trip on obviously invalid ports.
  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
  if (!ALLOWED_PORTS.has(port)) {
    throw new HttpError(400, 'blocked_port', `Only ports 80 and 443 are allowed, received ${port}`);
  }

  const addresses = await resolveHostAddresses(hostname);
  const blocked = addresses.filter((address) => isBlockedAddress(address));
  if (blocked.length > 0) {
    throw new HttpError(
      400,
      'blocked_address',
      `Target resolves to a private or reserved address (${blocked[0]})`,
      {
        details: { hostname },
      },
    );
  }

  return { url, addresses };
}
