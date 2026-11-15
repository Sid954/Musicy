const net = require('node:net');
const dns = require('node:dns/promises');

function isPrivateIPv4(hostname) {
  const parts = hostname.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b, c] = parts;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
    || (a === 192 && b === 0 && c === 0) || (a === 192 && b === 0 && c === 2)
    || (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

function parseIPv6(hostname) {
  let address = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (net.isIP(address) !== 6) return null;
  const dottedMatch = address.match(/(\d+\.\d+\.\d+\.\d+)$/);
  let embedded = null;
  if (dottedMatch) {
    const octets = dottedMatch[1].split('.').map(Number);
    embedded = [(octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]];
    address = address.slice(0, -dottedMatch[1].length);
    if (!address.endsWith('::')) address = address.replace(/:$/, '');
  }
  const halves = address.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':').filter(Boolean).map((part) => parseInt(part, 16)) : [];
  const right = halves[1] ? halves[1].split(':').filter(Boolean).map((part) => parseInt(part, 16)) : [];
  const missing = 8 - left.length - right.length - (embedded ? 2 : 0);
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const words = [...left, ...Array(missing).fill(0), ...right, ...(embedded || [])];
  return words.length === 8 && words.every((word) => Number.isInteger(word) && word >= 0 && word <= 0xffff) ? words : null;
}

function embeddedIPv4(words, index) {
  const [a, b] = words.slice(index, index + 2);
  return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;
}

function isPrivateIPv6(hostname) {
  const words = parseIPv6(hostname);
  if (!words) return false;
  const firstFiveZero = words.slice(0, 5).every((word) => word === 0);
  const firstSixZero = words.slice(0, 6).every((word) => word === 0);
  if (firstSixZero && words[6] === 0 && words[7] <= 1) return true; // :: and ::1
  if (firstFiveZero && words[5] === 0xffff) return isPrivateIPv4(embeddedIPv4(words, 6));
  if (firstSixZero) return true; // deprecated IPv4-compatible/reserved ::/96 range
  // Well-known NAT64 prefix 64:ff9b::/96 and 6to4 prefix 2002::/16 embed IPv4.
  if (words[0] === 0x0064 && words[1] === 0xff9b && words.slice(2, 6).every((word) => word === 0)) {
    return isPrivateIPv4(embeddedIPv4(words, 6));
  }
  if (words[0] === 0x2002) return isPrivateIPv4(embeddedIPv4(words, 1));
  return (words[0] & 0xfe00) === 0xfc00 // unique-local fc00::/7
    || (words[0] & 0xffc0) === 0xfe80 // link-local fe80::/10
    || (words[0] & 0xff00) === 0xff00 // multicast ff00::/8
    || (words[0] === 0x2001 && words[1] === 0x0db8); // documentation 2001:db8::/32
}

function validateHttpUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Enter a valid public http(s) URL.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only public http(s) URLs are supported.');
  if (url.username || url.password) throw new Error('URLs with embedded credentials are not supported.');
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  const unbracketed = hostname.replace(/^\[|\]$/g, '');
  const ipVersion = net.isIP(unbracketed);
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')
    || (ipVersion === 4 && isPrivateIPv4(unbracketed))
    || (ipVersion === 6 && isPrivateIPv6(unbracketed))) {
    throw new Error('Private and localhost URLs are not allowed.');
  }
  return url;
}

async function validatePublicHttpUrl(value, lookup = dns.lookup) {
  const url = validateHttpUrl(value);
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(hostname)) return url;
  let addresses;
  try { addresses = await lookup(hostname, { all: true, verbatim: true }); } catch {
    throw new Error('The URL host could not be resolved.');
  }
  if (!addresses.length || addresses.some(({ address }) => {
    const version = net.isIP(address);
    return (version === 4 && isPrivateIPv4(address)) || (version === 6 && isPrivateIPv6(address));
  })) throw new Error('URLs resolving to private or reserved addresses are not allowed.');
  // DNS pre-resolution rejects private results, but rebinding/redirects cannot be fully
  // prevented without pinning the validated address through the entire fetch/ffmpeg chain.
  return url;
}

module.exports = { validateHttpUrl, validatePublicHttpUrl, isPrivateIPv4, isPrivateIPv6, parseIPv6 };
