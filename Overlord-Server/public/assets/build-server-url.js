function extractHostname(value) {
  const candidate = String(value || "").trim();
  if (!candidate) return "";

  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(candidate) ? candidate : `http://${candidate}`);
    return url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  } catch {
    return candidate.replace(/^\[|\]$/g, "").split("%")[0].toLowerCase();
  }
}

function isLocalIpv4(hostname) {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
  const octets = parts.map(Number);
  if (octets.some((octet) => octet > 255)) return false;

  return octets[0] === 0
    || octets[0] === 10
    || octets[0] === 127
    || (octets[0] === 169 && octets[1] === 254)
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168);
}

function isLocalIpv6(hostname) {
  const host = hostname.split("%")[0];
  if (host === "::" || host === "::1" || host === "0:0:0:0:0:0:0:1") return true;

  const mappedIpv4 = host.match(/^(?:::ffff:|0:0:0:0:0:ffff:)(\d+\.\d+\.\d+\.\d+)$/i);
  if (mappedIpv4) return isLocalIpv4(mappedIpv4[1]);

  const firstHextet = Number.parseInt(host.split(":", 1)[0], 16);
  return Number.isFinite(firstHextet)
    && ((firstHextet >= 0xfc00 && firstHextet <= 0xfdff)
      || (firstHextet >= 0xfe80 && firstHextet <= 0xfebf));
}

export function isLocalServerAddress(value) {
  const hostname = extractHostname(value);
  if (!hostname) return false;
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;
  return isLocalIpv4(hostname) || (hostname.includes(":") && isLocalIpv6(hostname));
}
