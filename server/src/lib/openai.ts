import OpenAI from "openai";

const apiKey = process.env.OPENAI_API_KEY;

if (!apiKey) {
  throw new Error("OPENAI_API_KEY environment variable is not set");
}

export const openai = new OpenAI({
  apiKey,
});

/**
 * Decode receipt line items using OpenAI
 */
export async function decodeReceiptItems(
  lineItems: Array<{ description: string; qty?: number; price?: number }>,
  storeName?: string
) {
  const prompt = `You are a receipt line item decoder. Given abbreviated product descriptions from a grocery receipt${storeName ? ` from ${storeName}` : ""}, decode them into full, human-readable product names.

For each item, provide:
- decoded: Full product name
- confidence: A number between 0 and 1 indicating your confidence

Input items:
${lineItems.map((item, i) => `${i + 1}. ${item.description}`).join("\n")}

Return a JSON array with the decoded items.`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
  });

  const result = JSON.parse(response.choices[0]?.message?.content || "{}");
  return result.items || [];
}

/**
 * Estimate expiration date for a product
 */
export async function estimateExpiration(productName: string, category?: string) {
  const prompt = `Estimate the typical shelf life for: ${productName}${category ? ` (Category: ${category})` : ""}

Provide:
- days: Number of days until expiration (from purchase date)
- label: Human-readable label (e.g., "~1 week", "~2 months")
- confidence: "high", "medium", or "low"

Return as JSON.`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
  });

  return JSON.parse(response.choices[0]?.message?.content || "{}");
}
