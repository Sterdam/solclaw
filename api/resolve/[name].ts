import { jsonResponse, errorResponse, corsHeaders, getAgentPDAs, connection, getProgram } from "../shared";


export default async function handler(req: Request) {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const name = url.pathname.split("/").pop();

    if (!name) {
      return errorResponse("Missing name parameter");
    }

    const { agentRegistry, vault } = getAgentPDAs(name);
    const accountInfo = await connection.getAccountInfo(agentRegistry);

    if (!accountInfo) {
      return errorResponse("Agent not found", 404);
    }

    // Try to get more details
    let agentData: any = null;
    const program = await getProgram();
    if (program) {
      try {
        agentData = await (program.account as any).agentRegistry.fetch(agentRegistry);
      } catch {}
    }

    return jsonResponse({
      name,
      registered: true,
      agentRegistry: agentRegistry.toBase58(),
      vault: vault.toBase58(),
      authority: agentData?.authority?.toBase58() || null,
      stats: agentData
        ? {
            totalSent: Number(agentData.totalSent) / 1_000_000,
            totalReceived: Number(agentData.totalReceived) / 1_000_000,
            createdAt: Number(agentData.createdAt),
          }
        : null,
    });
  } catch (error: any) {
    return errorResponse(error.message, 500);
  }
}
