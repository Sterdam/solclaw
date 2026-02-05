import { jsonResponse, errorResponse, corsHeaders } from "./shared";
import { createHmac, randomBytes } from "crypto";


// In-memory webhook store (for hackathon/demo)
// In production, use Redis or a database
interface WebhookConfig {
  agentName: string;
  url: string;
  secret: string;
  events: string[];
  createdAt: number;
}

const webhookRegistry: Map<string, WebhookConfig> = new Map();

// Valid webhook events
const VALID_EVENTS = [
  "payment_received",
  "payment_sent",
  "invoice_created",
  "invoice_paid",
  "invoice_rejected",
  "allowance_pulled",
  "subscription_executed",
];

/**
 * POST /api/webhook - Register a webhook URL
 * DELETE /api/webhook - Remove a webhook
 * GET /api/webhook?name=X - Check webhook config
 */
export default async function handler(req: Request) {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // GET - Check webhook config
  if (req.method === "GET") {
    const url = new URL(req.url);
    const agentName = url.searchParams.get("name");

    if (!agentName) {
      return errorResponse("Missing name query parameter");
    }

    const config = webhookRegistry.get(agentName);
    if (!config) {
      return errorResponse("No webhook registered for this agent", 404);
    }

    // Don't reveal the secret
    return jsonResponse({
      agentName: config.agentName,
      url: config.url,
      events: config.events,
      createdAt: config.createdAt,
    });
  }

  // POST - Register webhook
  if (req.method === "POST") {
    try {
      const { agentName, url, events } = await req.json();

      if (!agentName || !url) {
        return errorResponse("Missing agentName or url");
      }

      // Validate URL
      try {
        new URL(url);
      } catch {
        return errorResponse("Invalid URL");
      }

      // Validate events
      const selectedEvents = events || [
        "payment_received",
        "invoice_created",
        "invoice_paid",
      ];
      const invalidEvents = selectedEvents.filter(
        (e: string) => !VALID_EVENTS.includes(e)
      );
      if (invalidEvents.length > 0) {
        return errorResponse(`Invalid events: ${invalidEvents.join(", ")}`, 400);
      }

      // Generate a random shared secret
      const secret = randomBytes(32).toString("hex");

      webhookRegistry.set(agentName, {
        agentName,
        url,
        secret,
        events: selectedEvents,
        createdAt: Date.now(),
      });

      return jsonResponse({
        success: true,
        agent: agentName,
        url,
        events: selectedEvents,
        secret,
        message:
          "Save this secret — it will not be shown again. Use it to verify webhook signatures via the X-SolClaw-Signature header (HMAC-SHA256 of the request body).",
        validEvents: VALID_EVENTS,
      });
    } catch (error: any) {
      return errorResponse(error.message, 500);
    }
  }

  // DELETE - Remove webhook
  if (req.method === "DELETE") {
    try {
      const { agentName } = await req.json();

      if (!agentName) {
        return errorResponse("Missing agentName");
      }

      if (webhookRegistry.delete(agentName)) {
        return jsonResponse({
          success: true,
          message: "Webhook removed",
        });
      } else {
        return errorResponse("No webhook found for this agent", 404);
      }
    } catch (error: any) {
      return errorResponse(error.message, 500);
    }
  }

  return errorResponse("Method not allowed", 405);
}

// ============================================================
// Webhook notification functions (exported for use by other API handlers)
// ============================================================

interface WebhookPayload {
  event: string;
  agent: string;
  data: Record<string, any>;
  timestamp: number;
}

/**
 * Notify an agent's webhook. Fire-and-forget.
 * Called internally after successful payments/invoices.
 */
export async function notifyWebhook(
  agentName: string,
  event: string,
  data: Record<string, any>
): Promise<void> {
  const config = webhookRegistry.get(agentName);
  if (!config) return; // No webhook registered
  if (!config.events.includes(event)) return; // Event not subscribed

  const payload: WebhookPayload = {
    event,
    agent: agentName,
    data,
    timestamp: Math.floor(Date.now() / 1000),
  };

  const body = JSON.stringify(payload);

  // HMAC signature for verification
  const signature = createHmac("sha256", config.secret).update(body).digest("hex");

  try {
    // Fire-and-forget with 5s timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    await fetch(config.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-SolClaw-Signature": signature,
        "X-SolClaw-Event": event,
      },
      body,
      signal: controller.signal,
    });

    clearTimeout(timeout);
  } catch (err: any) {
    // Log but don't fail the main operation
    console.error(`Webhook delivery failed for ${agentName}: ${err.message}`);
  }
}

/**
 * Notify multiple agents at once. Used after batch/split payments.
 */
export async function notifyMultipleWebhooks(
  notifications: Array<{
    agentName: string;
    event: string;
    data: Record<string, any>;
  }>
): Promise<void> {
  await Promise.allSettled(
    notifications.map((n) => notifyWebhook(n.agentName, n.event, n.data))
  );
}

/**
 * Get webhook config for an agent (for internal use)
 */
export function getWebhookConfig(
  agentName: string
): Omit<WebhookConfig, "secret"> | null {
  const config = webhookRegistry.get(agentName);
  if (!config) return null;
  const { secret, ...rest } = config;
  return rest;
}
