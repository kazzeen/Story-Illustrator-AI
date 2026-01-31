import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { llmModels } from "./llm-model-data";

interface LLMModelSelectorProps {
  selectedModel: string;
  onModelChange: (modelId: string) => void;
}

export function LLMModelSelector({ selectedModel, onModelChange }: LLMModelSelectorProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h3 className="text-lg font-semibold tracking-tight">AI Model</h3>
        <p className="text-sm text-muted-foreground">Select the LLM for story generation.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {llmModels.map((model) => (
          <Card
            key={model.id}
            className={cn(
              "cursor-pointer transition-all hover:border-primary/50 relative overflow-hidden",
              selectedModel === model.id ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border",
            )}
            onClick={() => onModelChange(model.id)}
          >
            <CardContent className="p-4 flex flex-col h-full">
              <div className="flex justify-between items-start mb-2">
                <div className="flex items-center gap-2 overflow-hidden">
                  <div
                    className={cn(
                      "p-1.5 rounded-md shrink-0",
                      selectedModel === model.id ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
                    )}
                  >
                    <model.icon className="w-4 h-4" />
                  </div>
                  <span className="font-medium text-sm truncate" title={model.name}>{model.name}</span>
                </div>
                {selectedModel === model.id && (
                  <div className="bg-primary text-primary-foreground rounded-full p-0.5 shrink-0">
                    <Check className="w-3 h-3" />
                  </div>
                )}
              </div>

              <div className="mb-2 flex flex-wrap gap-1">
                {model.tier && (
                  <Badge
                    variant={model.tier === "Professional" ? "default" : "secondary"}
                    className={cn(
                      "text-[10px] h-5 px-1.5 font-normal",
                      model.tier === "Professional" && "bg-primary/10 text-primary hover:bg-primary/20 border-primary/20",
                    )}
                  >
                    {model.tier}
                  </Badge>
                )}
              </div>

              <p className="text-xs text-muted-foreground line-clamp-3 mb-auto pt-1">
                {model.description}
              </p>

              <div className="flex items-center justify-between mt-3 pt-3 border-t">
                <Badge variant="secondary" className="text-[10px] px-1.5 h-5 font-normal">
                  {model.strength}
                </Badge>
                <span className="text-[10px] text-muted-foreground">{model.provider}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
