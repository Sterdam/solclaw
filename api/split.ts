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
    const { from, totalAmount, recipients, wallet, memo } = await req.json();

    if (!from || !totalAmount || !recipients || !Array.isArray(recipients)) {
      return errorResponse("Missing from, totalAmount, or recipients array");
    }

    // v3: Validate memo length
    if (memo && memo.length > 128) {
      return errorResponse("Memo exceeds 128 characters");
    }

    if (recipients.length < 2 || recipients.length > 10) {
      return errorResponse("Split must have 2-10 recipients");
    }

    // Validate shares sum to 10000
    const totalBps = recipients.reduce(
      (sum: number, r: any) => sum + (r.shareBps || 0),
      0
    );
    if (totalBps !== 10000) {
      return errorResponse("Shares must sum to 10000 basis points (100%)");
    }

    const senderPDAs = getAgentPDAs(from);

    // Verify sender exists
    const senderAccount = await connection.getAccountInfo(senderPDAs.agentRegistry);
    if (!senderAccount) {
      return errorResponse(`Sender agent "${from}" not found`, 404);
    }

    // Build remaining accounts info
    const remainingAccounts: any[] = [];
    const splitRecipients: any[] = [];

    for (const recipient of recipients) {
      if (!recipient.name || recipient.shareBps === undefined) {
        return errorResponse("Each recipient must have 'name' and 'shareBps'");
      }

      const recipientPDAs = getAgentPDAs(recipient.name);

      // Verify recipient exists
      const recipientAccount = await connection.getAccountInfo(recipientPDAs.agentRegistry);
      if (!recipientAccount) {
        return errorResponse(`Recipient agent "${recipient.name}" not found`, 404);
      }

      remainingAccounts.push({
        pubkey: recipientPDAs.agentRegistry.toBase58(),
        isSigner: false,
        isWritable: true,
      });
      remainingAccounts.push({
        pubkey: recipientPDAs.vault.toBase58(),
        isSigner: false,
        isWritable: true,
      });

      splitRecipients.push({
        name: recipient.name,
        shareBps: recipient.shareBps,
      });
    }

    const amountUnits = Math.floor(parseFloat(totalAmount) * 1_000_000);

    return jsonResponse({
      success: true,
      message: "Ready for split payment",
      data: {
        from,
        totalAmount: parseFloat(totalAmount),
        memo: memo || null,
        recipients: splitRecipients.map((r: any) => ({
          name: r.name,
          shareBps: r.shareBps,
          percentage: (r.shareBps / 100).toFixed(2) + "%",
          estimatedAmount: (parseFloat(totalAmount) * r.shareBps) / 10000,
        })),
        instruction: {
          name: "splitPayment",
          accounts: {
            senderRegistry: senderPDAs.agentRegistry.toBase58(),
            senderVault: senderPDAs.vault.toBase58(),
            authority: wallet || "SIGNER_REQUIRED",
            tokenProgram: TOKEN_PROGRAM_ID.toBase58(),
          },
          remainingAccounts,
          args: {
            totalAmount: amountUnits,
            recipients: splitRecipients,
            memo: memo || null,
          },
        },
      },
    });
  } catch (error: any) {
    return errorResponse(error.message, 500);
  }
}
