import {
  jsonResponse,
  errorResponse,
  corsHeaders,
  getProgram,
  INVOICE_STATUS,
} from "./shared";

// Calculate reputation score for an agent
async function calculateReputation(
  program: any,
  registry: any,
  name: string
): Promise<{ score: number; tier: string; badges: string[] }> {
  const totalSent = Number(registry.totalSent) / 1_000_000;
  const totalReceived = Number(registry.totalReceived) / 1_000_000;
  const volumeUsdc = totalSent + totalReceived;

  const now = Math.floor(Date.now() / 1000);
  const createdAt = Number(registry.createdAt);
  const tenureDays = Math.floor((now - createdAt) / 86400);

  const hasSpendingCap = Number(registry.dailyLimit || 0) > 0;

  // Simplified calculation for leaderboard (skip heavy queries)
  let score = 0;

  // Volume: 0-25 points
  score += Math.min(25, Math.round(Math.log10(Math.max(1, volumeUsdc)) * 6.25));

  // Tenure: 0-15 points
  score += Math.min(15, Math.round((tenureDays / 90) * 15));

  // Base reliability: 25 points (assume good unless proven otherwise)
  score += 25;

  // Activity bonus
  if (hasSpendingCap) score += 5;
  if (volumeUsdc > 0) score += 10;

  score = Math.min(100, score);

  let tier: string;
  if (score >= 75) tier = "veteran";
  else if (score >= 50) tier = "trusted";
  else if (score >= 25) tier = "active";
  else tier = "new";

  const badges: string[] = [];
  if (tenureDays <= 7 && tenureDays >= 0) badges.push("early_adopter");
  if (volumeUsdc >= 100) badges.push("high_volume");
  if (volumeUsdc >= 1000) badges.push("whale");
  if (hasSpendingCap) badges.push("safety_conscious");
  if (totalSent > totalReceived * 1.5 && totalSent > 0) badges.push("generous");

  return { score, tier, badges };
}

export default async function handler(req: Request) {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const limit = parseInt(url.searchParams.get("limit") || "10");
    const sort = url.searchParams.get("sort") || "volume"; // volume, reputation, sent, received

    const program = await getProgram();
    if (!program) {
      return errorResponse("Failed to load program", 503);
    }

    const accounts = await (program.account as any).agentRegistry.all();

    // Build leaderboard with reputation data
    const leaderboardPromises = accounts.map(async (a: any) => {
      const { score, tier, badges } = await calculateReputation(
        program,
        a.account,
        a.account.name
      );

      return {
        name: a.account.name,
        score,
        tier,
        badges,
        totalSent: Number(a.account.totalSent) / 1_000_000,
        totalReceived: Number(a.account.totalReceived) / 1_000_000,
        totalVolume:
          (Number(a.account.totalSent) + Number(a.account.totalReceived)) /
          1_000_000,
      };
    });

    const leaderboard = await Promise.all(leaderboardPromises);

    // Sort based on parameter
    switch (sort) {
      case "reputation":
        leaderboard.sort((a, b) => b.score - a.score);
        break;
      case "sent":
        leaderboard.sort((a, b) => b.totalSent - a.totalSent);
        break;
      case "received":
        leaderboard.sort((a, b) => b.totalReceived - a.totalReceived);
        break;
      case "volume":
      default:
        leaderboard.sort((a, b) => b.totalVolume - a.totalVolume);
        break;
    }

    return jsonResponse({
      sort,
      limit,
      leaderboard: leaderboard.slice(0, limit),
    });
  } catch (error: any) {
    return errorResponse(error.message, 500);
  }
}
