import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import {
  Connection,
  PublicKey,
  Keypair,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
} from "@solana/spl-token";

// Program ID on devnet
export const PROGRAM_ID = new PublicKey(
  "J4qipHcPyaPkVs8ymCLcpgqSDJeoSn3k1LJLK7Q9DZ5H"
);

// USDC Mint on Solana Devnet
export const USDC_MINT = new PublicKey(
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
);

// IDL type
export interface SolclawIDL {
  version: string;
  name: string;
  instructions: any[];
  accounts: any[];
  errors: any[];
}

// Agent Registry type
export interface AgentRegistry {
  nameHash: number[];
  name: string;
  authority: PublicKey;
  vault: PublicKey;
  createdAt: BN;
  totalSent: BN;
  totalReceived: BN;
  bump: number;
  vaultBump: number;
}

// Subscription type
export interface Subscription {
  sender: PublicKey;
  receiver: PublicKey;
  senderName: string;
  receiverName: string;
  amount: BN;
  intervalSeconds: BN;
  lastExecuted: BN;
  nextDue: BN;
  isActive: boolean;
  authority: PublicKey;
  totalPaid: BN;
  executionCount: BN;
  bump: number;
}

// Batch payment entry
export interface BatchPaymentEntry {
  recipientName: string;
  amount: number; // In USDC (not units)
}

// Split recipient
export interface SplitRecipient {
  name: string;
  shareBps: number; // Basis points (5000 = 50%)
}

// SDK class
export class SolclawSDK {
  private connection: Connection;
  private provider: AnchorProvider | null = null;
  private program: Program | null = null;

  constructor(rpcUrl: string = "https://api.devnet.solana.com") {
    this.connection = new Connection(rpcUrl, "confirmed");
  }

  /**
   * Initialize the SDK with a wallet for signing transactions
   */
  async initialize(wallet: anchor.Wallet): Promise<void> {
    this.provider = new AnchorProvider(this.connection, wallet, {
      preflightCommitment: "confirmed",
    });
    anchor.setProvider(this.provider);

    // Load IDL from chain
    const idl = await Program.fetchIdl(PROGRAM_ID, this.provider);
    if (!idl) {
      throw new Error("Failed to fetch IDL from chain");
    }
    this.program = new Program(idl as any, this.provider);
  }

