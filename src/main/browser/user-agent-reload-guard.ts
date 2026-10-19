import type { WebContents } from "electron";

/**
 * 视口身份切换后的自动刷新护栏（#243 评审）：页面正被使用时不刷新，避免丢失用户输入或打断 Agent 操作。
 *
 * 「用户是否输入过」只认真实的用户输入事件（isTrusted）：搜索页自动聚焦输入框、脚本回填搜索词
 * 都不算，否则百度、必应这类本功能针对的页面会永远不切换。监听运行在独立的隔离世界里，
 * 页面脚本读不到也改不了这个标记；页面重新加载或跳转后自然清零。
 */
export const USER_INPUT_WORLD_ID = 1047;

const WATCH_USER_INPUT = `(() => {
  if (window.__cyreneInputWatch) return;
  window.__cyreneInputWatch = true;
  window.__cyreneUserEdited = false;
  const mark = (event) => { if (event.isTrusted) window.__cyreneUserEdited = true; };
  document.addEventListener("input", mark, true);
  document.addEventListener("change", mark, true);
})()`;

const READ_USER_INPUT = "window.__cyreneUserEdited === true";
const PROBE_TIMEOUT_MS = 500;

/** 在页面 DOM 就绪时调用，开始记录真实用户输入。 */
export function watchUserInput(contents: WebContents): void {
  if (contents.isDestroyed()) return;
  void contents.executeJavaScriptInIsolatedWorld(USER_INPUT_WORLD_ID, [{ code: WATCH_USER_INPUT }]).catch(() => {});
}

/** 页面里是否有用户输入过的内容。查询失败或超时按「有」处理，宁可不刷新也不丢输入。 */
export async function pageHasUserInput(contents: WebContents): Promise<boolean> {
  if (contents.isDestroyed()) return true;
  const probe = contents.executeJavaScriptInIsolatedWorld(USER_INPUT_WORLD_ID, [{ code: READ_USER_INPUT }])
    .then((value) => value === true, () => true);
  const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(true), PROBE_TIMEOUT_MS));
  return Promise.race([probe, timeout]);
}

export interface UserAgentReloadState {
  /** Agent 浏览器控制正持有该标签。 */
  controlled: boolean;
  /** 元素选择器正在该标签上运行。 */
  picking: boolean;
  /** 页面仍在加载。 */
  loading: boolean;
}

/** 这些情况下先不刷新，保留待刷新标记，交给下一次宽度变化或切换标签时再判断。 */
export function shouldDeferUserAgentReload(state: UserAgentReloadState): boolean {
  return state.controlled || state.picking || state.loading;
}
