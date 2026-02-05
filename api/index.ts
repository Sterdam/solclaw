import { jsonResponse, corsHeaders, PROGRAM_ID, USDC_MINT } from "./shared";

export const config = { runtime: "edge" };

export default function handler() {
  return jsonResponse({
    name: "SolClaw API",
    version: "4.0.0",
    description: "Agent-to-Agent USDC payments by name on Solana (Serverless)",
    programId: PROGRAM_ID.toBase58(),
    usdcMint: USDC_MINT.toBase58(),
    network: "devnet",
    features: {
      core: "Register agents, send USDC by name",
      batch: "Pay up to 10 agents in one transaction",
      split: "Split payments with basis points",
      subscriptions: "Recurring payments with permissionless crank",
      memo: "v3: Optional memo on all transfers (128 bytes max)",
      spendingCap: "v3: Daily spending limits with auto-reset",
      allowance: "v3: ERC-20 style approve/transferFrom pattern",
      invoice: "v4: On-chain payment requests with expiry",
      webhook: "v4: Payment notifications with HMAC signatures",
      refund: "v4: Reverse payments with memo reference",
    },
    endpoints: {
      // Core
      register: "POST /api/register",
      send: "POST /api/send (supports memo)",
      balance: "GET /api/balance/[name]",
      resolve: "GET /api/resolve/[name]",
      agents: "GET /api/agents (includes spending cap info)",
      leaderboard: "GET /api/leaderboard",
      // Batch & Split
      batch: "POST /api/batch (supports memo per payment)",
      split: "POST /api/split (supports memo)",
      // Subscriptions
      subscribe: "POST /api/subscribe",
      executeSubscription: "POST /api/execute",
      cancelSubscription: "DELETE /api/subscribe",
      subscriptions: "GET /api/subscriptions",
      dueSubscriptions: "GET /api/due",
      // v3: Spending Cap
      setDailyLimit: "POST /api/limit",
      // v3: Allowances
      approve: "POST /api/approve",
      transferFrom: "POST /api/transfer-from",
      revoke: "POST /api/revoke",
      allowances: "GET /api/allowances",
      // v4: Invoice
      initCounter: "POST /api/init-counter (one-time setup)",
      createInvoice: "POST /api/invoice",
      getInvoice: "GET /api/invoice/[id]",
      payInvoice: "POST /api/invoice/[id]/pay",
      rejectInvoice: "POST /api/invoice/[id]/reject",
      cancelInvoice: "POST /api/invoice/[id]/cancel",
      listInvoices: "GET /api/invoices/[name]?role=both&status=all",
      // v4: Webhook
      registerWebhook: "POST /api/webhook",
      removeWebhook: "DELETE /api/webhook",
      checkWebhook: "GET /api/webhook?name=X",
      // v4: Refund
      refund: "POST /api/refund",
    },
  });
}
