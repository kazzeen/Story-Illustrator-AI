import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Check, ChevronLeft, ChevronRight, ImageOff } from "lucide-react";

/**
 * Minimal item shape used by RotatingCardSelector.
 *
 * Usage:
 * ```tsx
 * const items = [
 *   { id: "cinematic", name: "Cinematic", description: "Film-still look", preview: "https://..." },
 * ];
 *
 * <RotatingCardSelector
 *   items={items}
 *   selectedId={selected}
 *   onSelect={setSelected}
 *   ariaLabel="Art Style Selector"
 * />
 * ```
 */
export type RotatingCardSelectorItem = {
  id: string;
  name: string;
  description: string;
  preview: string;
};

/**
 * A 3D rotating carousel selector.
 *
 * Notes:
 * - `selectedId` is controlled by the parent (recommended).
 * - Keyboard: ArrowLeft/ArrowRight on the focused region.
 */
export type RotatingCardSelectorProps<TItem extends RotatingCardSelectorItem> = {
  items: TItem[];
  selectedId?: string;
  onSelect: (id: string) => void;
  ariaLabel: string;
  className?: string;
  previousButtonLabel?: string;
  nextButtonLabel?: string;
  getItemId?: (item: TItem) => string;
  getItemName?: (item: TItem) => string;
  getItemDescription?: (item: TItem) => string;
  getItemPreview?: (item: TItem) => string;
};

function PreviewImage({ src, alt }: { src: string; alt: string }) {
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
            status === "loading" ? "opacity-0" : "opacity-100",
          )}
          onLoad={() => setStatus("loaded")}
          onError={() => setStatus("error")}
          draggable={false}
        />
      )}
    </>
  );
}

