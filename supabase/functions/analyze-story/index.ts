import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.2";
import { ensureHairEyeColorAttributes, type HairEyeAutogenConfig } from "../_shared/clothing-colors.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// UUID validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type JsonObject = Record<string, unknown>;

type CharacterReferenceSheet = {
  base_facial_features?: string;
  facial_proportions?: string;
  distinctive_physical_characteristics?: string;
  outfit_variations?: unknown[];
  age_and_change_parameters?: JsonObject;
};

type CharacterAnalysis = {
  name?: string;
  description?: string;
  physical_attributes?: string;
  clothing?: string;
  accessories?: string;
  personality?: string;
  reference_sheet?: CharacterReferenceSheet;
};

type SceneAnalysis = {
  title?: string;
  summary?: string;
  original_text?: string;
  characters?: unknown;
  character_states?: unknown;
  setting?: string;
  emotional_tone?: string;
  image_prompt?: string;
};

type AnalysisParsed = {
  scenes?: unknown;
  characters?: unknown;
  style_guide?: unknown;
  story_style_guide?: unknown;
};

type InsertedSceneRow = { id: string; scene_number: number };
type DbCharacterRow = { id: string; name: string | null };
type ExistingSheetRow = { character_id: string; version: number };
type InsertedSheetRow = { id: string; character_id: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const v of value) {
    if (typeof v === "string") out.push(v);
  }
  return out;
}

function asJsonObject(value: unknown): JsonObject | null {
  return isRecord(value) ? (value as JsonObject) : null;
}

function getNested(root: unknown, path: string[]): unknown {
  let curr: unknown = root;
  for (const key of path) {
    if (!isRecord(curr) || !(key in curr)) return undefined;
    curr = (curr as Record<string, unknown>)[key];
  }
  return curr;
}

