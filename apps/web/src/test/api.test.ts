import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ApiError, api } from "@/lib/api";

const realFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = vi.fn();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

function mockResponse(status: number, body: unknown, ok = false) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return {
    ok: ok || (status >= 200 && status < 300),
    status,
    statusText: status === 402 ? "Payment Required" : "Error",
    text: () => Promise.resolve(text),
    json: () => Promise.resolve(typeof body === "string" ? JSON.parse(body) : body),
  } as any;
}

describe("api error mapping", () => {
  it("ApiError carries status + parsed FastAPI detail", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockResponse(402, { detail: "Project cost cap reached ($5.00). Raise the cap to continue." })
    );
    await expect(api.listProjects()).rejects.toMatchObject({
      name: "ApiError",
      status: 402,
      message: "Project cost cap reached ($5.00). Raise the cap to continue.",
    });
  });

  it("Pydantic 422 array detail returns the first msg", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockResponse(422, {
        detail: [
          { loc: ["body", "name"], msg: "name must contain non-whitespace characters", type: "value_error" },
          { loc: ["body", "name"], msg: "second message", type: "value_error" },
        ],
      })
    );
    try {
      await api.listProjects();
      throw new Error("should have thrown");
    } catch (e) {
      const err = e as ApiError;
      expect(err.status).toBe(422);
      expect(err.message).toBe("name must contain non-whitespace characters");
    }
  });

  it("network failure surfaces actionable cold-start message", async () => {
    // mockRejectedValue (not Once) so both attempts in this test reject.
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(api.listProjects()).rejects.toMatchObject({ name: "ApiError", status: 0 });
    try {
      await api.listProjects();
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as Error).message).toMatch(/cold start|unreachable/i);
    }
  });

  it("non-JSON 502 body falls back to truncated text", async () => {
    const longHtml = "<html>" + "x".repeat(500) + "</html>";
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockResponse(502, longHtml));
    try {
      await api.listProjects();
    } catch (e) {
      const err = e as ApiError;
      expect(err.status).toBe(502);
      expect(err.message.length).toBeLessThanOrEqual(201);
      expect(err.message.endsWith("…")).toBe(true);
    }
  });

  it("happy path returns parsed JSON", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockResponse(200, [{ id: "p1", name: "x" }], true));
    const list = await api.listProjects();
    expect(list).toEqual([{ id: "p1", name: "x" }]);
  });
});
