import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isBlockedUrl } from '../../../src/utils/url-safety.js';

vi.mock('dns', () => {
  const mockLookup = vi.fn();
  return {
    default: {
      lookup: mockLookup,
    },
    lookup: mockLookup,
  };
});

import dns from 'dns';

const mockLookup = dns.lookup as ReturnType<typeof vi.fn>;

function mockDnsLookup(hostname: string, ip: string | null, family = 4) {
  if (ip === null) {
    mockLookup.mockImplementationOnce(
      (_hostname: string, optionsOrCallback: unknown, callback?: unknown) => {
        const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
        process.nextTick(() => {
          (cb as (err: NodeJS.ErrnoException | null, address?: string, family?: number) => void)({
            code: 'ENOTFOUND',
            hostname: _hostname,
          } as NodeJS.ErrnoException);
        });
      }
    );
  } else {
    mockLookup.mockImplementationOnce(
      (_hostname: string, optionsOrCallback: unknown, callback?: unknown) => {
        const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
        process.nextTick(() => {
          (cb as (err: null, address: string, family: number) => void)(null, ip, family);
        });
      }
    );
  }
}

function setupDefaultDnsMocks() {
  mockLookup.mockImplementation(
    (_hostname: string, optionsOrCallback: unknown, callback?: unknown) => {
      const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
      process.nextTick(() => {
        (cb as (err: NodeJS.ErrnoException | null, address?: string, family?: number) => void)({
          code: 'ENOTFOUND',
          hostname: _hostname,
        } as NodeJS.ErrnoException);
      });
    }
  );
}

describe('isBlockedUrl - SSRF Protection', () => {
  beforeEach(() => {
    mockLookup.mockReset();
    setupDefaultDnsMocks();
  });

  describe('RFC 1918 private ranges', () => {
    it('should block http://10.0.0.1 (10.0.0.0/8 private)', async () => {
      mockDnsLookup('10.0.0.1', '10.0.0.1');
      const result = await isBlockedUrl('http://10.0.0.1');
      expect(result.blocked).toBe(true);
      expect(result.reason).toBe('private_ip');
    });

    it('should block http://192.168.1.1 (192.168.0.0/16 private)', async () => {
      mockDnsLookup('192.168.1.1', '192.168.1.1');
      const result = await isBlockedUrl('http://192.168.1.1');
      expect(result.blocked).toBe(true);
      expect(result.reason).toBe('private_ip');
    });

    it('should block http://172.16.0.1 (172.16.0.0/12 private)', async () => {
      mockDnsLookup('172.16.0.1', '172.16.0.1');
      const result = await isBlockedUrl('http://172.16.0.1');
      expect(result.blocked).toBe(true);
      expect(result.reason).toBe('private_ip');
    });
  });

  describe('loopback addresses', () => {
    it('should block http://127.0.0.1 (127.0.0.0/8 loopback)', async () => {
      const result = await isBlockedUrl('http://127.0.0.1');
      expect(result.blocked).toBe(true);
      expect(result.reason).toBe('loopback');
    });
  });

  describe('link-local addresses', () => {
    it('should block http://169.254.169.254 (link-local, AWS metadata)', async () => {
      const result = await isBlockedUrl('http://169.254.169.254');
      expect(result.blocked).toBe(true);
      expect(result.reason).toBe('link_local');
    });
  });

  describe('IPv6 addresses', () => {
    it('should block http://[::1] (IPv6 loopback)', async () => {
      const result = await isBlockedUrl('http://[::1]');
      expect(result.blocked).toBe(true);
      expect(result.reason).toBe('loopback');
    });

    it('should block http://[fc00::1] (IPv6 ULA)', async () => {
      const result = await isBlockedUrl('http://[fc00::1]');
      expect(result.blocked).toBe(true);
      expect(result.reason).toBe('private_ip');
    });
  });

  describe('DNS-resolved hosts', () => {
    it('should block http://localhost (resolves to loopback)', async () => {
      mockDnsLookup('localhost', '127.0.0.1');
      const result = await isBlockedUrl('http://localhost');
      expect(result.blocked).toBe(true);
      expect(result.reason).toBe('loopback');
    });

    it('should allow http://example.com (public)', async () => {
      mockDnsLookup('example.com', '93.184.216.34');
      const result = await isBlockedUrl('http://example.com');
      expect(result.blocked).toBe(false);
    });

    it('should allow http://8.8.8.8 (public IP)', async () => {
      const result = await isBlockedUrl('http://8.8.8.8');
      expect(result.blocked).toBe(false);
    });

    it('should block DNS rebinding - hostname resolves to private IP', async () => {
      mockDnsLookup('attacker.example.com', '192.168.1.100');
      const result = await isBlockedUrl('http://attacker.example.com');
      expect(result.blocked).toBe(true);
      expect(result.reason).toBe('private_ip');
    });
  });

  describe('admin override', () => {
    it('should allow private URLs when allowPrivateNetwork=true AND isAdmin=true', async () => {
      mockDnsLookup('10.0.0.1', '10.0.0.1');
      const result = await isBlockedUrl('http://10.0.0.1', {
        allowPrivateNetwork: true,
        isAdmin: true,
      });
      expect(result.blocked).toBe(false);
    });

    it('should still block private URLs when allowPrivateNetwork=true but isAdmin=false', async () => {
      mockDnsLookup('10.0.0.1', '10.0.0.1');
      const result = await isBlockedUrl('http://10.0.0.1', {
        allowPrivateNetwork: true,
        isAdmin: false,
      });
      expect(result.blocked).toBe(true);
      expect(result.reason).toBe('private_ip');
    });

    it('should still block private URLs when allowPrivateNetwork=false but isAdmin=true', async () => {
      mockDnsLookup('10.0.0.1', '10.0.0.1');
      const result = await isBlockedUrl('http://10.0.0.1', {
        allowPrivateNetwork: false,
        isAdmin: true,
      });
      expect(result.blocked).toBe(true);
      expect(result.reason).toBe('private_ip');
    });
  });

  describe('edge cases', () => {
    it('should block invalid URL', async () => {
      const result = await isBlockedUrl('not-a-valid-url');
      expect(result.blocked).toBe(true);
      expect(result.reason).toBe('invalid_url');
    });

    it('should process https:// scheme correctly', async () => {
      mockDnsLookup('example.com', '93.184.216.34');
      const result = await isBlockedUrl('https://example.com');
      expect(result.blocked).toBe(false);
    });

    it('should handle DNS lookup failure gracefully', async () => {
      mockDnsLookup('nonexistent.example.com', null);
      const result = await isBlockedUrl('http://nonexistent.example.com');
      expect(result.blocked).toBe(true);
      expect(result.reason).toBe('invalid_url');
    });
  });
});
