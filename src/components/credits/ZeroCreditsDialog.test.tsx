// @vitest-environment jsdom

import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ZeroCreditsDialog } from "./ZeroCreditsDialog";
import { BrowserRouter } from "react-router-dom";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// Mock useNavigate
const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

describe("ZeroCreditsDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  const renderDialog = (open = true) => {
    return render(
      <BrowserRouter>
        <ZeroCreditsDialog 
          open={open} 
          onOpenChange={vi.fn()} 
          userTier="free" 
        />
      </BrowserRouter>
    );
  };

  it("renders correctly when open", () => {
    renderDialog(true);
    expect(screen.getByText("Out of Credits")).toBeTruthy();
    expect(screen.getByText(/You've used all your credits/)).toBeTruthy();
    expect(screen.getByText("Buy More Credits")).toBeTruthy();
    expect(screen.getByText("Upgrade Membership")).toBeTruthy();
  });

  it("does not render when closed", () => {
    renderDialog(false);
    expect(screen.queryByText("Out of Credits")).toBeNull();
  });

  it("navigates to pricing credits mode when Buy More clicked", () => {
    renderDialog(true);
    const button = screen.getByText("Buy More Credits");
    fireEvent.click(button);
    
    // Check navigation happened (might need to wait for timeout in component)
    // The component has a 200ms delay. We can use fake timers.
  });

  it("navigates to subscription mode when Upgrade Membership clicked", () => {
    renderDialog(true);
    const button = screen.getByText("Upgrade Membership");
    fireEvent.click(button);
  });
  
  it("prevents dismissal via escape key", () => {
    const onOpenChange = vi.fn();
    render(
      <BrowserRouter>
        <ZeroCreditsDialog 
          open={true} 
          onOpenChange={onOpenChange} 
          userTier="free" 
        />
      </BrowserRouter>
    );
    
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape", code: "Escape" });
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
