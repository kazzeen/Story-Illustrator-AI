
import { assemblePrompt } from "./supabase/functions/_shared/prompt-assembly.ts";
import { buildStyleGuidance } from "./supabase/functions/_shared/style-prompts.ts";

const styleId = "anime";
const model = "z-image-turbo";
const basePrompt = "A warrior standing on a cliff";

const guidance = buildStyleGuidance({ styleId, intensity: 100, strict: true });

const assembly = assemblePrompt({
  basePrompt,
  stylePrefix: guidance.prefix,
  stylePositive: guidance.positive,
  model,
  selectedStyleId: styleId,
});

console.log("--- Generated Prompt for Z-Image-Turbo ---");
console.log(assembly.fullPrompt);
console.log("------------------------------------------");
