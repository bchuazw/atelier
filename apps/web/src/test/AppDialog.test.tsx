import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AppDialog from "@/components/AppDialog";
import { useUI } from "@/lib/store";

function resetStore() {
  // Drain any leftover dialogs from prior tests.
  while (useUI.getState().dialogQueue.length > 0) {
    const d = useUI.getState().dialogQueue[0];
    useUI.getState().resolveDialog(d.id, false);
  }
}

beforeEach(() => {
  localStorage.clear();
  resetStore();
});

describe("AppDialog", () => {
  it("renders nothing when queue is empty", () => {
    render(<AppDialog />);
    expect(screen.queryByRole("button", { name: /confirm/i })).toBeNull();
  });

  it("renders the head of the queue and resolves true on Confirm", async () => {
    const user = userEvent.setup();
    render(<AppDialog />);
    let resolved: boolean | null = null;
    act(() => {
      void useUI.getState()
        .showConfirm({ message: "delete forever?", confirmLabel: "Delete", cancelLabel: "Keep" })
        .then((v) => {
          resolved = v;
        });
    });
    expect(await screen.findByText("delete forever?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete" }));
    // Promise resolves microtask-async; flush.
    await new Promise((r) => setTimeout(r, 0));
    expect(resolved).toBe(true);
    expect(useUI.getState().dialogQueue).toHaveLength(0);
  });

  it("Cancel button resolves false", async () => {
    const user = userEvent.setup();
    render(<AppDialog />);
    let resolved: boolean | null = null;
    act(() => {
      void useUI.getState()
        .showConfirm({ message: "really?", cancelLabel: "Nope" })
        .then((v) => {
          resolved = v;
        });
    });
    await screen.findByText("really?");
    await user.click(screen.getByRole("button", { name: "Nope" }));
    await new Promise((r) => setTimeout(r, 0));
    expect(resolved).toBe(false);
  });

  it("renders queued dialogs one at a time (FIFO)", async () => {
    const user = userEvent.setup();
    render(<AppDialog />);
    act(() => {
      void useUI.getState().showConfirm({ message: "first?" });
      void useUI.getState().showConfirm({ message: "second?" });
    });
    expect(await screen.findByText("first?")).toBeInTheDocument();
    expect(screen.queryByText("second?")).toBeNull();
    // Dismiss first → second appears.
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(await screen.findByText("second?")).toBeInTheDocument();
  });

  it("info dialog has only one button", async () => {
    const user = userEvent.setup();
    render(<AppDialog />);
    act(() => {
      void useUI.getState().showInfo({ message: "fyi" });
    });
    await screen.findByText("fyi");
    // Should resolve when the single button is clicked.
    await user.click(screen.getByRole("button"));
    await new Promise((r) => setTimeout(r, 0));
    expect(useUI.getState().dialogQueue).toHaveLength(0);
  });
});
