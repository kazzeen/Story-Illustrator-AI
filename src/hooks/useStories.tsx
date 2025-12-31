import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { useAuth } from './useAuth';
import { useToast } from './use-toast';
import { updateImagePromptWithAttributes } from '@/lib/scene-character-appearance';

export interface Story {
  id: string;
  title: string;
  description: string | null;
  original_filename: string | null;
  original_content: string | null;
  status: 'imported' | 'analyzing' | 'analyzed' | 'generating' | 'completed' | 'error';
  art_style: string;
  aspect_ratio: string;
  scene_count: number;
  completed_scenes?: number;
  word_count: number;
  active_style_guide_id?: string | null;
  consistency_settings?: Json | null;
  created_at: string;
  updated_at: string;
}

export interface Scene {
  id: string;
  story_id: string;
  scene_number: number;
  title: string | null;
  summary: string | null;
  original_text: string | null;
  characters: string[] | null;
  setting: string | null;
  emotional_tone: string | null;
  image_prompt: string | null;
  image_url: string | null;
  generation_status: 'pending' | 'generating' | 'completed' | 'error';
  character_states?: Json | null;
  consistency_score?: number | null;
  consistency_status: 'pass' | 'warn' | 'fail' | null;
  consistency_details?: Json | null;
  created_at: string;
  updated_at: string;
}

