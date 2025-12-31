import { describe, expect, test } from "vitest";
import { readBooleanPreference, writeBooleanPreference } from "./ui-preferences";
import fs from "node:fs";

class MemoryStorage {
  private data = new Map<string, string>();
  getItem(key: string) {
    return this.data.has(key) ? this.data.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  clear() {
    this.data.clear();
  }
  key(index: number) {
    return Array.from(this.data.keys())[index] ?? null;
  }
  get length() {
    return this.data.size;
  }
}

describe("ui preferences", () => {
  test("reads default when missing", () => {
    const storage = new MemoryStorage() as unknown as Storage;
    expect(readBooleanPreference({ storage, key: "k", defaultValue: false })).toBe(false);
    expect(readBooleanPreference({ storage, key: "k", defaultValue: true })).toBe(true);
  });

  test("reads persisted boolean values", () => {
    const storage = new MemoryStorage() as unknown as Storage;
    storage.setItem("k", "true");
    expect(readBooleanPreference({ storage, key: "k", defaultValue: false })).toBe(true);
    storage.setItem("k", "false");
    expect(readBooleanPreference({ storage, key: "k", defaultValue: true })).toBe(false);
  });

  test("writes boolean values", () => {
    const storage = new MemoryStorage() as unknown as Storage;
    writeBooleanPreference({ storage, key: "k", value: true });
    expect(storage.getItem("k")).toBe("true");
    writeBooleanPreference({ storage, key: "k", value: false });
    expect(storage.getItem("k")).toBe("false");
  });

  test("SceneDetailModal debug panel includes a11y attributes and persistence key", () => {
    const modalPath = new URL("../components/storyboard/SceneDetailModal.tsx", import.meta.url);
    const source = fs.readFileSync(modalPath, "utf8");

    expect(source).toContain('const DEBUG_PREF_KEY = "scene_modal_debug_expanded"');
    expect(source).toContain("aria-expanded={isDebugExpanded}");
    expect(source).toContain("aria-controls={`scene-debug-panel-${scene.id}`}");
    expect(source).toContain("onClick={() => setIsDebugExpanded((v) => !v)}");
  });

  test("Storyboard hydrates scene debug info from DB after failures", () => {
    const storyboardPath = new URL("../pages/Storyboard.tsx", import.meta.url);
    const source = fs.readFileSync(storyboardPath, "utf8");

    expect(source).toContain("const hydrateSceneDebugFromDb");
    expect(source).toContain("await hydrateSceneDebugFromDb(sceneId)");
    expect(source).toContain("await hydrateSceneDebugFromDb(scene.id)");
  });

  test("Storyboard hydrates scene debug info when opening the modal", () => {
    const storyboardPath = new URL("../pages/Storyboard.tsx", import.meta.url);
    const source = fs.readFileSync(storyboardPath, "utf8");

    expect(source).toContain("if (!isModalOpen || !selectedScene?.id) return;");
    expect(source).toContain("void hydrateSceneDebugFromDb(selectedScene.id)");
  });
});
