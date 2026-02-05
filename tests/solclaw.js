const anchor = require("@coral-xyz/anchor");
const { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } = require("@solana/web3.js");
const { TOKEN_PROGRAM_ID } = require("@solana/spl-token");

const PROGRAM_ID = new PublicKey("J4qipHcPyaPkVs8ymCLcpgqSDJeoSn3k1LJLK7Q9DZ5H");
const USDC_MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

describe("solclaw", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  let program;

  before(async () => {
    const idl = await anchor.Program.fetchIdl(PROGRAM_ID, provider);
    program = new anchor.Program(idl, provider);
  });

  it("Registers SolClawTest agent", async () => {
    const name = "SolClawTest";

    const [agentRegistry] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), Buffer.from(name)],
      PROGRAM_ID
    );
    const [vault] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), Buffer.from(name)],
      PROGRAM_ID
    );

    console.log("Registering agent:", name);
    console.log("Agent Registry PDA:", agentRegistry.toBase58());
    console.log("Vault PDA:", vault.toBase58());

    try {
      const tx = await program.methods
        .registerAgent(name)
        .accounts({
          agentRegistry,
          vault,
          usdcMint: USDC_MINT,
          authority: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .rpc();

      console.log("Transaction:", tx);
      console.log(`Explorer: https://explorer.solana.com/tx/${tx}?cluster=devnet`);
    } catch (error) {
      if (error.message && error.message.includes("already in use")) {
        console.log("Agent already registered!");
      } else {
        throw error;
      }
    }

    const agent = await program.account.agentRegistry.fetch(agentRegistry);
    console.log("Agent name:", agent.name);
    console.log("Authority:", agent.authority.toBase58());
    console.log("Vault:", agent.vault.toBase58());
  });

  it("Registers ReceiverBot agent", async () => {
    const name = "ReceiverBot";

    const [agentRegistry] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), Buffer.from(name)],
      PROGRAM_ID
    );
    const [vault] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), Buffer.from(name)],
      PROGRAM_ID
    );

    console.log("Registering agent:", name);

    try {
      const tx = await program.methods
        .registerAgent(name)
        .accounts({
          agentRegistry,
          vault,
          usdcMint: USDC_MINT,
          authority: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .rpc();

      console.log("Transaction:", tx);
    } catch (error) {
      if (error.message && error.message.includes("already in use")) {
        console.log("Agent already registered!");
      } else {
        throw error;
      }
    }
  });
});
