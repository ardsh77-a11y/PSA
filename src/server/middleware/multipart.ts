/**
 * A minimal, dependency-free multipart/form-data parser (RFC 7578).
 *
 * It splits the raw request body on the boundary declared in the Content-Type
 * header, then for each part separates the headers from the content and
 * classifies the part as a text field (no filename) or an uploaded file
 * (has a filename). Binary content is preserved as a Buffer.
 *
 * This is intentionally small: it handles the shape browsers actually send for
 * file uploads (Content-Disposition: form-data; name=...; filename=...) plus
 * simple text fields. It is not a full RFC implementation (no nested
 * multipart/mixed, no transfer-encoding decoding) but is sufficient for the
 * scan upload flow. A base64 JSON fallback exists in the scan API for cases
 * where a client cannot produce multipart bodies.
 */

export interface UploadedFile {
  /** The form field name the file was uploaded under. */
  field: string;
  /** The original client filename (may be empty). */
  filename: string;
  /** The declared content type (defaults to application/octet-stream). */
  contentType: string;
  /** The raw file bytes. */
  bytes: Buffer;
}

export interface MultipartResult {
  fields: Record<string, string>;
  files: UploadedFile[];
}

/** Extract the boundary token from a multipart Content-Type header value. */
export function extractBoundary(contentType: string): string | null {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!match) return null;
  return (match[1] ?? match[2] ?? '').trim() || null;
}

/** Parse the Content-Disposition header line of a part. */
function parseDisposition(line: string): { name?: string; filename?: string } {
  const out: { name?: string; filename?: string } = {};
  const nameMatch = /name="([^"]*)"/i.exec(line);
  if (nameMatch) out.name = nameMatch[1];
  const fileMatch = /filename="([^"]*)"/i.exec(line);
  if (fileMatch) out.filename = fileMatch[1];
  return out;
}

/**
 * Parse a multipart/form-data body. Returns decoded text fields plus any
 * uploaded file parts. On a malformed body it returns whatever it could parse
 * (never throws) so callers can fall back gracefully.
 */
export function parseMultipart(body: Buffer, contentType: string): MultipartResult {
  const result: MultipartResult = { fields: {}, files: [] };
  const boundary = extractBoundary(contentType);
  if (!boundary) return result;

  const delimiter = Buffer.from(`--${boundary}`);
  const CRLF = Buffer.from('\r\n');
  const headerSep = Buffer.from('\r\n\r\n');

  // Split the body into parts on the boundary delimiter.
  const parts: Buffer[] = [];
  let searchFrom = 0;
  let start = body.indexOf(delimiter, 0);
  if (start === -1) return result;
  start += delimiter.length;
  while (start < body.length) {
    // Skip the CRLF right after a boundary; a trailing "--" marks the end.
    if (body[start] === 0x2d && body[start + 1] === 0x2d) break; // "--"
    // Move past the leading CRLF.
    if (body[start] === 0x0d && body[start + 1] === 0x0a) start += 2;
    const next = body.indexOf(delimiter, start);
    if (next === -1) break;
    // The part content ends at the CRLF immediately before the next boundary.
    let end = next;
    if (body[end - 2] === 0x0d && body[end - 1] === 0x0a) end -= 2;
    parts.push(body.subarray(start, end));
    start = next + delimiter.length;
    searchFrom = start;
  }
  void searchFrom;
  void CRLF;

  for (const part of parts) {
    const sepIdx = part.indexOf(headerSep);
    if (sepIdx === -1) continue;
    const headerText = part.subarray(0, sepIdx).toString('utf8');
    const content = part.subarray(sepIdx + headerSep.length);

    let disposition = '';
    let partContentType = 'application/octet-stream';
    for (const rawLine of headerText.split('\r\n')) {
      const lower = rawLine.toLowerCase();
      if (lower.startsWith('content-disposition:')) disposition = rawLine;
      else if (lower.startsWith('content-type:')) partContentType = rawLine.slice(rawLine.indexOf(':') + 1).trim();
    }
    if (!disposition) continue;

    const { name, filename } = parseDisposition(disposition);
    if (name === undefined) continue;

    if (filename !== undefined) {
      // A file part (even if filename is empty, the presence of the attribute
      // signals a file input). Skip empty file inputs the browser sends.
      if (filename === '' && content.length === 0) continue;
      result.files.push({
        field: name,
        filename,
        contentType: partContentType,
        bytes: content,
      });
    } else {
      result.fields[name] = content.toString('utf8');
    }
  }

  return result;
}
