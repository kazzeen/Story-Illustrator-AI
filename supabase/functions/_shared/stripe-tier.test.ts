import { describe, expect, it } from "vitest";
import { resolveSubscriptionTier, resolveTierFromPriceId } from "./stripe-tier";

describe("stripe-tier", () => {
  it("resolves starter tier", () => {
    const tier = resolveTierFromPriceId("price_starter_month", {
      STRIPE_PRICE_STARTER_ID: "price_starter_month",
      STRIPE_PRICE_STARTER_ANNUAL_ID: "price_starter_year",
    });
    expect(tier).toBe("starter");
  });

  it("resolves creator tier", () => {
    const tier = resolveTierFromPriceId("price_creator_year", {
      STRIPE_PRICE_CREATOR_ID: "price_creator_month",
      STRIPE_PRICE_CREATOR_ANNUAL_ID: "price_creator_year",
    });
    expect(tier).toBe("creator");
  });

  it("resolves professional tier", () => {
    const tier = resolveTierFromPriceId("price_pro_month", {
      STRIPE_PRICE_PROFESSIONAL_ID: "price_pro_month",
      STRIPE_PRICE_PROFESSIONAL_ANNUAL_ID: "price_pro_year",
    });
    expect(tier).toBe("professional");
  });

  it("returns null for unknown price", () => {
    const tier = resolveTierFromPriceId("price_unknown", {
      STRIPE_PRICE_STARTER_ID: "price_starter_month",
      STRIPE_PRICE_CREATOR_ID: "price_creator_month",
      STRIPE_PRICE_PROFESSIONAL_ID: "price_pro_month",
    });
    expect(tier).toBeNull();
  });

  it("prefers metadata tier over price id", () => {
    const tier = resolveSubscriptionTier({
      metadataTier: "creator",
      subscriptionTier: null,
      priceId: "price_starter_month",
      env: {
        STRIPE_PRICE_STARTER_ID: "price_starter_month",
        STRIPE_PRICE_CREATOR_ID: "price_creator_month",
        STRIPE_PRICE_PROFESSIONAL_ID: "price_pro_month",
      },
    });
    expect(tier).toBe("creator");
  });

  it("falls back to price id when metadata is missing", () => {
    const tier = resolveSubscriptionTier({
      metadataTier: null,
      subscriptionTier: null,
      priceId: "price_pro_month",
      env: {
        STRIPE_PRICE_STARTER_ID: "price_starter_month",
        STRIPE_PRICE_CREATOR_ID: "price_creator_month",
        STRIPE_PRICE_PROFESSIONAL_ID: "price_pro_month",
      },
    });
    expect(tier).toBe("professional");
  });

  it("uses subscription metadata tier when session metadata is missing", () => {
    const tier = resolveSubscriptionTier({
      metadataTier: null,
      subscriptionTier: "starter",
      priceId: "price_unknown",
      env: {
        STRIPE_PRICE_STARTER_ID: "price_starter_month",
        STRIPE_PRICE_CREATOR_ID: "price_creator_month",
        STRIPE_PRICE_PROFESSIONAL_ID: "price_pro_month",
      },
    });
    expect(tier).toBe("starter");
  });

  it("returns null when tier cannot be resolved", () => {
    const tier = resolveSubscriptionTier({
      metadataTier: "not_a_tier",
      subscriptionTier: "also_not_a_tier",
      priceId: "price_unknown",
      env: {
        STRIPE_PRICE_STARTER_ID: "price_starter_month",
        STRIPE_PRICE_CREATOR_ID: "price_creator_month",
        STRIPE_PRICE_PROFESSIONAL_ID: "price_pro_month",
      },
    });
    expect(tier).toBeNull();
  });
});
