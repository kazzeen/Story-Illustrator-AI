import React, { useState, useRef, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Check, ImageOff, ChevronLeft, ChevronRight } from "lucide-react";

export interface ArtStyle {
  id: string;
  name: string;
  description: string;
  preview: string;
  elements: string[];
  palette: string;
  composition: string;
  texture: string;
  status: "approved" | "draft";
}

interface CircularStyleSelectorProps {
  styles: ArtStyle[];
  selectedStyle?: string;
  onStyleSelect: (styleId: string) => void;
  className?: string;
}

function StylePreviewImage({ src, alt }: { src: string; alt: string }) {
  const [status, setStatus] = useState<"loading" | "error" | "loaded">("loading");

  return (
    <>
      {status === "loading" && <Skeleton className="absolute inset-0 w-full h-full" />}
      {status === "error" ? (
        <div className="absolute inset-0 flex items-center justify-center bg-muted text-muted-foreground">
          <ImageOff className="w-8 h-8 opacity-50" />
        </div>
      ) : (
        <img
          src={src}
          alt={alt}
          className={cn(
            "w-full h-full object-cover transition-opacity duration-500",
            status === "loading" ? "opacity-0" : "opacity-100"
          )}
          onLoad={() => setStatus("loaded")}
          onError={() => setStatus("error")}
          draggable={false}
        />
      )}
    </>
  );
}

