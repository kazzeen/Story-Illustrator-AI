import { useState } from "react";
import { useCharacters, Character } from "@/hooks/useCharacters";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, User, Sparkles, Loader2, Wand2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { SUPABASE_KEY, SUPABASE_URL, supabase } from "@/integrations/supabase/client";
import { extractDetailedError } from "@/lib/error-reporting";

interface CharacterListProps {
  storyId: string;
  selectedArtStyle?: string;
  selectedModel?: string;
  styleIntensity?: number;
  strictStyle?: boolean;
  disabledStyleElements?: string[];
}

export function CharacterList({ storyId, selectedArtStyle, selectedModel, styleIntensity, strictStyle, disabledStyleElements }: CharacterListProps) {
  const { characters, loading, addCharacter, updateCharacter, deleteCharacter, fetchCharacters } =
    useCharacters(storyId);
  const { toast } = useToast();
  const { refreshProfile } = useAuth();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatingCharacterById, setGeneratingCharacterById] = useState<Record<string, boolean>>({});
  const [imageOverrideById, setImageOverrideById] = useState<Record<string, string>>({});
  const [editingCharacter, setEditingCharacter] = useState<Character | null>(
    null
  );
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    physical_attributes: "",
    clothing: "",
    accessories: "",
    personality: "",
  });

  const handleOpenDialog = (character?: Character) => {
    if (character) {
      setEditingCharacter(character);
      setFormData({
        name: character.name,
        description: character.description || "",
        physical_attributes: character.physical_attributes || "",
        clothing: character.clothing || "",
        accessories: character.accessories || "",
        personality: character.personality || "",
      });
    } else {
      setEditingCharacter(null);
      setFormData({
        name: "",
        description: "",
        physical_attributes: "",
        clothing: "",
        accessories: "",
        personality: "",
      });
    }
    setIsDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!formData.name) return;

    if (editingCharacter) {
      await updateCharacter(editingCharacter.id, formData);
    } else {
      await addCharacter({ ...formData, source: "manual" });
    }
    setIsDialogOpen(false);
  };

  const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

  const handleRegenerateCharacterImage = async (char: Character) => {
    if (isGenerating) return;
    if (generatingCharacterById[char.id]) return;

    setGeneratingCharacterById((prev) => ({ ...prev, [char.id]: true }));

    try {
      type GenerateCharacterReferenceSuccess = {
        success: true;
        imageUrl: string;
        requestId?: string;
        referenceSheetId?: string | null;
        cached?: boolean;
        style?: { id?: string };
      };

      const shouldRetryStatus = (status: number | null) =>
        status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
      const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError || !session) {
        toast({
          title: "Sign in required",
          description: "Please sign in to generate character images.",
          variant: "destructive",
        });
        return;
      }

      let accessToken = session.access_token;
      const tryRefresh = async () => {
        try {
          const { data, error } = await supabase.auth.refreshSession();
          const nextToken = data?.session?.access_token;
          if (error || !nextToken) return false;
          accessToken = nextToken;
          return true;
        } catch {
          return false;
        }
      };

      const functionUrl = `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/generate-character-reference`;
      const apikey = String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? SUPABASE_KEY);
      const expectedStyleId = selectedArtStyle || "digital_illustration";
      const requestId = crypto.randomUUID();

      const invokeGenerate = async (attempt: number) => {
        let rawResponse: Response;
        try {
          rawResponse = await fetch(functionUrl, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
              ...(apikey ? { apikey } : {}),
            },
            body: JSON.stringify({
              characterId: char.id,
              requestId,
              style: selectedArtStyle || "digital_illustration",
              styleIntensity,
              strictStyle,
              disabledStyleElements,
              model: selectedModel || "venice-sd35",
              forceRegenerate: true,
            }),
          });
        } catch (netError) {
          throw new Error(`Network error: ${netError instanceof Error ? netError.message : String(netError)}`);
        }

        const responseHeaders: Record<string, string> = {};
        rawResponse.headers.forEach((value, key) => {
          responseHeaders[key.toLowerCase()] = value;
        });

        const responseStatus = rawResponse.status;
        const responseStatusText = rawResponse.statusText;

        let responseBody: unknown;
        try {
          const text = await rawResponse.text();
          try {
            responseBody = JSON.parse(text);
          } catch {
            responseBody = text;
          }
        } catch {
          responseBody = null;
        }

        if (!rawResponse.ok) {
          const detailed = extractDetailedError({
            status: responseStatus,
            statusText: responseStatusText,
            headers: responseHeaders,
            errorBody: responseBody,
          });

          const thrown = new Error(detailed.description);
          (thrown as unknown as Record<string, unknown>)._detailed = detailed;
          (thrown as unknown as Record<string, unknown>)._status = responseStatus;
          throw thrown;
        }

        if (
          isRecord(responseBody) &&
          responseBody.success === true &&
          typeof responseBody.imageUrl === "string" &&
          responseBody.imageUrl.length > 0
        ) {
          const typed = responseBody as unknown as GenerateCharacterReferenceSuccess;
          const returnedStyleId =
            isRecord(typed.style) && typeof typed.style.id === "string" ? typed.style.id : null;
          if (returnedStyleId && returnedStyleId !== expectedStyleId) {
            throw new Error(`Style mismatch: expected ${expectedStyleId}, got ${returnedStyleId}`);
          }
          return typed;
        }

        const message =
          isRecord(responseBody) && typeof responseBody.error === "string" ? responseBody.error : "Unknown error from server";
        throw new Error(message);
      };

      let lastError: unknown = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const res = await invokeGenerate(attempt);
          setImageOverrideById((prev) => ({ ...prev, [char.id]: res.imageUrl }));
          await fetchCharacters();
          await refreshProfile();
          toast({
            title: "Image regenerated",
            description: `Updated ${char.name}`,
          });
          lastError = null;
          break;
        } catch (e) {
          lastError = e;
          const status =
            isRecord(e) && "_status" in e ? (typeof e._status === "number" ? (e._status as number) : null) : null;
          if (attempt < 3 && status === 401) {
            const refreshed = await tryRefresh();
            if (refreshed) continue;
          }
          if (attempt < 3 && (status === null || shouldRetryStatus(status))) {
            const delay = Math.min(6000, 800 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 250);
            await sleep(delay);
            continue;
          }
          break;
        }
      }

      if (lastError) {
        let message = lastError instanceof Error ? lastError.message : "Failed to regenerate character image";
        const detailed = isRecord(lastError) && "_detailed" in lastError ? (lastError._detailed as unknown) : null;
        if (isRecord(detailed) && typeof detailed.technicalDetails === "string" && typeof detailed.description === "string") {
          if (String(detailed.description).toLowerCase().includes("style application failed")) {
            message = `Style application failed (${expectedStyleId}).`;
          }
        }
        const status =
          isRecord(lastError) && "_status" in lastError ? (typeof lastError._status === "number" ? (lastError._status as number) : null) : null;
        if (status === 402) {
          message = "Insufficient credits to generate a character image.";
        }
        toast({
          title: "Generation failed",
          description: message,
          variant: "destructive",
        });
      }
    } finally {
      setGeneratingCharacterById((prev) => {
        const next = { ...prev };
        delete next[char.id];
        return next;
      });
    }
  };

  const handleGenerateAllCharacters = async () => {
    if (isGenerating) return;
    if (characters.length === 0) {
      toast({
        title: "No Characters",
        description: "Please add characters before generating images.",
        variant: "destructive",
      });
      return;
    }

    setIsGenerating(true);
    let successCount = 0;
    let failCount = 0;
    const failedNames: string[] = [];

    toast({
      title: "Starting Generation",
      description: `Generating images for ${characters.length} characters...`,
    });

    try {
      type GenerateCharacterReferenceSuccess = {
        success: true;
        imageUrl: string;
        requestId?: string;
        referenceSheetId?: string | null;
        cached?: boolean;
        style?: { id?: string };
      };

      const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
      const shouldRetryStatus = (status: number | null) => status === 429 || status === 500 || status === 502 || status === 503 || status === 504;

      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) {
        toast({
          title: "Authentication Error",
          description: "Could not read your login session. Please sign in again.",
          variant: "destructive",
        });
        return;
      }

      if (!session) {
        toast({
          title: "Sign in required",
          description: "Please sign in to generate character images.",
          variant: "destructive",
        });
        return;
      }

      let accessToken = session.access_token;
      const tryRefresh = async () => {
        try {
          const { data, error } = await supabase.auth.refreshSession();
          const nextToken = data?.session?.access_token;
          if (error || !nextToken) return false;
          accessToken = nextToken;
          return true;
        } catch {
          return false;
        }
      };

      const functionUrl = `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/generate-character-reference`;
      const apikey = String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? SUPABASE_KEY);
      const expectedStyleId = selectedArtStyle || "digital_illustration";

      const invokeGenerate = async (char: Character, requestId: string, attempt: number) => {
        let rawResponse: Response;
        try {
          rawResponse = await fetch(functionUrl, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
              ...(apikey ? { apikey } : {}),
            },
            body: JSON.stringify({
              characterId: char.id,
              requestId,
              style: selectedArtStyle || "digital_illustration",
              styleIntensity,
              strictStyle,
              disabledStyleElements,
              model: selectedModel || "venice-sd35",
              forceRegenerate: false,
            }),
          });
        } catch (netError) {
          throw new Error(`Network error: ${netError instanceof Error ? netError.message : String(netError)}`);
        }

        const responseHeaders: Record<string, string> = {};
        rawResponse.headers.forEach((value, key) => {
          responseHeaders[key.toLowerCase()] = value;
        });

        const responseStatus = rawResponse.status;
        const responseStatusText = rawResponse.statusText;

        let responseBody: unknown;
        try {
          const text = await rawResponse.text();
          try {
            responseBody = JSON.parse(text);
          } catch {
            responseBody = text;
          }
        } catch {
          responseBody = null;
        }

        if (!rawResponse.ok) {
          const detailed = extractDetailedError({
            status: responseStatus,
            statusText: responseStatusText,
            headers: responseHeaders,
            errorBody: responseBody,
          });

          console.error(`Edge function error for ${char.name} (attempt ${attempt}):`, {
            status: responseStatus,
            statusText: responseStatusText,
            headers: responseHeaders,
            body: responseBody,
            detailed,
          });

          const thrown = new Error(detailed.description);
          (thrown as unknown as Record<string, unknown>)._detailed = detailed;
          (thrown as unknown as Record<string, unknown>)._status = responseStatus;
          throw thrown;
        }

        if (isRecord(responseBody) && responseBody.success === true && typeof responseBody.imageUrl === "string" && responseBody.imageUrl.length > 0) {
          const typed = responseBody as unknown as GenerateCharacterReferenceSuccess;
          const returnedStyleId =
            isRecord(typed.style) && typeof typed.style.id === "string" ? typed.style.id : null;
          if (returnedStyleId && returnedStyleId !== expectedStyleId) {
            throw new Error(`Style mismatch: expected ${expectedStyleId}, got ${returnedStyleId}`);
          }
          return typed;
        }

        const message =
          isRecord(responseBody) && typeof responseBody.error === "string" ? responseBody.error : "Unknown error from server";
        throw new Error(message);
      };

      let outOfCredits = false;

      // Process characters sequentially to avoid rate limits
      for (const char of characters) {
        try {
          const requestId = crypto.randomUUID();
          let lastError: unknown = null;
          for (let attempt = 1; attempt <= 3; attempt++) {
            try {
              await invokeGenerate(char, requestId, attempt);
              lastError = null;
              break;
            } catch (e) {
              lastError = e;
              const status =
                isRecord(e) && "_status" in e ? (typeof e._status === "number" ? (e._status as number) : null) : null;
              if (status === 402) break;
              if (attempt < 3 && status === 401) {
                const refreshed = await tryRefresh();
                if (refreshed) continue;
              }
              if (attempt < 3 && (status === null || shouldRetryStatus(status))) {
                const delay = Math.min(6000, 800 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 250);
                await sleep(delay);
                continue;
              }
              break;
            }
          }

          if (lastError) throw lastError;
          successCount++;
        } catch (err) {
          console.error(`Failed to generate for ${char.name}:`, err);
          const status =
            isRecord(err) && "_status" in err ? (typeof err._status === "number" ? (err._status as number) : null) : null;
          if (status === 402) {
            outOfCredits = true;
            toast({
              title: "Insufficient credits",
              description: "You don’t have enough credits to generate more character images.",
              variant: "destructive",
            });
          }
          failCount++;
          failedNames.push(char.name);
          // We continue to the next character even if one fails
        }
        
        // Small delay to be gentle on the API
        await sleep(250);
        if (outOfCredits) break;
      }

      // Refresh character list to show new images
      await fetchCharacters();
      await refreshProfile();

      try {
        const { data: verifyRows, error: verifyError } = await supabase
          .from("characters")
          .select("id,name,image_url")
          .eq("story_id", storyId);

        if (verifyError) {
          console.warn("Verification query failed:", verifyError);
        } else if (verifyRows) {
          const missing = verifyRows.filter((r) => !r.image_url).map((r) => r.name).filter(Boolean);
          failCount = missing.length;
          successCount = verifyRows.length - missing.length;
          missing.forEach((n) => {
            if (typeof n === "string" && !failedNames.includes(n)) failedNames.push(n);
          });
        }
      } catch (verifyFetchError) {
        console.error("Verification query failed:", verifyFetchError);
      }

      if (successCount > 0) {
        toast({
          title: "Generation Complete",
          description:
            failCount > 0
              ? `Generated ${successCount} images. Failed: ${failCount}${failedNames.length > 0 ? ` (${failedNames.slice(0, 6).join(", ")}${failedNames.length > 6 ? ", ..." : ""})` : ""}`
              : `Successfully generated ${successCount} character images.`,
          variant: failCount > 0 ? "default" : "default", // or success variant if available
        });
      } else {
        toast({
          title: "Generation Failed",
          description: "Could not generate any character images. Please try again.",
          variant: "destructive",
        });
      }

    } catch (error) {
      console.error("Batch generation error:", error);
      toast({
        title: "System Error",
        description: "An unexpected error occurred during generation.",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  if (loading) {
    return <div className="text-center py-8">Loading characters...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Characters</h2>
        <div className="flex gap-2">
          {characters.length > 0 && (
            <Button 
              onClick={handleGenerateAllCharacters} 
              variant="secondary" 
              disabled={isGenerating}
              className="relative overflow-hidden"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Wand2 className="w-4 h-4 mr-2 text-purple-500" />
                  Generate Characters
                </>
              )}
            </Button>
          )}
          <Button onClick={() => handleOpenDialog()}>
            <Plus className="w-4 h-4 mr-2" />
            Add Character
          </Button>
        </div>
      </div>

      {characters.length === 0 ? (
        <div className="text-center py-12 bg-secondary/30 rounded-xl border border-border/50">
          <p className="text-muted-foreground mb-4">No characters added yet</p>
          <Button variant="outline" onClick={() => handleOpenDialog()}>
            Create your first character
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {characters.map((char) => (
            <Card key={char.id} className="relative group overflow-hidden flex flex-col h-full border-muted/40 hover:border-primary/50 transition-colors">
              {/* Character Image */}
              <div className="relative w-full aspect-[3/4] bg-muted/20 border-b border-border/50">
                {imageOverrideById[char.id] || char.image_url ? (
                  <img
                    src={imageOverrideById[char.id] || char.image_url || ""}
                    alt={char.name}
                    className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center w-full h-full text-muted-foreground/30 bg-secondary/10">
                    <User className="w-16 h-16 mb-2" />
                    <span className="text-xs font-medium uppercase tracking-wider">No Image</span>
                  </div>
                )}

                {/* Overlay Gradient for Text Readability if we put text over image, but here we put actions */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

                {/* Auto Badge */}
                {char.source === "auto" && (
                  <div className="absolute top-3 left-3 z-10">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge variant="secondary" className="backdrop-blur-md bg-black/40 text-white hover:bg-black/60 border-white/10 shadow-sm pl-1.5 pr-2.5 py-0.5">
                            <Sparkles className="w-3 h-3 mr-1.5 text-purple-400" />
                            Auto
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent side="right">
                          <p>Auto-detected from story text</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                )}

                {/* Regenerate button */}
                {(imageOverrideById[char.id] || char.image_url) && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="absolute top-2 right-2 bg-background/80 backdrop-blur-sm h-8 w-8"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleRegenerateCharacterImage(char);
                    }}
                    disabled={isGenerating || Boolean(generatingCharacterById[char.id])}
                  >
                    <RefreshCw className={`w-4 h-4 ${generatingCharacterById[char.id] ? 'animate-spin' : ''}`} />
                  </Button>
                )}

                {/* Floating Actions */}
                <div className="absolute top-2 right-12 flex gap-1 opacity-0 group-hover:opacity-100 transition-all duration-300 transform translate-y-[-10px] group-hover:translate-y-0 z-10">
                  <Button
                    variant="secondary"
                    size="icon"
                    className="character-edit-button h-8 w-8 rounded-full shadow-lg bg-white/90 hover:bg-white text-foreground backdrop-blur-sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleOpenDialog(char);
                    }}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="destructive"
                    size="icon"
                    className="h-8 w-8 rounded-full shadow-lg opacity-90 hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteCharacter(char.id);
                    }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>

              <CardHeader className="pb-2 pt-4">
                <CardTitle className="flex justify-between items-start">
                  <span className="truncate" title={char.name}>{char.name}</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex-grow">
                <ScrollArea className="h-[200px]">
                  <div className="space-y-4 text-sm">
                    {char.description && (
                      <div>
                        <span className="font-semibold text-muted-foreground block mb-1">
                          Description
                        </span>
                        <p>{char.description}</p>
                      </div>
                    )}
                    {char.physical_attributes && (
                      <div>
                        <span className="font-semibold text-muted-foreground block mb-1">
                          Appearance
                        </span>
                        <p>{char.physical_attributes}</p>
                      </div>
                    )}
                    {(char.clothing || char.accessories) && (
                      <div>
                        <span className="font-semibold text-muted-foreground block mb-1">
                          Attire & Items
                        </span>
                        <p>
                          {[char.clothing, char.accessories]
                            .filter(Boolean)
                            .join(", ")}
                        </p>
                      </div>
                    )}
                    {char.personality && (
                      <div className="flex flex-wrap gap-2 pt-2">
                        {char.personality.split(",").map((trait) => (
                          <Badge key={trait} variant="secondary">
                            {trait.trim()}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingCharacter ? "Edit Character" : "Add Character"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                placeholder="Character Name"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="description">Brief Description</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                placeholder="Role in story, key traits..."
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="physical">Physical Attributes</Label>
                <Textarea
                  id="physical"
                  value={formData.physical_attributes}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      physical_attributes: e.target.value,
                    })
                  }
                  placeholder="Hair, eyes, height, build..."
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="clothing">Clothing Style</Label>
                <Textarea
                  id="clothing"
                  value={formData.clothing}
                  onChange={(e) =>
                    setFormData({ ...formData, clothing: e.target.value })
                  }
                  placeholder="Signature outfit, colors..."
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="accessories">Accessories</Label>
                <Input
                  id="accessories"
                  value={formData.accessories}
                  onChange={(e) =>
                    setFormData({ ...formData, accessories: e.target.value })
                  }
                  placeholder="Weapons, jewelry, items..."
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="personality">Personality Traits</Label>
                <Input
                  id="personality"
                  value={formData.personality}
                  onChange={(e) =>
                    setFormData({ ...formData, personality: e.target.value })
                  }
                  placeholder="Brave, shy, cunning (comma separated)"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit}>
              {editingCharacter ? "Save Changes" : "Create Character"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
