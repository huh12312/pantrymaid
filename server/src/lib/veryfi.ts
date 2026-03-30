/**
 * Veryfi API client for receipt OCR processing
 */

interface VeryfiConfig {
  clientId: string;
  clientSecret: string;
  username: string;
  apiKey: string;
}

interface VeryfiLineItem {
  description: string;
  quantity?: number;
  price?: number;
  total?: number;
}

interface VeryfiResponse {
  vendor?: {
    name?: string;
  };
  line_items?: VeryfiLineItem[];
  total?: number;
}

export class VeryfiClient {
  private config: VeryfiConfig;
  private baseUrl = "https://api.veryfi.com/api/v8";

  constructor(config: VeryfiConfig) {
    this.config = config;
  }

  /**
   * Process a receipt image
   */
  async processReceipt(imageBase64: string): Promise<VeryfiResponse> {
    const url = `${this.baseUrl}/partner/documents`;

    const headers = {
      "Content-Type": "application/json",
      "CLIENT-ID": this.config.clientId,
      "AUTHORIZATION": `apikey ${this.config.username}:${this.config.apiKey}`,
    };

    const body = {
      file_data: imageBase64,
      categories: ["Grocery", "Food & Drink"],
      boost_mode: 0,
    };

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Veryfi API error: ${response.status} - ${error}`);
    }

    return response.json() as Promise<VeryfiResponse>;
  }
}

// Export singleton instance
export const veryfiClient = new VeryfiClient({
  clientId: process.env.VERYFI_CLIENT_ID || "",
  clientSecret: process.env.VERYFI_CLIENT_SECRET || "",
  username: process.env.VERYFI_USERNAME || "",
  apiKey: process.env.VERYFI_API_KEY || "",
});
