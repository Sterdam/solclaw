import {
  jsonResponse,
  errorResponse,
  corsHeaders,
  PROGRAM_ID,
  connection,
  getProgram,
  getInvoicePDA,
  INVOICE_STATUS_NAMES,
  TOKEN_PROGRAM_ID,
} from "../../shared";
import { PublicKey, Transaction } from "@solana/web3.js";


/**
 * POST /api/invoice/:id/pay - Pay a pending invoice
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

    // Fetch invoice to get payer/requester info
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

    // Check expiry
    const now = Math.floor(Date.now() / 1000);
    if (invoice.expiresAt.toNumber() > 0 && now > invoice.expiresAt.toNumber()) {
      return errorResponse("Invoice has expired");
    }

    // Get payer and requester registries
    const payerRegistry = await (program.account as any).agentRegistry.fetch(
      invoice.payer
    );
    const requesterRegistry = await (program.account as any).agentRegistry.fetch(
      invoice.requester
    );

    // Build pay_invoice instruction
    const payInvoiceIx = await (program.methods as any)
      .payInvoice()
      .accounts({
        invoice: invoicePDA,
        payerRegistry: invoice.payer,
        requesterRegistry: invoice.requester,
        payerVault: payerRegistry.vault,
        requesterVault: requesterRegistry.vault,
        authority: walletPubkey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();

    const transaction = new Transaction().add(payInvoiceIx);
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
      memo: invoice.memo,
      transaction: serialized.toString("base64"),
      message: `Sign and submit to pay invoice #${invoiceId}: ${invoice.amount.toNumber() / 1_000_000} USDC to ${invoice.requesterName}`,
    });
  } catch (error: any) {
    if (error.message?.includes("SpendingCapExceeded")) {
      return errorResponse("Payment would exceed daily spending limit");
    }
    return errorResponse(error.message, 500);
  }
}
