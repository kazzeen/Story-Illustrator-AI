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
import { Plus, Pencil, Trash2, User, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface CharacterListProps {
  storyId: string;
}

export function CharacterList({ storyId }: CharacterListProps) {
  const { characters, loading, addCharacter, updateCharacter, deleteCharacter } =
    useCharacters(storyId);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
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

  if (loading) {
    return <div className="text-center py-8">Loading characters...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Characters</h2>
        <Button onClick={() => handleOpenDialog()}>
          <Plus className="w-4 h-4 mr-2" />
          Add Character
        </Button>
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
            <Card key={char.id} className="relative group">
              <CardHeader className="pb-2">
                <CardTitle className="flex justify-between items-start">
                  <div className="flex items-center gap-2">
                    <span>{char.name}</span>
                    {char.source === 'auto' && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger>
                            <Sparkles className="w-4 h-4 text-purple-400" />
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Auto-detected from story</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => handleOpenDialog(char)}
                    >
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => deleteCharacter(char.id)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent>
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
