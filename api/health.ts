import { jsonResponse, corsHeaders, connection, PROGRAM_ID, USDC_MINT } from "./shared";

export default async function handler(req: Request) {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    // Check RPC connection
    const slot = await connection.getSlot();

    return jsonResponse({
      status: "ok",
      version: "4.0.0",
      chain: "solana-devnet",
      programId: PROGRAM_ID.toBase58(),
      usdcMint: USDC_MINT.toBase58(),
      endpoints: 33,
      currentSlot: slot,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    return jsonResponse(
      {
        status: "degraded",
        version: "4.0.0",
        chain: "solana-devnet",
        error: error.message,
        timestamp: new Date().toISOString(),
      },
      503
    );
  }
}
