import {
  jsonResponse,
  errorResponse,
  corsHeaders,
  getAgentPDAs,
  connection,
  PROGRAM_ID,
  USDC_MINT,
  TOKEN_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  RENT_SYSVAR,
} from "./shared";

export const config = { runtime: "edge" };

export default async function handler(req: Request) {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  try {
    const { name, wallet } = await req.json();

    if (!name || !wallet) {
      return errorResponse("Missing name or wallet");
    }

    if (name.length < 1 || name.length > 32) {
      return errorResponse("Name must be between 1 and 32 characters");
    }

    const { agentRegistry, vault } = getAgentPDAs(name);

    // Check if name already registered
    const existingAccount = await connection.getAccountInfo(agentRegistry);
    if (existingAccount) {
      return errorResponse("Name already registered", 409);
    }

    return jsonResponse({
      success: true,
      message: "Ready to register",
      data: {
        name,
        wallet,
        agentRegistry: agentRegistry.toBase58(),
        vault: vault.toBase58(),
        programId: PROGRAM_ID.toBase58(),
        usdcMint: USDC_MINT.toBase58(),
        instruction: {
          name: "registerAgent",
          accounts: {
            agentRegistry: agentRegistry.toBase58(),
            vault: vault.toBase58(),
            usdcMint: USDC_MINT.toBase58(),
            authority: wallet,
            systemProgram: SYSTEM_PROGRAM_ID.toBase58(),
            tokenProgram: TOKEN_PROGRAM_ID.toBase58(),
            rent: RENT_SYSVAR.toBase58(),
          },
          args: { name },
        },
      },
    });
  } catch (error: any) {
    return errorResponse(error.message, 500);
  }
}
