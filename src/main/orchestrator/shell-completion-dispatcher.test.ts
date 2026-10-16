import { afterEach, describe, expect, it, vi } from "vitest";
import { ShellCompletionDispatcher, type ShellCompletion } from "./shell-completion-dispatcher";

const completion = (conversationId = "original", jobId = "job-1", signal?: AbortSignal): ShellCompletion => ({
  conversationId, sourceRunId: "source-run", signal,
  snapshot: { jobId, pid: null, status: "exited", exitCode: 0, reason: null, totalBytes: 4,
    logFile: "fixture.log", command: "fixture", shell: "cmd", startedAt: "2026-01-01T00:00:00Z", durationMs: 5, tail: "done" },
});
const dispatchers: ShellCompletionDispatcher[] = [];
function setup(busy = false) {
  const deps = { append: vi.fn(async () => {}), isBusy: vi.fn(() => busy), wake: vi.fn(async (_id: string, _job: string) => {}), onError: vi.fn() };
  const dispatcher = new ShellCompletionDispatcher(deps);
  dispatchers.push(dispatcher);
  return { dispatcher, deps };
}
afterEach(async () => { for (const dispatcher of dispatchers.splice(0)) await dispatcher.dispose(); vi.useRealTimers(); });

describe("shell completion inbox", () => {
  it("persists once and wakes the originating idle conversation without a waiter", async () => {
    const { dispatcher, deps } = setup();
    deps.wake.mockImplementation(async id => { await dispatcher.take(id); });
    dispatcher.enqueue(completion());
    dispatcher.enqueue(completion());
    await expect.poll(() => deps.wake.mock.calls.length).toBe(1);
    expect(deps.wake).toHaveBeenCalledWith("original", "job-1");
    expect(deps.append).toHaveBeenCalledTimes(1);
    expect(deps.append.mock.invocationCallOrder[0]).toBeLessThan(deps.wake.mock.invocationCallOrder[0]);
    expect(await dispatcher.take("original")).toEqual([]);
  });

  it("busy conversations consume durable internal facts once; other conversations cannot consume them", async () => {
    const { dispatcher, deps } = setup(true);
    dispatcher.enqueue(completion());
    await expect.poll(() => deps.append.mock.calls.length).toBe(1);
    expect(deps.wake).not.toHaveBeenCalled();
    expect(await dispatcher.take("different")).toEqual([]);
    const messages = await dispatcher.take("original");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ visibility: "internal", content: expect.stringContaining('"exitCode":0') });
    expect(await dispatcher.take("original")).toEqual([]);
  });

  it("kicks a late completion after a busy run releases its guard", async () => {
    const { dispatcher, deps } = setup(true);
    dispatcher.enqueue(completion());
    await expect.poll(() => deps.append.mock.calls.length).toBe(1);
    deps.isBusy.mockReturnValue(false);
    dispatcher.kick("original");
    await expect.poll(() => deps.wake.mock.calls.length).toBe(1);
  });

  it("cancelled owners keep their result but never automatically wake", async () => {
    const { dispatcher, deps } = setup();
    const controller = new AbortController();
    dispatcher.enqueue(completion("original", "job-1", controller.signal));
    controller.abort();
    await expect.poll(() => deps.append.mock.calls.length).toBe(1);
    expect(deps.wake).not.toHaveBeenCalled();
  });

  it("retains failed persistence and retries without dispatching an uncommitted fact", async () => {
    vi.useFakeTimers();
    const { dispatcher, deps } = setup();
    deps.append.mockRejectedValueOnce(new Error("disk unavailable"));
    dispatcher.enqueue(completion());
    await vi.advanceTimersByTimeAsync(1);
    expect(deps.wake).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(deps.append).toHaveBeenCalledTimes(2);
    expect(deps.wake).toHaveBeenCalledTimes(1);
  });

  it("cancelling the conversation also suppresses jobs launched by older runs, until an explicit new run", async () => {
    const { dispatcher, deps } = setup();
    dispatcher.suppressWake("original");
    dispatcher.enqueue(completion());
    await expect.poll(() => deps.append.mock.calls.length).toBe(1);
    expect(deps.wake).not.toHaveBeenCalled();
    dispatcher.resume("original");
    dispatcher.enqueue(completion("original", "new-job"));
    await expect.poll(() => deps.wake.mock.calls.length).toBe(1);
    expect(deps.wake).toHaveBeenCalledWith("original", "new-job");
  });

  it("shutdown drains an in-flight write and suppresses wake/retry", async () => {
    const { dispatcher, deps } = setup();
    let finish!: () => void;
    deps.append.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    dispatcher.enqueue(completion());
    await expect.poll(() => deps.append.mock.calls.length).toBe(1);
    let disposed = false;
    const stopping = dispatcher.dispose().then(() => { disposed = true; });
    await Promise.resolve();
    expect(disposed).toBe(false);
    finish();
    await stopping;
    expect(deps.wake).not.toHaveBeenCalled();
  });
});
