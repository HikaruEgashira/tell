import { expect, test } from "bun:test";
import { shouldCopy } from "./clipboard";

test("フェンス付きコードブロックがあればコピーする", () => {
  expect(shouldCopy("説明\n```ts\nconst x = 1;\n```\n")).toBe(true);
});

test("インラインコードだけならコピーしない", () => {
  expect(shouldCopy("`const x = 1` を使う")).toBe(false);
});

test("コードが無ければコピーしない", () => {
  expect(shouldCopy("pong")).toBe(false);
});
