/**
 * Open Food Facts API client
 * Free product database - no API key required
 */

interface OpenFoodFactsProduct {
  code: string;
  product_name?: string;
  brands?: string;
  categories?: string;
  image_url?: string;
}

interface OpenFoodFactsResponse {
  status: number;
  product?: OpenFoodFactsProduct;
}

export class OpenFoodFactsClient {
  private baseUrl = "https://world.openfoodfacts.org/api/v2";

  /**
   * Look up a product by UPC/barcode
   */
  async getProductByBarcode(upc: string): Promise<OpenFoodFactsProduct | null> {
    const url = `${this.baseUrl}/product/${upc}.json`;

    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "PantryMaid/1.0 (https://github.com/huh12312/pantrymaid)",
        },
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json() as OpenFoodFactsResponse;

      if (data.status === 1 && data.product) {
        return data.product;
      }

      return null;
    } catch (error) {
      console.error("Open Food Facts API error:", error);
      return null;
    }
  }

  /**
   * Search for products by name
   */
  async searchProducts(query: string, limit = 10): Promise<OpenFoodFactsProduct[]> {
    const url = `${this.baseUrl}/search?search_terms=${encodeURIComponent(query)}&page_size=${limit}&json=true`;

    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "PantryMaid/1.0 (https://github.com/huh12312/pantrymaid)",
        },
      });

      if (!response.ok) {
        return [];
      }

      const data = await response.json() as { products?: OpenFoodFactsProduct[] };
      return data.products || [];
    } catch (error) {
      console.error("Open Food Facts search error:", error);
      return [];
    }
  }
}

// Export singleton instance
export const openFoodFactsClient = new OpenFoodFactsClient();
