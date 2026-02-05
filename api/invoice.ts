import {
  jsonResponse,
  errorResponse,
  corsHeaders,
  PROGRAM_ID,
  connection,
  getAgentPDAs,
  getInvoiceCounterPDA,
  getInvoicePDA,
  getProgram,
  SYSTEM_PROGRAM_ID,
  INVOICE_STATUS_NAMES,
} from "./shared";
import { PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";


/**
 * POST /api/invoice - Create a payment request (invoice)
 * Body: {
 *   requesterName: string,
 *   payerName: string,
 *   amount: number (USDC),
 *   memo: string,
 *   expiresInSeconds?: number (0 = never),
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
    const { requesterName, payerName, amount, memo, expiresInSeconds, wallet } =
      await req.json();

    // Validation
    if (!requesterName || !payerName || !amount || !memo || !wallet) {
      return errorResponse(
        "Missing required fields: requesterName, payerName, amount, memo, wallet"
      );
    }

    if (amount <= 0) {
      return errorResponse("Amount must be greater than 0");
    }

    if (requesterName === payerName) {
      return errorResponse("Cannot invoice yourself");
    }

    if (Buffer.byteLength(memo, "utf8") > 128) {
      return errorResponse("Memo exceeds 128 bytes");
    }

    const expiry = expiresInSeconds || 0;
    if (expiry < 0) {
      return errorResponse("Invalid expiry value");
    }

    const walletPubkey = new PublicKey(wallet);
    const requesterPDAs = getAgentPDAs(requesterName);
    const payerPDAs = getAgentPDAs(payerName);
    const counterPDA = getInvoiceCounterPDA();

    // Verify both agents exist
    const program = await getProgram();
    if (!program) {
      return errorResponse("Failed to load program", 503);
    }

    // Get current counter value to derive invoice PDA
    let counterValue: bigint;
    try {
      const counterAccount = await (program.account as any).invoiceCounter.fetch(
        counterPDA
      );
      counterValue = BigInt(counterAccount.count.toString());
    } catch (e) {
      return errorResponse(
        "Invoice counter not initialized. Call POST /api/init-counter first.",
        503
      );
    }

    const invoicePDA = getInvoicePDA(counterValue);
    const amountUnits = new BN(Math.floor(amount * 1_000_000));

    // Build create_invoice instruction
    const createInvoiceIx = await (program.methods as any)
      .createInvoice(payerName, amountUnits, memo, new BN(expiry))
      .accounts({
        invoice: invoicePDA,
        counter: counterPDA,
        requesterRegistry: requesterPDAs.agentRegistry,
        payerRegistry: payerPDAs.agentRegistry,
        authority: walletPubkey,
        feePayer: walletPubkey,
        systemProgram: SYSTEM_PROGRAM_ID,
      })
      .instruction();

    const transaction = new Transaction().add(createInvoiceIx);
    transaction.recentBlockhash = (
      await connection.getLatestBlockhash()
    ).blockhash;
    transaction.feePayer = walletPubkey;

    const serialized = transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    });

    const expiresAt =
      expiry > 0 ? Math.floor(Date.now() / 1000) + expiry : 0;

    return jsonResponse({
      success: true,
      invoiceId: Number(counterValue),
      invoice: invoicePDA.toBase58(),
      requester: requesterName,
      payer: payerName,
      amount,
      memo,
      status: "pending",
      expiresAt,
      expiresIn: expiry > 0 ? `${expiry} seconds` : "never",
      transaction: serialized.toString("base64"),
      message: "Sign and submit this transaction to create the invoice",
    });
  } catch (error: any) {
    return errorResponse(error.message, 500);
  }
}
