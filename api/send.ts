import {
  jsonResponse,
  errorResponse,
  corsHeaders,
  getAgentPDAs,
  connection,
  TOKEN_PROGRAM_ID,
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
    const { from, to, amount, wallet, memo } = await req.json();

    if (!from || !to || !amount) {
      return errorResponse("Missing from, to, or amount");
    }

    // v3: Validate memo length
    if (memo && memo.length > 128) {
      return errorResponse("Memo exceeds 128 characters");
    }

    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      return errorResponse("Invalid amount");
    }

    const senderPDAs = getAgentPDAs(from);
    const receiverPDAs = getAgentPDAs(to);

    // Verify sender exists
    const senderAccount = await connection.getAccountInfo(senderPDAs.agentRegistry);
    if (!senderAccount) {
      return errorResponse(`Sender agent "${from}" not found`, 404);
    }

    // Verify receiver exists
    const receiverAccount = await connection.getAccountInfo(receiverPDAs.agentRegistry);
    if (!receiverAccount) {
      return errorResponse(`Receiver agent "${to}" not found`, 404);
    }

    const amountUnits = Math.floor(amountNum * 1_000_000);

    return jsonResponse({
      success: true,
      message: "Ready to transfer",
      data: {
        from,
        to,
        amount: amountNum,
        amountUnits,
        memo: memo || null,
        senderVault: senderPDAs.vault.toBase58(),
        receiverVault: receiverPDAs.vault.toBase58(),
        instruction: {
          name: "transferByName",
          accounts: {
            senderRegistry: senderPDAs.agentRegistry.toBase58(),
            senderVault: senderPDAs.vault.toBase58(),
            receiverRegistry: receiverPDAs.agentRegistry.toBase58(),
            receiverVault: receiverPDAs.vault.toBase58(),
            authority: wallet || "SIGNER_REQUIRED",
            tokenProgram: TOKEN_PROGRAM_ID.toBase58(),
          },
          args: { amount: amountUnits, memo: memo || null },
        },
      },
    });
  } catch (error: any) {
    return errorResponse(error.message, 500);
  }
}