function asHairEyeOverrides(value: unknown): HairEyeAutogenConfig["overrides"] | undefined {
  if (!isRecord(value)) return undefined;
  const out: NonNullable<HairEyeAutogenConfig["overrides"]> = {};
  for (const [rawName, rawEntry] of Object.entries(value)) {
    const nameKey = String(rawName || "").trim().toLowerCase();
    if (!nameKey) continue;
    if (!isRecord(rawEntry)) continue;
    const hairColor = asString((rawEntry as Record<string, unknown>).hairColor) ?? asString((rawEntry as Record<string, unknown>).hair_color);
    const eyeColor = asString((rawEntry as Record<string, unknown>).eyeColor) ?? asString((rawEntry as Record<string, unknown>).eye_color);
    const normalized: { hairColor?: string; eyeColor?: string } = {};
    if (hairColor && hairColor.trim()) normalized.hairColor = hairColor.trim();
    if (eyeColor && eyeColor.trim()) normalized.eyeColor = eyeColor.trim();
    if (Object.keys(normalized).length > 0) out[nameKey] = normalized;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function readHairEyeAutogenConfig(consistencySettings: unknown): Partial<HairEyeAutogenConfig> {
  const root = isRecord(consistencySettings) ? (consistencySettings as Record<string, unknown>) : {};
  const nested =
    (asJsonObject(getNested(root, ["hair_eye_autogen"])) as Record<string, unknown> | null) ||
    (asJsonObject(getNested(root, ["hairEyeAutogen"])) as Record<string, unknown> | null) ||
    {};

  const pick = (key: string) =>
    key in nested ? nested[key] : key in root ? root[key] : root[key.replace(/([A-Z])/g, "_$1").toLowerCase()];

  const enabled =
    asBoolean(pick("enabled")) ??
    asBoolean(pick("hair_eye_autogen_enabled")) ??
    asBoolean(pick("hairEyeAutogenEnabled")) ??
    undefined;
  const allowFantasyColors =
    asBoolean(pick("allowFantasyColors")) ??
    asBoolean(pick("allow_fantasy_colors")) ??
    asBoolean(pick("hair_eye_autogen_allow_fantasy_colors")) ??
    undefined;
  const allowRareEyeColors =
    asBoolean(pick("allowRareEyeColors")) ??
    asBoolean(pick("allow_rare_eye_colors")) ??
    asBoolean(pick("hair_eye_autogen_allow_rare_eye_colors")) ??
    undefined;
  const overrideWins =
    asBoolean(pick("overrideWins")) ??
    asBoolean(pick("override_wins")) ??
    asBoolean(pick("hair_eye_autogen_override_wins")) ??
    undefined;

  const preferredHairColors = asStringArray(pick("preferredHairColors")) ?? asStringArray(pick("preferred_hair_colors")) ?? undefined;
  const preferredEyeColors = asStringArray(pick("preferredEyeColors")) ?? asStringArray(pick("preferred_eye_colors")) ?? undefined;

  const overrides = asHairEyeOverrides(pick("overrides")) ?? asHairEyeOverrides(pick("hair_eye_autogen_overrides")) ?? undefined;

  return {
    enabled,
    allowFantasyColors,
    allowRareEyeColors,
    overrideWins,
    preferredHairColors,
    preferredEyeColors,
    overrides,
  };
}

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

    // Parse and validate request body
    let requestBody: { storyId?: string };
    try {
      requestBody = await req.json();
    } catch {
      return json(400, { error: "Invalid request body" });
    }

    const { storyId } = requestBody;
    
    // Validate storyId is a valid UUID
    if (!storyId || !UUID_REGEX.test(storyId)) {
      return json(400, { error: "Valid story ID is required" });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const veniceApiKey = Deno.env.get("VENICE_API_KEY")!;

    // Validate user manually (since verify_jwt is disabled)
    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userErr } = await authClient.auth.getUser();
    const user = userData?.user;
    if (userErr || !user) {
      console.error("Auth validation failed:", userErr);
      return json(401, { error: "Invalid or expired session" });
    }

    // Privileged DB client
    const admin = createClient(supabaseUrl, supabaseServiceKey);

    const { data: story, error: storyError } = await admin
      .from("stories")
      .select("id, user_id, original_content, consistency_settings")
      .eq("id", storyId)
      .maybeSingle();

    if (storyError) {
      console.error("Story fetch error:", storyError);
      return json(500, { error: "Failed to fetch story" });
    }

    if (!story) return json(404, { error: "Story not found" });
    if (story.user_id !== user.id) return json(403, { error: "Not allowed" });

    await admin.from("stories").update({ status: "analyzing" }).eq("id", storyId);

    const storyContent = story.original_content || "";
    const consistencySettings = (story as { consistency_settings?: unknown }).consistency_settings;
    const hairEyeConfig = readHairEyeAutogenConfig(consistencySettings);
    
    // Validate content length before processing
    if (storyContent.length > 100000) {
      console.error("Story content too long:", storyContent.length);
      await admin.from("stories").update({ status: "error" }).eq("id", storyId);
      return json(400, { error: "Story content exceeds maximum length" });
    }

    const analysisPrompt = `You are a professional story analyst and storyboard creator. Analyze the following story and break it down into key scenes suitable for illustration.

For each scene, provide:
1. A short, evocative title (3-5 words)
2. A brief summary (1-2 sentences)
3. The main characters present (as a list)
4. The setting/location
5. The emotional tone (e.g., "mysterious", "joyful", "tense")
6. A detailed image generation prompt (Stable Diffusion format: "style, subject, action, lighting, modifiers"). NO conversational filler.

Also extract a list of all main characters in the story, including their descriptions, physical attributes, and personality.

IMPORTANT: For each scene, check if any character changes their appearance (new clothes, injuries, messy hair, etc.). Create a 'character_states' object mapping character names to their specific appearance IN THAT SCENE.

ALSO create:
- A story-level 'style_guide' that defines consistent rendering techniques, lighting/shading standards, color palette restrictions, and perspective/composition rules.
- A detailed 'reference_sheet' for each character, covering:
  - Base facial features and proportions
  - Distinctive physical characteristics
  - Multiple outfit variations with clear progression logic across scenes
  - Age/appearance change parameters that can evolve gradually over the story

Story to analyze:
${storyContent.substring(0, 50000)}

Respond in JSON format with an object containing 'scenes' and 'characters':
{
  "style_guide": {
    "rendering_techniques": "e.g., cinematic storybook illustration, high detail",
    "lighting_and_shading": "rules for lighting direction, softness, contrast",
    "color_palette": "restricted palette guidance and key colors to repeat",
    "perspective_and_composition": "camera rules, framing, lens, consistency constraints",
    "negative_prompt": "optional negative prompt additions"
  },
  "characters": [
    {
      "name": "Character Name",
      "description": "Role and brief summary",
      "physical_attributes": "Hair, eyes, build, etc.",
      "clothing": "Signature outfit (default)",
      "personality": "Key traits",
      "accessories": "Items they carry",
      "reference_sheet": {
        "base_facial_features": "face shape, eyes, nose, mouth, brows, distinguishing marks",
        "facial_proportions": "proportion guidance that should not change",
        "distinctive_physical_characteristics": "scars, freckles, tattoos, unique hair, etc.",
        "outfit_variations": [
          {
            "key": "default",
            "name": "Default Outfit",
            "description": "what they wear, fabrics, colors, silhouette",
            "scene_range": { "start": 1, "end": 999 },
            "progression_logic": "when to switch to this outfit and why"
          }
        ],
        "age_and_change_parameters": {
          "baseline_age": "number or description",
          "gradual_changes": "how hair, face, posture, injuries evolve gradually",
          "change_rate": "slow/moderate/fast with justification"
        }
      }
    }
  ],
  "scenes": [
    {
      "title": "Scene title",
      "summary": "Brief summary",
      "original_text": "The relevant excerpt from the story",
      "characters": ["Character1", "Character2"],
      "character_states": {
        "Character1": { "clothing": "wearing pajamas", "state": "sleepy" },
        "Character2": { "clothing": "wearing full plate armor", "state": "alert" }
      },
      "setting": "Location and time description",
      "emotional_tone": "Primary emotion",
      "image_prompt": "Detailed prompt for image generation"
    }
  ]
}

Aim for 8-15 scenes depending on story length. Focus on visually interesting and narratively important moments.`;

    console.log("Calling Venice AI for story analysis...", { storyId });

    const aiResponse = await fetch("https://api.venice.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${veniceApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.3-70b",
        messages: [{ role: "user", content: analysisPrompt }],
      }),
    });

    if (!aiResponse.ok) {
      const t = await aiResponse.text();
      console.error("AI API error:", aiResponse.status, t);

      await admin.from("stories").update({ status: "error" }).eq("id", storyId);

      if (aiResponse.status === 429) return json(429, { error: "Rate limit exceeded. Please try again later." });
      if (aiResponse.status === 402) return json(402, { error: "AI credits exhausted. Please add credits to continue." });

      return json(500, { error: "Failed to analyze story. Please try again." });
    }

    const aiData = await aiResponse.json();
    const content = aiData.choices?.[0]?.message?.content || "";

    let scenes: SceneAnalysis[] = [];
    let characters: CharacterAnalysis[] = [];
    let styleGuide: JsonObject = {};
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON found in response");
      const parsedUnknown = JSON.parse(jsonMatch[0]) as unknown;
      const parsed = (isRecord(parsedUnknown) ? (parsedUnknown as AnalysisParsed) : {}) as AnalysisParsed;

      scenes = Array.isArray(parsed.scenes) ? (parsed.scenes as SceneAnalysis[]) : [];
      characters = Array.isArray(parsed.characters) ? (parsed.characters as CharacterAnalysis[]) : [];
      styleGuide =
        asJsonObject(parsed.style_guide) ||
        asJsonObject(parsed.story_style_guide) ||
        {};
    } catch (e) {
      console.error("Failed to parse AI response:", e);
      await admin.from("stories").update({ status: "error" }).eq("id", storyId);
      return json(500, { error: "Failed to parse story analysis. Please try again." });
    }

    const hairEyeAutogenItems: Array<Record<string, unknown>> = [];

    const charactersToInsert = characters
      .map((char) => {
        const name = asString(char.name);
        if (!name) return null;
        const autogen = ensureHairEyeColorAttributes({
          storyId,
          storyText: storyContent,
          characterName: name,
          description: asString(char.description),
          physicalAttributes: asString(char.physical_attributes),
          config: hairEyeConfig,
        });

        const enabled = autogen.configUsed.enabled;
        if (enabled) {
          hairEyeAutogenItems.push({
            character: name,
            added: autogen.added,
            skipped: autogen.skipped,
            final: autogen.final,
            issues: autogen.issues,
            inferred: autogen.context,
            config: {
              enabled: autogen.configUsed.enabled,
              allowFantasyColors: autogen.configUsed.allowFantasyColors,
              allowRareEyeColors: autogen.configUsed.allowRareEyeColors,
              overrideWins: autogen.configUsed.overrideWins,
              preferredHairColors: autogen.configUsed.preferredHairColors,
              preferredEyeColors: autogen.configUsed.preferredEyeColors,
              hasOverrides: Boolean(autogen.configUsed.overrides && Object.keys(autogen.configUsed.overrides).length > 0),
            },
          });
        }
        return {
          story_id: storyId,
          name,
          description: asString(char.description),
          physical_attributes: autogen.physicalAttributes || null,
          clothing: asString(char.clothing),
          accessories: asString(char.accessories),
          personality: asString(char.personality),
          source: "auto",
        };
      })
      .filter((c): c is NonNullable<typeof c> => Boolean(c));

    if (charactersToInsert.length > 0) {
      console.log("Inserting characters...", { storyId, count: charactersToInsert.length });
      const { error: charError } = await admin.from("characters").insert(charactersToInsert);
      if (charError) {
        console.error("Character insert error:", charError);
        // We continue even if character insert fails, as scenes are primary
      } else if (hairEyeAutogenItems.length > 0) {
        const status = hairEyeAutogenItems.some((i) => {
          const issues = (i.issues as unknown) as unknown[];
          return Array.isArray(issues) && issues.length > 0;
        })
          ? "warn"
          : "pass";
        const { error: logErr } = await admin.from("consistency_logs").insert({
          story_id: storyId,
          scene_id: null,
          check_type: "character_attribute_autogen",
          status,
          details: { type: "hair_eye_color", items: hairEyeAutogenItems },
        });
        if (logErr) console.error("Auto-generation log insert error:", logErr);
      }
    }

    const scenesToInsert = scenes.map((scene, index) => {
      const charactersArray = asStringArray(scene.characters) || [];
      const statesObject = asJsonObject(scene.character_states) || {};
      return {
        story_id: storyId,
        scene_number: index + 1,
        title: asString(scene.title),
        summary: asString(scene.summary),
        original_text: asString(scene.original_text),
        characters: charactersArray,
        character_states: statesObject,
        setting: asString(scene.setting),
        emotional_tone: asString(scene.emotional_tone),
        image_prompt: asString(scene.image_prompt),
        generation_status: "pending",
      };
    });

    console.log("Inserting scenes...", { storyId, count: scenesToInsert.length });

    const { data: insertedScenes, error: insertError } = await admin
      .from("scenes")
      .insert(scenesToInsert)
      .select("id, scene_number");
    if (insertError) {
      console.error("Scene insert error:", insertError);
      await admin.from("stories").update({ status: "error" }).eq("id", storyId);
      return json(500, { error: "Failed to save scenes" });
    }

    const { data: dbCharacters } = await admin
      .from("characters")
      .select("id, name, story_id")
      .eq("story_id", storyId);

    const characterIdByName = new Map<string, string>();
    ((dbCharacters || []) as DbCharacterRow[]).forEach((c) => {
      if (c.name && c.id) characterIdByName.set(String(c.name).toLowerCase(), String(c.id));
    });

    if (Object.keys(styleGuide || {}).length > 0) {
      const { data: lastGuide } = await admin
        .from("story_style_guides")
        .select("version")
        .eq("story_id", storyId)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();

      const nextVersion = (lastGuide?.version ?? 0) + 1;

      const { data: newGuide, error: guideErr } = await admin
        .from("story_style_guides")
        .insert({
          story_id: storyId,
          version: nextVersion,
          status: "approved",
          guide: styleGuide,
          created_by: user.id,
        })
        .select("id")
        .single();

      if (guideErr) {
        console.error("Style guide insert error:", guideErr);
      } else if (newGuide?.id) {
        await admin.from("stories").update({ active_style_guide_id: newGuide.id }).eq("id", storyId);
      }
    }

    if ((dbCharacters || []).length > 0 && characters.length > 0) {
      const characterIds = ((dbCharacters || []) as DbCharacterRow[])
        .map((c) => c.id)
        .filter((id) => Boolean(id));
      const { data: existingSheets } = await admin
        .from("character_reference_sheets")
        .select("character_id, version")
        .in("character_id", characterIds);

      const maxVersionByCharacterId = new Map<string, number>();
      ((existingSheets || []) as ExistingSheetRow[]).forEach((r) => {
        const characterId = String(r.character_id);
        const v = Number(r.version ?? 0);
        const curr = maxVersionByCharacterId.get(characterId) ?? 0;
        if (v > curr) maxVersionByCharacterId.set(characterId, v);
      });

      const sheetsToInsert = characters
        .map((char) => {
          const nameKey = String(char.name || "").toLowerCase();
          const characterId = characterIdByName.get(nameKey);
          if (!characterId) return null;

          const nextVersion = (maxVersionByCharacterId.get(characterId) ?? 0) + 1;
          const ref = (isRecord(char.reference_sheet) ? (char.reference_sheet as CharacterReferenceSheet) : {}) as CharacterReferenceSheet;
          const promptSnippetParts = [
            asString(char.physical_attributes),
            ref.base_facial_features ? `Face: ${ref.base_facial_features}` : "",
            ref.facial_proportions ? `Proportions: ${ref.facial_proportions}` : "",
            ref.distinctive_physical_characteristics ? `Distinctive: ${ref.distinctive_physical_characteristics}` : "",
          ].filter(Boolean);

          return {
            story_id: storyId,
            character_id: characterId,
            version: nextVersion,
            status: "approved",
            sheet: ref,
            prompt_snippet: promptSnippetParts.join(". "),
            reference_image_url: null,
            created_by: user.id,
          };
        })
        .filter((v): v is NonNullable<typeof v> => Boolean(v));

      if (sheetsToInsert.length > 0) {
        const { data: insertedSheets, error: sheetErr } = await admin
          .from("character_reference_sheets")
          .insert(sheetsToInsert)
          .select("id, character_id");

        if (sheetErr) {
          console.error("Reference sheet insert error:", sheetErr);
        } else {
          const updates = ((insertedSheets || []) as InsertedSheetRow[]).map((s) => ({
            id: s.character_id,
            active_reference_sheet_id: s.id,
          }));

          for (const u of updates) {
            await admin.from("characters").update({ active_reference_sheet_id: u.active_reference_sheet_id }).eq("id", u.id);
          }
        }
      }
    }

    if ((insertedScenes || []).length > 0 && (dbCharacters || []).length > 0) {
      const sceneIdByNumber = new Map<number, string>();
      ((insertedScenes || []) as InsertedSceneRow[]).forEach((s) => {
        const n = Number(s.scene_number);
        if (n && s.id) sceneIdByNumber.set(n, String(s.id));
      });

      const statesToUpsert: Array<{
        story_id: string;
        scene_id: string;
        character_id: string;
        state: JsonObject;
        source: string;
        story_context: string | null;
      }> = [];
      const lastStateByCharacterId = new Map<string, JsonObject>();
      const lastSceneIdByCharacterId = new Map<string, string>();
      const changeEvents: Array<{
        story_id: string;
        from_scene_id: string;
        to_scene_id: string;
        character_id: string;
        event: JsonObject;
        story_context: string | null;
      }> = [];

      scenes.forEach((scene, index) => {
        const sceneNumber = index + 1;
        const sceneId = sceneIdByNumber.get(sceneNumber);
        if (!sceneId) return;

        const states = asJsonObject(scene.character_states) || {};
        Object.keys(states).forEach((characterName) => {
          const characterId = characterIdByName.get(String(characterName).toLowerCase());
          if (!characterId) return;
          const nextState = asJsonObject(states[characterName]) || {};
          const prevState = lastStateByCharacterId.get(characterId) || {};
          const prevSceneId = lastSceneIdByCharacterId.get(characterId) || null;

          const keysToCompare = ["clothing", "state", "injury", "injuries", "hair", "age", "appearance"];
          const changedKeys = keysToCompare.filter((k) => {
            const a = prevState[k];
            const b = nextState[k];
            return a !== undefined && b !== undefined && String(a) !== String(b);
          });

          if (prevSceneId && changedKeys.length > 0) {
            changeEvents.push({
              story_id: storyId,
              from_scene_id: prevSceneId,
              to_scene_id: sceneId,
              character_id: characterId,
              event: {
                type: "appearance_change",
                changed_keys: changedKeys,
                from: prevState,
                to: nextState,
              },
              story_context: scene.original_text || scene.summary || null,
            });
          }

          statesToUpsert.push({
            story_id: storyId,
            scene_id: sceneId,
            character_id: characterId,
            state: nextState,
            source: "auto",
            story_context: scene.original_text || scene.summary || null,
          });

          lastStateByCharacterId.set(characterId, { ...(prevState || {}), ...(nextState || {}) });
          lastSceneIdByCharacterId.set(characterId, sceneId);
        });
      });

      if (statesToUpsert.length > 0) {
        const { error: stateErr } = await admin
          .from("scene_character_states")
          .upsert(statesToUpsert, { onConflict: "scene_id,character_id" } as unknown as { onConflict: string });
        if (stateErr) console.error("Scene character states upsert error:", stateErr);
      }

      if (changeEvents.length > 0) {
        const { error: changeErr } = await admin.from("character_change_events").insert(changeEvents);
        if (changeErr) console.error("Character change events insert error:", changeErr);
      }
    }

    await admin
      .from("stories")
      .update({ status: "analyzed", scene_count: scenesToInsert.length })
      .eq("id", storyId);

    console.log("Story analysis complete!", { storyId });

    return json(200, {
      success: true,
      sceneCount: scenesToInsert.length,
      message: `Successfully analyzed story into ${scenesToInsert.length} scenes`,
    });
  } catch (error) {
    console.error("Error in analyze-story function:", error);
    return json(500, { error: "An unexpected error occurred. Please try again." });
  }
});