export function RotatingCardSelector<TItem extends RotatingCardSelectorItem>({
  items,
  selectedId,
  onSelect,
  ariaLabel,
  className,
  previousButtonLabel = "Previous option",
  nextButtonLabel = "Next option",
  getItemId = (i) => i.id,
  getItemName = (i) => i.name,
  getItemDescription = (i) => i.description,
  getItemPreview = (i) => i.preview,
}: RotatingCardSelectorProps<TItem>) {
  const rotationRef = useRef(0);
  const targetRotationRef = useRef(0);
  const isDraggingRef = useRef(false);
  const startXRef = useRef(0);
  const startRotationRef = useRef(0);
  const isSpinningRef = useRef(false);
  const animationFrameRef = useRef<number>();
  const spinSpeedRef = useRef(0);
  const spinTimeoutRef = useRef<NodeJS.Timeout>();

  const [activeButton, setActiveButton] = useState<"prev" | "next" | null>(null);
  const sceneRef = useRef<HTMLDivElement>(null);

  const normalizedItems = useMemo(() => items.filter(Boolean), [items]);
  const count = normalizedItems.length;
  const angleStep = count > 0 ? 360 / count : 0;
  const itemWidth = 220;
  const radius = Math.max(itemWidth, count > 0 ? (count * itemWidth) / (2 * Math.PI) : itemWidth);

  useEffect(() => {
    if (!selectedId || count <= 0) return;
    const idx = normalizedItems.findIndex((s) => getItemId(s) === selectedId);
    if (idx === -1) return;
    const target = -idx * angleStep;
    if (Math.abs(targetRotationRef.current - target) > 0.1) {
      targetRotationRef.current = target;
      if (Math.abs(rotationRef.current - target) > 360) {
        rotationRef.current = target;
      }
    }
  }, [selectedId, count, angleStep, normalizedItems, getItemId]);

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
        const diff = targetRotationRef.current - rotationRef.current;
        if (Math.abs(diff) > 0.01) {
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

  const snapToNearest = useCallback(() => {
    if (count <= 0) return;
    const snappedIndex = Math.round(-rotationRef.current / angleStep);
    targetRotationRef.current = -snappedIndex * angleStep;

    const normalizedIndex = ((snappedIndex % count) + count) % count;
    const item = normalizedItems[normalizedIndex];
    if (!item) return;
    const id = getItemId(item);
    if (id && id !== selectedId) onSelect(id);
  }, [angleStep, count, getItemId, normalizedItems, onSelect, selectedId]);

  const handleStart = (clientX: number) => {
    if (count <= 0) return;
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

  const stopSpinning = useCallback(() => {
    setActiveButton(null);
    if (spinTimeoutRef.current) clearTimeout(spinTimeoutRef.current);
    if (isSpinningRef.current) {
      isSpinningRef.current = false;
      snapToNearest();
    }
  }, [snapToNearest]);

  const rotateTo = useCallback(
    (direction: number) => {
      if (count <= 0) return;
      const currentTargetIndex = Math.round(-targetRotationRef.current / angleStep);
      const newIndex = currentTargetIndex + direction;
      targetRotationRef.current = -newIndex * angleStep;

      const normalizedIndex = ((newIndex % count) + count) % count;
      const item = normalizedItems[normalizedIndex];
      if (!item) return;
      onSelect(getItemId(item));
    },
    [angleStep, count, getItemId, normalizedItems, onSelect],
  );

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

  useEffect(() => {
    return () => {
      if (spinTimeoutRef.current) clearTimeout(spinTimeoutRef.current);
    };
  }, []);

  return (
    <div
      className={cn(
        "relative w-full h-[400px] flex items-center justify-center overflow-hidden bg-gradient-to-b from-background/50 to-background perspective-1000",
        className,
      )}
      onMouseDown={(e) => handleStart(e.clientX)}
      onMouseMove={(e) => handleMove(e.clientX)}
      onMouseUp={() => handleEnd()}
      onMouseLeave={() => {
        if (isDraggingRef.current) handleEnd();
        stopSpinning();
      }}
      onTouchStart={(e) => handleStart(e.touches[0].clientX)}
      onTouchMove={(e) => handleMove(e.touches[0].clientX)}
      onTouchEnd={() => handleEnd()}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      role="region"
      aria-label={ariaLabel}
    >
      <div
        ref={sceneRef}
        className="relative w-full h-full flex items-center justify-center transform-style-3d"
        style={{ transform: `translateZ(-${radius}px) rotateY(0deg)` }}
      >
        {normalizedItems.map((item, index) => {
          const id = getItemId(item);
          const name = getItemName(item);
          const description = getItemDescription(item);
          const preview = getItemPreview(item);

          const angle = index * angleStep;
          const isSelected = id === selectedId;

          return (
            <div
              key={id}
              className={cn(
                "absolute top-1/2 left-1/2 -ml-[100px] -mt-[140px] w-[200px] h-[280px] rounded-xl border bg-card shadow-xl overflow-hidden cursor-pointer transition-all duration-300",
                isSelected
                  ? "border-primary ring-2 ring-primary scale-105 z-10"
                  : "border-border opacity-70 hover:opacity-100",
              )}
              style={{
                transform: `rotateY(${angle}deg) translateZ(${radius}px)`,
                backfaceVisibility: "hidden",
              }}
              onClick={(e) => {
                e.stopPropagation();
                if (isSpinningRef.current) return;
                targetRotationRef.current = -index * angleStep;
                onSelect(id);
              }}
              role="option"
              aria-selected={isSelected}
            >
              <div className="relative h-[200px] w-full">
                <PreviewImage src={preview} alt={name} />
                <div className="absolute inset-0 bg-gradient-to-t from-background/90 via-background/20 to-transparent" />
                {isSelected && (
                  <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-primary flex items-center justify-center text-primary-foreground">
                    <Check className="w-4 h-4" />
                  </div>
                )}
              </div>
              <div className="p-3">
                <p className="font-semibold text-sm text-foreground">{name}</p>
                <p className="text-xs text-muted-foreground line-clamp-2">{description}</p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-4 z-20 pointer-events-none">
        <button
          type="button"
          className={cn(
            "pointer-events-auto p-2 rounded-full bg-background/80 border hover:bg-accent transition-colors active:scale-95 active:bg-accent",
            activeButton === "prev" && "bg-accent scale-95",
          )}
          onMouseDown={() => handleSpinStart(-1)}
          onMouseUp={() => handleSpinStop(-1)}
          onMouseLeave={() => {
            if (activeButton === "prev") handleSpinStop(-1);
          }}
          onTouchStart={() => handleSpinStart(-1)}
          onTouchEnd={() => handleSpinStop(-1)}
          aria-label={previousButtonLabel}
        >
          <ChevronLeft className="w-6 h-6" />
        </button>
        <button
          type="button"
          className={cn(
            "pointer-events-auto p-2 rounded-full bg-background/80 border hover:bg-accent transition-colors active:scale-95 active:bg-accent",
            activeButton === "next" && "bg-accent scale-95",
          )}
          onMouseDown={() => handleSpinStart(1)}
          onMouseUp={() => handleSpinStop(1)}
          onMouseLeave={() => {
            if (activeButton === "next") handleSpinStop(1);
          }}
          onTouchStart={() => handleSpinStart(1)}
          onTouchEnd={() => handleSpinStop(1)}
          aria-label={nextButtonLabel}
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
