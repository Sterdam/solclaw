import { jsonResponse, errorResponse, corsHeaders, getAgentPDAs, getVaultBalance } from "../shared";


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

    const { vault } = getAgentPDAs(name);
    const balance = await getVaultBalance(vault);

    return jsonResponse({
      name,
      vault: vault.toBase58(),
      balance,
      unit: "USDC",
    });
  } catch (error: any) {
    return errorResponse(error.message, 500);
  }
}
