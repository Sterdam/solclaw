import { jsonResponse, errorResponse, corsHeaders, getProgram } from "./shared";


export default async function handler(req: Request) {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const program = await getProgram();
    if (!program) {
      return errorResponse("Failed to load program", 503);
    }

    const accounts = await (program.account as any).subscription.all();
    const now = Math.floor(Date.now() / 1000);

    const dueSubscriptions = accounts
      .filter(
        (a: any) => a.account.isActive && Number(a.account.nextDue) <= now
      )
      .map((a: any) => ({
        senderName: a.account.senderName,
        receiverName: a.account.receiverName,
        amount: Number(a.account.amount) / 1_000_000,
        nextDue: Number(a.account.nextDue),
        overdueSecs: now - Number(a.account.nextDue),
        totalPaid: Number(a.account.totalPaid) / 1_000_000,
        executionCount: Number(a.account.executionCount),
      }));

    return jsonResponse({
      count: dueSubscriptions.length,
      now,
      subscriptions: dueSubscriptions,
    });
  } catch (error: any) {
    return errorResponse(error.message, 500);
  }
}
