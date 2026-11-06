import { URL } from 'url';
import { config } from '../config';

/**
 * Validates whether a given URL is allowed according to the security whitelist
 * and strictly prevents SSRF (Server-Side Request Forgery) against private IP ranges.
 */
export function isAllowedEducationalUrl(targetUrl: string): { allowed: boolean; reason?: string } {
  try {
    const parsed = new URL(targetUrl);

    // Only allow HTTP/HTTPS
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { allowed: false, reason: 'Protocol must be http or https' };
    }

    const hostname = parsed.hostname.toLowerCase();

    // Check SSRF blacklist: private ranges, localhost, AWS metadata, etc.
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname === '::1' ||
      hostname.startsWith('10.') ||
      hostname.startsWith('192.168.') ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname) ||
      hostname === '169.254.169.254' // Cloud metadata endpoint
    ) {
      return { allowed: false, reason: 'Access to private or local networks is strictly forbidden' };
    }

    // Whitelist check
    const isWhitelisted = config.browser.allowedDomains.some((domain) => {
      return hostname === domain || hostname.endsWith(`.${domain}`);
    });

    if (!isWhitelisted) {
      return {
        allowed: false,
        reason: `Domain ${hostname} is not in the approved educational whitelist`,
      };
    }

    return { allowed: true };
  } catch (err: any) {
    return { allowed: false, reason: `Malformed URL: ${err.message}` };
  }
}
