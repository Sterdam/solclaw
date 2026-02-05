import {
  jsonResponse,
  errorResponse,
  corsHeaders,
  connection,
  getProgram,
  getInvoicePDA,
  INVOICE_STATUS_NAMES,
} from "../../shared";
import { PublicKey, Transaction } from "@solana/web3.js";


/**
 * POST /api/invoice/:id/reject - Reject a pending invoice (as payer)
 * Body: { wallet: string }
 */
export default async function handler(req: Request) {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  try {
    // Extract ID from URL
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/");
    const idIndex = pathParts.indexOf("invoice") + 1;
    const id = pathParts[idIndex];

    const invoiceId = parseInt(id, 10);
    if (isNaN(invoiceId) || invoiceId < 0) {
      return errorResponse("Invalid invoice ID");
    }

    const { wallet } = await req.json();
    if (!wallet) {
      return errorResponse("Missing wallet address");
    }

    const walletPubkey = new PublicKey(wallet);

    const program = await getProgram();
    if (!program) {
      return errorResponse("Failed to load program", 503);
    }

    const invoicePDA = getInvoicePDA(invoiceId);

    // Fetch invoice
    let invoice: any;
    try {
      invoice = await (program.account as any).invoice.fetch(invoicePDA);
    } catch (e) {
      return errorResponse("Invoice not found", 404);
    }

    // Check invoice status
    if (invoice.status !== 0) {
      return errorResponse(
        `Invoice is not pending (status: ${INVOICE_STATUS_NAMES[invoice.status] || "unknown"})`
      );
    }

    // Build reject_invoice instruction
    const rejectInvoiceIx = await (program.methods as any)
      .rejectInvoice()
      .accounts({
        invoice: invoicePDA,
        payerRegistry: invoice.payer,
        authority: walletPubkey,
      })
      .instruction();

    const transaction = new Transaction().add(rejectInvoiceIx);
    transaction.recentBlockhash = (
      await connection.getLatestBlockhash()
    ).blockhash;
    transaction.feePayer = walletPubkey;

    const serialized = transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    });

    return jsonResponse({
      success: true,
      invoiceId,
      amount: invoice.amount.toNumber() / 1_000_000,
      payer: invoice.payerName,
      requester: invoice.requesterName,
      transaction: serialized.toString("base64"),
      message: `Sign and submit to reject invoice #${invoiceId}`,
    });
  } catch (error: any) {
    return errorResponse(error.message, 500);
  }
}
