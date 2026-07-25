import { describe, it, expect } from "bun:test";
import { normalize } from "../src/core/normalize";
import {
  userMsg,
  assistantText,
  assistantWithThinking,
  assistantWithToolCall,
  toolResult,
} from "./fixtures";

describe("normalize", () => {
  it("returns empty for empty input", () => {
    expect(normalize([])).toEqual([]);
  });

  it("normalizes user message (string content)", () => {
    const blocks = normalize([userMsg("fix the bug")]);
    expect(blocks).toEqual([{ kind: "user", text: "fix the bug", sourceIndex: 0 }]);
  });

  it("normalizes assistant text message", () => {
    const blocks = normalize([assistantText("done")]);
    expect(blocks).toEqual([{ kind: "assistant", text: "done", sourceIndex: 0 }]);
  });

  it("normalizes assistant string content", () => {
    const msg = { ...assistantText("done"), content: "plain text" } as any;
    expect(normalize([msg])).toEqual([{ kind: "assistant", text: "plain text", sourceIndex: 0 }]);
  });

  it("skips assistant thinking blocks", () => {
    const blocks = normalize([assistantWithThinking("result", "hmm")]);
    expect(blocks).toEqual([{ kind: "assistant", text: "result", sourceIndex: 0 }]);
  });

  it("normalizes tool call", () => {
    const blocks = normalize([assistantWithToolCall("Read", { path: "a.ts" })]);
    expect(blocks).toEqual([{
      kind: "tool_call", name: "Read", args: { path: "a.ts" }, sourceIndex: 0,
    }]);
  });

  it("normalizes tool result", () => {
    const blocks = normalize([toolResult("Read", "file contents")]);
    expect(blocks).toEqual([{
      kind: "tool_result", name: "Read",
      text: "file contents", sourceIndex: 0,
    }]);
  });

  it("handles mixed message sequence", () => {
    const blocks = normalize([
      userMsg("fix it"),
      assistantWithToolCall("Read", { path: "x.ts" }),
      toolResult("Read", "code"),
      assistantText("done"),
    ]);
    expect(blocks).toHaveLength(4);
    expect(blocks.map((b) => b.kind)).toEqual([
      "user", "tool_call", "tool_result", "assistant",
    ]);
  });

  it("produces image placeholder for user image content", () => {
    const msg = {
      role: "user" as const,
      content: [
        { type: "text" as const, text: "look at this" },
        { type: "image" as const, data: "abc", mimeType: "image/png" },
      ],
      timestamp: Date.now(),
    };
    const blocks = normalize([msg]);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({ kind: "user", text: "look at this", sourceIndex: 0 });
    expect(blocks[1]).toEqual({ kind: "user", text: "[image: image/png]", sourceIndex: 0 });
  });

  it("normalizes bashExecution messages", () => {
    const msg = { role: "bashExecution", command: "ls -la", output: "files", exitCode: 0 } as any;
    const blocks = normalize([msg]);
    expect(blocks).toEqual([
      { kind: "bash", command: "ls -la", output: "files", exitCode: 0, sourceIndex: 0 },
    ]);
  });

  it("skips truly unknown message roles gracefully", () => {
    const custom = { role: "custom", content: "hello" } as any;
    expect(normalize([custom])).toEqual([]);
  });
});


