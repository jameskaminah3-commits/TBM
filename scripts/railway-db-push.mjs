import "dotenv/config";
import { Resolver, isIP } from "node:dns";
import https from "node:https";
import path from "node:path";
import { spawn } from "node:child_process";

const publicDnsServers = ["1.1.1.1", "1.0.0.1", "8.8.8.8", "8.8.4.4"];

function getDatabaseUrl() {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    throw new Error("DATABASE_URL must be set before running db:push.");
  }

  return new URL(raw);
}

function isPrivateHostname(hostname) {
  return hostname === "localhost"
    || hostname === "127.0.0.1"
    || hostname === "::1"
    || hostname.endsWith(".local");
}

function requestDnsJson(options) {
  return new Promise((resolve, reject) => {
    const request = https.request({
      host: options.ip,
      servername: options.servername,
      port: 443,
      method: "GET",
      path: options.path,
      headers: {
        Host: options.hostHeader,
        Accept: "application/dns-json",
      },
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        if (response.statusCode && response.statusCode >= 400) {
          reject(new Error(`DNS endpoint responded with ${response.statusCode}`));
          return;
        }

        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });

    request.setTimeout(4000, () => {
      request.destroy(new Error("DNS HTTPS request timed out"));
    });
    request.on("error", reject);
    request.end();
  });
}

async function resolveIpv4ViaPublicDns(hostname) {
  const resolver = new Resolver();
  resolver.setServers(publicDnsServers);

  try {
    const addresses = await new Promise((resolve, reject) => {
      resolver.resolve4(hostname, (error, records) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(records);
      });
    });

    if (Array.isArray(addresses) && addresses.length > 0) {
      return addresses[0];
    }
  } catch {
    // Fall through to HTTPS DNS.
  }

  const providers = [
    { ip: "1.1.1.1", servername: "cloudflare-dns.com", hostHeader: "cloudflare-dns.com", pathPrefix: "/dns-query" },
    { ip: "1.0.0.1", servername: "cloudflare-dns.com", hostHeader: "cloudflare-dns.com", pathPrefix: "/dns-query" },
    { ip: "8.8.8.8", servername: "dns.google", hostHeader: "dns.google", pathPrefix: "/resolve" },
  ];

  for (const provider of providers) {
    try {
      const payload = await requestDnsJson({
        ip: provider.ip,
        servername: provider.servername,
        hostHeader: provider.hostHeader,
        path: `${provider.pathPrefix}?name=${encodeURIComponent(hostname)}&type=A`,
      });
      const answers = Array.isArray(payload?.Answer) ? payload.Answer : [];
      const record = answers.find((answer) => answer && typeof answer.data === "string");
      if (record?.data) {
        return record.data;
      }
    } catch {
      // Try the next provider.
    }
  }

  throw new Error(`Could not resolve an IPv4 address for ${hostname}`);
}

function mergeNodeOptions(...values) {
  return values
    .flatMap((value) => (value || "").split(/\s+/))
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter((entry, index, array) => array.indexOf(entry) === index)
    .join(" ");
}

async function main() {
  const databaseUrl = getDatabaseUrl();
  const hostname = databaseUrl.hostname;
  const env = {
    ...process.env,
    NODE_OPTIONS: mergeNodeOptions(process.env.NODE_OPTIONS, "--dns-result-order=ipv4first"),
  };

  if (!isPrivateHostname(hostname) && isIP(hostname) === 0) {
    const ipv4Address = await resolveIpv4ViaPublicDns(hostname);
    env.DATABASE_HOST_OVERRIDE = ipv4Address;
    env.DATABASE_SSL_SERVERNAME = hostname;
    console.log(`[db:push] Resolved ${hostname} to ${ipv4Address} for this deploy.`);
  }

  const drizzleBin = path.resolve(process.cwd(), "node_modules", "drizzle-kit", "bin.cjs");
  const child = spawn(process.execPath, [drizzleBin, "push"], {
    cwd: process.cwd(),
    env,
    stdio: "inherit",
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 1);
  });
}

main().catch((error) => {
  console.error("[db:push] Failed to prepare Railway-safe database connection:", error);
  process.exit(1);
});
