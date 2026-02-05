import {
  jsonResponse,
  errorResponse,
  corsHeaders,
  getAgentPDAs,
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
    const { name, limitUsdc, wallet } = await req.json();

    if (!name) {
      return errorResponse("Missing agent name");
    }

    if (limitUsdc === undefined || limitUsdc === null) {
      return errorResponse("Missing limitUsdc (set to 0 to remove limit)");
    }

    const limitNum = parseFloat(limitUsdc);
    if (isNaN(limitNum) || limitNum < 0) {
      return errorResponse("Invalid limitUsdc value");
    }

    const agentPDAs = getAgentPDAs(name);

    // Verify agent exists
    const agentAccount = await connection.getAccountInfo(agentPDAs.agentRegistry);
    if (!agentAccount) {
      return errorResponse(`Agent "${name}" not found`, 404);
    }

    const limitUnits = Math.floor(limitNum * 1_000_000);

    return jsonResponse({
      success: true,
      message: limitUnits === 0
        ? "Ready to remove daily spending limit"
        : `Ready to set daily limit to ${limitNum} USDC`,
      data: {
        name,
        limitUsdc: limitNum,
        limitUnits,
        instruction: {
          name: "setDailyLimit",
          accounts: {
            registry: agentPDAs.agentRegistry.toBase58(),
            authority: wallet || "SIGNER_REQUIRED",
          },
          args: { limitUsdc: limitUnits },
        },
      },
    });
  } catch (error: any) {
    return errorResponse(error.message, 500);
  }
}
