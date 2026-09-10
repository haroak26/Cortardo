import { lookup } from "dns/promises";
import { isIP } from "net";

const PRIVATE_RANGES = [
  { start: "10.0.0.0", end: "10.255.255.255" },
  { start: "172.16.0.0", end: "172.31.255.255" },
  { start: "192.168.0.0", end: "192.168.255.255" },
  { start: "127.0.0.0", end: "127.255.255.255" },
  { start: "169.254.0.0", end: "169.254.255.255" },
  { start: "::1", end: "::1" },
  { start: "fc00::", end: "fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff" },
  { start: "fe80::", end: "febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff" },
];

function ipToNumber(ip: string): bigint {
  const parts = ip.split(".");
  if (parts.length === 4) {
    return ((BigInt(parseInt(parts[0])) << 24n) |
      (BigInt(parseInt(parts[1])) << 16n) |
      (BigInt(parseInt(parts[2])) << 8n) |
      BigInt(parseInt(parts[3])));
  }
  return 0n;
}

function isInRange(ip: string, range: { start: string; end: string }): boolean {
  const ipNum = ipToNumber(ip);
  if (ipNum === 0n) return false;
  return ipNum >= ipToNumber(range.start) && ipNum <= ipToNumber(range.end);
}

export function isPrivateIp(ip: string): boolean {
  const cleaned = ip.replace(/^::ffff:/, "");
  if (!isIP(cleaned)) return false;
  return PRIVATE_RANGES.some(range => isInRange(cleaned, range));
}

export async function resolveAndCheckUrl(url: string): Promise<{ blocked: boolean; reason?: string }> {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;

    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
      return { blocked: true, reason: "Localhost URLs are not allowed" };
    }

    if (isIP(hostname)) {
      if (isPrivateIp(hostname)) {
        return { blocked: true, reason: "Private IP addresses are not allowed" };
      }
      return { blocked: false };
    }

    const addresses = await lookup(hostname);
    const ips = Array.isArray(addresses) ? addresses.map(a => a.address) : [addresses.address];

    for (const ip of ips) {
      if (isPrivateIp(ip)) {
        return { blocked: true, reason: `Resolved to private IP: ${ip}` };
      }
    }

    return { blocked: false };
  } catch {
    return { blocked: true, reason: "Failed to resolve hostname" };
  }
}
