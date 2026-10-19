import { describe, expect, it } from "vitest";
import { isEditingKeystroke, shouldDeferUserAgentReload } from "./user-agent-reload-guard";

describe("视口身份切换后的自动刷新护栏", () => {
  it("页面空闲时可以刷新", () => {
    expect(shouldDeferUserAgentReload({ controlled: false, picking: false, loading: false })).toBe(false);
  });

  it.each([
    ["Agent 浏览器控制中", { controlled: true, picking: false, loading: false }],
    ["元素选择中", { controlled: false, picking: true, loading: false }],
    ["页面仍在加载", { controlled: false, picking: false, loading: true }],
  ])("%s时延后刷新", (_label, state) => {
    expect(shouldDeferUserAgentReload(state)).toBe(true);
  });
});

describe("键盘编辑判定（覆盖 iframe 内输入）", () => {
  it.each([
    [{ type: "keyDown", key: "a" }],
    [{ type: "keyDown", key: "中" }],
    [{ type: "keyDown", key: " " }],
    [{ type: "keyDown", key: "Backspace" }],
    [{ type: "keyDown", key: "Delete" }],
    [{ type: "keyDown", key: "Enter" }],
    [{ type: "keyDown", key: "v", control: true }],
    [{ type: "keyDown", key: "x", meta: true }],
  ])("会改动内容的按键：%j", (input) => {
    expect(isEditingKeystroke(input)).toBe(true);
  });

  it.each([
    [{ type: "keyUp", key: "a" }],
    [{ type: "char", key: "a" }],
    [{ type: "keyDown", key: "ArrowDown" }],
    [{ type: "keyDown", key: "Tab" }],
    [{ type: "keyDown", key: "PageDown" }],
    [{ type: "keyDown", key: "Shift" }],
    [{ type: "keyDown", key: "c", control: true }],
    [{ type: "keyDown", key: "a", control: true }],
    [{ type: "keyDown", key: "f", alt: true }],
  ])("不改动内容的按键不算：%j", (input) => {
    expect(isEditingKeystroke(input)).toBe(false);
  });
});
