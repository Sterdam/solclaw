import { jsonResponse, errorResponse, corsHeaders, getProgram } from "./shared";

export const config = { runtime: "edge" };

export default async function handler(req: Request) {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const owner = url.searchParams.get("owner");
    const spender = url.searchParams.get("spender");

    const program = await getProgram();
    if (!program) {
      return errorResponse("Failed to load program", 503);
    }

    const accounts = await (program.account as any).allowance.all();

    let allowances = accounts.map((a: any) => ({
      ownerName: a.account.ownerName,
      spenderName: a.account.spenderName,
      amount: Number(a.account.amount) / 1_000_000,
      totalPulled: Number(a.account.totalPulled) / 1_000_000,
      pullCount: Number(a.account.pullCount),
      isActive: a.account.isActive,
      owner: a.account.owner.toBase58(),
      spender: a.account.spender.toBase58(),
      pda: a.publicKey.toBase58(),
    }));

    // Filter by owner or spender if provided
    if (owner) {
      allowances = allowances.filter((a: any) => a.ownerName === owner);
    }
    if (spender) {
      allowances = allowances.filter((a: any) => a.spenderName === spender);
    }

    return jsonResponse({
      count: allowances.length,
      allowances,
    });
  } catch (error: any) {
    return errorResponse(error.message, 500);
  }
}
