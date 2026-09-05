import { describe, test, expect } from "bun:test";
import { normalizeIngredientName, isStaple, STAPLES } from "../../../lib/ingredients";

describe("normalizeIngredientName", () => {
  test("lowercases and trims", () => {
    expect(normalizeIngredientName("  Onion  ")).toBe("onion");
  });

  test("strips punctuation and parenthetical asides", () => {
    expect(normalizeIngredientName("Unsweetened Almond Milk (32 oz)")).toBe("almond milk");
    expect(normalizeIngredientName("Tomatoes, Roma")).toBe("tomato roma");
  });

  test("drops stopwords", () => {
    expect(normalizeIngredientName("chopped onion")).toBe("onion");
    expect(normalizeIngredientName("organic fresh spinach")).toBe("spinach");
    expect(normalizeIngredientName("boneless skinless chicken breast")).toBe("chicken breast");
  });

  describe("plural/singular", () => {
    test("regular plurals", () => {
      expect(normalizeIngredientName("onions")).toBe("onion");
      expect(normalizeIngredientName("eggs")).toBe("egg");
      expect(normalizeIngredientName("apples")).toBe("apple");
      expect(normalizeIngredientName("carrots")).toBe("carrot");
    });

    test("irregular plurals", () => {
      expect(normalizeIngredientName("tomatoes")).toBe("tomato");
      expect(normalizeIngredientName("potatoes")).toBe("potato");
      expect(normalizeIngredientName("berries")).toBe("berry");
      expect(normalizeIngredientName("cherries")).toBe("cherry");
      expect(normalizeIngredientName("leaves")).toBe("leaf");
      expect(normalizeIngredientName("loaves")).toBe("loaf");
      expect(normalizeIngredientName("knives")).toBe("knife");
    });

    test("mass nouns that end in 's' are left alone", () => {
      expect(normalizeIngredientName("asparagus")).toBe("asparagus");
      expect(normalizeIngredientName("hummus")).toBe("hummus");
      expect(normalizeIngredientName("couscous")).toBe("couscous");
    });

    test("boxes/dishes-style -es plurals", () => {
      expect(normalizeIngredientName("boxes")).toBe("box");
      expect(normalizeIngredientName("dishes")).toBe("dish");
    });
  });

  describe("compound-food allowlist", () => {
    test("almond milk never degrades to almond", () => {
      expect(normalizeIngredientName("almond milk")).toBe("almond milk");
      expect(normalizeIngredientName("Almond Milk")).toBe("almond milk");
      expect(normalizeIngredientName("unsweetened organic almond milk")).toBe("almond milk");
    });

    test("olive oil, peanut butter, ice cream preserved", () => {
      expect(normalizeIngredientName("extra virgin olive oil")).toBe("olive oil");
      expect(normalizeIngredientName("creamy peanut butter")).toBe("peanut butter");
      expect(normalizeIngredientName("vanilla ice cream")).toBe("ice cream");
    });

    test("plain milk normalizes to just 'milk', distinct from almond milk", () => {
      expect(normalizeIngredientName("whole milk")).toBe("milk");
      expect(normalizeIngredientName("milk")).toBe("milk");
      expect(normalizeIngredientName("almond milk")).not.toBe("milk");
    });
  });

  test("returns empty string for empty/whitespace-only input", () => {
    expect(normalizeIngredientName("")).toBe("");
    expect(normalizeIngredientName("   ")).toBe("");
  });

  test("falls back to original tokens when every token is a stopword", () => {
    // Degenerate input — must not throw or return an empty string when there's
    // clearly *something* there.
    expect(normalizeIngredientName("fresh organic")).toBe("fresh organic");
  });
});

describe("STAPLES / isStaple", () => {
  test("covers salt, pepper, water, cooking oil, common spices", () => {
    expect(isStaple("salt")).toBe(true);
    expect(isStaple("pepper")).toBe(true);
    expect(isStaple("water")).toBe(true);
    expect(isStaple("cooking oil")).toBe(true);
    expect(isStaple("cumin")).toBe(true);
    expect(isStaple("cinnamon")).toBe(true);
  });

  test("does not flag ordinary ingredients as staples", () => {
    expect(isStaple("chicken breast")).toBe(false);
    expect(isStaple("onion")).toBe(false);
    expect(isStaple(normalizeIngredientName("Roma Tomatoes"))).toBe(false);
  });

  test("STAPLES set members are already in normalized form", () => {
    for (const staple of STAPLES) {
      expect(normalizeIngredientName(staple)).toBe(staple);
    }
  });
});
