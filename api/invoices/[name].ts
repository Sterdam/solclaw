import {
  jsonResponse,
  errorResponse,
  corsHeaders,
  getProgram,
  getAgentPDAs,
  INVOICE_STATUS_NAMES,
} from "../shared";


/**
 * GET /api/invoices/:name - List invoices for an agent
 * Query params:
 *   role: "payer" | "requester" | "both" (default: "both")
 *   status: "pending" | "paid" | "rejected" | "cancelled" | "expired" | "all" (default: "all")
 */
export default async function handler(req: Request) {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "GET") {
    return errorResponse("Method not allowed", 405);
  }

  try {
    // Extract name from URL
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/");
    const name = decodeURIComponent(pathParts[pathParts.length - 1]);

    if (!name) {
      return errorResponse("Missing agent name");
    }

    const role = url.searchParams.get("role") || "both";
    const statusFilter = url.searchParams.get("status") || "all";

    const program = await getProgram();
    if (!program) {
      return errorResponse("Failed to load program", 503);
    }

    const { agentRegistry } = getAgentPDAs(name);
    const invoices: any[] = [];
    const now = Math.floor(Date.now() / 1000);

    // Fetch invoices where agent is requester
    if (role === "requester" || role === "both") {
      try {
        const asRequester = await (program.account as any).invoice.all([
          {
            memcmp: {
              offset: 8 + 8, // after discriminator + id
              bytes: agentRegistry.toBase58(),
            },
          },
        ]);

        for (const acc of asRequester) {
          let status = INVOICE_STATUS_NAMES[acc.account.status] || "unknown";
          if (
            status === "pending" &&
            acc.account.expiresAt.toNumber() > 0 &&
            now > acc.account.expiresAt.toNumber()
          ) {
            status = "expired";
          }

          invoices.push({
            id: acc.account.id.toNumber(),
            role: "requester",
            requester: acc.account.requesterName,
            payer: acc.account.payerName,
            amount: acc.account.amount.toNumber() / 1_000_000,
            memo: acc.account.memo,
            status,
            statusCode: acc.account.status,
            createdAt: acc.account.createdAt.toNumber(),
            expiresAt: acc.account.expiresAt.toNumber(),
            paidAt: acc.account.paidAt.toNumber(),
          });
        }
      } catch (e) {
        // No invoices as requester
      }
    }

    // Fetch invoices where agent is payer
    if (role === "payer" || role === "both") {
      try {
        const asPayer = await (program.account as any).invoice.all([
          {
            memcmp: {
              offset: 8 + 8 + 32, // after discriminator + id + requester
              bytes: agentRegistry.toBase58(),
            },
          },
        ]);

        for (const acc of asPayer) {
          let status = INVOICE_STATUS_NAMES[acc.account.status] || "unknown";
          if (
            status === "pending" &&
            acc.account.expiresAt.toNumber() > 0 &&
            now > acc.account.expiresAt.toNumber()
          ) {
            status = "expired";
          }

          invoices.push({
            id: acc.account.id.toNumber(),
            role: "payer",
            requester: acc.account.requesterName,
            payer: acc.account.payerName,
            amount: acc.account.amount.toNumber() / 1_000_000,
            memo: acc.account.memo,
            status,
            statusCode: acc.account.status,
            createdAt: acc.account.createdAt.toNumber(),
            expiresAt: acc.account.expiresAt.toNumber(),
            paidAt: acc.account.paidAt.toNumber(),
          });
        }
      } catch (e) {
        // No invoices as payer
      }
    }

    // Filter by status
    let filteredInvoices = invoices;
    if (statusFilter !== "all") {
      filteredInvoices = invoices.filter((inv) => inv.status === statusFilter);
    }

    // Sort by creation time, newest first
    filteredInvoices.sort((a, b) => b.createdAt - a.createdAt);

    return jsonResponse({
      agent: name,
      role,
      statusFilter,
      count: filteredInvoices.length,
      invoices: filteredInvoices,
    });
  } catch (error: any) {
    return errorResponse(error.message, 500);
  }
}
