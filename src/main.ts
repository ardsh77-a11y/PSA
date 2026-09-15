import { createServer } from 'node:http';
import { config } from './config/index.js';
import { getDb } from './db/connection.js';
import { Router, type RequestContext } from './server/router.js';
import { parseBody } from './server/middleware/bodyParser.js';
import { resolveSession } from './server/middleware/session.js';
import { tryServeStatic } from './server/middleware/static.js';
import { notFound, serverError } from './server/errors.js';
import { registerAuthRoutes } from './server/routes/auth.js';
import { registerAppRoutes } from './server/routes/app.js';
import { registerInventoryRoutes } from './server/routes/inventory.js';
import { registerPricingRoutes } from './server/routes/pricing.js';
import { registerInventoryApi } from './api/inventory.js';
import { registerCardsApi } from './api/cards.js';
import { registerPricingApi } from './api/pricing.js';

/** Build the router with all registered routes. */
export function buildRouter(): Router {
  const router = new Router();
  registerAuthRoutes(router);
  registerAppRoutes(router);
  registerInventoryRoutes(router);
  registerPricingRoutes(router);
  registerInventoryApi(router);
  registerCardsApi(router);
  registerPricingApi(router);
  return router;
}

/** Create the configured HTTP server (exported for testing). */
export function createApp() {
  const router = buildRouter();

  return createServer((req, res) => {
    void handle(router, req, res).catch((err) => serverError(res, err));
  });
}

async function handle(
  router: Router,
  req: Parameters<Parameters<typeof createServer>[0]>[0],
  res: Parameters<Parameters<typeof createServer>[0]>[1],
): Promise<void> {
  const method = (req.method ?? 'GET').toUpperCase();
  const url = new URL(req.url ?? '/', `http://localhost:${config.port}`);
  const pathname = url.pathname;

  // 1) Static assets from public/ (GET/HEAD only).
  if (method === 'GET' && tryServeStatic(pathname, res)) return;

  // 2) Resolve session + user for every request.
  const { sessionToken, user } = resolveSession(req);

  // 3) Match a route.
  const matched = router.match(method, pathname);
  if (!matched) {
    notFound(res);
    return;
  }

  // 4) Parse body for methods that carry one.
  const hasBody = method === 'POST' || method === 'PUT' || method === 'PATCH';
  const body = hasBody ? await parseBody(req) : undefined;

  const query: Record<string, string> = {};
  for (const [k, v] of url.searchParams as unknown as Iterable<[string, string]>) {
    query[k] = v;
  }

  const ctx: RequestContext = {
    req,
    res,
    params: matched.params,
    query,
    body,
    sessionToken,
    user,
  };

  await matched.handler(ctx);
}

function main(): void {
  // Ensure the database + schema exist before serving traffic.
  getDb();

  const server = createApp();
  server.listen(config.port, () => {
    console.log(`PokeOps running at http://localhost:${config.port}`);
  });

  const shutdown = () => {
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Only auto-start when run directly (not when imported by tests).
const invokedPath = process.argv[1] ?? '';
if (invokedPath.endsWith('main.js') || invokedPath.endsWith('main.ts')) {
  main();
}
