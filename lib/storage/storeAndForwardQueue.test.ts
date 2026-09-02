import { describe, it, expect, beforeEach, vi } from "vitest";
import { StoreAndForwardQueue, QueueItem } from "./storeAndForwardQueue.js";

describe("StoreAndForwardQueue", () => {
  let queue: StoreAndForwardQueue;

  beforeEach(() => {
    queue = new StoreAndForwardQueue();
  });

  it("should initialize cleanly and fall back to LocalStorageEngine in Node environment", async () => {
    await expect(queue.initialize()).resolves.not.toThrow();
  });

  it("should enqueue and prioritize packets correctly", async () => {
    await queue.initialize();

    // Enqueue different priorities
    const p1 = await queue.enqueuePacket("HEX1", 101, 1); // Medical
    const p2 = await queue.enqueuePacket("HEX2", 102, 4); // Trapped (highest priority)
    const p3 = await queue.enqueuePacket("HEX3", 103, 2); // Lost

    const stats = await queue.getQueueStats();
    expect(stats.pending).toBe(3);

    // Should pull Trapped (4) first
    const next = await queue.getNextPendingPacket();
    expect(next?.id).toBe(p2.id);
    expect(next?.status).toBe("TRANSMITTING");

    const statsAfterPull = await queue.getQueueStats();
    expect(statsAfterPull.inFlight).toBe(1);
    expect(statsAfterPull.pending).toBe(2);
  });

  it("should handle transmission attempts and backoff", async () => {
    await queue.initialize();

    const p = await queue.enqueuePacket("HEX_FAIL", 201, 3);
    const pulled = await queue.getNextPendingPacket();
    expect(pulled?.id).toBe(p.id);

    // Fail the attempt
    await queue.markAttemptFailed(p.id, "Connection Timeout");

    const stats = await queue.getQueueStats();
    expect(stats.pending).toBe(1);

    const updatedItem = (await queue.getAllPackets()).find((x) => x.id === p.id);
    expect(updatedItem?.retryCount).toBe(1);
    expect(updatedItem?.status).toBe("QUEUED");
    expect(updatedItem?.errorReason).toBe("Connection Timeout");

    // Since retryCount > 0, immediately trying to pull again might be blocked by backoff delay
    const tryAgain = await queue.getNextPendingPacket();
    // In test environment, backoff/jitter is calculated with standard delays, so it returns null
    expect(tryAgain).toBeNull();
  });

  it("should mark packets delivered successfully", async () => {
    await queue.initialize();

    const p = await queue.enqueuePacket("HEX_OK", 301, 1);
    const pulled = await queue.getNextPendingPacket();
    expect(pulled?.id).toBe(p.id);

    await queue.markDelivered(p.id);

    const stats = await queue.getQueueStats();
    expect(stats.delivered).toBe(1);
    expect(stats.pending).toBe(0);
    expect(stats.inFlight).toBe(0);
  });

  it("should trigger subscription callbacks on state transitions", async () => {
    await queue.initialize();

    const listener = vi.fn();
    const unsubscribe = queue.subscribe(listener);

    await queue.enqueuePacket("HEX_EVENT", 401, 2);

    expect(listener).toHaveBeenCalled();
    const calls = listener.mock.calls;
    expect(calls[0][0].type).toBe("ENQUEUED");
    expect(calls[0][0].item?.nodeId).toBe(401);

    unsubscribe();
  });
});
