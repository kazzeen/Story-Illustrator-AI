
const assert = require('assert');

function sanitizePrompt(raw) {
  let out = String(raw || "");
  out = out.replace(/\s+/g, " ").trim();
  out = out
    .split("")
    .filter((c) => {
      const code = c.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join("");
  out = out.replace(/\s+/g, " ").trim();
  return out;
}

// Mock data
const scene = {
    id: "scene-1",
    story_id: "story-1",
    image_prompt: "Elena stands on the cliff edge.",
    characters: ["Elena", "The Guide"]
};

const storyCharacters = [
    {
        id: "char-1",
        name: "Elena",
        physical_attributes: "Tall, blonde hair, blue eyes",
        clothing: "Red cloak",
        accessories: "Silver necklace",
        description: "The brave protagonist"
    },
    {
        id: "char-2",
        name: "The Guide",
        physical_attributes: "Short, bearded",
        clothing: "Grey robes",
        accessories: "Wooden staff",
        description: "Mysterious helper"
    },
    {
        id: "char-3",
        name: "Villain",
        physical_attributes: "Dark armor",
        clothing: "Black cape",
        accessories: "Spiked mace",
        description: "The antagonist"
    }
];

// Logic from generate-scene-image
const sceneCharacterNames = scene.characters || [];
const activeCharacters = storyCharacters.filter(c => 
  sceneCharacterNames.some(name => name.toLowerCase().includes(c.name.toLowerCase()) || c.name.toLowerCase().includes(name.toLowerCase()))
) || [];

let characterContext = "";
if (activeCharacters.length > 0) {
  characterContext = "\n\nCharacter Details (Maintain Consistency):";
  activeCharacters.forEach(char => {
    characterContext += `\n- ${char.name}: ${char.physical_attributes || ''} ${char.clothing || ''} ${char.accessories || ''}. ${char.description || ''}`;
  });
}

const safePrompt = scene.image_prompt;
const styleModifier = "cinematic style";
const fullPrompt = `Create a professional illustration: ${safePrompt}.${characterContext} Style: ${styleModifier}. High quality, detailed, artistic illustration suitable for a storybook.`;

console.log("Full Prompt Generated:\n", fullPrompt);

// Assertions
try {
    assert(fullPrompt.includes("Elena: Tall, blonde hair, blue eyes Red cloak Silver necklace. The brave protagonist"));
    assert(fullPrompt.includes("The Guide: Short, bearded Grey robes Wooden staff. Mysterious helper"));
    assert(!fullPrompt.includes("Villain")); // Villain is not in the scene

    assert.strictEqual(sanitizePrompt("Elena stands on the cliff edge."), "Elena stands on the cliff edge.");
    assert.strictEqual(sanitizePrompt("  Elena\tstands\non  the  cliff  "), "Elena stands on the cliff");
    assert.strictEqual(sanitizePrompt("Elena\u0007 stands"), "Elena stands");
    assert.strictEqual(sanitizePrompt("nude gore weapon"), "nude gore weapon");
    assert(!/\bE\s+l\s+e\s+n\s+a\b/.test(sanitizePrompt("Elena")));

    console.log("Test Passed: Character details correctly included in prompt.");
} catch (e) {
    console.error("Test Failed:", e.message);
    process.exit(1);
}
