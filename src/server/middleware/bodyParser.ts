import type { IncomingMessage } from 'node:http';
import { parseMultipart, type UploadedFile } from './multipart.js';

export interface ParsedBody {
  /** Decoded fields for JSON, urlencoded and multipart bodies. */
  fields: Record<string, string>;
  /** Raw body text (utf8 decode of the raw bytes). */
  raw: string;
  /** Raw body bytes, preserved for binary payloads (multipart uploads). */
  rawBuffer: Buffer;
  /** Parsed JSON value when the content type was application/json. */
  json?: unknown;
  /** Uploaded file parts extracted from a multipart/form-data body. */
  files?: UploadedFile[];
}

/**
 * Read and parse the request body. Supports application/json,
 * application/x-www-form-urlencoded and multipart/form-data. For multipart
 * bodies the file parts are extracted (see ./multipart.ts) and text fields are
 * decoded into `fields`. The raw bytes are always preserved on `rawBuffer` so
 * binary payloads survive.
 */
export async function parseBody(req: IncomingMessage): Promise<ParsedBody> {
  const rawBuffer = await readRaw(req);
  const raw = rawBuffer.toString('utf8');
  const contentType = String(req.headers['content-type'] ?? '').toLowerCase();
  const result: ParsedBody = { fields: {}, raw, rawBuffer };

  if (!rawBuffer.length) return result;

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
  } else if (contentType.includes('multipart/form-data')) {
    const parsed = parseMultipart(rawBuffer, contentType);
    result.files = parsed.files;
    for (const [k, v] of Object.entries(parsed.fields)) {
      result.fields[k] = v;
    }
  }

  return result;
}

function readRaw(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', (err) => reject(err));
  });
}
