import { app } from "electron";
import { IPC } from "../../shared/ipc-channels";
import type { IpcScope } from "../application/ipc-scope";
import { openStorageFolder } from "../chats/chats-store";

/**
 * 通用设置「数据目录」：只读返回路径 + 在系统文件管理器中打开。
 * 打开动作复用聊天存储的 openStorageFolder；shell.openPath 失败时返回错误文本而不是抛异常，
 * 这里透传为 { ok: false, error }，渲染端据此提示，避免按钮静默无效。
 */
export function registerDataDirIpc(ipc: Pick<IpcScope, "handle">): void {
  ipc.handle(IPC.SETTINGS_GET_DATA_DIR, () => app.getPath("userData"));
  ipc.handle(IPC.SETTINGS_OPEN_DATA_DIR, async () => {
    const error = await openStorageFolder();
    return error ? { ok: false, error } : { ok: true };
  });
}
