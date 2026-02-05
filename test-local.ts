// Local test server using Bun
// Run: bun test-local.ts

import indexHandler from "./api/index";
import agentsHandler from "./api/agents";
import leaderboardHandler from "./api/leaderboard";
import dueHandler from "./api/due";
import subscriptionsHandler from "./api/subscriptions";
import registerHandler from "./api/register";
import sendHandler from "./api/send";
import batchHandler from "./api/batch";
import splitHandler from "./api/split";
import subscribeHandler from "./api/subscribe";
import executeHandler from "./api/execute";

// v3: New handlers
import limitHandler from "./api/limit";
import approveHandler from "./api/approve";
import transferFromHandler from "./api/transfer-from";
import revokeHandler from "./api/revoke";
import allowancesHandler from "./api/allowances";

// v4: Invoice, Webhook, Refund handlers
import initCounterHandler from "./api/init-counter";
import invoiceHandler from "./api/invoice";
import invoiceByIdHandler from "./api/invoice/[id]";
import invoicePayHandler from "./api/invoice/[id]/pay";
import invoiceRejectHandler from "./api/invoice/[id]/reject";
import invoiceCancelHandler from "./api/invoice/[id]/cancel";
import invoicesHandler from "./api/invoices/[name]";
import webhookHandler from "./api/webhook";
import refundHandler from "./api/refund";

// Dynamic imports for path-based handlers
import balanceHandler from "./api/balance/[name]";
import resolveHandler from "./api/resolve/[name]";

const PORT = 3000;

// Route mapping
const routes: Record<string, (req: Request) => Promise<Response>> = {
  "/api": indexHandler,
  "/api/agents": agentsHandler,
  "/api/leaderboard": leaderboardHandler,
  "/api/due": dueHandler,
  "/api/subscriptions": subscriptionsHandler,
  "/api/register": registerHandler,
  "/api/send": sendHandler,
  "/api/batch": batchHandler,
  "/api/split": splitHandler,
  "/api/subscribe": subscribeHandler,
  "/api/execute": executeHandler,
  // v3: New routes
  "/api/limit": limitHandler,
  "/api/approve": approveHandler,
  "/api/transfer-from": transferFromHandler,
  "/api/revoke": revokeHandler,
  "/api/allowances": allowancesHandler,
  // v4: Invoice, Webhook, Refund routes
  "/api/init-counter": initCounterHandler,
  "/api/invoice": invoiceHandler,
  "/api/webhook": webhookHandler,
  "/api/refund": refundHandler,
};

// Extract path param handlers
function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  // Direct route match
  if (routes[path]) {
    return routes[path](req);
  }

  // Path param routes - handlers extract name from pathname
  if (path.startsWith("/api/balance/")) {
    return balanceHandler(req);
  }

  if (path.startsWith("/api/resolve/")) {
    return resolveHandler(req);
  }

  // v4: Invoice dynamic routes
  if (path.match(/^\/api\/invoice\/\d+\/pay$/)) {
    return invoicePayHandler(req);
  }

  if (path.match(/^\/api\/invoice\/\d+\/reject$/)) {
    return invoiceRejectHandler(req);
  }

  if (path.match(/^\/api\/invoice\/\d+\/cancel$/)) {
    return invoiceCancelHandler(req);
  }

  if (path.match(/^\/api\/invoice\/\d+$/)) {
    return invoiceByIdHandler(req);
  }

  if (path.startsWith("/api/invoices/")) {
    return invoicesHandler(req);
  }

  // 404
  return Promise.resolve(
    new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    })
  );
}

console.log(`Starting local test server on http://localhost:${PORT}`);
console.log("Available endpoints:");
console.log("  GET  /api              - API info (v4.0.0)");
console.log("  GET  /api/agents       - List agents");
console.log("  GET  /api/balance/:name - Get balance");
console.log("  GET  /api/resolve/:name - Resolve name");
console.log("  GET  /api/leaderboard  - Leaderboard");
console.log("  GET  /api/due          - Due subscriptions");
console.log("  GET  /api/subscriptions - All subscriptions");
console.log("  GET  /api/allowances   - List allowances");
console.log("  POST /api/register     - Register agent");
console.log("  POST /api/send         - Send USDC (supports memo)");
console.log("  POST /api/batch        - Batch payment (supports memo)");
console.log("  POST /api/split        - Split payment (supports memo)");
console.log("  POST /api/subscribe    - Create subscription");
console.log("  DELETE /api/subscribe  - Cancel subscription");
console.log("  POST /api/execute      - Execute subscription");
console.log("  POST /api/limit        - Set daily spending limit");
console.log("  POST /api/approve      - Approve allowance");
console.log("  POST /api/transfer-from - Pull payment (transferFrom)");
console.log("  POST /api/revoke       - Revoke allowance");
console.log("  -- v4: Invoice --");
console.log("  POST /api/init-counter - Initialize invoice counter (once)");
console.log("  POST /api/invoice      - Create invoice");
console.log("  GET  /api/invoice/:id  - Get invoice details");
console.log("  POST /api/invoice/:id/pay - Pay invoice");
console.log("  POST /api/invoice/:id/reject - Reject invoice");
console.log("  POST /api/invoice/:id/cancel - Cancel invoice");
console.log("  GET  /api/invoices/:name - List invoices for agent");
console.log("  -- v4: Webhook --");
console.log("  POST /api/webhook      - Register webhook");
console.log("  DELETE /api/webhook    - Remove webhook");
console.log("  GET  /api/webhook?name=X - Check webhook config");
console.log("  -- v4: Refund --");
console.log("  POST /api/refund       - Refund a payment");

Bun.serve({
  port: PORT,
  fetch: handleRequest,
});
