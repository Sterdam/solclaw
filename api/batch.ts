import {
  jsonResponse,
  errorResponse,
  corsHeaders,
  getAgentPDAs,
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
    const { from, payments, wallet } = await req.json();

    if (!from || !payments || !Array.isArray(payments)) {
      return errorResponse("Missing from or payments array");
    }

    if (payments.length < 1 || payments.length > 10) {
      return errorResponse("Batch must contain 1-10 payments");
    }

    const senderPDAs = getAgentPDAs(from);

    // Verify sender exists
    const senderAccount = await connection.getAccountInfo(senderPDAs.agentRegistry);
    if (!senderAccount) {
      return errorResponse(`Sender agent "${from}" not found`, 404);
    }

    // Build remaining accounts info
    const remainingAccounts: any[] = [];
    const paymentEntries: any[] = [];

    for (const payment of payments) {
      if (!payment.to || !payment.amount) {
        return errorResponse("Each payment must have 'to' and 'amount'");
      }

      // v3: Validate memo length
      if (payment.memo && payment.memo.length > 128) {
        return errorResponse(`Memo for "${payment.to}" exceeds 128 characters`);
      }

      const recipientPDAs = getAgentPDAs(payment.to);

      // Verify recipient exists
      const recipientAccount = await connection.getAccountInfo(recipientPDAs.agentRegistry);
      if (!recipientAccount) {
        return errorResponse(`Recipient agent "${payment.to}" not found`, 404);
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

      paymentEntries.push({
        recipientName: payment.to,
        amount: Math.floor(parseFloat(payment.amount) * 1_000_000),
        memo: payment.memo || null,
      });
    }

    return jsonResponse({
      success: true,
      message: "Ready for batch payment",
      data: {
        from,
        payments: payments.map((p: any) => ({
          to: p.to,
          amount: parseFloat(p.amount),
          amountUnits: Math.floor(parseFloat(p.amount) * 1_000_000),
          memo: p.memo || null,
        })),
        instruction: {
          name: "batchPayment",
          accounts: {
            senderRegistry: senderPDAs.agentRegistry.toBase58(),
            senderVault: senderPDAs.vault.toBase58(),
            authority: wallet || "SIGNER_REQUIRED",
            tokenProgram: TOKEN_PROGRAM_ID.toBase58(),
          },
          remainingAccounts,
          args: { payments: paymentEntries },
        },
      },
    });
  } catch (error: any) {
    return errorResponse(error.message, 500);
  }
}