  /**
   * Get PDA addresses for an agent
   */
  getAgentPDAs(name: string): {
    agentRegistry: PublicKey;
    vault: PublicKey;
  } {
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

  /**
   * Get PDA for a subscription
   */
  getSubscriptionPDA(senderName: string, receiverName: string): PublicKey {
    const senderPDAs = this.getAgentPDAs(senderName);
    const receiverPDAs = this.getAgentPDAs(receiverName);

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

  /**
   * Register a new agent with a human-readable name
   */
  async registerAgent(name: string): Promise<string> {
    if (!this.program || !this.provider) {
      throw new Error("SDK not initialized. Call initialize() first.");
    }

    if (name.length < 1 || name.length > 32) {
      throw new Error("Name must be between 1 and 32 characters");
    }

    const { agentRegistry, vault } = this.getAgentPDAs(name);

    const tx = await this.program.methods
      .registerAgent(name)
      .accounts({
        agentRegistry,
        vault,
        usdcMint: USDC_MINT,
        authority: this.provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    return tx;
  }

  /**
   * Deposit USDC into an agent's vault
   */
  async deposit(name: string, amount: number): Promise<string> {
    if (!this.program || !this.provider) {
      throw new Error("SDK not initialized. Call initialize() first.");
    }

    const { agentRegistry, vault } = this.getAgentPDAs(name);

    // Get user's USDC token account
    const userTokenAccount = await getAssociatedTokenAddress(
      USDC_MINT,
      this.provider.wallet.publicKey
    );

    // Convert amount to USDC units (6 decimals)
    const amountUnits = Math.floor(amount * 1_000_000);

    const tx = await this.program.methods
      .deposit(new BN(amountUnits))
      .accounts({
        agentRegistry,
        vault,
        userTokenAccount,
        authority: this.provider.wallet.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    return tx;
  }

  /**
   * Transfer USDC from one agent to another by name
   */
  async transferByName(
    fromName: string,
    toName: string,
    amount: number
  ): Promise<string> {
    if (!this.program || !this.provider) {
      throw new Error("SDK not initialized. Call initialize() first.");
    }

    const senderPDAs = this.getAgentPDAs(fromName);
    const receiverPDAs = this.getAgentPDAs(toName);

    // Convert amount to USDC units (6 decimals)
    const amountUnits = Math.floor(amount * 1_000_000);

    const tx = await this.program.methods
      .transferByName(new BN(amountUnits))
      .accounts({
        senderRegistry: senderPDAs.agentRegistry,
        senderVault: senderPDAs.vault,
        receiverRegistry: receiverPDAs.agentRegistry,
        receiverVault: receiverPDAs.vault,
        authority: this.provider.wallet.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    return tx;
  }

  /**
   * Withdraw USDC from vault to user's wallet
   */
  async withdraw(name: string, amount: number): Promise<string> {
    if (!this.program || !this.provider) {
      throw new Error("SDK not initialized. Call initialize() first.");
    }

    const { agentRegistry, vault } = this.getAgentPDAs(name);

    // Get or create user's USDC token account
    const destination = await getAssociatedTokenAddress(
      USDC_MINT,
      this.provider.wallet.publicKey
    );

    // Check if destination account exists
    try {
      await getAccount(this.connection, destination);
    } catch {
      // Create associated token account if it doesn't exist
      const createAtaIx = createAssociatedTokenAccountInstruction(
        this.provider.wallet.publicKey,
        destination,
        this.provider.wallet.publicKey,
        USDC_MINT
      );
      await this.provider.sendAndConfirm(
        new anchor.web3.Transaction().add(createAtaIx)
      );
    }

    // Convert amount to USDC units (6 decimals)
    const amountUnits = Math.floor(amount * 1_000_000);

    const tx = await this.program.methods
      .withdraw(new BN(amountUnits))
      .accounts({
        agentRegistry,
        vault,
        destination,
        authority: this.provider.wallet.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    return tx;
  }

  /**
   * Get agent registry info
   */
  async getAgent(name: string): Promise<AgentRegistry | null> {
    if (!this.program) {
      throw new Error("SDK not initialized. Call initialize() first.");
    }

    const { agentRegistry } = this.getAgentPDAs(name);

    try {
      const account = await (this.program.account as any).agentRegistry.fetch(
        agentRegistry
      );
      return account as AgentRegistry;
    } catch {
      return null;
    }
  }

  /**
   * Get vault balance for an agent
   */
  async getBalance(name: string): Promise<number> {
    const { vault } = this.getAgentPDAs(name);

    try {
      const account = await getAccount(this.connection, vault);
      return Number(account.amount) / 1_000_000; // Convert to USDC
    } catch {
      return 0;
    }
  }

  /**
   * Check if an agent name is already registered
   */
  async isNameRegistered(name: string): Promise<boolean> {
    const agent = await this.getAgent(name);
    return agent !== null;
  }

  /**
   * Resolve name to vault address
   */
  resolveNameToVault(name: string): PublicKey {
    const { vault } = this.getAgentPDAs(name);
    return vault;
  }

  /**
   * Get all registered agents (fetch from program accounts)
   */
  async getAllAgents(): Promise<AgentRegistry[]> {
    if (!this.program) {
      throw new Error("SDK not initialized. Call initialize() first.");
    }

    const accounts = await (this.program.account as any).agentRegistry.all();
    return accounts.map((a: any) => a.account as AgentRegistry);
  }

  /**
   * Get leaderboard (top agents by total sent + received)
   */
  async getLeaderboard(limit: number = 10): Promise<AgentRegistry[]> {
    const agents = await this.getAllAgents();

    return agents
      .sort((a, b) => {
        const aTotal = Number(a.totalSent) + Number(a.totalReceived);
        const bTotal = Number(b.totalSent) + Number(b.totalReceived);
        return bTotal - aTotal;
      })
      .slice(0, limit);
  }

  // ============================================================
  // BATCH PAYMENT
  // ============================================================

  /**
   * Batch pay multiple agents in one transaction
   * Max 10 recipients per batch
   */
  async batchPayment(
    senderName: string,
    payments: BatchPaymentEntry[]
  ): Promise<string> {
    if (!this.program || !this.provider) {
      throw new Error("SDK not initialized. Call initialize() first.");
    }

    if (payments.length < 1 || payments.length > 10) {
      throw new Error("Batch must contain 1-10 payments");
    }

    const senderPDAs = this.getAgentPDAs(senderName);

    // Build remaining accounts (registry + vault for each recipient)
    const remainingAccounts: {
      pubkey: PublicKey;
      isSigner: boolean;
      isWritable: boolean;
    }[] = [];

    // Format payments for the contract
    const paymentEntries = payments.map((p) => ({
      recipientName: p.recipientName,
      amount: new BN(Math.floor(p.amount * 1_000_000)),
    }));

    for (const payment of payments) {
      const recipientPDAs = this.getAgentPDAs(payment.recipientName);
      remainingAccounts.push({
        pubkey: recipientPDAs.agentRegistry,
        isSigner: false,
        isWritable: true,
      });
      remainingAccounts.push({
        pubkey: recipientPDAs.vault,
        isSigner: false,
        isWritable: true,
      });
    }

    const tx = await this.program.methods
      .batchPayment(paymentEntries)
      .accounts({
        senderRegistry: senderPDAs.agentRegistry,
        senderVault: senderPDAs.vault,
        authority: this.provider.wallet.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .remainingAccounts(remainingAccounts)
      .rpc();

    return tx;
  }

  // ============================================================
  // SPLIT PAYMENT
  // ============================================================

  /**
   * Split a total amount across multiple agents proportionally
   * Shares must sum to 10000 (100% in basis points)
   * Max 10 recipients
   */
  async splitPayment(
    senderName: string,
    totalAmount: number,
    recipients: SplitRecipient[]
  ): Promise<string> {
    if (!this.program || !this.provider) {
      throw new Error("SDK not initialized. Call initialize() first.");
    }

    if (recipients.length < 2 || recipients.length > 10) {
      throw new Error("Split must have 2-10 recipients");
    }

    // Validate shares sum to 10000
    const totalBps = recipients.reduce((sum, r) => sum + r.shareBps, 0);
    if (totalBps !== 10000) {
      throw new Error("Shares must sum to 10000 basis points (100%)");
    }

    const senderPDAs = this.getAgentPDAs(senderName);

    // Build remaining accounts
    const remainingAccounts: {
      pubkey: PublicKey;
      isSigner: boolean;
      isWritable: boolean;
    }[] = [];

    // Format recipients for the contract
    const splitRecipients = recipients.map((r) => ({
      name: r.name,
      shareBps: r.shareBps,
    }));

    for (const recipient of recipients) {
      const recipientPDAs = this.getAgentPDAs(recipient.name);
      remainingAccounts.push({
        pubkey: recipientPDAs.agentRegistry,
        isSigner: false,
        isWritable: true,
      });
      remainingAccounts.push({
        pubkey: recipientPDAs.vault,
        isSigner: false,
        isWritable: true,
      });
    }

    const amountUnits = Math.floor(totalAmount * 1_000_000);

    const tx = await this.program.methods
      .splitPayment(new BN(amountUnits), splitRecipients)
      .accounts({
        senderRegistry: senderPDAs.agentRegistry,
        senderVault: senderPDAs.vault,
        authority: this.provider.wallet.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .remainingAccounts(remainingAccounts)
      .rpc();

    return tx;
  }

  // ============================================================
  // SUBSCRIPTIONS
  // ============================================================

  /**
   * Create a recurring payment subscription
   * @param senderName - Name of the paying agent
   * @param receiverName - Name of the receiving agent
   * @param amount - Amount per payment in USDC
   * @param intervalSeconds - Interval between payments in seconds (min 60)
   */
  async createSubscription(
    senderName: string,
    receiverName: string,
    amount: number,
    intervalSeconds: number
  ): Promise<string> {
    if (!this.program || !this.provider) {
      throw new Error("SDK not initialized. Call initialize() first.");
    }

    if (intervalSeconds < 60) {
      throw new Error("Interval must be at least 60 seconds");
    }

    const senderPDAs = this.getAgentPDAs(senderName);
    const receiverPDAs = this.getAgentPDAs(receiverName);
    const subscription = this.getSubscriptionPDA(senderName, receiverName);

    const amountUnits = Math.floor(amount * 1_000_000);

    const tx = await this.program.methods
      .createSubscription(receiverName, new BN(amountUnits), new BN(intervalSeconds))
      .accounts({
        subscription,
        senderRegistry: senderPDAs.agentRegistry,
        receiverRegistry: receiverPDAs.agentRegistry,
        authority: this.provider.wallet.publicKey,
        payer: this.provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return tx;
  }

  /**
   * Execute a due subscription payment (permissionless crank)
   * Anyone can call this for any due subscription
   */
  async executeSubscription(
    senderName: string,
    receiverName: string
  ): Promise<string> {
    if (!this.program || !this.provider) {
      throw new Error("SDK not initialized. Call initialize() first.");
    }

    const senderPDAs = this.getAgentPDAs(senderName);
    const receiverPDAs = this.getAgentPDAs(receiverName);
    const subscription = this.getSubscriptionPDA(senderName, receiverName);

    const tx = await this.program.methods
      .executeSubscription()
      .accounts({
        subscription,
        senderRegistry: senderPDAs.agentRegistry,
        receiverRegistry: receiverPDAs.agentRegistry,
        senderVault: senderPDAs.vault,
        receiverVault: receiverPDAs.vault,
        tokenProgram: TOKEN_PROGRAM_ID,
        cranker: this.provider.wallet.publicKey,
      })
      .rpc();

    return tx;
  }

  /**
   * Cancel an active subscription
   * Only the sender (authority) can cancel
   */
  async cancelSubscription(
    senderName: string,
    receiverName: string
  ): Promise<string> {
    if (!this.program || !this.provider) {
      throw new Error("SDK not initialized. Call initialize() first.");
    }

    const subscription = this.getSubscriptionPDA(senderName, receiverName);

    const tx = await this.program.methods
      .cancelSubscription()
      .accounts({
        subscription,
        authority: this.provider.wallet.publicKey,
      })
      .rpc();

    return tx;
  }

  /**
   * Get subscription details
   */
  async getSubscription(
    senderName: string,
    receiverName: string
  ): Promise<Subscription | null> {
    if (!this.program) {
      throw new Error("SDK not initialized. Call initialize() first.");
    }

    const subscription = this.getSubscriptionPDA(senderName, receiverName);

    try {
      const account = await (this.program.account as any).subscription.fetch(
        subscription
      );
      return account as Subscription;
    } catch {
      return null;
    }
  }

  /**
   * Get all subscriptions (for a specific sender or all)
   */
  async getAllSubscriptions(senderName?: string): Promise<Subscription[]> {
    if (!this.program) {
      throw new Error("SDK not initialized. Call initialize() first.");
    }

    const accounts = await (this.program.account as any).subscription.all();
    let subscriptions = accounts.map((a: any) => a.account as Subscription);

    if (senderName) {
      const senderPDAs = this.getAgentPDAs(senderName);
      subscriptions = subscriptions.filter(
        (s: Subscription) => s.sender.equals(senderPDAs.agentRegistry)
      );
    }

    return subscriptions;
  }

  /**
   * Get all due subscriptions that can be executed
   */
  async getDueSubscriptions(): Promise<
    { subscription: Subscription; senderName: string; receiverName: string }[]
  > {
    const subscriptions = await this.getAllSubscriptions();
    const now = Math.floor(Date.now() / 1000);

    return subscriptions
      .filter((s) => s.isActive && Number(s.nextDue) <= now)
      .map((s) => ({
        subscription: s,
        senderName: s.senderName,
        receiverName: s.receiverName,
      }));
  }
}

// Helper function to create wallet from private key
export function createWalletFromPrivateKey(
  privateKey: string | number[]
): anchor.Wallet {
  let secretKey: Uint8Array;

  if (typeof privateKey === "string") {
    // Assume base58 encoded
    const bs58 = require("bs58");
    secretKey = bs58.default.decode(privateKey);
  } else {
    secretKey = Uint8Array.from(privateKey);
  }

  const keypair = Keypair.fromSecretKey(secretKey);
  return new anchor.Wallet(keypair);
}

// Export types and constants
export { Connection, PublicKey, Keypair } from "@solana/web3.js";
export { BN } from "@coral-xyz/anchor";
