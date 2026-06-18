import dns from 'dns';

/**
 * Defense against SSRF attacks on server URLs.
 *
 * Admin users can test private network URLs as an explicit opt-in via the
 * `isAdmin` parameter. Callers MUST use `isInternalAdmin(req)` for admin checks,
 * NOT `req.auth?.isAdmin` — the latter is undefined when authentication is disabled.
 */

export type IsBlockedUrlOptions = {
  allowPrivateNetwork?: boolean;
  isAdmin?: boolean;
};

export type IsBlockedUrlResult = {
  blocked: boolean;
  reason?: string;
};

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4) {return false;}
  const [a, b, _c] = parts;

  if (a === 10) {return true;}
  if (a === 172 && b >= 16 && b <= 31) {return true;}
  if (a === 192 && b === 168) {return true;}
  if (a === 127) {return true;}
  if (a === 169 && b === 254) {return true;}

  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();

  if (lower === '::1') {return true;}
  if (lower.startsWith('fc') || lower.startsWith('fd')) {return true;}
  if (lower.startsWith('fe80')) {return true;}

  return false;
}

function isPrivateIP(ip: string): boolean {
  if (ip.includes(':')) {
    return isPrivateIPv6(ip);
  }
  return isPrivateIPv4(ip);
}

function getBlockReason(ip: string): string {
  const lower = ip.toLowerCase();

  if (lower === '::1') {return 'loopback';}
  if (lower.startsWith('fe80')) {return 'link_local';}
  if (lower.startsWith('fc') || lower.startsWith('fd')) {return 'private_ip';}

  const parts = ip.split('.').map(Number);
  if (parts.length === 4) {
    const [a, b] = parts;
    if (a === 127) {return 'loopback';}
    if (a === 169 && b === 254) {return 'link_local';}
    if (a === 10) {return 'private_ip';}
    if (a === 172 && b >= 16 && b <= 31) {return 'private_ip';}
    if (a === 192 && b === 168) {return 'private_ip';}
  }

  return 'private_ip';
}

function parseHostFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    return null;
  }
}

/**
 * Check if a URL should be blocked for SSRF protection.
 *
 * Blocks private/internal IP ranges including:
 * - 127.0.0.0/8 (loopback)
 * - 10.0.0.0/8 (private RFC 1918)
 * - 172.16.0.0/12 (private RFC 1918)
 * - 192.168.0.0/16 (private RFC 1918)
 * - 169.254.0.0/16 (link-local, includes AWS metadata 169.254.169.254)
 * - ::1 (IPv6 loopback)
 * - fc00::/7 (IPv6 ULA)
 * - fe80::/10 (IPv6 link-local)
 *
 * Integration points for Wave 5 tasks:
 * - T14 (POST /test-connection): Call isBlockedUrl(req.body.url) and return 400 if blocked
 * - T15 (GET /test-connection/:testId): No URL input, no check needed
 * - T16 (POST /servers/:id/test): Call isBlockedUrl(server.url) for the existing server URL
 *
 * @param url - The URL to check
 * @param options - Optional configuration:
 *   - allowPrivateNetwork: When true, allows loopback/private IPs. Note: this only takes effect when combined with `isAdmin=true` (admin override).
 *   - isAdmin: When `isAdmin=true`, the function allows private IPs/loopback addresses. Callers MUST pass `isInternalAdmin(req)` for admin checks, NOT `req.auth?.isAdmin` — the latter is undefined when auth is disabled.
 * @returns Promise resolving to { blocked: boolean, reason?: string }
 */
export async function isBlockedUrl(
  url: string,
  options?: IsBlockedUrlOptions
): Promise<IsBlockedUrlResult> {
  const hostname = parseHostFromUrl(url);
  if (!hostname) {
    return { blocked: true, reason: 'invalid_url' };
  }

  if (options?.allowPrivateNetwork === true && options?.isAdmin === true) {
    return { blocked: false };
  }

  let ip: string;

  const normalizedHost = hostname.replace(/^\[|\]$/g, '');
  const numericIp = /^(?:\d{1,3}\.){3}\d{1,3}$|^[\da-fA-F:]+$/.test(normalizedHost);
  if (numericIp) {
    ip = normalizedHost;
  } else {
    try {
      const result = await new Promise<{ address: string; family: number }>((resolve, reject) => {
        dns.lookup(normalizedHost, (err, address, family) => {
          if (err) {reject(err);}
          else {resolve({ address, family });}
        });
      });
      ip = result.address;
    } catch {
      return { blocked: true, reason: 'invalid_url' };
    }
  }

  if (isPrivateIP(ip)) {
    return { blocked: true, reason: getBlockReason(ip) };
  }

  return { blocked: false };
}
