import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json(401, { error: "Missing Authorization header" });
    }

    let requestBody: {
      genre?: string;
      prompt?: string;
      characters?: string;
      setting?: string;
      plotPoints?: string;
      model?: string;
    };
    try {
      requestBody = await req.json();
    } catch {
      return json(400, { error: "Invalid request body" });
    }

    const { genre, prompt, characters, setting, plotPoints, model } = requestBody;

    if (!genre || typeof genre !== "string") {
      return json(400, { error: "Genre is required" });
    }
    if (!prompt || typeof prompt !== "string" || prompt.trim().length < 20) {
      return json(400, { error: "Story description is required (at least 20 characters)" });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const veniceApiKey = Deno.env.get("VENICE_API_KEY")!;

    // Validate user
    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userErr } = await authClient.auth.getUser();
    const user = userData?.user;
    if (userErr || !user) {
      console.error("Auth validation failed:", userErr);
      return json(401, { error: "Invalid or expired session" });
    }

    // Build the creative writing prompt
    const selectedModel = model || "llama-3.3-70b";
    const parts: string[] = [];
    parts.push(`Write a compelling ${genre} story based on the following description:`);
    parts.push(`\nDescription: ${prompt.trim()}`);
    if (characters?.trim()) {
      parts.push(`\nCharacters: ${characters.trim()}`);
    }
    if (setting?.trim()) {
      parts.push(`\nSetting: ${setting.trim()}`);
    }
    if (plotPoints?.trim()) {
      parts.push(`\nKey plot points to include: ${plotPoints.trim()}`);
    }
    parts.push(`\nRequirements:
- Write a complete, well-structured story with a clear beginning, middle, and end
- Include vivid descriptions of settings, characters, and actions
- Use dialogue where appropriate
- Aim for 2000-4000 words
- Make the story engaging and emotionally resonant
- Include scene breaks where natural transitions occur

Format your response as:
TITLE: [Your story title here]
STORY:
[The full story text here]`);

    const storyPrompt = parts.join("\n");

    console.log("Calling Venice AI for story generation...", { model: selectedModel, genre });

    const aiResponse = await fetch("https://api.venice.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${veniceApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: selectedModel,
        safe_mode: false,
        messages: [
          {
            role: "system",
            content: "You are a talented creative fiction writer. Write vivid, engaging stories with rich descriptions suitable for visual illustration. Always follow the exact output format requested.",
          },
          { role: "user", content: storyPrompt },
        ],
      }),
    });

    if (!aiResponse.ok) {
      const t = await aiResponse.text();
      console.error("AI API error:", aiResponse.status, t);

      if (aiResponse.status === 429) return json(429, { error: "Rate limit exceeded. Please wait a moment and try again." });
      if (aiResponse.status === 402) return json(402, { error: "AI credits exhausted. Please add credits to continue." });

      return json(500, { error: "Failed to generate story. Please try again." });
    }

    const aiData = await aiResponse.json();
    const content = aiData.choices?.[0]?.message?.content || "";

    // Parse the response to extract title and story
    let title = "Untitled Story";
    let storyText = content;

    const titleMatch = content.match(/^TITLE:\s*(.+)/m);
    if (titleMatch) {
      title = titleMatch[1].trim();
    }

    const storyMatch = content.match(/STORY:\s*\n([\s\S]+)/);
    if (storyMatch) {
      storyText = storyMatch[1].trim();
    } else if (titleMatch) {
      // Remove the TITLE line from the story text
      storyText = content.replace(/^TITLE:\s*.+\n*/m, "").trim();
    }

    const wordCount = storyText.split(/\s+/).filter(Boolean).length;

    // Create the story in the database
    const admin = createClient(supabaseUrl, supabaseServiceKey);

    const { data: story, error: storyError } = await admin
      .from("stories")
      .insert({
        user_id: user.id,
        title,
        original_content: storyText,
        status: "imported",
        word_count: wordCount,
      })
      .select("id")
      .single();

    if (storyError) {
      console.error("Story insert error:", storyError);
      return json(500, { error: "Failed to save generated story" });
    }

    console.log("Story generated successfully!", { storyId: story.id, wordCount });

    return json(200, {
      storyId: story.id,
      title,
      content: storyText,
      wordCount,
    });
  } catch (error) {
    console.error("Error in generate-story function:", error);
    return json(500, { error: "An unexpected error occurred. Please try again." });
  }
});
