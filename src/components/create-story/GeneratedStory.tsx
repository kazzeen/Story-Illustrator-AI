import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { BookOpen, Edit3, Grid3X3, Loader2 } from "lucide-react";

interface GeneratedStoryProps {
  title: string;
  content: string;
  wordCount: number;
  onGenerateStoryboard: () => void;
  isAnalyzing: boolean;
}

export function GeneratedStory({
  title,
  content,
  wordCount,
  onGenerateStoryboard,
  isAnalyzing,
}: GeneratedStoryProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState(content);

  return (
    <Card variant="glass">
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle className="text-2xl flex items-center gap-2">
              <BookOpen className="w-6 h-6 text-primary" />
              {title}
            </CardTitle>
            <Badge variant="secondary" className="text-xs">
              {wordCount.toLocaleString()} words
            </Badge>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsEditing(!isEditing)}
            className="gap-2 shrink-0"
          >
            <Edit3 className="w-4 h-4" />
            {isEditing ? "Preview" : "Edit"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {isEditing ? (
          <Textarea
            value={editedContent}
            onChange={(e) => setEditedContent(e.target.value)}
            rows={20}
            className="font-mono text-sm"
          />
        ) : (
          <div className="prose prose-sm dark:prose-invert max-w-none">
            {editedContent.split("\n").map((paragraph, i) =>
              paragraph.trim() ? <p key={i}>{paragraph}</p> : <br key={i} />,
            )}
          </div>
        )}

        <div className="flex justify-end pt-4 border-t">
          <Button
            variant="hero"
            size="lg"
            className="gap-2"
            onClick={onGenerateStoryboard}
            disabled={isAnalyzing}
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Analyzing Scenes...
              </>
            ) : (
              <>
                <Grid3X3 className="w-5 h-5" />
                Generate Storyboard
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function GeneratedStorySkeleton() {
  return (
    <Card variant="glass">
      <CardHeader>
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-5 w-24 mt-2" />
      </CardHeader>
      <CardContent className="space-y-4">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-full" />
      </CardContent>
    </Card>
  );
}