export function CircularStyleSelector({
  styles,
  selectedStyle,
  onStyleSelect,
  className,
}: CircularStyleSelectorProps) {
  // Animation state refs
  const rotationRef = useRef(0);
  const targetRotationRef = useRef(0);
  const isDraggingRef = useRef(false);
  const startXRef = useRef(0);
  const startRotationRef = useRef(0);
  const isSpinningRef = useRef(false);
  const animationFrameRef = useRef<number>();
  const spinSpeedRef = useRef(0);
  const spinTimeoutRef = useRef<NodeJS.Timeout>();

  // UI State
  const [activeButton, setActiveButton] = useState<"prev" | "next" | null>(null);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);

  const approvedStyles = styles.filter((s) => s.status === "approved");
  const count = approvedStyles.length;
  const angleStep = 360 / count;
  const itemWidth = 220; 
  const radius = Math.max(itemWidth, (count * itemWidth) / (2 * Math.PI));

  // Initialize rotation from prop
  useEffect(() => {
    if (selectedStyle) {
      const index = approvedStyles.findIndex((s) => s.id === selectedStyle);
      if (index !== -1) {
        const target = -index * angleStep;
        // If first load or significant deviation, snap/animate to target
        if (Math.abs(targetRotationRef.current - target) > 0.1) {
             targetRotationRef.current = target;
             // If very far (initial load), set immediately to avoid wild spin
             if (Math.abs(rotationRef.current - target) > 360) {
                rotationRef.current = target;
             }
        }
      }
    }
  }, [selectedStyle, count, angleStep]); // eslint-disable-line react-hooks/exhaustive-deps

  // Animation Loop
  useEffect(() => {
    let lastTime = performance.now();
    
    const animate = (time: number) => {
      const deltaTime = time - lastTime;
      lastTime = time;

      if (isDraggingRef.current) {
        targetRotationRef.current = rotationRef.current;
      } else if (isSpinningRef.current) {
         targetRotationRef.current += spinSpeedRef.current;
         rotationRef.current += spinSpeedRef.current;
      } else {
         // Smooth interpolation to target
         const diff = targetRotationRef.current - rotationRef.current;
         if (Math.abs(diff) > 0.01) {
            // Frame-rate independent lerp
            const factor = 1 - Math.exp(-0.01 * deltaTime);
            rotationRef.current += diff * factor; 
         } else {
            rotationRef.current = targetRotationRef.current;
         }
      }

      if (sceneRef.current) {
        sceneRef.current.style.transform = `translateZ(-${radius}px) rotateY(${rotationRef.current}deg)`;
      }

      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animationFrameRef.current = requestAnimationFrame(animate);
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [radius]);

  const handleStart = (clientX: number) => {
    isDraggingRef.current = true;
    startXRef.current = clientX;
    startRotationRef.current = rotationRef.current;
    isSpinningRef.current = false;
  };

  const handleMove = (clientX: number) => {
    if (!isDraggingRef.current) return;
    const delta = clientX - startXRef.current;
    rotationRef.current = startRotationRef.current + delta * 0.5;
  };

  const handleEnd = () => {
    isDraggingRef.current = false;
    snapToNearest();
  };

  const snapToNearest = () => {
    const snappedIndex = Math.round(-rotationRef.current / angleStep);
    targetRotationRef.current = -snappedIndex * angleStep;
    
    const normalizedIndex = ((snappedIndex % count) + count) % count;
    if (approvedStyles[normalizedIndex] && approvedStyles[normalizedIndex].id !== selectedStyle) {
      onStyleSelect(approvedStyles[normalizedIndex].id);
    }
  };

  // Input Handlers
  const onMouseDown = (e: React.MouseEvent) => handleStart(e.clientX);
  const onMouseMove = (e: React.MouseEvent) => handleMove(e.clientX);
  const onMouseUp = () => handleEnd();
  const onMouseLeave = () => {
    if (isDraggingRef.current) handleEnd();
    stopSpinning();
  };

  const onTouchStart = (e: React.TouchEvent) => handleStart(e.touches[0].clientX);
  const onTouchMove = (e: React.TouchEvent) => handleMove(e.touches[0].clientX);
  const onTouchEnd = () => handleEnd();

  const rotateTo = (direction: number) => {
    const currentTargetIndex = Math.round(-targetRotationRef.current / angleStep);
    const newIndex = currentTargetIndex + direction;
    targetRotationRef.current = -newIndex * angleStep;
    
    const normalizedIndex = ((newIndex % count) + count) % count;
    if (approvedStyles[normalizedIndex]) {
       onStyleSelect(approvedStyles[normalizedIndex].id);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") rotateTo(-1);
    if (e.key === "ArrowRight") rotateTo(1);
  };

  const handleSpinStart = (direction: number) => {
     setActiveButton(direction === -1 ? "prev" : "next");
     spinTimeoutRef.current = setTimeout(() => {
        isSpinningRef.current = true;
        spinSpeedRef.current = direction * 2; 
     }, 200);
  };
  
  const handleSpinStop = (direction: number) => {
     setActiveButton(null);
     if (spinTimeoutRef.current) {
        clearTimeout(spinTimeoutRef.current);
        spinTimeoutRef.current = undefined;
     }
     
     if (isSpinningRef.current) {
        isSpinningRef.current = false;
        snapToNearest();
     } else {
        rotateTo(direction);
     }
  };
  
  const stopSpinning = () => {
    setActiveButton(null);
    if (spinTimeoutRef.current) clearTimeout(spinTimeoutRef.current);
    if (isSpinningRef.current) {
       isSpinningRef.current = false;
       snapToNearest();
    }
  };

  return (
    <div
      className={cn(
        "relative w-full h-[400px] flex items-center justify-center overflow-hidden bg-gradient-to-b from-background/50 to-background perspective-1000",
        className
      )}
      ref={containerRef}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseLeave}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      role="region"
      aria-label="Art Style Selector"
    >
      <div
        ref={sceneRef}
        className="relative w-full h-full flex items-center justify-center transform-style-3d"
        style={{
          transform: `translateZ(-${radius}px) rotateY(0deg)`,
        }}
      >
        {approvedStyles.map((style, index) => {
          const angle = index * angleStep;
          const isSelected = style.id === selectedStyle;

          return (
            <div
              key={style.id}
              className={cn(
                "absolute top-1/2 left-1/2 -ml-[100px] -mt-[140px] w-[200px] h-[280px] rounded-xl border bg-card shadow-xl overflow-hidden cursor-pointer transition-all duration-300",
                isSelected ? "border-primary ring-2 ring-primary scale-105 z-10" : "border-border opacity-70 hover:opacity-100"
              )}
              style={{
                transform: `rotateY(${angle}deg) translateZ(${radius}px)`,
                backfaceVisibility: "hidden", 
              }}
              onClick={(e) => {
                e.stopPropagation();
                if (isSpinningRef.current) return;
                
                const targetRotation = -index * angleStep;
                targetRotationRef.current = targetRotation;
                onStyleSelect(style.id);
              }}
              role="option"
              aria-selected={isSelected}
            >
              <div className="relative h-[200px] w-full">
                <StylePreviewImage src={style.preview} alt={style.name} />
                <div className="absolute inset-0 bg-gradient-to-t from-background/90 via-background/20 to-transparent" />
                {isSelected && (
                  <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-primary flex items-center justify-center text-primary-foreground">
                    <Check className="w-4 h-4" />
                  </div>
                )}
              </div>
              <div className="p-3">
                <p className="font-semibold text-sm text-foreground">{style.name}</p>
                <p className="text-xs text-muted-foreground line-clamp-2">
                  {style.description}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-4 z-20 pointer-events-none">
        <button
          className={cn(
            "pointer-events-auto p-2 rounded-full bg-background/80 border hover:bg-accent transition-colors active:scale-95 active:bg-accent",
            activeButton === "prev" && "bg-accent scale-95"
          )}
          onMouseDown={() => handleSpinStart(-1)}
          onMouseUp={() => handleSpinStop(-1)}
          onMouseLeave={() => {
            if (activeButton === "prev") handleSpinStop(-1);
          }}
          onTouchStart={() => handleSpinStart(-1)}
          onTouchEnd={() => handleSpinStop(-1)}
          aria-label="Previous style"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>
        <button
          className={cn(
            "pointer-events-auto p-2 rounded-full bg-background/80 border hover:bg-accent transition-colors active:scale-95 active:bg-accent",
            activeButton === "next" && "bg-accent scale-95"
          )}
          onMouseDown={() => handleSpinStart(1)}
          onMouseUp={() => handleSpinStop(1)}
          onMouseLeave={() => {
            if (activeButton === "next") handleSpinStop(1);
          }}
          onTouchStart={() => handleSpinStart(1)}
          onTouchEnd={() => handleSpinStop(1)}
          aria-label="Next style"
        >
          <ChevronRight className="w-6 h-6" />
        </button>
      </div>
      
      <div className="absolute inset-0 pointer-events-none bg-gradient-to-r from-background via-transparent to-background opacity-50" />
      
      <style>{`
        .perspective-1000 {
          perspective: 1000px;
        }
        .transform-style-3d {
          transform-style: preserve-3d;
        }
      `}</style>
    </div>
  );
}
