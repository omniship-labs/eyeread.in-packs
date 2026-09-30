// The zip URL rules from README.md: https, public, a fixed URL per version,
// no IP addresses, localhost or private networks. Checked for the entry's
// URL and again for every redirect hop.
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** Problems with a URL that don't need the network, as a list of strings. */
export function urlProblems(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return ['is not a valid URL'];
  }
  const problems = [];
  if (url.protocol !== 'https:') problems.push('must use https://');
  if (url.username || url.password) problems.push('must not contain a username or password');
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (isIP(host)) problems.push('must use a host name, not an IP address');
  else if (host === 'localhost' || host.endsWith('.localhost') || !host.includes('.'))
    problems.push('must be a public host');
  if (/\/latest(\/|$)/i.test(url.pathname))
    problems.push('must point at one fixed version, not "latest"');
  return problems;
}

/** Is this resolved address loopback, private, link-local or otherwise not public? */
export function isPrivateAddress(address) {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  const v6 = address.toLowerCase();
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateAddress(mapped[1]);
  return (
    v6 === '::' ||
    v6 === '::1' ||
    /^f[cd]/.test(v6) ||
    /^fe[89ab]/.test(v6) ||
    v6.startsWith('ff')
  );
}

/** Every rule, including that the host resolves only to public addresses. */
export async function checkUrl(raw, resolve = lookup) {
  const problems = urlProblems(raw);
  if (problems.length > 0) return problems;
  const host = new URL(raw).hostname;
  let addresses;
  try {
    addresses = await resolve(host, { all: true });
  } catch (err) {
    return [`host ${host} doesn't resolve (${err.code ?? err.message})`];
  }
  if (addresses.some((a) => isPrivateAddress(a.address)))
    return [`host ${host} resolves to a private network address`];
  return [];
}
