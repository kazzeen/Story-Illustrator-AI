import { Brain, Zap, Sparkles, MessageSquare, Rocket } from "lucide-react";

export interface LLMModel {
  id: string;
  name: string;
  description: string;
  provider: string;
  strength: string;
  icon: React.ElementType;
  tier?: "Performance" | "Standard" | "Professional";
}

export const llmModels: LLMModel[] = [
  {
    id: "llama-3.3-70b",
    name: "Llama 3.3 70B",
    description: "High-quality creative writing with excellent instruction following and narrative coherence.",
    provider: "Meta / Venice",
    strength: "Best Quality",
    icon: Brain,
    tier: "Professional",
  },
  {
    id: "venice-uncensored",
    name: "Venice Uncensored",
    description: "Default Venice model with no content restrictions. Good for mature or edgy storylines.",
    provider: "Venice",
    strength: "Uncensored",
    icon: MessageSquare,
    tier: "Standard",
  },
  {
    id: "qwen3-235b",
    name: "Qwen 3 235B",
    description: "Large reasoning model with strong creative capabilities and multilingual support.",
    provider: "Alibaba / Venice",
    strength: "Reasoning & Depth",
    icon: Sparkles,
    tier: "Professional",
  },
  {
    id: "mistral-31-24b",
    name: "Mistral 31 24B",
    description: "Balanced model offering good quality at moderate cost. Solid all-rounder for storytelling.",
    provider: "Mistral / Venice",
    strength: "Balanced",
    icon: Zap,
    tier: "Standard",
  },
  {
    id: "llama-3.2-3b",
    name: "Llama 3.2 3B",
    description: "Fastest and most lightweight option. Best for quick drafts and iteration.",
    provider: "Meta / Venice",
    strength: "Speed",
    icon: Rocket,
    tier: "Performance",
  },
];
