import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handle: vi.fn(), sendMail: vi.fn(), deleteDraft: vi.fn(),
  card: vi.fn(), dismiss: vi.fn(),
}));
vi.mock("electron", () => ({ ipcMain: { handle: mocks.handle }, dialog: {} }));
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
  } as never);
  mocks.sendMail.mockResolvedValue({ accepted: ["to@example.invalid"], messageId: "fixture" });
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

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
