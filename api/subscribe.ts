import {
  jsonResponse,
  errorResponse,
  corsHeaders,
  getAgentPDAs,
  getSubscriptionPDA,
  connection,
  formatInterval,
  SYSTEM_PROGRAM_ID,
} from "./shared";

export const config = { runtime: "edge" };

export default async function handler(req: Request) {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // DELETE - Cancel subscription
  if (req.method === "DELETE") {
    try {
      const { from, to, wallet } = await req.json();

      if (!from || !to) {
        return errorResponse("Missing from or to");
      }

      const subscription = getSubscriptionPDA(from, to);

      // Verify subscription exists
      const subscriptionAccount = await connection.getAccountInfo(subscription);
      if (!subscriptionAccount) {
        return errorResponse("Subscription not found", 404);
      }

      return jsonResponse({
        success: true,
        message: "Ready to cancel subscription",
        data: {
          from,
          to,
          subscription: subscription.toBase58(),
          instruction: {
            name: "cancelSubscription",
            accounts: {
              subscription: subscription.toBase58(),
              authority: wallet || "SIGNER_REQUIRED",
            },
          },
        },
      });
    } catch (error: any) {
      return errorResponse(error.message, 500);
    }
  }

  // POST - Create subscription
  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  try {
    const { from, to, amount, intervalSeconds, wallet } = await req.json();

    if (!from || !to || !amount || !intervalSeconds) {
      return errorResponse("Missing from, to, amount, or intervalSeconds");
    }

    if (intervalSeconds < 60) {
      return errorResponse("Interval must be at least 60 seconds");
    }

    const senderPDAs = getAgentPDAs(from);
    const receiverPDAs = getAgentPDAs(to);
    const subscription = getSubscriptionPDA(from, to);

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

    // Check if subscription already exists
    const existingSubscription = await connection.getAccountInfo(subscription);
    if (existingSubscription) {
      return errorResponse("Subscription already exists between these agents", 409);
    }

    const amountUnits = Math.floor(parseFloat(amount) * 1_000_000);

    return jsonResponse({
      success: true,
      message: "Ready to create subscription",
      data: {
        from,
        to,
        amount: parseFloat(amount),
        intervalSeconds,
        intervalHuman: formatInterval(intervalSeconds),
        subscription: subscription.toBase58(),
        instruction: {
          name: "createSubscription",
          accounts: {
            subscription: subscription.toBase58(),
            senderRegistry: senderPDAs.agentRegistry.toBase58(),
            receiverRegistry: receiverPDAs.agentRegistry.toBase58(),
            authority: wallet || "SIGNER_REQUIRED",
            payer: wallet || "SIGNER_REQUIRED",
            systemProgram: SYSTEM_PROGRAM_ID.toBase58(),
          },
          args: {
            receiverName: to,
            amount: amountUnits,
            intervalSeconds,
          },
        },
      },
    });
  } catch (error: any) {
    return errorResponse(error.message, 500);
  }
}
