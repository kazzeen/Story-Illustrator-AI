import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  Image, 
  RefreshCw, 
  Edit3, 
  Trash2, 
  MoreVertical,
  MapPin,
  Users,
  Heart,
  AlertTriangle
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { Scene } from "@/hooks/useStories";

interface SceneCardProps {
  scene: Scene;
  onEdit?: (scene: Scene) => void;
  onRegenerate?: (scene: Scene) => void;
  onDelete?: (scene: Scene) => void;
  onClick?: (scene: Scene) => void;
}

export function SceneCard({ 
  scene, 
  onEdit, 
  onRegenerate, 
  onDelete,
  onClick 
}: SceneCardProps) {
  const moodColors: Record<string, string> = {
    tense: "bg-red-500/20 text-red-400",
    happy: "bg-green-500/20 text-green-400",
    sad: "bg-blue-500/20 text-blue-400",
    mysterious: "bg-purple-500/20 text-purple-400",
    romantic: "bg-pink-500/20 text-pink-400",
    peaceful: "bg-cyan-500/20 text-cyan-400",
  };

  const consistencyHeaders = (() => {
    const details = scene.consistency_details;
    if (!details || typeof details !== "object" || Array.isArray(details)) return null;
    const rec = details as Record<string, unknown>;
    const headersRaw = rec.headers;
    if (!headersRaw || typeof headersRaw !== "object" || Array.isArray(headersRaw)) return null;

    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(headersRaw as Record<string, unknown>)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  })();

  const isContentBlocked =
    String(consistencyHeaders?.["x-venice-is-content-violation"] ?? "").toLowerCase() === "true" ||
    String(consistencyHeaders?.["x-venice-contains-minor"] ?? "").toLowerCase() === "true";

  return (
    <Card 
      variant="interactive" 
      className="group overflow-hidden"
      onClick={() => onClick?.(scene)}
    >
      {/* Scene Image */}
      <div className="relative aspect-video overflow-hidden">
        {scene.image_url ? (
          <img
            src={scene.image_url}
            alt={scene.title || `Scene ${scene.scene_number}`}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="w-full h-full gradient-card flex items-center justify-center">
            {scene.generation_status === "generating" ? (
              <div className="flex flex-col items-center gap-3">
                <RefreshCw className="w-8 h-8 text-primary animate-spin" />
                <span className="text-sm text-muted-foreground">Generating...</span>
              </div>
            ) : (
              scene.generation_status === "error" && scene.consistency_details &&
              typeof scene.consistency_details === "object" && !Array.isArray(scene.consistency_details) &&
              isContentBlocked ? (
                <div className="flex flex-col items-center gap-2 text-destructive">
                  <AlertTriangle className="w-12 h-12" />
                  <span className="text-sm">Content Blocked</span>
                </div>
              ) : (
                <Image className="w-12 h-12 text-muted-foreground/50" />
              )
            )}
          </div>
        )}

        {/* Scene Number */}
        <div className="absolute top-3 left-3">
          <div className="w-8 h-8 rounded-lg gradient-primary flex items-center justify-center text-sm font-bold text-primary-foreground shadow-glow">
            {scene.scene_number}
          </div>
        </div>

        {/* Actions Menu */}
        <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="glass" size="icon" className="h-8 w-8">
                <MoreVertical className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={(e) => {
                e.stopPropagation();
                onEdit?.(scene);
              }}>
                <Edit3 className="w-4 h-4 mr-2" />
                Edit Scene
              </DropdownMenuItem>
              <DropdownMenuItem onClick={(e) => {
                e.stopPropagation();
                onRegenerate?.(scene);
              }}>
                <RefreshCw className="w-4 h-4 mr-2" />
                Regenerate Image
              </DropdownMenuItem>
              <DropdownMenuItem 
                className="text-destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete?.(scene);
                }}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete Scene
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <CardContent className="p-4">
        {/* Title */}
        <h3 className="font-display text-lg font-semibold text-foreground mb-2 line-clamp-1 group-hover:text-primary transition-colors">
          {scene.title}
        </h3>

        {/* Summary */}
        <p className="text-sm text-muted-foreground mb-4 line-clamp-2">
          {scene.summary}
        </p>

        {/* Metadata */}
        <div className="flex flex-wrap gap-2 mb-3">
          {scene.emotional_tone && (
            <Badge
              className={
                moodColors[String(scene.emotional_tone).toLowerCase()] || "bg-muted text-muted-foreground"
              }
            >
              <Heart className="w-3 h-3 mr-1" />
              {scene.emotional_tone}
            </Badge>
          )}
        </div>

        {/* Details */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          {scene.setting && (
            <div className="flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5" />
              <span className="truncate max-w-[100px]">{scene.setting}</span>
            </div>
          )}
          {Array.isArray(scene.characters) && scene.characters.length > 0 && (
            <div className="flex items-center gap-1">
              <Users className="w-3.5 h-3.5" />
              <span>{scene.characters.length}</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
