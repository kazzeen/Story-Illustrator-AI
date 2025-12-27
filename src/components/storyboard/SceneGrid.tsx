import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  Grid3X3, 
  List, 
  Search, 
  Filter,
  SlidersHorizontal 
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Scene {
  id: string;
  number: number;
  title: string;
  summary: string;
  characters: string[];
  location: string;
  mood: string;
  imageUrl?: string;
  status: "pending" | "generating" | "complete";
}

// Demo data
const demoScenes: Scene[] = [
  {
    id: "1",
    number: 1,
    title: "The Beginning",
    summary: "Our hero wakes up in a strange land, surrounded by towering crystal formations that shimmer with an otherworldly light.",
    characters: ["Elena", "The Guide"],
    location: "Crystal Valley",
    mood: "Mysterious",
    imageUrl: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=800",
    status: "complete",
  },
  {
    id: "2",
    number: 2,
    title: "The Journey Starts",
    summary: "Elena meets a mysterious figure who offers to guide her through the enchanted forest toward the ancient citadel.",
    characters: ["Elena", "The Guide", "Forest Spirits"],
    location: "Enchanted Forest",
    mood: "Peaceful",
    imageUrl: "https://images.unsplash.com/photo-1448375240586-882707db888b?w=800",
    status: "complete",
  },
  {
    id: "3",
    number: 3,
    title: "The Dark Cave",
    summary: "The path leads through a treacherous cave system where ancient dangers lurk in every shadow.",
    characters: ["Elena", "The Guide"],
    location: "Shadow Caverns",
    mood: "Tense",
    imageUrl: "https://images.unsplash.com/photo-1504699439244-b4f8f0f04d06?w=800",
    status: "complete",
  },
  {
    id: "4",
    number: 4,
    title: "A Moment of Rest",
    summary: "By a moonlit lake, our travelers share stories and build a bond that will prove crucial in battles to come.",
    characters: ["Elena", "The Guide"],
    location: "Moonlight Lake",
    mood: "Romantic",
    status: "generating",
  },
  {
    id: "5",
    number: 5,
    title: "The Citadel Revealed",
    summary: "At dawn, the ancient citadel emerges from the mist, its spires reaching toward the heavens.",
    characters: ["Elena", "The Guide"],
    location: "Ancient Citadel",
    mood: "Happy",
    status: "pending",
  },
  {
    id: "6",
    number: 6,
    title: "The Final Challenge",
    summary: "Standing before the gates, Elena must face her greatest fear to unlock the secrets within.",
    characters: ["Elena", "The Guardian"],
    location: "Citadel Gates",
    mood: "Tense",
    status: "pending",
  },
];

interface SceneGridProps {
  onSceneClick?: (scene: Scene) => void;
}

export function SceneGrid({ onSceneClick }: SceneGridProps) {
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [searchQuery, setSearchQuery] = useState("");

  const filteredScenes = demoScenes.filter(
    (scene) =>
      scene.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      scene.summary.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        {/* Search */}
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search scenes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* View Controls */}
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-2">
            <Filter className="w-4 h-4" />
            Filter
          </Button>
          <Button variant="outline" size="sm" className="gap-2">
            <SlidersHorizontal className="w-4 h-4" />
            Style
          </Button>
          <div className="flex items-center border border-border rounded-lg p-1">
            <Button
              variant={viewMode === "grid" ? "secondary" : "ghost"}
              size="icon"
              className="h-8 w-8"
              onClick={() => setViewMode("grid")}
            >
              <Grid3X3 className="w-4 h-4" />
            </Button>
            <Button
              variant={viewMode === "list" ? "secondary" : "ghost"}
              size="icon"
              className="h-8 w-8"
              onClick={() => setViewMode("list")}
            >
              <List className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Scene Grid */}
      <div
        className={cn(
          "grid gap-6",
          viewMode === "grid"
            ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
            : "grid-cols-1"
        )}
      >
        {filteredScenes.map((scene) => (
          <Card
            key={scene.id}
            variant="interactive"
            className="overflow-hidden cursor-pointer"
            onClick={() => onSceneClick?.(scene)}
          >
            <div className="relative aspect-video bg-secondary overflow-hidden">
              {scene.imageUrl ? (
                <img src={scene.imageUrl} alt={scene.title} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <span className="text-sm text-muted-foreground">No image</span>
                </div>
              )}
              <div className="absolute top-3 left-3">
                <div className="w-8 h-8 rounded-lg gradient-primary flex items-center justify-center text-sm font-bold text-primary-foreground shadow-glow">
                  {scene.number}
                </div>
              </div>
            </div>

            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-display text-lg font-semibold text-foreground line-clamp-1">
                    {scene.title}
                  </h3>
                  <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                    {scene.summary}
                  </p>
                </div>
                <Badge variant="secondary" className="shrink-0 capitalize">
                  {scene.status}
                </Badge>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Empty State */}
      {filteredScenes.length === 0 && (
        <div className="text-center py-12">
          <p className="text-muted-foreground">No scenes found matching your search.</p>
        </div>
      )}
    </div>
  );
}
