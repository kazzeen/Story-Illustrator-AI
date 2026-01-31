import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Layout } from "@/components/layout/Layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sparkles, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { StoryForm, type StoryFormData } from "@/components/create-story/StoryForm";
import { LLMModelSelector } from "@/components/create-story/LLMModelSelector";
import { GeneratedStory, GeneratedStorySkeleton } from "@/components/create-story/GeneratedStory";

type Phase = "input" | "generating" | "result";

interface GeneratedResult {
  storyId: string;
  title: string;
  content: string;
  wordCount: number;
}

export default function CreateStory() {
  const { user, loading: authLoading } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [phase, setPhase] = useState<Phase>("input");
  const [selectedModel, setSelectedModel] = useState("llama-3.3-70b");
  const [formData, setFormData] = useState<StoryFormData>({
    genre: "",
    prompt: "",
    characters: "",
    setting: "",
    plotPoints: "",
  });
  const [formErrors, setFormErrors] = useState<Partial<Record<keyof StoryFormData, string>>>({});
  const [result, setResult] = useState<GeneratedResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Redirect to auth if not signed in
  if (!authLoading && !user) {
    navigate("/auth");
    return null;
  }

  const validate = (): boolean => {
    const errors: Partial<Record<keyof StoryFormData, string>> = {};
    if (!formData.genre) errors.genre = "Please select a genre";
    if (!formData.prompt.trim()) {
      errors.prompt = "Story description is required";
    } else if (formData.prompt.trim().length < 20) {
      errors.prompt = "Please provide at least 20 characters";
    }
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleGenerate = async () => {
    if (!validate()) return;

    setPhase("generating");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast({ title: "Not authenticated", description: "Please sign in to continue.", variant: "destructive" });
        navigate("/auth");
        return;
      }

      const { data, error } = await supabase.functions.invoke("generate-story", {
        body: {
          genre: formData.genre,
          prompt: formData.prompt,
          characters: formData.characters,
          setting: formData.setting,
          plotPoints: formData.plotPoints,
          model: selectedModel,
        },
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (error) {
        throw new Error(error.message || "Failed to generate story");
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      setResult({
        storyId: data.storyId,
        title: data.title,
        content: data.content,
        wordCount: data.wordCount,
      });
      setPhase("result");

      toast({
        title: "Story generated!",
        description: `"${data.title}" — ${data.wordCount.toLocaleString()} words`,
      });
    } catch (error) {
      console.error("Story generation error:", error);
      setPhase("input");
      const message = error instanceof Error ? error.message : "Failed to generate story. Please try again.";
      toast({ title: "Generation failed", description: message, variant: "destructive" });
    }
  };

  const handleGenerateStoryboard = async () => {
    if (!result) return;

    setIsAnalyzing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast({ title: "Not authenticated", description: "Please sign in to continue.", variant: "destructive" });
        return;
      }

      const { data, error } = await supabase.functions.invoke("analyze-story", {
        body: { storyId: result.storyId },
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (error) throw new Error(error.message || "Failed to analyze story");
      if (data?.error) throw new Error(data.error);

      toast({
        title: "Story analyzed!",
        description: `Broken into ${data.sceneCount} scenes. Redirecting to storyboard...`,
      });

      navigate(`/storyboard/${result.storyId}`);
    } catch (error) {
      console.error("Story analysis error:", error);
      const message = error instanceof Error ? error.message : "Failed to analyze story. Please try again.";
      toast({ title: "Analysis failed", description: message, variant: "destructive" });
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <Layout>
      <div className="container mx-auto px-6 py-12">
        {/* Header */}
        <div className="max-w-3xl mx-auto text-center mb-12">
          <Badge className="mb-4 bg-primary/10 text-primary border-primary/20">
            <Sparkles className="w-3 h-3 mr-1" />
            AI Story Writer
          </Badge>
          <h1 className="font-display text-4xl md:text-5xl font-bold text-foreground mb-4">
            Create a New Story
          </h1>
          <p className="text-xl text-muted-foreground">
            Describe your story idea and let AI write it for you, then generate a visual storyboard
          </p>
        </div>

        <div className="max-w-3xl mx-auto space-y-8">
          {phase === "input" && (
            <>
              <StoryForm value={formData} onChange={setFormData} errors={formErrors} />
              <LLMModelSelector selectedModel={selectedModel} onModelChange={setSelectedModel} />
              <div className="flex justify-end">
                <Button variant="hero" size="xl" className="gap-2" onClick={handleGenerate}>
                  <Sparkles className="w-5 h-5" />
                  Generate Story
                </Button>
              </div>
            </>
          )}

          {phase === "generating" && (
            <div className="space-y-6">
              <div className="text-center py-8">
                <Loader2 className="w-10 h-10 text-primary animate-spin mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-foreground mb-2">Generating your story...</h3>
                <p className="text-muted-foreground">This may take a moment. The AI is crafting your {formData.genre.toLowerCase()} story.</p>
              </div>
              <GeneratedStorySkeleton />
            </div>
          )}

          {phase === "result" && result && (
            <GeneratedStory
              title={result.title}
              content={result.content}
              wordCount={result.wordCount}
              onGenerateStoryboard={handleGenerateStoryboard}
              isAnalyzing={isAnalyzing}
            />
          )}
        </div>
      </div>
    </Layout>
  );
}
