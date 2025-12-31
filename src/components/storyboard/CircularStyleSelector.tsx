import { RotatingCardSelector, type RotatingCardSelectorItem } from "./RotatingCardSelector";

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

export function CircularStyleSelector({
  styles,
  selectedStyle,
  onStyleSelect,
  className,
}: CircularStyleSelectorProps) {
  const approvedStyles = styles.filter((s) => s.status === "approved");

  const items = approvedStyles.map((style): RotatingCardSelectorItem => {
    return {
      id: style.id,
      name: style.name,
      description: style.description,
      preview: style.preview,
    };
  });

  return (
    <RotatingCardSelector
      items={items}
      selectedId={selectedStyle}
      onSelect={onStyleSelect}
      className={className}
      ariaLabel="Art Style Selector"
      previousButtonLabel="Previous style"
      nextButtonLabel="Next style"
    />
  );
}
