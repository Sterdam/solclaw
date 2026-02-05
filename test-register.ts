import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import {
  Connection,
  PublicKey,
  Keypair,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import * as fs from "fs";

const PROGRAM_ID = new PublicKey("J4qipHcPyaPkVs8ymCLcpgqSDJeoSn3k1LJLK7Q9DZ5H");
const USDC_MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

async function main() {
  // Load wallet
  const keyPath = process.env.HOME + "/.config/solana/id.json";
  const secretKey = JSON.parse(fs.readFileSync(keyPath, "utf-8"));
  const keypair = Keypair.fromSecretKey(Uint8Array.from(secretKey));
  const wallet = new anchor.Wallet(keypair);

  console.log("Wallet:", wallet.publicKey.toBase58());

  // Connect to devnet
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const provider = new AnchorProvider(connection, wallet, {
    preflightCommitment: "confirmed",
  });
  anchor.setProvider(provider);

  // Load IDL
  const idl = await Program.fetchIdl(PROGRAM_ID, provider);
  if (!idl) {
    throw new Error("Failed to fetch IDL");
  }
  const program = new Program(idl as any, provider);

  // Register agent
  const name = "TestAgent";
  const [agentRegistry] = PublicKey.findProgramAddressSync(
    [Buffer.from("agent"), Buffer.from(name)],
    PROGRAM_ID
  );
  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), Buffer.from(name)],
    PROGRAM_ID
  );

  console.log("Agent Registry PDA:", agentRegistry.toBase58());
  console.log("Vault PDA:", vault.toBase58());

  try {
    const tx = await program.methods
      .registerAgent(name)
      .accounts({
        agentRegistry,
        vault,
        usdcMint: USDC_MINT,
        authority: wallet.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    console.log("Transaction:", tx);
    console.log("Agent registered successfully!");
    console.log(`Explorer: https://explorer.solana.com/tx/${tx}?cluster=devnet`);
  } catch (error: any) {
    if (error.message.includes("already in use")) {
      console.log("Agent already registered, that's OK!");
    } else {
      throw error;
    }
  }
}

main().catch(console.error);
