import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, Zap, Image as ImageIcon, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

import { imageModels, type ImageModel } from "./model-data";

interface ModelSelectorProps {
  selectedModel: string;
  onModelChange: (modelId: string) => void;
}

export function ModelSelector({ selectedModel, onModelChange }: ModelSelectorProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
            <h3 className="text-lg font-semibold tracking-tight">Image Model</h3>
            <p className="text-sm text-muted-foreground">Select the AI model for generation.</p>
        </div>
        <Badge variant="outline" className="text-xs font-normal">
          {imageModels.find(m => m.id === selectedModel)?.name || selectedModel}
        </Badge>
      </div>
      
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {imageModels.map((model) => (
          <Card
            key={model.id}
            className={cn(
              "cursor-pointer transition-all hover:border-primary/50 relative overflow-hidden",
              selectedModel === model.id ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border"
            )}
            onClick={() => onModelChange(model.id)}
          >
            <CardContent className="p-4 flex flex-col h-full">
              <div className="flex justify-between items-start mb-2">
                <div className="flex items-center gap-2">
                    <div className={cn("p-1.5 rounded-md", selectedModel === model.id ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
                        <model.icon className="w-4 h-4" />
                    </div>
                    <span className="font-medium text-sm">{model.name}</span>
                </div>
                {selectedModel === model.id && (
                  <div className="bg-primary text-primary-foreground rounded-full p-0.5">
                    <Check className="w-3 h-3" />
                  </div>
                )}
              </div>
              
              <p className="text-xs text-muted-foreground line-clamp-3 mb-auto pt-1">
                {model.description}
              </p>

              <div className="flex items-center justify-between mt-3 pt-3 border-t">
                <Badge variant="secondary" className="text-[10px] px-1.5 h-5 font-normal">
                  {model.strength}
                </Badge>
                {model.cost === "high" && (
                   <span className="text-[10px] text-muted-foreground font-medium">$$$</span>
                )}
                 {model.cost === "low" && (
                   <span className="text-[10px] text-muted-foreground font-medium">$</span>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
