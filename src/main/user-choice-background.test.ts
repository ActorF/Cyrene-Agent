import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handle: vi.fn(), sendMail: vi.fn(), deleteDraft: vi.fn(),
  card: vi.fn(), dismiss: vi.fn(),
  downloadAttachment: vi.fn(), showSaveDialog: vi.fn(), writeFile: vi.fn(),
}));
vi.mock("electron", () => ({ ipcMain: { handle: mocks.handle }, dialog: { showSaveDialog: mocks.showSaveDialog } }));
vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, promises: { ...actual.promises, writeFile: mocks.writeFile } };
});
vi.mock("./timeout-manager", () => ({ getTimeoutSettings: () => ({ userChoiceTimeout: 60_000 }) }));
vi.mock("./toast/toast-events", () => ({ toastEvents: {
  publishChoiceCard: mocks.card, publishChoiceDismiss: mocks.dismiss,
} }));
vi.mock("./logger", () => ({ logger: { info: vi.fn(), warn: vi.fn() }, LogTag: {} }));
vi.mock("nodemailer", () => ({ default: { createTransport: () => ({ sendMail: mocks.sendMail, close: vi.fn() }) } }));
vi.mock("./email/gmail-service", () => ({ GmailService: class {}, GmailServiceError: class extends Error {} }));

import { registerChoiceIpc, requestUserChoice, setChoiceCardSender } from "./user-choice";
import { registerEmailTools, setEmailConfig } from "./orchestrator/tools/email-tools";
import { registerGmailTools } from "./orchestrator/tools/gmail-tools";
import { toolRegistry } from "./orchestrator/tools/registry/tool-registry";
import { executeToolDefinition } from "./orchestrator/tools/registry/tool-executor";

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  registerChoiceIpc();
  setEmailConfig(() => true, () => "smtp.invalid", () => 465, () => true,
    () => "sender@example.invalid", () => "fixture", () => "fixture");
  registerEmailTools();
  registerGmailTools({
    getDraft: vi.fn(async () => ({ id: "draft-1", message: { subject: "fixture", to: ["to@example.invalid"] } })),
    deleteDraft: mocks.deleteDraft,
    downloadAttachment: mocks.downloadAttachment,
  } as never);
  mocks.sendMail.mockResolvedValue({ accepted: ["to@example.invalid"], messageId: "fixture" });
  mocks.downloadAttachment.mockResolvedValue({ filename: "fixture.txt", mimeType: "text/plain", bytes: Buffer.from("fixture") });
  mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: "mock-save-path" });
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

it.each(["normal", "allow_all"] as const)("blocks headless attachment downloads before network, dialog and file writes (%s)", async permissionMode => {
  const result = await executeToolDefinition(toolRegistry.getById("gmail_download_attachment")!,
    { messageId: "message-1", attachmentId: "attachment-1" },
    { userQuery: "fixture", allowUserInteraction: false, permissionMode });
  expect(result).toMatchObject({ status: "failed", errorCode: "USER_CHOICE_UNAVAILABLE", retryable: false, effectState: "not_applied" });
  expect(mocks.downloadAttachment).not.toHaveBeenCalled();
  expect(mocks.showSaveDialog).not.toHaveBeenCalled();
  expect(mocks.writeFile).not.toHaveBeenCalled();
});

it.each([false, true])("preserves foreground attachment save/cancel behavior (cancelled=%s)", async canceled => {
  mocks.showSaveDialog.mockResolvedValue({ canceled, filePath: "mock-save-path" });
  const result = await executeToolDefinition(toolRegistry.getById("gmail_download_attachment")!,
    { messageId: "message-1", attachmentId: "attachment-1" }, { userQuery: "fixture" });
  expect(result.status).toBe("succeeded");
  expect(mocks.downloadAttachment).toHaveBeenCalledWith("message-1", "attachment-1");
  expect(mocks.showSaveDialog).toHaveBeenCalledWith({ defaultPath: "fixture.txt", title: "保存 Gmail 附件" });
  if (canceled) expect(mocks.writeFile).not.toHaveBeenCalled();
  else expect(mocks.writeFile).toHaveBeenCalledWith("mock-save-path", Buffer.from("fixture"), { flag: "w" });
});

it("rejects headless choices without timers, cards, toasts or accepting a dangerous default", async () => {
  const sender = vi.fn();
  setChoiceCardSender(sender);
  await expect(requestUserChoice("fixture", [{ label: "Send", value: "send" }], "send", {
    allowPrompt: false, runId: "background",
  })).rejects.toMatchObject({ code: "USER_CHOICE_UNAVAILABLE" });
  expect(vi.getTimerCount()).toBe(0);
  expect(sender).not.toHaveBeenCalled();
  expect(mocks.card).not.toHaveBeenCalled();
  expect(mocks.dismiss).not.toHaveBeenCalled();
});

const cases = [
  { id: "send_email", args: { to: ["to@example.invalid"], subject: "fixture", body: "fixture" }, answer: "send" },
  { id: "gmail_manage_drafts", args: { operation: "delete", draftId: "draft-1" }, answer: "delete" },
];

it.each(cases)("$id cannot wait for invisible approval or perform a mutation in allow_all background runs", async ({ id, args }) => {
  const sender = vi.fn();
  setChoiceCardSender(sender);
  const result = await executeToolDefinition(toolRegistry.getById(id)!, args, {
    userQuery: "fixture", runId: "background", allowUserInteraction: false, permissionMode: "allow_all",
  });
  expect(result).toMatchObject({ status: "failed", errorCode: "USER_CHOICE_UNAVAILABLE", retryable: false, effectState: "not_applied" });
  expect(sender).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
  expect(mocks.sendMail).not.toHaveBeenCalled();
  expect(mocks.deleteDraft).not.toHaveBeenCalled();
});

it.each(cases)("$id keeps foreground confirmation available alongside a rejected background choice", async ({ id, args, answer }) => {
  const sender = vi.fn();
  setChoiceCardSender(sender);
  const pending = executeToolDefinition(toolRegistry.getById(id)!, args, { userQuery: "fixture", runId: "foreground" });
  await vi.advanceTimersByTimeAsync(0);
  expect(sender).toHaveBeenCalledTimes(1);
  expect(mocks.sendMail).not.toHaveBeenCalled();
  expect(mocks.deleteDraft).not.toHaveBeenCalled();
  await expect(requestUserChoice("background", [], "send", { allowPrompt: false })).rejects.toThrow();
  expect(vi.getTimerCount()).toBe(1);
  const handler = mocks.handle.mock.calls.at(-1)![1];
  handler({}, { id: sender.mock.calls[0][0].id, value: answer });
  expect((await pending).status).toBe("succeeded");
  expect(id === "send_email" ? mocks.sendMail : mocks.deleteDraft).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
