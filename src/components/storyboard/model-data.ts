import { Image as ImageIcon, Sparkles, Zap, Brain, Rocket } from "lucide-react";

export interface ImageModel {
  id: string;
  name: string;
  description: string;
  provider: string;
  cost: "low" | "medium" | "high";
  strength: string;
  icon: React.ElementType;
  tier?: "Performance" | "Standard" | "Professional";
  specs?: {
    resolution: string;
    features: string[];
    useCase: string;
  };
  supportedResolutions?: { label: string; width: number; height: number }[];
}

export const imageModels: ImageModel[] = [
  {
    id: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash (Nano Banana)",
    description: "High-speed, efficient image generation optimized for rapid processing.",
    provider: "Google",
    cost: "low",
    strength: "Speed & Efficiency",
    icon: Rocket,
    tier: "Performance",
    specs: {
      resolution: "1024×1024",
      features: ["Low latency", "High throughput", "Optimized processing"],
      useCase: "Quick prototyping, social media content"
    },
    supportedResolutions: [
      { label: "Square (1024×1024)", width: 1024, height: 1024 },
    ]
  },
  {
    id: "gemini-3-pro",
    name: "Gemini 3 Pro (Nano Banana Pro)",
    description: "Professional asset production with real-world grounding and reasoning.",
    provider: "Google",
    cost: "high",
    strength: "Reasoning & Quality",
    icon: Brain,
    tier: "Professional",
    specs: {
      resolution: "Up to 4K (3840×2160)",
      features: ["Google Search grounding", "Composition refinement", "Complex instruction following"],
      useCase: "Marketing materials, detailed product visuals"
    },
    supportedResolutions: [
      { label: "Standard HD (1920×1080)", width: 1920, height: 1080 },
      { label: "4K UHD (3840×2160)", width: 3840, height: 2160 },
      { label: "Square (1024×1024)", width: 1024, height: 1024 },
      { label: "Portrait (1080×1920)", width: 1080, height: 1920 },
    ]
  },
  {
    id: "venice-sd35",
    name: "Venice SD3.5",
    description: "Private implementation of Stable Diffusion 3.5. Balanced performance.",
    provider: "Venice",
    cost: "medium",
    strength: "General Purpose",
    icon: ImageIcon,
    tier: "Standard",
    specs: {
      resolution: "1024×1024",
      features: ["Private implementation", "Balanced detail"],
      useCase: "General storyboarding, concept art"
    }
  },
  {
    id: "hidream",
    name: "HiDream",
    description: "High-quality generation with validated output standards.",
    provider: "Venice",
    cost: "medium",
    strength: "General Purpose",
    icon: Sparkles,
    tier: "Standard",
    specs: {
      resolution: "1024×1024",
      features: ["Validated output", "Consistent style"],
      useCase: "Polished illustrations"
    }
  },
  {
    id: "lustify-sdxl",
    name: "Lustify SDXL",
    description: "Uncensored model optimized for character portraits.",
    provider: "Lustify",
    cost: "low",
    strength: "Uncensored / Characters",
    icon: Zap,
    tier: "Performance",
    specs: {
      resolution: "1024×1024",
      features: ["Character focused", "Uncensored"],
      useCase: "Character portraits"
    }
  },
  {
    id: "lustify-v7",
    name: "Lustify v7",
    description: "Latest uncensored model with improved parameter tuning.",
    provider: "Lustify",
    cost: "low",
    strength: "Uncensored / Advanced",
    icon: Zap,
    tier: "Performance",
    specs: {
      resolution: "1024×1024",
      features: ["Advanced tuning", "Uncensored"],
      useCase: "Complex character scenes"
    }
  },
  {
    id: "qwen-image",
    name: "Qwen",
    description: "Optimized for cultural context and diverse language prompts.",
    provider: "Venice",
    cost: "medium",
    strength: "Cultural Context",
    icon: ImageIcon,
    tier: "Standard",
    specs: {
      resolution: "1024×1024",
      features: ["Multilingual prompt support", "Cultural awareness"],
      useCase: "Global content, diverse settings"
    }
  },
  {
    id: "wai-Illustrious",
    name: "Anime (WAI)",
    description: "Specialized for anime style and character consistency.",
    provider: "WAI",
    cost: "low",
    strength: "Anime",
    icon: Sparkles,
    tier: "Performance",
    specs: {
      resolution: "1024×1024",
      features: ["Anime aesthetic", "Character consistency"],
      useCase: "Anime/Manga style stories"
    }
  },
  {
    id: "z-image-turbo",
    name: "Z-Image Turbo",
    description: "High-speed generation optimized for rapid iteration.",
    provider: "Venice",
    cost: "low",
    strength: "Speed",
    icon: Zap,
    tier: "Performance",
    specs: {
      resolution: "512×512",
      features: ["Ultra-fast generation", "Low cost"],
      useCase: "Rapid brainstorming"
    }
  },
];
