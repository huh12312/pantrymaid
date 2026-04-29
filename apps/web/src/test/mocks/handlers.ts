 
 
 
import { http, HttpResponse } from "msw";

const API_BASE = "http://localhost:3000";

/**
 * MSW v2 request handlers for mocking API endpoints
 * These handlers will be used in tests to mock backend responses
 */
export const handlers = [
  // Items endpoints
  http.get(`${API_BASE}/items`, () => {
    return HttpResponse.json({
      success: true,
      data: {
        items: [
          {
            id: "1",
            householdId: "household-1",
            name: "Milk",
            brand: "Great Value",
            category: "Dairy",
            location: "fridge",
            quantity: 1,
            unit: "gallon",
            barcodeUpc: "041220000000",
            expirationDate: new Date("2024-12-31").toISOString(),
            expirationEstimated: false,
            addedBy: "user-1",
            addedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            notes: null,
          },
        ],
        total: 1,
        page: 1,
        pageSize: 50,
      },
    });
  }),

  http.get(`${API_BASE}/items/:id`, ({ params }) => {
    const { id } = params;

    return HttpResponse.json({
      success: true,
      data: {
        id,
        householdId: "household-1",
        name: "Milk",
        brand: "Great Value",
        category: "Dairy",
        location: "fridge",
        quantity: 1,
        unit: "gallon",
        barcodeUpc: "041220000000",
        expirationDate: new Date("2024-12-31").toISOString(),
        expirationEstimated: false,
        addedBy: "user-1",
        addedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        notes: null,
      },
    });
  }),

  http.post(`${API_BASE}/items`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;

    return HttpResponse.json(
      {
        success: true,
        data: {
          id: "new-item-id",
          householdId: "household-1",
          ...body,
          addedBy: "user-1",
          addedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      },
      { status: 201 }
    );
  }),

  http.put(`${API_BASE}/items/:id`, async ({ params, request }) => {
    const { id } = params;
    const body = (await request.json()) as Record<string, unknown>;

    return HttpResponse.json({
      success: true,
      data: {
        id,
        householdId: "household-1",
        name: "Milk",
        brand: "Great Value",
        category: "Dairy",
        location: "fridge",
        quantity: 1,
        unit: "gallon",
        ...body,
        addedBy: "user-1",
        addedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
  }),

  http.delete(`${API_BASE}/items/:id`, () => {
    return new HttpResponse(null, { status: 204 });
  }),

  // Households endpoints
  http.post(`${API_BASE}/households`, async ({ request }) => {
    const body = await request.json();

    return HttpResponse.json(
      {
        success: true,
        data: {
          id: "new-household-id",
          // @ts-expect-error - body type is unknown
          name: body.name,
          inviteCode: "ABC12345",
          createdAt: new Date().toISOString(),
        },
      },
      { status: 201 }
    );
  }),

  http.get(`${API_BASE}/households/:id`, ({ params }) => {
    const { id } = params;

    return HttpResponse.json({
      success: true,
      data: {
        id,
        name: "Smith Family",
        inviteCode: "ABC12345",
        createdAt: new Date().toISOString(),
        members: [
          {
            id: "user-1",
            displayName: "John Smith",
            createdAt: new Date().toISOString(),
          },
          {
            id: "user-2",
            displayName: "Jane Smith",
            createdAt: new Date().toISOString(),
          },
        ],
      },
    });
  }),

  http.post(`${API_BASE}/households/:id/members`, async ({ params, request }) => {
    const { id } = params;
    const body = await request.json();

    // @ts-expect-error - body type is unknown
    if (body.inviteCode === "ABC12345") {
      return HttpResponse.json({
        success: true,
        data: {
          householdId: id,
          userId: "new-user-id",
        },
      });
    }

    return HttpResponse.json(
      {
        success: false,
        error: "Invalid invite code",
      },
      { status: 403 }
    );
  }),

  // Barcode endpoints
  http.get(`${API_BASE}/barcode/:upc`, ({ params }) => {
    const { upc } = params;

    if (upc === "999999999999") {
      return HttpResponse.json(
        {
          success: false,
          error: "Product not found",
        },
        { status: 404 }
      );
    }

    return HttpResponse.json({
      success: true,
      data: {
        upc,
        name: "Coca-Cola Classic",
        brand: "Coca-Cola",
        category: "Beverages",
        imageUrl: "https://example.com/coke.jpg",
        source: "cache",
        estimatedExpirationDays: 365,
        estimatedExpirationLabel: "~1 year",
      },
    });
  }),

  // Receipt endpoints
  http.post(`${API_BASE}/receipt`, async () => {
    return HttpResponse.json({
      success: true,
      data: {
        storeName: "Walmart",
        lineItems: [
          {
            raw: "GV MLK HLF GL",
            decoded: "Great Value Milk Half Gallon",
            confidence: 0.95,
            quantity: 1,
            price: 3.99,
          },
          {
            raw: "BNNNS ORGNIC",
            decoded: "Organic Bananas",
            confidence: 0.88,
            quantity: 1,
            price: 2.49,
          },
        ],
        total: 6.48,
      },
    });
  }),

  // Auth endpoints (Better Auth)
  http.post(`${API_BASE}/auth/sign-in`, async () => {
    return HttpResponse.json({
      success: true,
      data: {
        user: {
          id: "user-1",
          email: "test@example.com",
          householdId: "household-1",
        },
        token: "mock-jwt-token",
      },
    });
  }),

  http.post(`${API_BASE}/auth/sign-up`, async ({ request }) => {
    const body = await request.json();

    return HttpResponse.json(
      {
        success: true,
        data: {
          user: {
            id: "new-user-id",
            // @ts-expect-error - body type is unknown
            email: body.email,
            householdId: null,
          },
          token: "mock-jwt-token",
        },
      },
      { status: 201 }
    );
  }),

  http.get(`${API_BASE}/auth/session`, () => {
    return HttpResponse.json({
      success: true,
      data: {
        user: {
          id: "user-1",
          email: "test@example.com",
          householdId: "household-1",
          displayName: "Test User",
        },
      },
    });
  }),

  http.post(`${API_BASE}/auth/sign-out`, () => {
    return HttpResponse.json({
      success: true,
    });
  }),
];
