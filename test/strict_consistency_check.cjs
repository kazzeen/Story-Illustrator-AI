
const assert = require('assert');

// Mock data
const scene = {
    id: "scene-1",
    story_id: "story-1",
    image_prompt: "Elena stands on the cliff edge.",
    characters: ["Elena"],
    stories: {
        consistency_settings: { mode: "strict" }
    }
};

const storyCharacters = [
    {
        name: "Elena",
        physical_attributes: "Tall, blonde",
        clothing: "Red cloak",
        accessories: "",
        description: "Protagonist"
    }
];

// Logic Simulation
const consistencySettings = scene.stories.consistency_settings;
const isStrict = consistencySettings.mode === "strict";

const activeCharacters = storyCharacters.filter(c => scene.characters.includes(c.name));

let characterContext = "";
if (activeCharacters.length > 0) {
    characterContext = "\n\nCharacter Details (Maintain Consistency):";
    activeCharacters.forEach(char => {
        const charDesc = `- ${char.name}: ${char.physical_attributes || ''} ${char.clothing || ''} ${char.accessories || ''}. ${char.description || ''}`;
        characterContext += `\n${charDesc}`;
    });

    if (isStrict) {
        characterContext += "\nCRITICAL: You MUST strictly adhere to these character descriptions. Do not alter their physical appearance or clothing.";
    }
}

console.log("Generated Context:", characterContext);

// Assertions
try {
    assert(characterContext.includes("Elena"));
    assert(characterContext.includes("Tall, blonde"));
    assert(characterContext.includes("Red cloak"));
    assert(characterContext.includes("CRITICAL"), "Strict mode should add critical warning");
    console.log("Test Passed: Strict mode correctly adds warning and details.");
} catch (e) {
    console.error("Test Failed:", e.message);
    process.exit(1);
}
