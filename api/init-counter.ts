import {
  jsonResponse,
  errorResponse,
  corsHeaders,
  PROGRAM_ID,
  connection,
  getInvoiceCounterPDA,
  SYSTEM_PROGRAM_ID,
} from "./shared";
import { PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";

export const config = { runtime: "edge" };

// Initialize invoice counter - call once after program deploy
export default async function handler(req: Request) {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  try {
    const { wallet } = await req.json();

    if (!wallet) {
      return errorResponse("Missing wallet address");
    }

    const walletPubkey = new PublicKey(wallet);
    const counterPDA = getInvoiceCounterPDA();

    // Check if counter already exists
    const accountInfo = await connection.getAccountInfo(counterPDA);
    if (accountInfo) {
      return jsonResponse({
        success: false,
        message: "Invoice counter already initialized",
        counter: counterPDA.toBase58(),
      });
    }

    // Build init_invoice_counter instruction
    const initCounterIx = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: counterPDA, isSigner: false, isWritable: true },
        { pubkey: walletPubkey, isSigner: true, isWritable: true },
        { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: Buffer.from([175, 175, 109, 31, 13, 152, 155, 237]), // init_invoice_counter discriminator
    });

    const transaction = new Transaction().add(initCounterIx);
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
      message: "Sign and submit this transaction to initialize the invoice counter",
      counter: counterPDA.toBase58(),
      transaction: serialized.toString("base64"),
    });
  } catch (error: any) {
    return errorResponse(error.message, 500);
  }
}
