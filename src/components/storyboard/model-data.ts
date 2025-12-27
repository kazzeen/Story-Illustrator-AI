import { Image as ImageIcon, Sparkles, Zap } from "lucide-react";

export interface ImageModel {
  id: string;
  name: string;
  description: string;
  provider: string;
  cost: "low" | "medium" | "high";
  strength: string;
  icon: React.ElementType;
}

export const imageModels: ImageModel[] = [
  {
    id: "venice-sd35",
    name: "Venice SD3.5",
    description: "Private implementation of Stable Diffusion 3.5. Balanced performance.",
    provider: "Venice",
    cost: "medium",
    strength: "General Purpose",
    icon: ImageIcon,
  },
  {
    id: "hidream",
    name: "HiDream",
    description: "High-quality generation with validated output standards.",
    provider: "Venice",
    cost: "medium",
    strength: "General Purpose",
    icon: Sparkles,
  },
  {
    id: "lustify-sdxl",
    name: "Lustify SDXL",
    description: "Uncensored model optimized for character portraits.",
    provider: "Lustify",
    cost: "low",
    strength: "Uncensored / Characters",
    icon: Zap,
  },
  {
    id: "lustify-v7",
    name: "Lustify v7",
    description: "Latest uncensored model with improved parameter tuning.",
    provider: "Lustify",
    cost: "low",
    strength: "Uncensored / Advanced",
    icon: Zap,
  },
  {
    id: "qwen-image",
    name: "Qwen",
    description: "Optimized for cultural context and diverse language prompts.",
    provider: "Venice",
    cost: "medium",
    strength: "Cultural Context",
    icon: ImageIcon,
  },
  {
    id: "wai-Illustrious",
    name: "Anime (WAI)",
    description: "Specialized for anime style and character consistency.",
    provider: "WAI",
    cost: "low",
    strength: "Anime",
    icon: Sparkles,
  },
  {
    id: "z-image-turbo",
    name: "Z-Image Turbo",
    description: "High-speed generation optimized for rapid iteration.",
    provider: "Venice",
    cost: "low",
    strength: "Speed",
    icon: Zap,
  },
];