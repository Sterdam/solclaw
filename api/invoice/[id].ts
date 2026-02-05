import {
  jsonResponse,
  errorResponse,
  corsHeaders,
  getProgram,
  getInvoicePDA,
  INVOICE_STATUS_NAMES,
} from "../shared";


/**
 * GET /api/invoice/:id - Get invoice details
 */
export default async function handler(req: Request) {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "GET") {
    return errorResponse("Method not allowed", 405);
  }

  try {
    // Extract ID from URL
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/");
    const id = pathParts[pathParts.length - 1];

    const invoiceId = parseInt(id, 10);
    if (isNaN(invoiceId) || invoiceId < 0) {
      return errorResponse("Invalid invoice ID");
    }

    const program = await getProgram();
    if (!program) {
      return errorResponse("Failed to load program", 503);
    }

    const invoicePDA = getInvoicePDA(invoiceId);

    try {
      const invoice = await (program.account as any).invoice.fetch(invoicePDA);

      // Check if invoice has expired
      const now = Math.floor(Date.now() / 1000);
      let status = INVOICE_STATUS_NAMES[invoice.status] || "unknown";
      if (
        status === "pending" &&
        invoice.expiresAt.toNumber() > 0 &&
        now > invoice.expiresAt.toNumber()
      ) {
        status = "expired";
      }

      return jsonResponse({
        id: invoiceId,
        invoicePDA: invoicePDA.toBase58(),
        requester: invoice.requesterName,
        requesterPDA: invoice.requester.toBase58(),
        payer: invoice.payerName,
        payerPDA: invoice.payer.toBase58(),
        amount: invoice.amount.toNumber() / 1_000_000,
        amountRaw: invoice.amount.toNumber(),
        memo: invoice.memo,
        status,
        statusCode: invoice.status,
        createdAt: invoice.createdAt.toNumber(),
        expiresAt: invoice.expiresAt.toNumber(),
        paidAt: invoice.paidAt.toNumber(),
        authority: invoice.authority.toBase58(),
      });
    } catch (e: any) {
      if (e.message?.includes("Account does not exist")) {
        return errorResponse("Invoice not found", 404);
      }
      throw e;
    }
  } catch (error: any) {
    return errorResponse(error.message, 500);
  }
}
