import {
  jsonResponse,
  errorResponse,
  corsHeaders,
  getAgentPDAs,
  getSubscriptionPDA,
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
    const { from, to, wallet } = await req.json();

    if (!from || !to) {
      return errorResponse("Missing from or to");
    }

    const senderPDAs = getAgentPDAs(from);
    const receiverPDAs = getAgentPDAs(to);
    const subscription = getSubscriptionPDA(from, to);

    // Verify subscription exists
    const subscriptionAccount = await connection.getAccountInfo(subscription);
    if (!subscriptionAccount) {
      return errorResponse("Subscription not found", 404);
    }

    return jsonResponse({
      success: true,
      message: "Ready to execute subscription",
      data: {
        from,
        to,
        subscription: subscription.toBase58(),
        instruction: {
          name: "executeSubscription",
          accounts: {
            subscription: subscription.toBase58(),
            senderRegistry: senderPDAs.agentRegistry.toBase58(),
            receiverRegistry: receiverPDAs.agentRegistry.toBase58(),
            senderVault: senderPDAs.vault.toBase58(),
            receiverVault: receiverPDAs.vault.toBase58(),
            tokenProgram: TOKEN_PROGRAM_ID.toBase58(),
            cranker: wallet || "SIGNER_REQUIRED",
          },
        },
      },
    });
  } catch (error: any) {
    return errorResponse(error.message, 500);
  }
}
