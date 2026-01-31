import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Upload, FileText, X, CheckCircle2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useStories } from "@/hooks/useStories";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface UploadedFile {
  name: string;
  size: number;
  type: string;
  content: string;
  status: "uploading" | "processing" | "ready" | "error";
  progress?: number;
}

export function FileUpload() {
  const [isDragging, setIsDragging] = useState(false);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const { user } = useAuth();
  const { createStory } = useStories();
  const { toast } = useToast();
  const navigate = useNavigate();

  const readFileContent = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsText(file);
    });
  };

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setIsDragging(true);
    } else if (e.type === "dragleave") {
      setIsDragging(false);
    }
  }, []);

  const handleFiles = useCallback(async (fileList: File[]) => {
    if (!user) {
      toast({
        title: "Sign in required",
        description: "Please sign in to upload stories",
        variant: "destructive",
      });
      navigate("/auth");
      return;
    }

    for (const file of fileList) {
      const newFile: UploadedFile = {
        name: file.name,
        size: file.size,
        type: file.type,
        content: "",
        status: "uploading",
        progress: 0,
      };

      let index: number;
      setFiles((prev) => {
        index = prev.length;
        return [...prev, newFile];
      });

      try {
        // Simulate progress while reading
        const progressInterval = setInterval(() => {
          setFiles((prev) =>
            prev.map((f, i) =>
              i === index && f.status === "uploading"
                ? { ...f, progress: Math.min((f.progress || 0) + 20, 90) }
                : f
            )
          );
        }, 100);

        const content = await readFileContent(file);
        clearInterval(progressInterval);

        setFiles((prev) =>
          prev.map((f, i) =>
            i === index ? { ...f, content, status: "ready", progress: 100 } : f
          )
        );
      } catch (error) {
        console.error("Error reading file:", error);
        setFiles((prev) =>
          prev.map((f, i) => (i === index ? { ...f, status: "error" } : f))
        );
      }
    }
  }, [user, toast, navigate, setFiles]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const droppedFiles = Array.from(e.dataTransfer.files);
    handleFiles(droppedFiles);
  }, [handleFiles]);

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const handleAnalyze = async () => {
    const readyFiles = files.filter((f) => f.status === "ready");
    if (readyFiles.length === 0) return;

    setIsAnalyzing(true);

    try {
      for (const file of readyFiles) {
        // Extract title from filename
        const title = file.name.replace(/\.[^/.]+$/, "");
        
        // Create story in database
        const story = await createStory(title, file.content, file.name);
        if (!story) {
          throw new Error("Failed to create story");
        }

        // Get the current session for auth
        const { data: { session } } = await supabase.auth.getSession();
        
        if (!session) {
          throw new Error("Not authenticated");
        }

        // Call analyze-story edge function with auth header
        const { data, error } = await supabase.functions.invoke("analyze-story", {
          body: { storyId: story.id },
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        });

        if (error) {
          throw new Error(data?.error || error.message || "Failed to analyze story");
        }

        toast({
          title: "Story analyzed!",
          description: `"${title}" has been broken into ${data.sceneCount} scenes`,
        });

        // Navigate to storyboard
        navigate(`/storyboard/${story.id}`);
      }
    } catch (error) {
      console.error("Error analyzing story:", error);
      toast({
        title: "Analysis failed",
        description: error instanceof Error ? error.message : "Failed to analyze story",
        variant: "destructive",
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Drop Zone */}
      <Card
        variant="glass"
        className={cn(
          "border-2 border-dashed transition-all duration-300",
          isDragging
            ? "border-primary bg-primary/5"
            : "border-border hover:border-primary/50"
        )}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        <CardContent className="p-12 flex flex-col items-center justify-center text-center">
          <div
            className={cn(
              "w-20 h-20 rounded-2xl flex items-center justify-center mb-6 transition-all duration-300",
              isDragging ? "bg-primary/20 scale-110" : "bg-secondary"
            )}
          >
            <Upload
              className={cn(
                "w-10 h-10 transition-colors",
                isDragging ? "text-primary" : "text-muted-foreground"
              )}
            />
          </div>

          <h3 className="font-display text-2xl font-semibold text-foreground mb-2">
            Drop your story here
          </h3>
          <p className="text-muted-foreground mb-6 max-w-md">
            Upload TXT files with your story. We'll extract the text and
            prepare it for AI-powered illustration.
          </p>

          <div className="flex items-center gap-4">
            <Button variant="hero" size="lg" asChild>
              <label className="cursor-pointer">
                <input
                  type="file"
                  className="hidden"
                  accept=".txt"
                  multiple
                  onChange={(e) =>
                    e.target.files && handleFiles(Array.from(e.target.files))
                  }
                />
                Browse Files
              </label>
            </Button>
            <span className="text-muted-foreground text-sm">or drag & drop</span>
          </div>

          <div className="flex items-center gap-2 mt-6 text-xs text-muted-foreground">
            <span className="px-2 py-1 bg-secondary rounded">TXT</span>
          </div>
        </CardContent>
      </Card>

      {/* Uploaded Files */}
      {files.length > 0 && (
        <div className="space-y-3">
          <h4 className="font-semibold text-foreground">Uploaded Files</h4>
          {files.map((file, index) => (
            <Card key={index} variant="default" className="p-4">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center">
                  <FileText className="w-5 h-5 text-primary" />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <p className="font-medium text-foreground truncate">
                      {file.name}
                    </p>
                    <div className="flex items-center gap-2">
                      {file.status === "ready" ? (
                        <CheckCircle2 className="w-5 h-5 text-green-400" />
                      ) : file.status === "uploading" ? (
                        <Loader2 className="w-5 h-5 text-primary animate-spin" />
                      ) : null}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => removeFile(index)}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">
                      {formatFileSize(file.size)}
                    </span>
                    {file.status === "uploading" && file.progress !== undefined && (
                      <>
                        <div className="flex-1 h-1 bg-secondary rounded-full overflow-hidden">
                          <div
                            className="h-full gradient-primary transition-all duration-300"
                            style={{ width: `${file.progress}%` }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {file.progress}%
                        </span>
                      </>
                    )}
                    {file.status === "ready" && (
                      <span className="text-xs text-green-400">
                        Ready to analyze
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          ))}

          {files.some((f) => f.status === "ready") && (
            <div className="flex justify-end pt-4">
              <Button 
                variant="hero" 
                size="lg" 
                onClick={handleAnalyze}
                disabled={isAnalyzing}
              >
                {isAnalyzing ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Analyzing with AI...
                  </>
                ) : (
                  "Analyze Story"
                )}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
