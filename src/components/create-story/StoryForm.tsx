import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PenTool } from "lucide-react";

const genres = [
  "Fantasy",
  "Sci-Fi",
  "Mystery",
  "Romance",
  "Horror",
  "Adventure",
  "Historical",
  "Comedy",
  "Drama",
  "Children's",
] as const;

export interface StoryFormData {
  genre: string;
  prompt: string;
  characters: string;
  setting: string;
  plotPoints: string;
}

interface StoryFormProps {
  value: StoryFormData;
  onChange: (data: StoryFormData) => void;
  errors: Partial<Record<keyof StoryFormData, string>>;
}

export function StoryForm({ value, onChange, errors }: StoryFormProps) {
  const update = (field: keyof StoryFormData, val: string) => {
    onChange({ ...value, [field]: val });
  };

  return (
    <Card variant="glass">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <PenTool className="w-5 h-5 text-primary" />
          Story Details
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Genre */}
        <div className="space-y-2">
          <Label htmlFor="genre">Genre *</Label>
          <Select value={value.genre} onValueChange={(v) => update("genre", v)}>
            <SelectTrigger id="genre" className={errors.genre ? "border-destructive" : ""}>
              <SelectValue placeholder="Select a genre" />
            </SelectTrigger>
            <SelectContent>
              {genres.map((g) => (
                <SelectItem key={g} value={g}>
                  {g}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.genre && <p className="text-xs text-destructive">{errors.genre}</p>}
        </div>

        {/* Story Description */}
        <div className="space-y-2">
          <Label htmlFor="prompt">Story Description *</Label>
          <Textarea
            id="prompt"
            placeholder="Describe the story you want to create. Be as detailed as you like — include themes, tone, key events, or anything you envision..."
            value={value.prompt}
            onChange={(e) => {
              if (e.target.value.length <= 5000) update("prompt", e.target.value);
            }}
            rows={5}
            className={errors.prompt ? "border-destructive" : ""}
          />
          <div className="flex justify-between">
            {errors.prompt ? (
              <p className="text-xs text-destructive">{errors.prompt}</p>
            ) : (
              <span />
            )}
            <span className="text-xs text-muted-foreground">{value.prompt.length}/5000</span>
          </div>
        </div>

        {/* Characters */}
        <div className="space-y-2">
          <Label htmlFor="characters">Characters</Label>
          <Input
            id="characters"
            placeholder="e.g. Aria - young wizard, Kael - her mentor, Shadow - a mysterious cat"
            value={value.characters}
            onChange={(e) => update("characters", e.target.value)}
          />
          <p className="text-xs text-muted-foreground">Comma-separated names with brief descriptions</p>
        </div>

        {/* Setting */}
        <div className="space-y-2">
          <Label htmlFor="setting">Setting</Label>
          <Input
            id="setting"
            placeholder="e.g. A floating city above the clouds in a medieval fantasy world"
            value={value.setting}
            onChange={(e) => update("setting", e.target.value)}
          />
        </div>

        {/* Plot Points */}
        <div className="space-y-2">
          <Label htmlFor="plotPoints">Key Plot Points</Label>
          <Input
            id="plotPoints"
            placeholder="e.g. Discovers hidden power, faces a trial by fire, confronts the villain"
            value={value.plotPoints}
            onChange={(e) => update("plotPoints", e.target.value)}
          />
          <p className="text-xs text-muted-foreground">Major events or turning points to include</p>
        </div>
      </CardContent>
    </Card>
  );
}
