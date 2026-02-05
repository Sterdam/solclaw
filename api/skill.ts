import { jsonResponse, corsHeaders } from "./shared";

export default async function handler(req: Request) {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  return jsonResponse({
    name: "solclaw",
    version: "4.0.0",
    description: "Agent-native USDC payment infrastructure on Solana. Send, request, split, batch, subscribe — all by name, not addresses.",
    homepage: "https://solclaw.xyz",
    api_base: "https://solclaw.xyz/api",
    endpoints: 33,
    features: [
      "name-based payments",
      "batch payments",
      "split payments",
      "subscriptions",
      "allowances",
      "invoices",
      "spending caps",
      "webhooks",
      "refunds",
      "reputation",
    ],
    files: {
      skill: "https://solclaw.xyz/skill.md",
      heartbeat: "https://solclaw.xyz/heartbeat.md",
    },
    chain: "solana-devnet",
    usdc_mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    program_id: "J4qipHcPyaPkVs8ymCLcpgqSDJeoSn3k1LJLK7Q9DZ5H",
  });
}
