/**
 * Minimal ambient type declarations for the Node.js built-in modules and
 * globals used by PokeOps. We cannot install @types/node in this offline
 * environment (npm registry is forbidden), so we declare exactly what we use.
 *
 * These are intentionally loose but type-safe enough to keep `tsc --strict`
 * meaningful for our own code.
 */

// ---------------------------------------------------------------------------
// Globals
// ---------------------------------------------------------------------------
interface ProcessEnv {
  [key: string]: string | undefined;
}
interface Process {
  env: ProcessEnv;
  argv: string[];
  cwd(): string;
  exit(code?: number): never;
  on(event: string, listener: (...args: any[]) => void): void;
}
declare const process: Process;

declare const __dirname: string;
declare const __filename: string;

interface URLSearchParams {
  get(name: string): string | null;
  getAll(name: string): string[];
  has(name: string): boolean;
  [Symbol.iterator](): IterableIterator<[string, string]>;
}
declare const URLSearchParams: {
  new (init?: string): URLSearchParams;
};
interface URL {
  pathname: string;
  search: string;
  searchParams: URLSearchParams;
  href: string;
}
declare const URL: {
  new (input: string, base?: string): URL;
};

interface BufferConstructor {
  from(data: string, encoding?: string): Buffer;
  from(data: ArrayBuffer | Uint8Array | number[]): Buffer;
  concat(list: Uint8Array[]): Buffer;
  alloc(size: number): Buffer;
  isBuffer(obj: unknown): boolean;
}
interface Buffer extends Uint8Array {
  toString(encoding?: string): string;
  readonly length: number;
}
declare const Buffer: BufferConstructor;

interface Console {
  log(...args: unknown[]): void;
  error(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  info(...args: unknown[]): void;
}
declare const console: Console;

declare function setTimeout(handler: (...args: any[]) => void, timeout?: number): number;
declare function clearTimeout(id: number): void;
declare function setInterval(handler: (...args: any[]) => void, timeout?: number): number;
declare function clearInterval(id: number): void;

// ---------------------------------------------------------------------------
// node:crypto
// ---------------------------------------------------------------------------
declare module 'node:crypto' {
  export function randomUUID(): string;
  export function randomBytes(size: number): Buffer;
  export function scryptSync(
    password: string | Buffer,
    salt: string | Buffer,
    keylen: number,
  ): Buffer;
  export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean;
  export function createHash(algorithm: string): {
    update(data: string | Buffer): { digest(encoding: string): string };
    digest(encoding: string): string;
  };
}

// ---------------------------------------------------------------------------
// node:fs
// ---------------------------------------------------------------------------
declare module 'node:fs' {
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
  export function existsSync(path: string): boolean;
  export function readFileSync(path: string): Buffer;
  export function readFileSync(path: string, encoding: string): string;
  export function writeFileSync(path: string, data: string | Buffer): void;
  export function statSync(path: string): { isFile(): boolean; isDirectory(): boolean; size: number };
}

// ---------------------------------------------------------------------------
// node:path
// ---------------------------------------------------------------------------
declare module 'node:path' {
  export function join(...parts: string[]): string;
  export function resolve(...parts: string[]): string;
  export function extname(p: string): string;
  export function dirname(p: string): string;
  export function basename(p: string, ext?: string): string;
  const sep: string;
  export { sep };
}

// ---------------------------------------------------------------------------
// node:url
// ---------------------------------------------------------------------------
declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string;
  export class URL {
    constructor(input: string, base?: string);
    pathname: string;
    searchParams: { get(name: string): string | null };
  }
}

// ---------------------------------------------------------------------------
// node:http
// ---------------------------------------------------------------------------
declare module 'node:http' {
  export interface IncomingMessage {
    method?: string;
    url?: string;
    headers: Record<string, string | string[] | undefined>;
    on(event: 'data', listener: (chunk: Buffer) => void): void;
    on(event: 'end', listener: () => void): void;
    on(event: 'error', listener: (err: Error) => void): void;
  }
  export interface ServerResponse {
    statusCode: number;
    setHeader(name: string, value: string | string[]): void;
    getHeader(name: string): string | string[] | number | undefined;
    writeHead(statusCode: number, headers?: Record<string, string | string[]>): void;
    write(chunk: string | Buffer): void;
    end(chunk?: string | Buffer): void;
    headersSent: boolean;
  }
  export interface Server {
    listen(port: number, callback?: () => void): Server;
    close(callback?: () => void): void;
  }
  export function createServer(
    listener: (req: IncomingMessage, res: ServerResponse) => void,
  ): Server;
}

// ---------------------------------------------------------------------------
// node:sqlite  (experimental)
// ---------------------------------------------------------------------------
declare module 'node:sqlite' {
  export type SqlValue = string | number | bigint | null | Uint8Array;
  export interface StatementSync {
    run(...params: SqlValue[]): { changes: number; lastInsertRowid: number | bigint };
    get(...params: SqlValue[]): any;
    all(...params: SqlValue[]): any[];
  }
  export class DatabaseSync {
    constructor(path: string, options?: { open?: boolean });
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}

// ---------------------------------------------------------------------------
// node:test / node:assert
// ---------------------------------------------------------------------------
declare module 'node:test' {
  interface TestFn {
    (name: string, fn: () => void | Promise<void>): void;
    (name: string, options: object, fn: () => void | Promise<void>): void;
  }
  const test: TestFn;
  export default test;
  export { test };
  export function describe(name: string, fn: () => void): void;
  export function it(name: string, fn: () => void | Promise<void>): void;
  export function before(fn: () => void | Promise<void>): void;
  export function after(fn: () => void | Promise<void>): void;
  export function beforeEach(fn: () => void | Promise<void>): void;
  export function afterEach(fn: () => void | Promise<void>): void;
}

declare module 'node:assert' {
  interface Assert {
    (value: unknown, message?: string): void;
    ok(value: unknown, message?: string): void;
    equal(actual: unknown, expected: unknown, message?: string): void;
    strictEqual(actual: unknown, expected: unknown, message?: string): void;
    deepEqual(actual: unknown, expected: unknown, message?: string): void;
    deepStrictEqual(actual: unknown, expected: unknown, message?: string): void;
    notEqual(actual: unknown, expected: unknown, message?: string): void;
    notStrictEqual(actual: unknown, expected: unknown, message?: string): void;
    notDeepStrictEqual(actual: unknown, expected: unknown, message?: string): void;
    throws(fn: () => void, message?: string): void;
    match(value: string, regexp: RegExp, message?: string): void;
  }
  const assert: Assert;
  export default assert;
}
