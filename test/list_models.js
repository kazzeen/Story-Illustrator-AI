// test/list_models.js
// Run with: node --env-file=.env test/list_models.js

const apiKey = process.env.VENICE_API_KEY;

async function listModels() {
  console.log("Listing Venice AI models...");
  if (!apiKey) {
    console.log("Skipping: VENICE_API_KEY is not set. Please run with --env-file=.env or set the variable.");
    return;
  }
  try {
    const response = await fetch("https://api.venice.ai/api/v1/models", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
        console.error("API Error:", response.status, await response.text());
        return;
    }

    const data = await response.json();
    console.log("All Model IDs:", JSON.stringify(data.data.map(m => m.id), null, 2));

  } catch (error) {
    console.error("Test failed:", error);
  }
}

listModels();
