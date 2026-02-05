import {
  jsonResponse,
  errorResponse,
  corsHeaders,
  PROGRAM_ID,
  connection,
  getAgentPDAs,
  getProgram,
  getInvoicePDA,
  INVOICE_STATUS_NAMES,
  TOKEN_PROGRAM_ID,
} from "./shared";
import { PublicKey, Transaction } from "@solana/web3.js";
import BN from "bn.js";
import { notifyWebhook } from "./webhook";

export const config = { runtime: "edge" };

/**
 * POST /api/refund - Refund a previous payment
 * Body: {
 *   agentName: string,          // Who is issuing the refund (must be original receiver)
 *   invoiceId?: number,         // Original invoice ID (preferred method)
 *   amount?: number,            // Optional: partial refund. Omit for full refund.
 *   reason?: string,            // Optional: memo for the refund
 *   wallet: string
 * }
 */
export default async function handler(req: Request) {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  try {
    const { agentName, invoiceId, amount, reason, wallet } = await req.json();

    if (!agentName) {
      return errorResponse("Missing agentName (who is refunding)");
    }
    if (!wallet) {
      return errorResponse("Missing wallet address");
    }
    if (invoiceId === undefined) {
      return errorResponse(
        "Must provide invoiceId to identify the original payment"
      );
    }

    const walletPubkey = new PublicKey(wallet);

    const program = await getProgram();
    if (!program) {
      return errorResponse("Failed to load program", 503);
    }

    // Lookup invoice
    const invoicePDA = getInvoicePDA(invoiceId);
    let invoice: any;
    try {
      invoice = await (program.account as any).invoice.fetch(invoicePDA);
    } catch (e) {
      return errorResponse(`Invoice #${invoiceId} not found`, 404);
    }

    // Check invoice was paid
    if (invoice.status !== 1) {
      // STATUS_PAID = 1
      return errorResponse(
        `Can only refund paid invoices (status: ${INVOICE_STATUS_NAMES[invoice.status] || "unknown"})`
      );
    }

    // Verify agentName was the receiver (requester)
    if (invoice.requesterName !== agentName) {
      return errorResponse(
        `Only ${invoice.requesterName} (the payment receiver) can issue a refund`
      );
    }

    const originalReceiver = invoice.requesterName;
    const originalSender = invoice.payerName;
    const originalAmount = invoice.amount.toNumber() / 1_000_000;

    // Determine refund amount
    const refundAmount = amount || originalAmount;

    if (refundAmount > originalAmount) {
      return errorResponse(
        `Refund amount (${refundAmount}) exceeds original payment (${originalAmount})`
      );
    }

    // Build refund memo
    let refundMemo = reason
      ? `Refund: ${reason} (ref: invoice#${invoiceId})`
      : `Refund (ref: invoice#${invoiceId})`;

    // Truncate memo to 128 bytes if needed
    if (Buffer.byteLength(refundMemo, "utf8") > 128) {
      refundMemo = refundMemo.substring(0, 120) + "...";
    }

    // Get sender/receiver PDAs for the refund (reversed from original)
    const senderPDAs = getAgentPDAs(originalReceiver); // refund sender = original receiver
    const receiverPDAs = getAgentPDAs(originalSender); // refund recipient = original sender

    // Build transfer_by_name instruction for the refund
    const refundAmountUnits = new BN(Math.floor(refundAmount * 1_000_000));

    const transferIx = await (program.methods as any)
      .transferByName(refundAmountUnits, refundMemo)
      .accounts({
        senderRegistry: senderPDAs.agentRegistry,
        senderVault: senderPDAs.vault,
        receiverRegistry: receiverPDAs.agentRegistry,
        receiverVault: receiverPDAs.vault,
        authority: walletPubkey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();

    const transaction = new Transaction().add(transferIx);
    transaction.recentBlockhash = (
      await connection.getLatestBlockhash()
    ).blockhash;
    transaction.feePayer = walletPubkey;

    const serialized = transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    });

    // Schedule webhook notification for after the user submits
    // (The actual webhook will fire when they submit - we can't do it here)

    return jsonResponse({
      success: true,
      refund: {
        from: originalReceiver,
        to: originalSender,
        amount: refundAmount,
        fullRefund: refundAmount === originalAmount,
        reason: reason || null,
        originalInvoice: invoiceId,
        memo: refundMemo,
      },
      transaction: serialized.toString("base64"),
      message: `Sign and submit to refund ${refundAmount} USDC from ${originalReceiver} to ${originalSender}`,
    });
  } catch (error: any) {
    if (error.message?.includes("SpendingCapExceeded")) {
      return errorResponse(
        "Refund would exceed your daily spending limit. Increase your cap or wait until tomorrow."
      );
    }
    return errorResponse(error.message, 500);
  }
}
