export const TEST_USER = {
  email: "tester@pantrymaid.test",
  password: "Test1234!",
  name: "Test User",
};

export const TEST_USER_B = {
  email: "member@pantrymaid.test",
  password: "Test1234!",
  name: "Household Member",
};

export const ITEMS = {
  pantry: {
    name: "Olive Oil",
    quantity: 1,
    unit: "pieces",
    location: "pantry" as const,
    category: "Condiments",
  },
  fridge: {
    name: "Whole Milk",
    quantity: 1,
    unit: "pieces",
    location: "fridge" as const,
    category: "Dairy",
  },
  freezer: {
    name: "Frozen Peas",
    quantity: 2,
    unit: "pieces",
    location: "freezer" as const,
    category: "Vegetables",
  },
  withExpiry: {
    name: "Greek Yogurt",
    quantity: 3,
    unit: "pieces",
    location: "fridge" as const,
    category: "Dairy",
    expiryDate: "2026-04-15",
  },
};

export const BARCODE_MOCK = {
  upc: "021130126026",
  name: "Heinz Tomato Ketchup",
  brand: "Heinz",
  category: "Condiments",
};
