// @vitest-environment jsdom

import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ModelSelector } from "./ModelSelector";
import { imageModels } from "./model-data";

beforeAll(() => {
  const anyGlobal = globalThis as unknown as Record<string, unknown>;
  if (!("ResizeObserver" in anyGlobal)) {
    anyGlobal.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  if (!("matchMedia" in anyGlobal)) {
    anyGlobal.matchMedia = (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener() {},
        removeListener() {},
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() {
          return false;
        },
      }) as unknown;
  }
  anyGlobal.requestAnimationFrame = () => 0;
  anyGlobal.cancelAnimationFrame = () => {};
});

afterEach(() => {
  cleanup();
});

describe("ModelSelector", () => {
  test("renders in grid mode by default and allows selecting a model", async () => {
    const user = userEvent.setup();
    const onModelChange = vi.fn();
    render(<ModelSelector selectedModel={imageModels[0]!.id} onModelChange={onModelChange} />);

    expect(screen.getByText("Image Model")).toBeTruthy();
    await user.click(screen.getByTitle(imageModels[1]!.name));
    expect(onModelChange).toHaveBeenCalledWith(imageModels[1]!.id);
  });

  test("toggles to carousel mode and selection calls onModelChange", async () => {
    const user = userEvent.setup();
    const onModelChange = vi.fn();
    render(<ModelSelector selectedModel={imageModels[0]!.id} onModelChange={onModelChange} />);

    await user.click(screen.getByRole("button", { name: "Carousel View" }));
    expect(screen.getByRole("region", { name: "Image Model Selector" })).toBeTruthy();

    const options = screen.getAllByRole("option");
    const target = options.find((el) => el.textContent?.includes(imageModels[2]!.name));
    expect(target).toBeTruthy();
    if (!target) return;
    await user.click(target);
    expect(onModelChange).toHaveBeenCalledWith(imageModels[2]!.id);
  });

  test("toggling view mode does not trigger model selection changes", async () => {
    const user = userEvent.setup();
    const onModelChange = vi.fn();
    render(<ModelSelector selectedModel={imageModels[0]!.id} onModelChange={onModelChange} />);

    await user.click(screen.getByRole("button", { name: "Carousel View" }));
    await user.click(screen.getByRole("button", { name: "Grid View" }));

    expect(onModelChange).not.toHaveBeenCalled();
  });
});
