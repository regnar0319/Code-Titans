import { FramePayload, serializeFrame, frameToHex } from '../protocol/frame';

export type PacketStatus = 'QUEUED' | 'TRANSMITTING' | 'DELIVERED' | 'FAILED';

export interface QueueItem {
    id: string; // UUID or timestamp-based identifier
    rawHex: string; // 32-char hex representation
    payload: FramePayload; // Original payload
    timestamp: number; // Unix milliseconds when queued
    retryCount: number; // Number of transmission attempts
    status: PacketStatus;
}

const STORAGE_KEY = 'laksha_emergency_queue';
const MAX_RETRIES = 5;

/**
 * Gracefully detect storage availability
 */
function getStorage(): Storage | null {
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem('_test', '1');
            localStorage.removeItem('_test');
            return localStorage;
        }
    } catch (e) {
        // localStorage unavailable (private mode, quota exceeded, etc.)
    }
    return null;
}

/**
 * Load all queued packets from storage
 */
function loadQueue(): QueueItem[] {
    const storage = getStorage();
    if (!storage) return [];

    try {
        const data = storage.getItem(STORAGE_KEY);
        return data ? JSON.parse(data) : [];
    } catch (error) {
        console.error('Failed to load queue:', error);
        return [];
    }
}

/**
 * Persist queue to storage
 */
function saveQueue(queue: QueueItem[]): void {
    const storage = getStorage();
    if (!storage) {
        console.warn('localStorage unavailable, queue not persisted');
        return;
    }

    try {
        storage.setItem(STORAGE_KEY, JSON.stringify(queue));
        console.debug(`Persisted ${queue.length} queue items to localStorage`);
    } catch (error) {
        console.error('Failed to save queue:', error);
    }
}

/**
 * Generate unique ID for queue item
 */
function generateId(): string {
    return `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Enqueue an emergency packet
 * @param payload Emergency message
 * @returns Queue item with assigned ID
 */
export function enqueueEmergencyPacket(payload: FramePayload): QueueItem {
    const serialized = serializeFrame(payload);
    const rawHex = frameToHex(serialized);

    const item: QueueItem = {
        id: generateId(),
        rawHex,
        payload,
        timestamp: Date.now(),
        retryCount: 0,
        status: 'QUEUED',
    };

    const queue = loadQueue();
    queue.push(item);
    saveQueue(queue);

    return item;
}

/**
 * Get all pending packets awaiting transmission
 */
export function peekQueue(): QueueItem[] {
    const queue = loadQueue();
    return queue.filter((item) => item.status === 'QUEUED' || item.status === 'TRANSMITTING');
}

/**
 * Mark packet as successfully delivered
 */
export function markPacketDelivered(id: string): void {
    const queue = loadQueue();
    const item = queue.find((q) => q.id === id);
    if (item) {
        item.status = 'DELIVERED';
        saveQueue(queue);
    }
}

/**
 * Mark packet as failed transmission
 * @returns true if item exists and retry limit not exceeded
 */
export function markPacketFailed(id: string): boolean {
    const queue = loadQueue();
    const item = queue.find((q) => q.id === id);
    if (!item) return false;

    item.retryCount++;
    if (item.retryCount >= MAX_RETRIES) {
        item.status = 'FAILED';
    } else {
        item.status = 'QUEUED'; // Re-queue for retry
    }
    saveQueue(queue);
    return item.retryCount < MAX_RETRIES;
}

/**
 * Get queue statistics
 */
export function getQueueStats() {
    const queue = loadQueue();
    return {
        total: queue.length,
        queued: queue.filter((q) => q.status === 'QUEUED').length,
        transmitting: queue.filter((q) => q.status === 'TRANSMITTING').length,
        delivered: queue.filter((q) => q.status === 'DELIVERED').length,
        failed: queue.filter((q) => q.status === 'FAILED').length,
    };
}

/**
 * Clear all delivered/failed packets from queue
 */
export function clearCompletedPackets(): number {
    let queue = loadQueue();
    const before = queue.length;
    queue = queue.filter((q) => q.status === 'QUEUED' || q.status === 'TRANSMITTING');
    saveQueue(queue);
    return before - queue.length;
}
