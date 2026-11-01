import { describe, expect, it } from 'vitest';
import {
  isBlockedAddress,
  isBlockedIpv4,
  isBlockedIpv6,
  parseIpv4,
  validateTarget,
} from '../../worker/lib/ssrf';
import { HttpError } from '../../worker/lib/http';

describe('parseIpv4', () => {
  it('parses dotted quads', () => {
    expect(parseIpv4('0.0.0.0')).toBe(0);
    expect(parseIpv4('255.255.255.255')).toBe(4294967295);
    expect(parseIpv4('192.168.1.1')).toBe(3232235777);
  });

  it('rejects malformed input', () => {
    for (const value of ['256.1.1.1', '1.2.3', '1.2.3.4.5', 'abc', '1.2.3.-1']) {
      expect(parseIpv4(value)).toBeNull();
    }
  });
});

describe('isBlockedIpv4', () => {
  const blocked = [
    '0.0.0.0',
    '10.0.0.1',
    '10.255.255.254',
    '100.64.0.1',
    '127.0.0.1',
    '127.255.255.254',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.255',
    '192.0.0.8',
    '192.168.0.1',
    '198.18.0.1',
    '224.0.0.1',
    '240.0.0.1',
    '255.255.255.255',
  ];

  for (const address of blocked) {
    it(`blocks ${address}`, () => {
      expect(isBlockedIpv4(address)).toBe(true);
    });
  }

  const allowed = ['1.1.1.1', '8.8.8.8', '172.15.0.1', '172.32.0.1', '93.184.216.34', '198.17.0.1'];

  for (const address of allowed) {
    it(`allows public ${address}`, () => {
      expect(isBlockedIpv4(address)).toBe(false);
    });
  }
});

describe('isBlockedIpv6', () => {
  it('blocks loopback, unspecified and link-local', () => {
    for (const address of [
      '::',
      '::1',
      'fe80::1',
      'febf::1',
      'fc00::1',
      'fd12:3456::1',
      'ff02::1',
    ]) {
      expect(isBlockedIpv6(address)).toBe(true);
    }
  });

  it('blocks IPv4-mapped private ranges', () => {
    expect(isBlockedIpv6('::ffff:127.0.0.1')).toBe(true);
    expect(isBlockedIpv6('::ffff:10.0.0.1')).toBe(true);
    expect(isBlockedIpv6('::ffff:7f00:1')).toBe(true);
    expect(isBlockedIpv6('::ffff:8.8.8.8')).toBe(false);
  });

  it('blocks NAT64 forms of private addresses', () => {
    expect(isBlockedIpv6('64:ff9b::127.0.0.1')).toBe(true);
  });

  it('allows public IPv6', () => {
    expect(isBlockedIpv6('2606:4700:4700::1111')).toBe(false);
  });

  it('blocks documentation ranges', () => {
    expect(isBlockedIpv6('2001:db8::1')).toBe(true);
  });
});

describe('isBlockedAddress', () => {
  it('dispatches on address family', () => {
    expect(isBlockedAddress('10.1.2.3')).toBe(true);
    expect(isBlockedAddress('2606:4700::1')).toBe(false);
    expect(isBlockedAddress('not-an-ip')).toBe(true);
  });
});

async function expectHttpError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(HttpError);
  try {
    await promise;
  } catch (error) {
    expect((error as HttpError).code).toBe(code);
    expect((error as HttpError).status).toBe(400);
  }
}

describe('validateTarget', () => {
  it('rejects non-http schemes and embedded credentials', async () => {
    await expectHttpError(validateTarget('file:///etc/passwd'), 'blocked_scheme');
    await expectHttpError(validateTarget('ftp://example.com'), 'blocked_scheme');
    await expectHttpError(validateTarget('https://user:pass@example.com'), 'blocked_credentials');
    await expectHttpError(validateTarget('not a url'), 'invalid_target_url');
  });

  it('rejects internal hostnames without a DNS lookup', async () => {
    await expectHttpError(validateTarget('http://localhost/hook'), 'blocked_host');
    await expectHttpError(validateTarget('http://metadata.google.internal/'), 'blocked_host');
    await expectHttpError(validateTarget('http://api.localhost/'), 'blocked_host');
    await expectHttpError(validateTarget('http://service.internal/'), 'blocked_host');
  });

  it('rejects unusual ports before resolving', async () => {
    await expectHttpError(validateTarget('http://example.com:8080/'), 'blocked_port');
    await expectHttpError(validateTarget('http://example.com:22/'), 'blocked_port');
  });

  it('rejects private address literals', async () => {
    await expectHttpError(validateTarget('http://127.0.0.1/'), 'blocked_address');
    await expectHttpError(validateTarget('http://10.0.0.5/'), 'blocked_address');
    await expectHttpError(
      validateTarget('http://169.254.169.254/latest/meta-data/'),
      'blocked_address',
    );
    await expectHttpError(validateTarget('http://[::1]/'), 'blocked_address');
    await expectHttpError(validateTarget('http://[fd00::1]/'), 'blocked_address');
  });
});
