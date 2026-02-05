import {
  jsonResponse,
  errorResponse,
  corsHeaders,
  getProgram,
  getAgentPDAs,
  INVOICE_STATUS,
} from "../shared";

export default async function handler(req: Request) {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/");
    const name = decodeURIComponent(pathParts[pathParts.length - 1]);

    if (!name) {
      return errorResponse("Missing agent name");
    }

    const program = await getProgram();
    if (!program) {
      return errorResponse("Failed to load program", 503);
    }

    const { agentRegistry: registryPDA } = getAgentPDAs(name);

    // 1. Fetch agent registry
    let registry: any;
    try {
      registry = await (program.account as any).agentRegistry.fetch(registryPDA);
    } catch {
      return errorResponse("Agent not found", 404);
    }

    // 2. Calculate volume
    const totalSent = Number(registry.totalSent) / 1_000_000;
    const totalReceived = Number(registry.totalReceived) / 1_000_000;
    const volumeUsdc = totalSent + totalReceived;

    // 3. Tenure
    const now = Math.floor(Date.now() / 1000);
    const createdAt = Number(registry.createdAt);
    const tenureDays = Math.floor((now - createdAt) / 86400);

    // 4. Spending cap
    const hasSpendingCap = Number(registry.dailyLimit || 0) > 0;

    // 5. Fetch invoices where agent is payer
    let invoicesAsPayer: any[] = [];
    let invoicesAsRequester: any[] = [];
    try {
      const allInvoices = await (program.account as any).invoice.all();
      invoicesAsPayer = allInvoices.filter(
        (i: any) => i.account.payerName === name
      );
      invoicesAsRequester = allInvoices.filter(
        (i: any) => i.account.requesterName === name
      );
    } catch {
      // No invoices or invoice account doesn't exist yet
    }

    const paidInvoices = invoicesAsPayer.filter(
      (i) => i.account.status === INVOICE_STATUS.PAID
    ).length;
    const rejectedOrExpired = invoicesAsPayer.filter(
      (i) =>
        i.account.status === INVOICE_STATUS.REJECTED ||
        i.account.status === INVOICE_STATUS.EXPIRED
    ).length;
    const totalDecided = paidInvoices + rejectedOrExpired;
    const invoiceReliability =
      totalDecided > 0 ? Math.round((paidInvoices / totalDecided) * 100) : 100;

    // 6. Active subscriptions (as sender)
    let activeSubscriptions = 0;
    let subscriptions: any[] = [];
    try {
      const allSubs = await (program.account as any).subscription.all();
      subscriptions = allSubs.filter(
        (s: any) => s.account.senderName === name
      );
      activeSubscriptions = subscriptions.filter(
        (s: any) => s.account.isActive
      ).length;
    } catch {
      // No subscriptions
    }

    // 7. Allowances granted (as owner)
    let activeAllowances = 0;
    let allowances: any[] = [];
    try {
      const allAllowances = await (program.account as any).allowance.all();
      allowances = allAllowances.filter(
        (a: any) => a.account.ownerName === name
      );
      activeAllowances = allowances.filter(
        (a: any) => a.account.isActive
      ).length;
    } catch {
      // No allowances
    }

    // 8. Connections - unique agents interacted with
    const connectionSet = new Set<string>();
    for (const inv of invoicesAsPayer) {
      connectionSet.add(inv.account.requesterName);
    }
    for (const inv of invoicesAsRequester) {
      connectionSet.add(inv.account.payerName);
    }
    for (const sub of subscriptions) {
      connectionSet.add(sub.account.receiverName);
    }
    for (const all of allowances) {
      connectionSet.add(all.account.spenderName);
    }
    connectionSet.delete(name); // Remove self
    const connections = connectionSet.size;

    // 9. Calculate score (weighted 0-100)
    let score = 0;

    // Volume: 0-25 points (log scale, caps at 10000 USDC)
    score += Math.min(25, Math.round(Math.log10(Math.max(1, volumeUsdc)) * 6.25));

    // Tenure: 0-15 points (caps at 90 days)
    score += Math.min(15, Math.round((tenureDays / 90) * 15));

    // Invoice reliability: 0-25 points
    score += Math.round((invoiceReliability / 100) * 25);

    // Connections: 0-15 points (caps at 20 unique agents)
    score += Math.min(15, Math.round((connections / 20) * 15));

    // Activity features: 0-20 points
    if (hasSpendingCap) score += 5;
    if (activeSubscriptions > 0) score += 5;
    if (activeAllowances > 0) score += 5;
    if (totalDecided > 0) score += 5;

    score = Math.min(100, score);

    // 10. Tier
    let tier: string;
    if (score >= 75) tier = "veteran";
    else if (score >= 50) tier = "trusted";
    else if (score >= 25) tier = "active";
    else tier = "new";

    // 11. Badges
    const badges: string[] = [];
    if (tenureDays <= 7 && tenureDays >= 0) badges.push("early_adopter");
    if (volumeUsdc >= 100) badges.push("high_volume");
    if (volumeUsdc >= 1000) badges.push("whale");
    if (invoiceReliability >= 90 && totalDecided >= 3) badges.push("reliable_payer");
    if (hasSpendingCap) badges.push("safety_conscious");
    if (activeSubscriptions >= 3) badges.push("subscriber");
    if (connections >= 10) badges.push("well_connected");
    if (activeAllowances >= 1) badges.push("trusting");
    if (totalSent > totalReceived * 1.5 && totalSent > 0) badges.push("generous");

    return jsonResponse({
      agent: name,
      score,
      tier,
      breakdown: {
        volume_usdc: Math.round(volumeUsdc * 100) / 100,
        invoice_reliability: invoiceReliability,
        connections,
        tenure_days: tenureDays,
        has_spending_cap: hasSpendingCap,
        active_subscriptions: activeSubscriptions,
        allowances_granted: activeAllowances,
      },
      badges,
    });
  } catch (error: any) {
    return errorResponse(error.message, 500);
  }
}
