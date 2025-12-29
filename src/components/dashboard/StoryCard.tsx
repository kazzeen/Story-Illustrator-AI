import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Clock, Image, MoreVertical, Play } from "lucide-react";

interface StoryCardProps {
  title: string;
  author?: string;
  coverImage?: string;
  sceneCount: number;
  progress: number;
  completedScenes?: number;
  lastEdited: string;
  status: "draft" | "processing" | "complete";
}

export function StoryCard({
  title,
  author,
  coverImage,
  sceneCount,
  progress,
  completedScenes,
  lastEdited,
  status,
}: StoryCardProps) {
  const statusColors = {
    draft: "bg-muted text-muted-foreground",
    processing: "bg-primary/20 text-primary",
    complete: "bg-green-500/20 text-green-400",
  };

  const clampedProgress = Number.isFinite(progress) ? Math.max(0, Math.min(100, Math.round(progress))) : 0;
  const barColorClass =
    clampedProgress >= 100 ? "bg-green-500" : clampedProgress > 0 ? "bg-yellow-500" : "bg-red-500";
  const completed =
    typeof completedScenes === "number"
      ? Math.max(0, Math.min(sceneCount, Math.round(completedScenes)))
      : Math.max(0, Math.min(sceneCount, Math.round((clampedProgress / 100) * sceneCount)));
  const remaining = Math.max(0, sceneCount - completed);

  return (
    <Card variant="interactive" className="group overflow-hidden">
      {/* Cover Image */}
      <div className="relative aspect-[4/3] overflow-hidden">
        {coverImage ? (
          <img
            src={coverImage}
            alt={title}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="w-full h-full gradient-card flex items-center justify-center">
            <Image className="w-12 h-12 text-muted-foreground/50" />
          </div>
        )}
        
        {/* Overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
        
        {/* Play button on hover */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
          <Button variant="hero" size="icon" className="w-14 h-14 rounded-full">
            <Play className="w-6 h-6 ml-1" />
          </Button>
        </div>

        {/* Status Badge */}
        <div className="absolute top-3 right-3">
          <Badge className={statusColors[status]}>
            {status.charAt(0).toUpperCase() + status.slice(1)}
          </Badge>
        </div>
      </div>

      <CardContent className="p-4">
        {/* Title & Author */}
        <div className="mb-3">
          <h3 className="font-display text-lg font-semibold text-foreground line-clamp-1 group-hover:text-primary transition-colors">
            {title}
          </h3>
          {author && (
            <p className="text-sm text-muted-foreground">by {author}</p>
          )}
        </div>

        {/* Progress Bar */}
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="mb-3">
              <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                <span>{sceneCount} scenes</span>
                <span>{clampedProgress}%</span>
              </div>
              <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                <div
                  className={`h-full ${barColorClass} rounded-full transition-all duration-500`}
                  style={{ width: `${clampedProgress}%` }}
                />
              </div>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <div className="space-y-1">
              <div className="font-medium">Progress</div>
              {sceneCount > 0 ? (
                <>
                  <div className="text-xs text-muted-foreground">
                    Completed: {completed}/{sceneCount} scenes
                  </div>
                  <div className="text-xs text-muted-foreground">Remaining: {remaining}</div>
                </>
              ) : (
                <div className="text-xs text-muted-foreground">No scenes yet</div>
              )}
            </div>
          </TooltipContent>
        </Tooltip>

        {/* Footer */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="w-3.5 h-3.5" />
            {lastEdited}
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <MoreVertical className="w-4 h-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
