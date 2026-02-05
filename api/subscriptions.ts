import { jsonResponse, errorResponse, corsHeaders, getProgram, formatInterval } from "./shared";

export const config = { runtime: "edge" };

export default async function handler(req: Request) {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const sender = url.searchParams.get("sender");

    const program = await getProgram();
    if (!program) {
      return errorResponse("Failed to load program", 503);
    }

    const accounts = await (program.account as any).subscription.all();

    let subscriptions = accounts.map((a: any) => ({
      senderName: a.account.senderName,
      receiverName: a.account.receiverName,
      amount: Number(a.account.amount) / 1_000_000,
      intervalSeconds: Number(a.account.intervalSeconds),
      intervalHuman: formatInterval(Number(a.account.intervalSeconds)),
      nextDue: Number(a.account.nextDue),
      nextDueHuman: new Date(Number(a.account.nextDue) * 1000).toISOString(),
      isActive: a.account.isActive,
      totalPaid: Number(a.account.totalPaid) / 1_000_000,
      executionCount: Number(a.account.executionCount),
    }));

    if (sender) {
      subscriptions = subscriptions.filter((s: any) => s.senderName === sender);
    }

    return jsonResponse({ count: subscriptions.length, subscriptions });
  } catch (error: any) {
    return errorResponse(error.message, 500);
  }
}
