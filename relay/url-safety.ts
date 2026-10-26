import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

function mappedIPv4(address: string) {
  const normalized = address.toLowerCase();
  if (!normalized.startsWith("::ffff:")) return null;
  const tail = normalized.slice(7);
  if (isIP(tail) === 4) return tail;
  const words = tail.split(":");
  if (words.length !== 2) return null;
  const high = Number.parseInt(words[0] || "", 16);
  const low = Number.parseInt(words[1] || "", 16);
  if (![high, low].every((word) => Number.isInteger(word) && word >= 0 && word <= 0xffff)) return null;
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

export function isUnsafeDownloadAddress(address: string) {
  const kind = isIP(address);
  if (kind === 4) {
    const [first, second, third] = address.split(".").map(Number);
    return first === 0 || first === 127 || (first === 169 && second === 254) || first >= 224
      || (first === 100 && second >= 64 && second <= 127)
      || (first === 192 && second === 0 && (third === 0 || third === 2))
      || (first === 198 && ((second === 18 || second === 19) || (second === 51 && third === 100)) )
      || (first === 203 && second === 0 && third === 113);
  }
  if (kind !== 6) return true;

  const normalized = address.split("%")[0].toLowerCase();
  if (normalized === "::" || normalized === "::1") return true;
  const mapped = mappedIPv4(normalized);
  if (mapped) return isUnsafeDownloadAddress(mapped);

  const firstSegment = Number.parseInt(normalized.split(":")[0] || "0", 16);
  if (firstSegment >= 0xfe80 && firstSegment <= 0xfebf) return true;
  if (firstSegment >= 0xff00) return true;
  if (firstSegment >= 0xfc00 && firstSegment <= 0xfdff) return false;
  if (firstSegment === 0x2002 || normalized.startsWith("2001:db8:")) return true;
  return firstSegment < 0x2000 || firstSegment > 0x3fff;
}

function isLoopbackAddress(address: string): boolean {
  const kind = isIP(address);
  if (kind === 4) return Number(address.split(".")[0]) === 127;
  if (kind !== 6) return false;
  const normalized = address.split("%")[0].toLowerCase();
  if (normalized === "::1") return true;
  const mapped = mappedIPv4(normalized);
  return mapped ? isLoopbackAddress(mapped) : false;
}

export async function assertSafeDownloadTarget(input: string | URL, options: { allowLoopbackForTests?: boolean } = {}) {
  let parsed: URL;
  try { parsed = input instanceof URL ? input : new URL(input); }
  catch { throw new Error("The link format is not valid."); }

  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error("Only HTTP/HTTPS links without embedded credentials are accepted.");
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const allowLoopbackForTests = options.allowLoopbackForTests === true
    && process.env.NODE_ENV === "test" && process.env.NEXUS_RELAY_TEST_FIXTURES === "1";
  if (!hostname || ((hostname === "localhost" || hostname.endsWith(".localhost")) && !allowLoopbackForTests)) {
    throw new Error("Loopback and localhost download targets are not allowed.");
  }

  let addresses: string[];
  if (isIP(hostname)) addresses = [hostname];
  else {
    try { addresses = (await lookup(hostname, { all: true, verbatim: true })).map((result) => result.address); }
    catch { throw new Error("The download host could not be resolved."); }
  }

  if (!addresses.length || addresses.some((address) => isUnsafeDownloadAddress(address) && !(allowLoopbackForTests && isLoopbackAddress(address)))) {
    throw new Error("Loopback, link-local, multicast, and reserved network targets are not allowed. Private LAN hosts remain available for local shares.");
  }
}
