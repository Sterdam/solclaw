import {
  jsonResponse,
  errorResponse,
  corsHeaders,
  getAgentPDAs,
  getAllowancePDA,
  connection,
  SYSTEM_PROGRAM_ID,
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
    const { owner, spender, amount, wallet } = await req.json();

    if (!owner || !spender || amount === undefined) {
      return errorResponse("Missing owner, spender, or amount");
    }

    if (owner === spender) {
      return errorResponse("Cannot approve yourself");
    }

    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum < 0) {
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

    const allowancePDA = getAllowancePDA(owner, spender);
    const amountUnits = Math.floor(amountNum * 1_000_000);

    return jsonResponse({
      success: true,
      message: `Ready to approve ${spender} to pull up to ${amountNum} USDC from ${owner}`,
      data: {
        owner,
        spender,
        amount: amountNum,
        amountUnits,
        allowancePDA: allowancePDA.toBase58(),
        instruction: {
          name: "approve",
          accounts: {
            allowance: allowancePDA.toBase58(),
            ownerRegistry: ownerPDAs.agentRegistry.toBase58(),
            spenderRegistry: spenderPDAs.agentRegistry.toBase58(),
            authority: wallet || "SIGNER_REQUIRED",
            payer: wallet || "SIGNER_REQUIRED",
            systemProgram: SYSTEM_PROGRAM_ID.toBase58(),
          },
          args: {
            spenderName: spender,
            amount: amountUnits,
          },
        },
      },
    });
  } catch (error: any) {
    return errorResponse(error.message, 500);
  }
}
