import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { useAuth } from './useAuth';
import { useToast } from './use-toast';

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
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const { toast } = useToast();

  const fetchStories = useCallback(async () => {
  if (!user) {
    setStories([]);
    setLoading(false);
    return;
  }

  try {
    const { data, error } = await supabase
      .from('stories')
      .select('*')
      .order('updated_at', { ascending: false });

    if (error) throw error;
    setStories((data as Story[]) || []);
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
  const { toast } = useToast();

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

          const nextScene = typed.new as Scene;
          if (!nextScene?.id) return;

          setScenes((prev) => {
            const idx = prev.findIndex((s) => s.id === nextScene.id);
            const next = [...prev];

            if (idx === -1) {
              next.push(nextScene);
            } else {
              next[idx] = { ...next[idx], ...nextScene };
            }

            next.sort((a, b) => a.scene_number - b.scene_number);
            return next;
          });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [storyId]);

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
      const { data, error } = await supabase
        .from('scenes')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      setScenes((prev) =>
        prev.map((s) => (s.id === id ? (data as Scene) : s))
      );
      return data as Scene;
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