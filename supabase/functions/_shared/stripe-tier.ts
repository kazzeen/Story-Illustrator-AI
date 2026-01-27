export type SubscriptionTier = "starter" | "creator" | "professional";

export function normalizeSubscriptionTier(value: unknown): SubscriptionTier | null {
  if (value !== "starter" && value !== "creator" && value !== "professional") return null;
  return value;
}

export function resolveTierFromPriceId(
  priceId: string,
  env: Record<string, string | undefined>,
): SubscriptionTier | null {
  const starterIds = [env.STRIPE_PRICE_STARTER_ID, env.STRIPE_PRICE_STARTER_ANNUAL_ID].filter(Boolean) as string[];
  const creatorIds = [env.STRIPE_PRICE_CREATOR_ID, env.STRIPE_PRICE_CREATOR_ANNUAL_ID].filter(Boolean) as string[];
  const professionalIds = [env.STRIPE_PRICE_PROFESSIONAL_ID, env.STRIPE_PRICE_PROFESSIONAL_ANNUAL_ID].filter(Boolean) as string[];
  if (starterIds.includes(priceId)) return "starter";
  if (creatorIds.includes(priceId)) return "creator";
  if (professionalIds.includes(priceId)) return "professional";
  return null;
}

export function resolveSubscriptionTier(params: {
  metadataTier: unknown;
  subscriptionTier: unknown;
  priceId: string | null;
  env: Record<string, string | undefined>;
}): SubscriptionTier | null {
  const fromMetadata = normalizeSubscriptionTier(params.metadataTier);
  if (fromMetadata) return fromMetadata;
  const fromSubscriptionMetadata = normalizeSubscriptionTier(params.subscriptionTier);
  if (fromSubscriptionMetadata) return fromSubscriptionMetadata;
  if (!params.priceId) return null;
  return resolveTierFromPriceId(params.priceId, params.env);
}
