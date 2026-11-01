import type { Img } from "~/lib/types";

export const BLOCK_TYPES = ["heading", "paragraph", "list", "image", "quote", "cta"] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

export interface EditorBlock {
  key: string;
  type: BlockType;
  level: number;
  text: string;
  items: string[];
  media_id: string | null;
  image: Img | null;
  label: string;
  url: string;
}

export interface BlockDTO {
  type: BlockType;
  level?: number;
  text?: string;
  items?: string[];
  media_id?: string;
  label?: string;
  url?: string;
}

export type BlockAction =
  | { type: "add"; blockType: BlockType; key: string; at?: number }
  | { type: "remove"; key: string }
  | { type: "move"; key: string; delta: -1 | 1 }
  | { type: "update"; key: string; patch: Partial<Omit<EditorBlock, "key" | "type">> }
  | { type: "reset"; blocks: EditorBlock[] };

export function newBlock(type: BlockType, key: string): EditorBlock {
  return { key, type, level: 2, text: "", items: type === "list" ? [""] : [], media_id: null, image: null, label: "", url: "" };
}

export function blocksReducer(state: EditorBlock[], action: BlockAction): EditorBlock[] {
  switch (action.type) {
    case "add": {
      const at = action.at === undefined ? state.length : Math.max(0, Math.min(action.at, state.length));
      return [...state.slice(0, at), newBlock(action.blockType, action.key), ...state.slice(at)];
    }
    case "remove":
      return state.filter((b) => b.key !== action.key);
    case "move": {
      const i = state.findIndex((b) => b.key === action.key);
      const j = i + action.delta;
      if (i < 0 || j < 0 || j >= state.length) return state;
      const next = state.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    }
    case "update":
      return state.map((b) => (b.key === action.key ? { ...b, ...action.patch } : b));
    case "reset":
      return action.blocks;
  }
}

function isBlockType(v: unknown): v is BlockType {
  return typeof v === "string" && (BLOCK_TYPES as readonly string[]).includes(v);
}

export function blocksFromApi(raw: unknown, keyPrefix: string): EditorBlock[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((b) => b && isBlockType(b.type)).map((b, i) => ({
    ...newBlock(b.type, `${keyPrefix}-${i}`),
    level: typeof b.level === "number" ? b.level : 2,
    text: b.text ?? "",
    items: Array.isArray(b.items) ? b.items : [],
    media_id: b.media_id ?? null,
    image: b.image ?? null,
    label: b.label ?? "",
    url: b.url ?? "",
  }));
}

// blockToDTO sends only the fields that belong to a block's type; the API rejects free HTML and
// validates each block itself.
export function blockToDTO(b: EditorBlock): BlockDTO {
  switch (b.type) {
    case "heading":
      return { type: b.type, level: b.level, text: b.text.trim() };
    case "paragraph":
    case "quote":
      return { type: b.type, text: b.text.trim() };
    case "list":
      return { type: b.type, items: b.items.map((s) => s.trim()).filter(Boolean) };
    case "image":
      return b.media_id ? { type: b.type, media_id: b.media_id } : { type: b.type };
    case "cta":
      return { type: b.type, label: b.label.trim(), url: b.url.trim() };
  }
}
