/**
 * Small validation helpers for JSON API endpoints. The goal (section 40) is
 * to never lose data on partial/invalid input: collect field-level errors and
 * only apply the fields that validated.
 */

export type FieldErrors = Record<string, string>;

export class Validator {
  readonly errors: FieldErrors = {};

  constructor(private readonly src: Record<string, unknown>) {}

  has(field: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.src, field) && this.src[field] !== undefined;
  }

  private raw(field: string): unknown {
    return this.src[field];
  }

  /** Required non-empty string. */
  requiredString(field: string, label = field): string | undefined {
    if (!this.has(field)) {
      this.errors[field] = `${label} is required.`;
      return undefined;
    }
    const v = String(this.raw(field)).trim();
    if (!v) {
      this.errors[field] = `${label} is required.`;
      return undefined;
    }
    return v;
  }

  /** Optional string; returns undefined when absent. */
  optionalString(field: string): string | undefined {
    if (!this.has(field)) return undefined;
    const v = this.raw(field);
    if (v === null) return undefined;
    return String(v);
  }

  /** Optional non-negative integer. */
  optionalInt(field: string, label = field, opts: { min?: number; max?: number } = {}): number | undefined {
    if (!this.has(field)) return undefined;
    const n = Number(this.raw(field));
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
      this.errors[field] = `${label} must be a whole number.`;
      return undefined;
    }
    if (opts.min !== undefined && n < opts.min) {
      this.errors[field] = `${label} must be at least ${opts.min}.`;
      return undefined;
    }
    if (opts.max !== undefined && n > opts.max) {
      this.errors[field] = `${label} must be at most ${opts.max}.`;
      return undefined;
    }
    return n;
  }

  /** Optional number (float). */
  optionalNumber(field: string, label = field, opts: { min?: number } = {}): number | undefined {
    if (!this.has(field)) return undefined;
    const rawVal = this.raw(field);
    if (rawVal === '' || rawVal === null) return undefined;
    const n = Number(rawVal);
    if (!Number.isFinite(n)) {
      this.errors[field] = `${label} must be a number.`;
      return undefined;
    }
    if (opts.min !== undefined && n < opts.min) {
      this.errors[field] = `${label} must be at least ${opts.min}.`;
      return undefined;
    }
    return n;
  }

  /** Optional value constrained to an allowed set. */
  optionalEnum(field: string, allowed: readonly string[], label = field): string | undefined {
    if (!this.has(field)) return undefined;
    const v = String(this.raw(field));
    if (!allowed.includes(v)) {
      this.errors[field] = `${label} must be one of: ${allowed.join(', ')}.`;
      return undefined;
    }
    return v;
  }

  get valid(): boolean {
    return Object.keys(this.errors).length === 0;
  }
}
