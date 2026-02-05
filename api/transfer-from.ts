import {
  jsonResponse,
  errorResponse,
  corsHeaders,
  getAgentPDAs,
  getAllowancePDA,
  connection,
  TOKEN_PROGRAM_ID,
} from "./shared";


export default async function handler(req: Request) {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  try {
    const { owner, spender, amount, wallet, memo } = await req.json();

    if (!owner || !spender || !amount) {
      return errorResponse("Missing owner, spender, or amount");
    }

    // v3: Validate memo length
    if (memo && memo.length > 128) {
      return errorResponse("Memo exceeds 128 characters");
    }

    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      return errorResponse("Invalid amount");
    }

    const ownerPDAs = getAgentPDAs(owner);
    const spenderPDAs = getAgentPDAs(spender);

    // Verify owner exists
    const ownerAccount = await connection.getAccountInfo(ownerPDAs.agentRegistry);
    if (!ownerAccount) {
      return errorResponse(`Owner agent "${owner}" not found`, 404);
    }

    // Verify spender exists
    const spenderAccount = await connection.getAccountInfo(spenderPDAs.agentRegistry);
    if (!spenderAccount) {
      return errorResponse(`Spender agent "${spender}" not found`, 404);
    }

    // Verify allowance exists
    const allowancePDA = getAllowancePDA(owner, spender);
    const allowanceAccount = await connection.getAccountInfo(allowancePDA);
    if (!allowanceAccount) {
      return errorResponse(`No allowance found from "${owner}" to "${spender}"`, 404);
    }

    const amountUnits = Math.floor(amountNum * 1_000_000);

    return jsonResponse({
      success: true,
      message: `Ready for ${spender} to pull ${amountNum} USDC from ${owner}`,
      data: {
        owner,
        spender,
        amount: amountNum,
        amountUnits,
        memo: memo || null,
        instruction: {
          name: "transferFrom",
          accounts: {
            allowance: allowancePDA.toBase58(),
            ownerRegistry: ownerPDAs.agentRegistry.toBase58(),
            spenderRegistry: spenderPDAs.agentRegistry.toBase58(),
            ownerVault: ownerPDAs.vault.toBase58(),
            spenderVault: spenderPDAs.vault.toBase58(),
            spenderAuthority: wallet || "SIGNER_REQUIRED",
            tokenProgram: TOKEN_PROGRAM_ID.toBase58(),
          },
          args: {
            amount: amountUnits,
            memo: memo || null,
          },
        },
      },
    });
  } catch (error: any) {
    return errorResponse(error.message, 500);
  }
}
