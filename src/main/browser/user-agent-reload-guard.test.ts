import { describe, expect, it } from "vitest";
import { shouldDeferUserAgentReload } from "./user-agent-reload-guard";

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
