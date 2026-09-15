/**
 * Escape a value for safe interpolation into HTML text / attribute contexts.
 * Every piece of user-supplied data rendered into a template MUST pass through
 * this to prevent XSS.
 */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Tagged-template helper that auto-escapes interpolated values. */
export function html(strings: TemplateStringsArray, ...values: unknown[]): string {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) {
    out += escapeHtml(values[i]) + strings[i + 1];
  }
  return out;
}