export function useStories() {
  const [stories, setStories] = useState<Story[]>([]);
  const [latestStoryImageById, setLatestStoryImageById] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const { toast } = useToast();
  const latestStoryImageByIdRef = useRef<Record<string, string>>({});

  useEffect(() => {
    latestStoryImageByIdRef.current = latestStoryImageById;
  }, [latestStoryImageById]);

  const fetchStories = useCallback(async () => {
    if (!user) {
      setStories([]);
      setLatestStoryImageById({});
      setLoading(false);
      return;
    }

    try {
      const { data: storiesData, error: storiesError } = await supabase
        .from('stories')
        .select('*')
        .order('updated_at', { ascending: false });

      if (storiesError) throw storiesError;

      // Fetch scene statuses for all stories to calculate progress
      const { data: scenesData, error: scenesError } = await supabase
        .from('scenes')
        .select('story_id, generation_status');

      if (scenesError) {
        console.error('Error fetching scenes:', scenesError);
        // Continue with stories only, progress will be 0
      }

      const storyIds = (storiesData as Story[]).map((s) => s.id).filter(Boolean);
      if (storyIds.length > 0) {
        const { data: scenesWithImages, error: scenesWithImagesError } = await supabase
          .from("scenes")
          .select("story_id, image_url, updated_at")
          .in("story_id", storyIds)
          .not("image_url", "is", null)
          .order("updated_at", { ascending: false });

        if (!scenesWithImagesError) {
          const next: Record<string, string> = {};
          (scenesWithImages || []).forEach((row) => {
            const sid = typeof row.story_id === "string" ? row.story_id : null;
            const url = typeof row.image_url === "string" ? row.image_url : null;
            if (!sid || !url) return;
            if (next[sid]) return;
            next[sid] = url;
          });
          setLatestStoryImageById(next);
        } else {
          console.error("Error fetching latest scene images:", scenesWithImagesError);
        }
      } else {
        setLatestStoryImageById({});
      }

      const storiesWithProgress = (storiesData as Story[]).map(story => {
        const storyScenes = scenesData?.filter(s => s.story_id === story.id) || [];
        const completed = storyScenes.filter(s => s.generation_status === 'completed').length;
        return { ...story, completed_scenes: completed };
      });

      setStories(storiesWithProgress);
    } catch (error) {
      console.error('Error fetching stories:', error);
      toast({
        title: 'Error',
        description: 'Failed to load stories',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [user, toast, setStories, setLoading]);

  useEffect(() => {
    fetchStories();

    // Real-time subscription for stories and scenes
    const channel = supabase.channel('dashboard-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stories' }, () => {
        fetchStories();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scenes' }, async (payload) => {
        const eventTypeRaw = (payload as unknown as { eventType?: unknown }).eventType;
        const eventType =
          eventTypeRaw === "INSERT" || eventTypeRaw === "UPDATE" || eventTypeRaw === "DELETE" ? eventTypeRaw : null;
        const nextRaw = payload.new;
        const oldRaw = payload.old;
        const storyId =
          (nextRaw && typeof nextRaw === 'object' && 'story_id' in nextRaw && typeof (nextRaw as { story_id?: unknown }).story_id === 'string'
            ? (nextRaw as { story_id: string }).story_id
            : null) ??
          (oldRaw && typeof oldRaw === 'object' && 'story_id' in oldRaw && typeof (oldRaw as { story_id?: unknown }).story_id === 'string'
            ? (oldRaw as { story_id: string }).story_id
            : null);
        if (!storyId) return;

        const nextImageUrl =
          nextRaw && typeof nextRaw === "object" && "image_url" in nextRaw && typeof (nextRaw as { image_url?: unknown }).image_url === "string"
            ? ((nextRaw as { image_url: string }).image_url || "").trim()
            : "";
        const oldImageUrl =
          oldRaw && typeof oldRaw === "object" && "image_url" in oldRaw && typeof (oldRaw as { image_url?: unknown }).image_url === "string"
            ? ((oldRaw as { image_url: string }).image_url || "").trim()
            : "";

        if (nextImageUrl) {
          setLatestStoryImageById((prev) => {
            if (prev[storyId] === nextImageUrl) return prev;
            return { ...prev, [storyId]: nextImageUrl };
          });
        } else if (oldImageUrl) {
          const current = latestStoryImageByIdRef.current[storyId];
          if (current && current === oldImageUrl) {
            void (async () => {
              const { data } = await supabase
                .from("scenes")
                .select("image_url, updated_at")
                .eq("story_id", storyId)
                .not("image_url", "is", null)
                .order("updated_at", { ascending: false })
                .limit(1);
              const url = data?.[0]?.image_url;
              if (typeof url !== "string" || !url.trim()) {
                setLatestStoryImageById((prev) => {
                  if (!prev[storyId]) return prev;
                  const next = { ...prev };
                  delete next[storyId];
                  return next;
                });
                return;
              }
              const cleaned = url.trim();
              setLatestStoryImageById((prev) => (prev[storyId] === cleaned ? prev : { ...prev, [storyId]: cleaned }));
            })();
          }
        }

        const nextStatus =
          nextRaw && typeof nextRaw === "object" && "generation_status" in nextRaw
            ? String((nextRaw as { generation_status?: unknown }).generation_status ?? "")
            : "";
        const oldStatus =
          oldRaw && typeof oldRaw === "object" && "generation_status" in oldRaw
            ? String((oldRaw as { generation_status?: unknown }).generation_status ?? "")
            : "";

        const shouldRecount = eventType === "DELETE" || (nextStatus && nextStatus !== oldStatus);
        if (!shouldRecount) return;

        const { count: completedCount } = await supabase
          .from("scenes")
          .select("*", { count: "exact", head: true })
          .eq("story_id", storyId)
          .eq("generation_status", "completed");

        setStories((prev) => {
          let changed = false;
          const next = prev.map((story) => {
            if (story.id !== storyId) return story;
            const nextCompleted = typeof completedCount === "number" ? completedCount : story.completed_scenes;
            if (nextCompleted === story.completed_scenes) return story;
            changed = true;
            return { ...story, completed_scenes: nextCompleted };
          });
          return changed ? next : prev;
        });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, fetchStories]);

  const createStory = async (title: string, content: string, filename: string) => {
    if (!user) return null;

    const wordCount = content.split(/\s+/).filter(Boolean).length;

    try {
      const { data, error } = await supabase
        .from('stories')
        .insert({
          user_id: user.id,
          title,
          original_content: content,
          original_filename: filename,
          word_count: wordCount,
          status: 'imported',
        })
        .select()
        .single();

      if (error) throw error;
      
      setStories((prev) => [data as Story, ...prev]);
      return data as Story;
    } catch (error) {
      console.error('Error creating story:', error);
      toast({
        title: 'Error',
        description: 'Failed to create story',
        variant: 'destructive',
      });
      return null;
    }
  };

  const updateStory = async (id: string, updates: Partial<Story>) => {
    try {
      const { data, error } = await supabase
        .from('stories')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      setStories((prev) =>
        prev.map((s) => (s.id === id ? (data as Story) : s))
      );
      return data as Story;
    } catch (error) {
      console.error('Error updating story:', error);
      toast({
        title: 'Error',
        description: 'Failed to update story',
        variant: 'destructive',
      });
      return null;
    }
  };

  const deleteStory = async (id: string) => {
    try {
      const { error } = await supabase.from('stories').delete().eq('id', id);

      if (error) throw error;

      setStories((prev) => prev.filter((s) => s.id !== id));
      return true;
    } catch (error) {
      console.error('Error deleting story:', error);
      toast({
        title: 'Error',
        description: 'Failed to delete story',
        variant: 'destructive',
      });
      return false;
    }
  };

  return {
    stories,
    latestStoryImageById,
    loading,
    fetchStories,
    createStory,
    updateStory,
    deleteStory,
  };
}

export function useScenes(storyId: string | null) {
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [loading, setLoading] = useState(true);
  const [characterDefaultsByLowerName, setCharacterDefaultsByLowerName] = useState<
    Record<string, { clothing?: string; accessories?: string; physical_attributes?: string }>
  >({});
  const scenesRef = useRef<Scene[]>([]);
  const { toast } = useToast();

  useEffect(() => {
    scenesRef.current = scenes;
  }, [scenes]);

  const refreshCharacterDefaults = useCallback(async () => {
    if (!storyId) {
      setCharacterDefaultsByLowerName({});
      return { ok: false as const, byLowerName: {} as Record<string, { clothing?: string; accessories?: string; physical_attributes?: string }> };
    }
    try {
      const { data, error } = await supabase
        .from("characters")
        .select("name, clothing, accessories, physical_attributes")
        .eq("story_id", storyId);
      if (error) throw error;

      const next: Record<string, { clothing?: string; accessories?: string; physical_attributes?: string }> = {};
      (data || []).forEach((row) => {
        const name = typeof row.name === "string" ? row.name.trim() : "";
        if (!name) return;
        const key = name.toLowerCase();
        const clothing = typeof row.clothing === "string" ? row.clothing : "";
        const accessories = typeof row.accessories === "string" ? row.accessories : "";
        const physical_attributes = typeof row.physical_attributes === "string" ? row.physical_attributes : "";
        next[key] = {
          clothing: clothing || undefined,
          accessories: accessories || undefined,
          physical_attributes: physical_attributes || undefined,
        };
      });

      setCharacterDefaultsByLowerName(next);
      return { ok: true as const, byLowerName: next };
    } catch {
      setCharacterDefaultsByLowerName({});
      return { ok: false as const, byLowerName: {} as Record<string, { clothing?: string; accessories?: string; physical_attributes?: string }> };
    }
  }, [storyId]);

  useEffect(() => {
    void refreshCharacterDefaults();
  }, [refreshCharacterDefaults]);

  useEffect(() => {
    if (!storyId) return;

    type CharactersRealtimePayload =
      | { eventType: "INSERT" | "UPDATE"; new: unknown; old?: unknown }
      | { eventType: "DELETE"; old: unknown };

    const channel = supabase
      .channel(`characters:${storyId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "characters", filter: `story_id=eq.${storyId}` },
        (payload) => {
          const typed = payload as unknown as CharactersRealtimePayload;
          const rowNew = typed.eventType === "DELETE" ? null : (typed.new as Record<string, unknown> | null);
          const changedName =
            rowNew && typeof rowNew.name === "string" ? rowNew.name.trim() : rowNew && rowNew.name ? String(rowNew.name).trim() : "";
          const changedKey = changedName ? changedName.toLowerCase() : null;

          void (async () => {
            const { byLowerName } = await refreshCharacterDefaults();
            if (!changedKey) return;

            const impacted = scenesRef.current.filter((s) => {
              if (typeof s.image_prompt !== "string" || s.image_prompt.trim().length === 0) return false;
              const names = Array.isArray(s.characters) ? s.characters : [];
              return names.some((n) => String(n || "").trim().toLowerCase() === changedKey);
            });

            for (const s of impacted) {
              const base = s.image_prompt;
              if (typeof base !== "string" || base.trim().length === 0) continue;
              const nextPrompt = updateImagePromptWithAttributes({
                basePrompt: base,
                characterNames: s.characters,
                characterStates: s.character_states,
                defaultsByLowerName: byLowerName,
              });
              if (nextPrompt && nextPrompt !== base) {
                void supabase.from("scenes").update({ image_prompt: nextPrompt }).eq("id", s.id);
              }
            }
          })();
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [storyId, refreshCharacterDefaults]);

  useEffect(() => {
    if (!storyId) {
      setScenes([]);
      setLoading(false);
      return;
    }

    (async () => {
      try {
        const { data, error } = await supabase
          .from('scenes')
          .select('*')
          .eq('story_id', storyId)
          .order('scene_number', { ascending: true });

        if (error) throw error;
        setScenes((data as Scene[]) || []);
      } catch (error) {
        console.error('Error fetching scenes:', error);
        toast({
          title: 'Error',
          description: 'Failed to load scenes',
          variant: 'destructive',
        });
      } finally {
        setLoading(false);
      }
    })();
  }, [storyId, toast, setScenes, setLoading]);

  useEffect(() => {
    if (!storyId) return;

    type ScenesRealtimePayload =
      | { eventType: "INSERT" | "UPDATE"; new: unknown }
      | { eventType: "DELETE"; old: unknown };

    const channel = supabase
      .channel(`scenes:${storyId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "scenes", filter: `story_id=eq.${storyId}` },
        (payload) => {
          const typed = payload as unknown as ScenesRealtimePayload;

          if (typed.eventType === "DELETE") {
            const oldRow = typed.old as { id?: string } | null;
            const deletedId = oldRow?.id;
            if (!deletedId) return;

            setScenes((prev) => prev.filter((s) => s.id !== deletedId));
            return;
          }

          const parseJsonIfString = (value: unknown) => {
            if (typeof value !== "string") return value;
            try {
              return JSON.parse(value) as unknown;
            } catch {
              return value;
            }
          };

          const nextScene = typed.new as Scene;
          if (!nextScene?.id) return;

          const normalizedNextScene = {
            ...nextScene,
            consistency_details: parseJsonIfString(nextScene.consistency_details),
            character_states: parseJsonIfString(nextScene.character_states),
          } as Scene;

          setScenes((prev) => {
            const idx = prev.findIndex((s) => s.id === normalizedNextScene.id);
            const next = [...prev];

            if (idx === -1) {
              next.push(normalizedNextScene);
            } else {
              next[idx] = { ...next[idx], ...normalizedNextScene };
            }

            next.sort((a, b) => a.scene_number - b.scene_number);
            return next;
          });

          if (typed.eventType === "INSERT") {
            const promptRaw = normalizedNextScene.image_prompt;
            const shouldUpdate =
              typeof promptRaw === "string" &&
              promptRaw.trim().length > 0 &&
              Array.isArray(normalizedNextScene.characters) &&
              normalizedNextScene.characters.length > 0;
            if (shouldUpdate) {
              const nextPrompt = updateImagePromptWithAttributes({
                basePrompt: promptRaw,
                characterNames: normalizedNextScene.characters,
                characterStates: normalizedNextScene.character_states,
                defaultsByLowerName: characterDefaultsByLowerName,
              });
              if (nextPrompt && nextPrompt !== promptRaw) {
                void supabase.from("scenes").update({ image_prompt: nextPrompt }).eq("id", normalizedNextScene.id);
              }
            }
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [storyId, characterDefaultsByLowerName]);

  const fetchScenes = useCallback(async () => {
    if (!storyId) {
      setScenes([]);
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('scenes')
        .select('*')
        .eq('story_id', storyId)
        .order('scene_number', { ascending: true });

      if (error) throw error;
      setScenes((data as Scene[]) || []);
    } catch (error) {
      console.error('Error fetching scenes:', error);
      toast({
        title: 'Error',
        description: 'Failed to load scenes',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [storyId, toast]);

  useEffect(() => {
    fetchScenes();
  }, [storyId, fetchScenes]);

  const updateScene = async (id: string, updates: Partial<Scene>) => {
    try {
      const parseJsonIfString = (value: unknown) => {
        if (typeof value !== "string") return value;
        try {
          return JSON.parse(value) as unknown;
        } catch {
          return value;
        }
      };
      const isRecord = (value: unknown): value is Record<string, unknown> =>
        typeof value === "object" && value !== null && !Array.isArray(value);

      const existingScene = scenes.find((s) => s.id === id) ?? null;
      const existingDetails = parseJsonIfString(existingScene?.consistency_details);
      const nextDetails = parseJsonIfString(updates.consistency_details);

      const mergedDetailsUpdates =
        "consistency_details" in updates && isRecord(existingDetails) && isRecord(nextDetails)
          ? (() => {
              const existingGen = parseJsonIfString(existingDetails.generation_debug);
              const nextGen = parseJsonIfString(nextDetails.generation_debug);
              const mergedGen =
                isRecord(existingGen) && isRecord(nextGen)
                  ? { ...existingGen, ...nextGen }
                  : isRecord(nextGen)
                    ? nextGen
                    : isRecord(existingGen)
                      ? existingGen
                      : undefined;
              const mergedDetails: Record<string, unknown> = { ...existingDetails, ...nextDetails };
              if (mergedGen) mergedDetails.generation_debug = mergedGen;
              return { ...updates, consistency_details: mergedDetails as Json };
            })()
          : updates;

      const shouldRefreshPrompt = ("character_states" in updates || "characters" in updates) && !("image_prompt" in updates);
      const nextSceneForPrompt = existingScene
        ? ({
            ...existingScene,
            ...mergedDetailsUpdates,
            character_states:
              "character_states" in mergedDetailsUpdates ? parseJsonIfString(mergedDetailsUpdates.character_states) : existingScene.character_states,
            characters: "characters" in mergedDetailsUpdates ? mergedDetailsUpdates.characters : existingScene.characters,
          } as Scene)
        : null;

      const refreshedPrompt =
        shouldRefreshPrompt && nextSceneForPrompt
          ? updateImagePromptWithAttributes({
              basePrompt: nextSceneForPrompt.image_prompt,
              characterNames: nextSceneForPrompt.characters,
              characterStates: nextSceneForPrompt.character_states,
              defaultsByLowerName: characterDefaultsByLowerName,
            })
          : null;

      const finalUpdates =
        shouldRefreshPrompt && refreshedPrompt && refreshedPrompt !== nextSceneForPrompt?.image_prompt
          ? { ...mergedDetailsUpdates, image_prompt: refreshedPrompt }
          : mergedDetailsUpdates;

      const { data, error } = await supabase
        .from('scenes')
        .update(finalUpdates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      const normalized = {
        ...(data as Scene),
        consistency_details: parseJsonIfString((data as Scene).consistency_details),
        character_states: parseJsonIfString((data as Scene).character_states),
      } as Scene;

      setScenes((prev) =>
        prev.map((s) => (s.id === id ? normalized : s))
      );
      return normalized;
    } catch (error) {
      console.error('Error updating scene:', error);
      toast({
        title: 'Error',
        description: 'Failed to update scene',
        variant: 'destructive',
      });
      return null;
    }
  };

  const stopAllGeneration = async () => {
    try {
      const { error } = await supabase
        .from('scenes')
        .update({ generation_status: 'pending' })
        .eq('story_id', storyId)
        .eq('generation_status', 'generating');

      if (error) throw error;

      // Optimistically update local state
      setScenes((prev) =>
        prev.map((s) =>
          s.generation_status === 'generating'
            ? { ...s, generation_status: 'pending' }
            : s
        )
      );
      
      toast({
        title: 'Stopped',
        description: 'Stopped all active generations',
      });
      return true;
    } catch (error) {
      console.error('Error stopping generation:', error);
      toast({
        title: 'Error',
        description: 'Failed to stop generation',
        variant: 'destructive',
      });
      return false;
    }
  };

  return {
    scenes,
    loading,
    fetchScenes,
    updateScene,
    stopAllGeneration,
    setScenes,
  };
}
