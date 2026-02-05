import { jsonResponse, errorResponse, corsHeaders, getProgram } from "./shared";

export const config = { runtime: "edge" };

export default async function handler(req: Request) {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const limit = parseInt(url.searchParams.get("limit") || "10");

    const program = await getProgram();
    if (!program) {
      return errorResponse("Failed to load program", 503);
    }

    const accounts = await (program.account as any).agentRegistry.all();

    const leaderboard = accounts
      .map((a: any) => ({
        name: a.account.name,
        totalSent: Number(a.account.totalSent) / 1_000_000,
        totalReceived: Number(a.account.totalReceived) / 1_000_000,
        totalVolume:
          (Number(a.account.totalSent) + Number(a.account.totalReceived)) /
          1_000_000,
      }))
      .sort((a: any, b: any) => b.totalVolume - a.totalVolume)
      .slice(0, limit);

    return jsonResponse({ limit, leaderboard });
  } catch (error: any) {
    return errorResponse(error.message, 500);
  }
}
