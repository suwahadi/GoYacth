import { describe, expect, it } from "vitest";

import { blockToDTO, blocksFromApi, blocksReducer, newBlock, type EditorBlock } from "./block-editor";

const keys = (s: EditorBlock[]) => s.map((b) => b.key);

describe("blocksReducer", () => {
  const base = [newBlock("heading", "a"), newBlock("paragraph", "b"), newBlock("list", "c")];

  it("adds at the end or at a position", () => {
    expect(keys(blocksReducer(base, { type: "add", blockType: "quote", key: "d" }))).toEqual(["a", "b", "c", "d"]);
    expect(keys(blocksReducer(base, { type: "add", blockType: "cta", key: "d", at: 1 }))).toEqual(["a", "d", "b", "c"]);
    expect(blocksReducer(base, { type: "add", blockType: "list", key: "d" })[3].items).toEqual([""]);
  });

  it("moves blocks and ignores moves past the edges", () => {
    expect(keys(blocksReducer(base, { type: "move", key: "b", delta: -1 }))).toEqual(["b", "a", "c"]);
    expect(keys(blocksReducer(base, { type: "move", key: "b", delta: 1 }))).toEqual(["a", "c", "b"]);
    expect(blocksReducer(base, { type: "move", key: "a", delta: -1 })).toBe(base);
    expect(blocksReducer(base, { type: "move", key: "c", delta: 1 })).toBe(base);
  });

  it("removes and updates without touching other blocks", () => {
    expect(keys(blocksReducer(base, { type: "remove", key: "b" }))).toEqual(["a", "c"]);
    const next = blocksReducer(base, { type: "update", key: "a", patch: { text: "Hello", level: 3 } });
    expect(next[0]).toMatchObject({ text: "Hello", level: 3 });
    expect(next[1]).toBe(base[1]);
  });

  it("resets to new blocks", () => {
    expect(blocksReducer(base, { type: "reset", blocks: [] })).toEqual([]);
  });
});

describe("block DTOs", () => {
  it("sends only the fields of each block type", () => {
    const h = { ...newBlock("heading", "a"), text: " Title ", level: 3, url: "ignored" };
    expect(blockToDTO(h)).toEqual({ type: "heading", level: 3, text: "Title" });
    const l = { ...newBlock("list", "b"), items: ["One", " ", " Two "] };
    expect(blockToDTO(l)).toEqual({ type: "list", items: ["One", "Two"] });
    const img = { ...newBlock("image", "c"), media_id: "m1", text: "x" };
    expect(blockToDTO(img)).toEqual({ type: "image", media_id: "m1" });
    expect(blockToDTO(newBlock("image", "d"))).toEqual({ type: "image" });
    const cta = { ...newBlock("cta", "e"), label: "Book", url: "/boats" };
    expect(blockToDTO(cta)).toEqual({ type: "cta", label: "Book", url: "/boats" });
  });

  it("reads API blocks and skips unknown types", () => {
    const blocks = blocksFromApi([{ type: "paragraph", text: "Hi" }, { type: "html", text: "<b>" }, { type: "image", media_id: "m" }], "en");
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "image"]);
    expect(blocks[1].media_id).toBe("m");
    expect(blocksFromApi(null, "en")).toEqual([]);
  });
});
