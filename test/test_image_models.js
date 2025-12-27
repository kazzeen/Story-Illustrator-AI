// test/test_image_models.js
// Run with: node --env-file=.env test/test_image_models.js

const apiKey = process.env.VENICE_API_KEY;

const modelsToTest = [
  "qwen-image"
];

async function testModel(model) {
  console.log(`Testing model: ${model}...`);
  if (!apiKey) {
    console.log("Skipping: VENICE_API_KEY is not set.");
    return;
  }

  // Exact payload structure from generate-scene-image/index.ts
  const payload = {
    model,
    prompt: "A simple red apple",
    negative_prompt: "bad quality",
    width: 1024,
    height: 576,
    steps: 8, // Testing with 8
    cfg_scale: 7.5,
    safe_mode: false,
    hide_watermark: true,
    embed_exif_metadata: false,
  };

  try {
    const response = await fetch("https://api.venice.ai/api/v1/image/generate", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error(`[FAIL] ${model}: ${response.status} - ${errorText}`);
    } else {
        console.log(`[PASS] ${model}: Success`);
    }

  } catch (error) {
    console.error(`[ERR] ${model}:`, error.message);
  }
}

testModel("qwen-image");
