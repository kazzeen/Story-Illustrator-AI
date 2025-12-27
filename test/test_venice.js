
import fetch from 'node-fetch';

const apiKey = process.env.VENICE_API_KEY;

async function testVeniceGeneration() {
  console.log("Testing Venice AI generation...");
  if (!apiKey) {
    console.log("Skipping: VENICE_API_KEY is not set.");
    return;
  }
  try {
    const payload = {
        model: "venice-sd35",
        prompt: "A cute cat sitting on a futuristic chair",
        width: 1024,
        height: 1024,
        steps: 30,
        safe_mode: false,
        hide_watermark: true
    };

    // Compliance Check
    if (payload.safe_mode !== false || payload.hide_watermark !== true) {
        throw new Error("Compliance Check Failed: safe_mode must be false, hide_watermark must be true");
    }
    console.log("[Compliance] Payload verified: safe_mode=false, hide_watermark=true");

    const response = await fetch("https://api.venice.ai/api/v1/image/generate", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
        console.error("API Error:", response.status, await response.text());
        return;
    }

    const data = await response.json();
    console.log("Response Keys:", Object.keys(data));
    
    if (data.images) {
        console.log("Images array length:", data.images.length);
        const firstImage = data.images[0];
        console.log("First image type:", typeof firstImage);
        console.log("First image start:", firstImage.substring(0, 50));
    } else {
        console.log("No images in response:", JSON.stringify(data, null, 2));
    }

  } catch (error) {
    console.error("Test failed:", error);
  }
}

testVeniceGeneration();
