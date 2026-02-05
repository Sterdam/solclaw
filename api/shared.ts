import { Connection, PublicKey } from "@solana/web3.js";
import { getAccount } from "@solana/spl-token";
import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider } from "@coral-xyz/anchor";

// Constants
export const PROGRAM_ID = new PublicKey(
  "J4qipHcPyaPkVs8ymCLcpgqSDJeoSn3k1LJLK7Q9DZ5H"
);
export const USDC_MINT = new PublicKey(
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
);
export const RPC_URL = process.env.RPC_URL || "https://api.devnet.solana.com";
export const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);
export const SYSTEM_PROGRAM_ID = new PublicKey(
  "11111111111111111111111111111111"
);
export const RENT_SYSVAR = new PublicKey(
  "SysvarRent111111111111111111111111111111111"
);

// Shared connection
export const connection = new Connection(RPC_URL, "confirmed");

// Get PDAs
export function getAgentPDAs(name: string) {
  const [agentRegistry] = PublicKey.findProgramAddressSync(
    [Buffer.from("agent"), Buffer.from(name)],
    PROGRAM_ID
  );
  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), Buffer.from(name)],
    PROGRAM_ID
  );
  return { agentRegistry, vault };
}

// Get Subscription PDA
export function getSubscriptionPDA(senderName: string, receiverName: string) {
  const senderPDAs = getAgentPDAs(senderName);
  const receiverPDAs = getAgentPDAs(receiverName);

  const [subscription] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("subscription"),
      senderPDAs.agentRegistry.toBuffer(),
      receiverPDAs.agentRegistry.toBuffer(),
    ],
    PROGRAM_ID
  );
  return subscription;
}

// v3: Get Allowance PDA
export function getAllowancePDA(ownerName: string, spenderName: string) {
  const ownerPDAs = getAgentPDAs(ownerName);
  const spenderPDAs = getAgentPDAs(spenderName);

  const [allowance] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("allowance"),
      ownerPDAs.agentRegistry.toBuffer(),
      spenderPDAs.agentRegistry.toBuffer(),
    ],
    PROGRAM_ID
  );
  return allowance;
}

// v4: Get Invoice Counter PDA
export function getInvoiceCounterPDA() {
  const [counter] = PublicKey.findProgramAddressSync(
    [Buffer.from("invoice_counter")],
    PROGRAM_ID
  );
  return counter;
}

// v4: Get Invoice PDA by ID
export function getInvoicePDA(invoiceId: number | bigint) {
  const idBuffer = Buffer.alloc(8);
  idBuffer.writeBigUInt64LE(BigInt(invoiceId));

  const [invoice] = PublicKey.findProgramAddressSync(
    [Buffer.from("invoice"), idBuffer],
    PROGRAM_ID
  );
  return invoice;
}

// v4: Invoice status constants
export const INVOICE_STATUS = {
  PENDING: 0,
  PAID: 1,
  REJECTED: 2,
  CANCELLED: 3,
  EXPIRED: 4,
};

export const INVOICE_STATUS_NAMES = ["pending", "paid", "rejected", "cancelled", "expired"];

// Get balance
export async function getVaultBalance(vault: PublicKey): Promise<number> {
  try {
    const account = await getAccount(connection, vault);
    return Number(account.amount) / 1_000_000;
  } catch {
    return 0;
  }
}

// Format interval
export function formatInterval(seconds: number): string {
  if (seconds < 60) return `${seconds} seconds`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours`;
  return `${Math.floor(seconds / 86400)} days`;
}

// Get program (lazy loaded)
let program: Program | null = null;

export async function getProgram(): Promise<Program | null> {
  if (program) return program;

  try {
    // Create a dummy wallet for read-only operations
    const dummyKeypair = anchor.web3.Keypair.generate();
    const dummyWallet = {
      publicKey: dummyKeypair.publicKey,
      signTransaction: async (tx: any) => tx,
      signAllTransactions: async (txs: any[]) => txs,
    };

    const provider = new AnchorProvider(connection, dummyWallet as any, {
      preflightCommitment: "confirmed",
    });

    const idl = await Program.fetchIdl(PROGRAM_ID, provider);
    if (idl) {
      program = new Program(idl as any, provider);
    }
  } catch (e) {
    console.error("Failed to load program:", e);
  }

  return program;
}

// CORS headers
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// JSON response helper
export function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
}

// Error response helper
export function errorResponse(message: string, status = 400) {
  return jsonResponse({ error: message }, status);
}
