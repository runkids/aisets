import { describe, expect, it } from "vitest";
import { agentCliAdapters } from "./aiSectionUtils";
import type { AgentAdapterInfo } from "@/types";

describe("agentCliAdapters", () => {
  it("excludes Local LLM from Agent CLI counts and lists", () => {
    const adapters: AgentAdapterInfo[] = [
      { id: "codex", name: "Codex CLI", version: "0.1.0", path: "/bin/codex" },
      { id: "local-llm", name: "Local LLM", version: "ollama/llava", path: "" },
      { id: "pi", name: "Pi", version: "", path: "/bin/pi" },
    ];

    expect(agentCliAdapters(adapters).map((adapter) => adapter.id)).toEqual([
      "codex",
      "pi",
    ]);
  });

  it("returns an empty list when no adapters were reported", () => {
    expect(agentCliAdapters(undefined)).toEqual([]);
  });
});
