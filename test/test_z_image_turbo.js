// test/test_z_image_turbo.js
const apiKey = process.env.VENICE_API_KEY;

const model = "z-image-turbo";

async function testZImageTurbo() {
  console.log(`Testing model: ${model}...`);
  if (!apiKey) {
    console.log("Skipping: VENICE_API_KEY is not set.");
    return;
  }

  // Payload mimicking what generate-scene-image sends for z-image-turbo
  // Note: steps=0, no negative_prompt, style keywords front-loaded
  const payload = {
    model,
    prompt: "anime style artwork of, cel shading, A warrior standing on a cliff",
    width: 1024,
    height: 1024,
    steps: 0, // as per generate-scene-image logic
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
        const data = await response.json();
        console.log(`[PASS] ${model}: Success`);
        if (data.images && data.images.length > 0) {
            console.log("Image data received (base64 length):", data.images[0].length);
        }
    }

  } catch (error) {
    console.error(`[ERR] ${model}:`, error.message);
  }
}

testZImageTurbo();
