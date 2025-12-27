import { describe, expect, it } from "vitest";
import {
  readStoredDisabledStyleElements,
  styleElementToggleReducer,
  writeStoredDisabledStyleElements,
} from "./StyleSelector";

class MemoryStorage {
  private map = new Map<string, string>();

  getItem(key: string) {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
}

describe("styleElementToggleReducer", () => {
  it("toggles, undoes, and redoes", () => {
    const initial = { disabled: new Set<string>(), undo: [], redo: [] };

    const afterToggle = styleElementToggleReducer(initial, { type: "toggle", word: "Depth of field" });
    expect(afterToggle.disabled.has("Depth of field")).toBe(true);
    expect(afterToggle.undo.length).toBe(1);
    expect(afterToggle.redo.length).toBe(0);

    const afterUndo = styleElementToggleReducer(afterToggle, { type: "undo" });
    expect(afterUndo.disabled.has("Depth of field")).toBe(false);
    expect(afterUndo.undo.length).toBe(0);
    expect(afterUndo.redo.length).toBe(1);

    const afterRedo = styleElementToggleReducer(afterUndo, { type: "redo" });
    expect(afterRedo.disabled.has("Depth of field")).toBe(true);
    expect(afterRedo.undo.length).toBe(1);
    expect(afterRedo.redo.length).toBe(0);
  });

  it("load replaces disabled set and resets history", () => {
    const state = {
      disabled: new Set<string>(["A"]),
      undo: [{ word: "A", prevDisabled: false }],
      redo: [{ word: "B", prevDisabled: true }],
    };
    const loaded = styleElementToggleReducer(state, { type: "load", disabled: new Set(["X"]) });
    expect(Array.from(loaded.disabled)).toEqual(["X"]);
    expect(loaded.undo.length).toBe(0);
    expect(loaded.redo.length).toBe(0);
  });
});

describe("disabled style element storage helpers", () => {
  it("writes and reads per styleId while preserving other styles", () => {
    const storage = new MemoryStorage();
    writeStoredDisabledStyleElements("anime", new Set(["Cel shading"]), storage);
    writeStoredDisabledStyleElements("cinematic", new Set(["Depth of field", "Atmospheric haze"]), storage);

    const anime = readStoredDisabledStyleElements("anime", storage);
    const cinematic = readStoredDisabledStyleElements("cinematic", storage);

    expect(Array.from(anime)).toEqual(["Cel shading"]);
    expect(Array.from(cinematic).sort()).toEqual(["Atmospheric haze", "Depth of field"].sort());
  });

  it("returns empty set on invalid JSON", () => {
    const storage = new MemoryStorage();
    storage.setItem("styleSelector.disabledStyleElementsByStyle", "{not-json");
    const result = readStoredDisabledStyleElements("cinematic", storage);
    expect(Array.from(result)).toEqual([]);
  });
});

