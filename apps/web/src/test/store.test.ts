import { describe, it, expect, beforeEach } from "vitest";
import { useUI } from "@/lib/store";
import type { ProjectDTO, NodeDTO, EdgeDTO } from "@/lib/api";

// Reset store between tests via the public actions — Zustand has no
// built-in reset and we don't want to touch internals just for testing.
function resetStore() {
  const s = useUI.getState();
  s.setTree(null, [], []);
  // Clear any open dialogs from prior tests' showConfirm calls.
  while (useUI.getState().dialogQueue.length > 0) {
    const d = useUI.getState().dialogQueue[0];
    s.resolveDialog(d.id, false);
  }
  s.setShowcaseMode(false);
}

const fakeProject: ProjectDTO = {
  id: "proj-1",
  name: "Test",
  seed_url: null,
  working_node_id: null,
  created_at: "2026-04-28T00:00:00",
  context: "",
  style_pins: [],
  active_checkpoint_id: null,
  archived_count: 0,
  total_count: 0,
};

function makeNode(id: string, type: NodeDTO["type"] = "variant"): NodeDTO {
  return {
    id,
    parent_id: null,
    type,
    title: id,
    summary: null,
    build_status: "ready",
    model_used: null,
    position: { x: 0, y: 0 },
    sandbox_url: null,
    created_at: "2026-04-28T00:00:00",
  };
}

describe("store: champions + showcase", () => {
  beforeEach(() => {
    localStorage.clear();
    resetStore();
  });

  it("hydrates championedIds from localStorage on setTree", () => {
    localStorage.setItem("atelier:champions:proj-1", JSON.stringify(["a", "b"]));
    const nodes = [makeNode("a"), makeNode("b"), makeNode("c")];
    useUI.getState().setTree(fakeProject, nodes, []);
    expect(useUI.getState().championedIds).toEqual(["a", "b"]);
  });

  it("filters hydrated champions to nodes that still exist", () => {
    localStorage.setItem("atelier:champions:proj-1", JSON.stringify(["a", "ghost"]));
    useUI.getState().setTree(fakeProject, [makeNode("a")], []);
    expect(useUI.getState().championedIds).toEqual(["a"]);
  });

  it("toggleChampion adds + removes + persists", () => {
    useUI.getState().setTree(fakeProject, [makeNode("a"), makeNode("b")], []);
    useUI.getState().toggleChampion("a");
    expect(useUI.getState().championedIds).toEqual(["a"]);
    expect(JSON.parse(localStorage.getItem("atelier:champions:proj-1") || "[]")).toEqual(["a"]);
    useUI.getState().toggleChampion("b");
    expect(useUI.getState().championedIds).toEqual(["a", "b"]);
    useUI.getState().toggleChampion("a");
    expect(useUI.getState().championedIds).toEqual(["b"]);
  });

  it("auto-exits showcase mode when last champion is unstarred", () => {
    useUI.getState().setTree(fakeProject, [makeNode("a")], []);
    useUI.getState().toggleChampion("a");
    useUI.getState().setShowcaseMode(true);
    expect(useUI.getState().showcaseMode).toBe(true);
    useUI.getState().toggleChampion("a"); // unstar last one
    expect(useUI.getState().championedIds).toEqual([]);
    expect(useUI.getState().showcaseMode).toBe(false);
  });

  it("resets showcase mode + champions on project switch", () => {
    useUI.getState().setTree(fakeProject, [makeNode("a")], []);
    useUI.getState().toggleChampion("a");
    useUI.getState().setShowcaseMode(true);
    useUI.getState().setTree({ ...fakeProject, id: "proj-2", name: "Other" }, [], []);
    expect(useUI.getState().showcaseMode).toBe(false);
    expect(useUI.getState().championedIds).toEqual([]);
  });
});

describe("store: dialog queue (FIFO)", () => {
  beforeEach(() => resetStore());

  it("showConfirm enqueues + resolveDialog dequeues + resolves", async () => {
    const promise = useUI.getState().showConfirm({ message: "go?" });
    expect(useUI.getState().dialogQueue).toHaveLength(1);
    const dlg = useUI.getState().dialogQueue[0];
    useUI.getState().resolveDialog(dlg.id, true);
    expect(useUI.getState().dialogQueue).toHaveLength(0);
    await expect(promise).resolves.toBe(true);
  });

  it("multiple showConfirms queue in FIFO order", () => {
    useUI.getState().showConfirm({ message: "first" });
    useUI.getState().showConfirm({ message: "second" });
    useUI.getState().showConfirm({ message: "third" });
    const q = useUI.getState().dialogQueue;
    expect(q).toHaveLength(3);
    expect(q[0].message).toBe("first");
    expect(q[1].message).toBe("second");
    expect(q[2].message).toBe("third");
  });

  it("showInfo and showConfirm coexist in the same queue", () => {
    useUI.getState().showInfo({ message: "info!" });
    useUI.getState().showConfirm({ message: "confirm?" });
    const q = useUI.getState().dialogQueue;
    expect(q[0].kind).toBe("info");
    expect(q[1].kind).toBe("confirm");
  });
});

describe("store: error toast", () => {
  beforeEach(() => resetStore());

  it("showError sets and dismissError clears", () => {
    useUI.getState().showError("oops");
    expect(useUI.getState().errorToast?.message).toBe("oops");
    useUI.getState().dismissError();
    expect(useUI.getState().errorToast).toBeNull();
  });
});

describe("store: edges + nodes", () => {
  beforeEach(() => resetStore());

  it("upsertNode adds and replaces", () => {
    useUI.getState().setTree(fakeProject, [], []);
    const n = makeNode("a");
    useUI.getState().upsertNode(n);
    expect(useUI.getState().nodes).toHaveLength(1);
    useUI.getState().upsertNode({ ...n, title: "renamed" });
    expect(useUI.getState().nodes).toHaveLength(1);
    expect(useUI.getState().nodes[0].title).toBe("renamed");
  });

  it("addEdge ignores duplicates", () => {
    const edge: EdgeDTO = {
      id: "e1",
      from: "a",
      to: "b",
      type: "prompt",
      prompt_text: null,
    };
    useUI.getState().setTree(fakeProject, [], []);
    useUI.getState().addEdge(edge);
    useUI.getState().addEdge(edge); // dup
    expect(useUI.getState().edges).toHaveLength(1);
  });
});
