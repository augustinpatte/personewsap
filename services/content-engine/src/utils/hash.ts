import { createHash } from "node:crypto";

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function normalizeUrl(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";

  for (const key of Array.from(parsed.searchParams.keys())) {
    if (key.startsWith("utm_") || ["fbclid", "gclid", "mc_cid", "mc_eid"].includes(key)) {
      parsed.searchParams.delete(key);
    }
  }

  parsed.searchParams.sort();
  return parsed.toString().replace(/\/$/, "");
}
