import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Check, Info, LayoutGrid, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { imageModels, type ImageModel } from "./model-data";
import { RotatingCardSelector, type RotatingCardSelectorItem } from "./RotatingCardSelector";

interface ModelSelectorProps {
  selectedModel: string;
  onModelChange: (modelId: string) => void;
  selectedResolution?: { width: number; height: number };
  onResolutionChange?: (resolution: { width: number; height: number }) => void;
}

type ImageModelSelectorItem = RotatingCardSelectorItem & { meta: ImageModel };

function hashStringToHue(input: string) {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) >>> 0;
  return h % 360;
}

function svgTextEscape(input: string) {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildModelPreviewDataUrl(model: ImageModel) {
  const hue = hashStringToHue(model.id);
  const title = svgTextEscape(model.name);
  const subtitle = svgTextEscape(`${model.provider} • ${model.strength}`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${hue} 70% 55%)"/>
      <stop offset="1" stop-color="hsl(${(hue + 50) % 360} 70% 45%)"/>
    </linearGradient>
    <radialGradient id="r" cx="30%" cy="20%" r="80%">
      <stop offset="0" stop-color="rgba(255,255,255,0.55)"/>
      <stop offset="1" stop-color="rgba(255,255,255,0)"/>
    </radialGradient>
  </defs>
  <rect width="600" height="600" fill="url(#g)"/>
  <rect width="600" height="600" fill="url(#r)"/>
  <rect x="56" y="380" width="488" height="164" rx="22" fill="rgba(0,0,0,0.35)"/>
  <text x="86" y="438" font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto" font-size="32" font-weight="700" fill="white">${title}</text>
  <text x="86" y="478" font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto" font-size="18" font-weight="500" fill="rgba(255,255,255,0.85)">${subtitle}</text>
</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function ModelSelector({ selectedModel, onModelChange, selectedResolution, onResolutionChange }: ModelSelectorProps) {
  const [viewMode, setViewMode] = useState<"grid" | "carousel">("grid");
  const currentModel = imageModels.find((m) => m.id === selectedModel);
  const supportedResolutions = currentModel?.supportedResolutions;

  const carouselItems = useMemo<ImageModelSelectorItem[]>(
    () =>
      imageModels.map((m) => ({
        id: m.id,
        name: m.name,
        description: m.description,
        preview: buildModelPreviewDataUrl(m),
        meta: m,
      })),
    [],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
            <h3 className="text-lg font-semibold tracking-tight">Image Model</h3>
            <p className="text-sm text-muted-foreground">Select the AI model for generation.</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap justify-end">
            {supportedResolutions && onResolutionChange && (
               <Select 
                 value={selectedResolution ? JSON.stringify({width: selectedResolution.width, height: selectedResolution.height}) : (supportedResolutions[0] ? JSON.stringify({width: supportedResolutions[0].width, height: supportedResolutions[0].height}) : "")} 
                 onValueChange={(val) => {
                    try {
                        onResolutionChange(JSON.parse(val));
                    } catch {
                        return;
                    }
                 }}
               >
                 <SelectTrigger className="w-[180px] h-8 text-xs">
                   <SelectValue placeholder="Select Resolution" />
                 </SelectTrigger>
                 <SelectContent>
                   {supportedResolutions.map((res, idx) => (
                     <SelectItem key={idx} value={JSON.stringify({width: res.width, height: res.height})} className="text-xs">
                       {res.label}
                     </SelectItem>
                   ))}
                 </SelectContent>
               </Select>
            )}
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs font-normal">
                {currentModel?.name || selectedModel}
              </Badge>
              <div className="flex items-center border border-border rounded-lg p-1 bg-background/50">
                <Button
                  type="button"
                  variant={viewMode === "grid" ? "secondary" : "ghost"}
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setViewMode("grid")}
                  aria-label="Grid View"
                >
                  <LayoutGrid className="w-4 h-4" />
                </Button>
                <Button
                  type="button"
                  variant={viewMode === "carousel" ? "secondary" : "ghost"}
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setViewMode("carousel")}
                  aria-label="Carousel View"
                >
                  <RotateCw className="w-4 h-4" />
                </Button>
              </div>
            </div>
        </div>
      </div>
      
      {viewMode === "carousel" ? (
        <div className="space-y-4">
          <RotatingCardSelector<ImageModelSelectorItem>
            items={carouselItems}
            selectedId={selectedModel}
            onSelect={onModelChange}
            ariaLabel="Image Model Selector"
            previousButtonLabel="Previous model"
            nextButtonLabel="Next model"
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {imageModels.map((model) => (
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
                  
                  <div className="flex items-center gap-2">
                      {model.cost === "high" && (
                         <span className="text-[10px] text-muted-foreground font-medium">$$$</span>
                      )}
                       {model.cost === "low" && (
                         <span className="text-[10px] text-muted-foreground font-medium">$</span>
                      )}
  
                      {model.specs && (
                          <TooltipProvider>
                              <Tooltip>
                                  <TooltipTrigger asChild>
                                      <div className="cursor-help hover:bg-muted p-0.5 rounded-sm transition-colors" onClick={(e) => e.stopPropagation()}>
                                          <Info className="w-3.5 h-3.5 text-muted-foreground/70 hover:text-foreground" />
                                      </div>
                                  </TooltipTrigger>
                                  <TooltipContent className="max-w-[280px] space-y-3 p-4" side="top" align="end">
                                      <div className="space-y-1.5">
                                          <div className="flex items-center gap-2 border-b pb-2 mb-2">
                                              <model.icon className="w-4 h-4 text-primary" />
                                              <p className="font-semibold text-sm">{model.name}</p>
                                          </div>
                                          
                                          <div className="grid grid-cols-[70px_1fr] gap-x-2 gap-y-1 text-xs">
                                              <span className="text-muted-foreground font-medium">Resolution:</span>
                                              <span>{model.specs.resolution}</span>
                                              <span className="text-muted-foreground font-medium">Best For:</span>
                                              <span>{model.specs.useCase}</span>
                                          </div>
                                      </div>
                                      {model.specs.features && (
                                          <div className="space-y-1.5">
                                              <p className="text-xs font-medium text-muted-foreground">Key Features</p>
                                              <ul className="grid gap-1">
                                                  {model.specs.features.map((f, i) => (
                                                      <li key={i} className="text-xs flex items-start gap-2">
                                                          <span className="block w-1 h-1 rounded-full bg-primary mt-1.5 shrink-0" />
                                                          {f}
                                                      </li>
                                                  ))}
                                              </ul>
                                          </div>
                                      )}
                                  </TooltipContent>
                              </Tooltip>
                          </TooltipProvider>
                      )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
