import type { IncomingMessage } from 'node:http';

export interface ParsedBody {
  /** Decoded fields for JSON and urlencoded bodies. */
  fields: Record<string, string>;
  /** Raw body text (also used as the multipart placeholder). */
  raw: string;
  /** Parsed JSON value when the content type was application/json. */
  json?: unknown;
}

/**
 * Read and parse the request body. Supports application/json and
 * application/x-www-form-urlencoded. multipart/form-data is a placeholder:
 * the raw body is preserved for a future real parser (FEAT scanning uploads).
 */
export async function parseBody(req: IncomingMessage): Promise<ParsedBody> {
  const raw = await readRaw(req);
  const contentType = String(req.headers['content-type'] ?? '').toLowerCase();
  const result: ParsedBody = { fields: {}, raw };

  if (!raw) return result;

  if (contentType.includes('application/json')) {
    try {
      result.json = JSON.parse(raw);
      if (result.json && typeof result.json === 'object') {
        for (const [k, v] of Object.entries(result.json as Record<string, unknown>)) {
          result.fields[k] = String(v);
        }
      }
    } catch {
      // ignore malformed JSON; fields stay empty
    }
  } else if (contentType.includes('application/x-www-form-urlencoded')) {
    for (const pair of raw.split('&')) {
      if (!pair) continue;
      const idx = pair.indexOf('=');
      const key = decodeURIComponent((idx === -1 ? pair : pair.slice(0, idx)).replace(/\+/g, ' '));
      const val = idx === -1 ? '' : decodeURIComponent(pair.slice(idx + 1).replace(/\+/g, ' '));
      result.fields[key] = val;
    }
  }
  // multipart/form-data: raw is preserved above; real parsing added later.

  return result;
}

function readRaw(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', (err) => reject(err));
  });
}
