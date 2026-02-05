import {
  jsonResponse,
  errorResponse,
  corsHeaders,
  getAgentPDAs,
  getAllowancePDA,
  connection,
} from "./shared";


export default async function handler(req: Request) {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  try {
    const { owner, spender, wallet } = await req.json();

    if (!owner || !spender) {
      return errorResponse("Missing owner or spender");
    }

    const ownerPDAs = getAgentPDAs(owner);
    const spenderPDAs = getAgentPDAs(spender);

    // Verify owner exists
    const ownerAccount = await connection.getAccountInfo(ownerPDAs.agentRegistry);
    if (!ownerAccount) {
      return errorResponse(`Owner agent "${owner}" not found`, 404);
    }

    // Verify allowance exists
    const allowancePDA = getAllowancePDA(owner, spender);
    const allowanceAccount = await connection.getAccountInfo(allowancePDA);
    if (!allowanceAccount) {
      return errorResponse(`No allowance found from "${owner}" to "${spender}"`, 404);
    }

    return jsonResponse({
      success: true,
      message: `Ready to revoke ${spender}'s allowance from ${owner}`,
      data: {
        owner,
        spender,
        allowancePDA: allowancePDA.toBase58(),
        instruction: {
          name: "revokeAllowance",
          accounts: {
            allowance: allowancePDA.toBase58(),
            authority: wallet || "SIGNER_REQUIRED",
          },
          args: {},
        },
      },
    });
  } catch (error: any) {
    return errorResponse(error.message, 500);
  }
}
