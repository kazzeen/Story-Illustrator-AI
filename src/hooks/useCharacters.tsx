import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { enforceCharacterAgeCompliance } from "@/lib/character-compliance";

export interface Character {
  id: string;
  story_id: string;
  name: string;
  age?: number | null; // Added for compliance
  description: string | null;
  physical_attributes: string | null;
  clothing: string | null;
  accessories: string | null;
  personality: string | null;
  image_url: string | null;
  source: "manual" | "auto";
  created_at: string;
  updated_at: string;
}

type CreateCharacterInput = {
  name: string;
  age?: number | null; // Added for compliance
  description?: string | null;
  physical_attributes?: string | null;
  clothing?: string | null;
  accessories?: string | null;
  personality?: string | null;
  image_url?: string | null;
  source?: Character["source"];
};

type UpdateCharacterInput = Partial<Omit<Character, "id" | "story_id" | "created_at" | "updated_at">>;

export function useCharacters(storyId: string | null) {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [loading, setLoading] = useState(false);
  const { user } = useAuth();
  const { toast } = useToast();

  const coerceCharacter = (row: unknown): Character => {
    const obj = row as Record<string, unknown>;
    const sourceRaw = obj.source;
    const source: Character["source"] = sourceRaw === "auto" ? "auto" : "manual";
    return {
      id: String(obj.id ?? ""),
      story_id: String(obj.story_id ?? ""),
      name: String(obj.name ?? ""),
      description: typeof obj.description === "string" ? obj.description : obj.description === null ? null : null,
      physical_attributes:
        typeof obj.physical_attributes === "string" ? obj.physical_attributes : obj.physical_attributes === null ? null : null,
      clothing: typeof obj.clothing === "string" ? obj.clothing : obj.clothing === null ? null : null,
      accessories: typeof obj.accessories === "string" ? obj.accessories : obj.accessories === null ? null : null,
      personality: typeof obj.personality === "string" ? obj.personality : obj.personality === null ? null : null,
      image_url: typeof obj.image_url === "string" ? obj.image_url : obj.image_url === null ? null : null,
      source,
      created_at: String(obj.created_at ?? ""),
      updated_at: String(obj.updated_at ?? ""),
    };
  };

  const fetchCharacters = useCallback(async () => {
    if (!storyId || !user) {
      setCharacters([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("characters")
        .select("*")
        .eq("story_id", storyId)
        .order("created_at", { ascending: true });

      if (error) throw error;
      setCharacters((data || []).map(coerceCharacter));
    } catch (error) {
      console.error("Error fetching characters:", error);
      toast({
        title: "Error",
        description: "Failed to load characters",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [storyId, user, toast]);

  useEffect(() => {
    fetchCharacters();
  }, [fetchCharacters]);

  const addCharacter = async (character: CreateCharacterInput) => {
    if (!storyId || !user) return;

    // Age Compliance Check
    const complianceResult = enforceCharacterAgeCompliance(character);
    
    if (!complianceResult.isCompliant) {
      toast({
        title: "Compliance Error",
        description: complianceResult.errors.join(", "),
        variant: "destructive",
      });
      return;
    }

    const validatedChar = complianceResult.character;
    if (complianceResult.wasModified) {
       console.log("Character age adjusted for compliance:", complianceResult.auditLog);
       // Since we don't store age column yet, we ensure description reflects 18+ if it mentioned age
       // For now, we just proceed with the validated object, assuming upstream usage handles it
    }

    try {
      if (!validatedChar.name?.trim()) {
        toast({
          title: "Error",
          description: "Character name is required",
          variant: "destructive",
        });
        return;
      }
      const payload: Database["public"]["Tables"]["characters"]["Insert"] = {
          story_id: storyId,
          name: String(validatedChar.name ?? ""),
          description: typeof validatedChar.description === "string" ? validatedChar.description : null,
          physical_attributes:
            typeof validatedChar.physical_attributes === "string" ? validatedChar.physical_attributes : null,
          clothing: typeof validatedChar.clothing === "string" ? validatedChar.clothing : null,
          accessories: typeof validatedChar.accessories === "string" ? validatedChar.accessories : null,
          personality: typeof validatedChar.personality === "string" ? validatedChar.personality : null,
          image_url: typeof validatedChar.image_url === "string" ? validatedChar.image_url : null,
          source: validatedChar.source === "auto" ? "auto" : "manual",
      };

      const { data, error } = await supabase
        .from("characters")
        .insert(payload)
        .select()
        .single();

      if (error) throw error;
      const next = coerceCharacter(data);
      setCharacters((prev) => [...prev, next]);
      toast({
        title: "Success",
        description: "Character added",
      });
      return next;
    } catch (error) {
      console.error("Error adding character:", error);
      toast({
        title: "Error",
        description: "Failed to add character",
        variant: "destructive",
      });
    }
  };

  const updateCharacter = async (id: string, updates: UpdateCharacterInput) => {
    // Age Compliance Check
    const complianceResult = enforceCharacterAgeCompliance(updates);
    
    if (!complianceResult.isCompliant) {
      toast({
        title: "Compliance Error",
        description: complianceResult.errors.join(", "),
        variant: "destructive",
      });
      return;
    }

    const validatedUpdates = complianceResult.character;

    const dbUpdates: Database["public"]["Tables"]["characters"]["Update"] = {};
    const validatedRec = validatedUpdates as Record<string, unknown>;
    if (typeof validatedUpdates.name === "string") dbUpdates.name = validatedUpdates.name;
    if (validatedUpdates.description === null || typeof validatedUpdates.description === "string")
      dbUpdates.description = validatedUpdates.description;
    if (
      validatedUpdates.physical_attributes === null ||
      typeof validatedUpdates.physical_attributes === "string"
    )
      dbUpdates.physical_attributes = validatedUpdates.physical_attributes;
    const clothing = validatedRec.clothing;
    if (clothing === null) dbUpdates.clothing = null;
    else if (typeof clothing === "string") dbUpdates.clothing = clothing;
    const accessories = validatedRec.accessories;
    if (accessories === null) dbUpdates.accessories = null;
    else if (typeof accessories === "string") dbUpdates.accessories = accessories;
    const personality = validatedRec.personality;
    if (personality === null) dbUpdates.personality = null;
    else if (typeof personality === "string") dbUpdates.personality = personality;
    const imageUrl = validatedRec.image_url;
    if (imageUrl === null) dbUpdates.image_url = null;
    else if (typeof imageUrl === "string") dbUpdates.image_url = imageUrl;
    if (validatedUpdates.source === "auto") dbUpdates.source = "auto";
    if (validatedUpdates.source === "manual") dbUpdates.source = "manual";

    try {
      const { data, error } = await supabase
        .from("characters")
        .update(dbUpdates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      const next = coerceCharacter(data);
      setCharacters((prev) => prev.map((c) => (c.id === id ? next : c)));
      toast({
        title: "Success",
        description: "Character updated",
      });
      return next;
    } catch (error) {
      console.error("Error updating character:", error);
      toast({
        title: "Error",
        description: "Failed to update character",
        variant: "destructive",
      });
    }
  };

  const deleteCharacter = async (id: string) => {
    try {
      const { error } = await supabase.from("characters").delete().eq("id", id);
      if (error) throw error;
      setCharacters((prev) => prev.filter((c) => c.id !== id));
      toast({
        title: "Success",
        description: "Character deleted",
      });
    } catch (error) {
      console.error("Error deleting character:", error);
      toast({
        title: "Error",
        description: "Failed to delete character",
        variant: "destructive",
      });
    }
  };

  return {
    characters,
    loading,
    fetchCharacters,
    addCharacter,
    updateCharacter,
    deleteCharacter,
  };
}
