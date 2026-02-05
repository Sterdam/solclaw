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

    const accounts = await (program.account as any).agentRegistry.all();

    const agents = accounts.map((a: any) => ({
      name: a.account.name,
      authority: a.account.authority.toBase58(),
      vault: a.account.vault.toBase58(),
      totalSent: Number(a.account.totalSent) / 1_000_000,
      totalReceived: Number(a.account.totalReceived) / 1_000_000,
      createdAt: Number(a.account.createdAt),
      // v3: Spending cap fields
      dailyLimit: Number(a.account.dailyLimit || 0) / 1_000_000,
      dailySpent: Number(a.account.dailySpent || 0) / 1_000_000,
      hasSpendingCap: Number(a.account.dailyLimit || 0) > 0,
    }));

    return jsonResponse({ count: agents.length, agents });
  } catch (error: any) {
    return errorResponse(error.message, 500);
  }
}
