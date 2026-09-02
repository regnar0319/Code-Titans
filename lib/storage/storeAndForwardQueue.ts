/**
 * Store-and-Forward Emergency Queue for "Laksha"
 * Production-grade offline-first queue with auto-lock release, exponential backoff,
 * priority dequeuing, and seamless IndexedDB to localStorage/in-memory fallback.
 */
function calculateStringHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // Convert to 32-bit signed integer
  }
  return hash;
}

export interface QueueItem {
  id: string;
  rawHex: string; // 32-character / 16-byte encoded LoRa payload
  nodeId: number;
  triageType: number; // 1=Medical, 2=Lost, 3=Avalanche, 4=Trapped, 0=None
  retryCount: number; // Starts at 0
  maxRetries: number; // Default: 10
  lastAttemptAt: number | null;
  status: 'QUEUED' | 'TRANSMITTING' | 'DELIVERED' | 'FAILED';
  createdAt: number;
  errorReason?: string | null;
}

export interface QueueStats {
  pending: number;      // 'QUEUED' and retryCount < maxRetries (or expired 'TRANSMITTING')
  inFlight: number;     // Active 'TRANSMITTING' locks
  delivered: number;    // 'DELIVERED'
  failed: number;       // 'FAILED' or retryCount >= maxRetries
}

export type QueueUpdateListener = (event: { type: string; item?: QueueItem; stats: QueueStats }) => void;

import { hashCode } from "./hashUtils.js";
const DB_NAME = 'laksha_offline_db';
const DB_VERSION = 1;
const STORE_NAME = 'outbound_queue';
const TRANSMISSION_LOCK_TIMEOUT_MS = 15000; // 15 seconds lock duration
const BACKOFF_BASE_DELAY_MS = 5000; // 5 seconds base delay
const BACKOFF_MAX_DELAY_MS = 300000; // 5 minutes max delay

/**
 * Interface representing the underlying storage implementation.
 */
interface StorageEngine {
  init(): Promise<void>;
  put(item: QueueItem): Promise<void>;
  get(id: string): Promise<QueueItem | null>;
  getAll(): Promise<QueueItem[]>;
  delete(id: string): Promise<void>;
}

/**
 * Robust IndexedDB storage implementation.
 */
class IndexedDBEngine implements StorageEngine {
  private db: IDBDatabase | null = null;

  init(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB is not supported in this environment'));
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('status', 'status', { unique: false });
          store.createIndex('priority', 'triageType', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onerror = () => {
        reject(request.error || new Error('Failed to open IndexedDB'));
      };
    });
  }

  private getStore(mode: IDBTransactionMode): IDBObjectStore {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    const transaction = this.db.transaction(STORE_NAME, mode);
    return transaction.objectStore(STORE_NAME);
  }

  put(item: QueueItem): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const store = this.getStore('readwrite');
        const request = store.put(item);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      } catch (err) {
        reject(err);
      }
    });
  }

  get(id: string): Promise<QueueItem | null> {
    return new Promise((resolve, reject) => {
      try {
        const store = this.getStore('readonly');
        const request = store.get(id);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      } catch (err) {
        reject(err);
      }
    });
  }

  getAll(): Promise<QueueItem[]> {
    return new Promise((resolve, reject) => {
      try {
        const store = this.getStore('readonly');
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      } catch (err) {
        reject(err);
      }
    });
  }

  delete(id: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const store = this.getStore('readwrite');
        const request = store.delete(id);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      } catch (err) {
        reject(err);
      }
    });
  }
}

/**
 * LocalStorage storage implementation with in-memory fallback.
 */
class LocalStorageEngine implements StorageEngine {
  private memoryCache = new Map<string, QueueItem>();
  private prefix = 'laksha_sf_';

  async init(): Promise<void> {
    try {
      if (typeof localStorage === 'undefined') {
        return;
      }
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(this.prefix)) {
          const itemJson = localStorage.getItem(key);
          if (itemJson) {
            try {
              const item = JSON.parse(itemJson) as QueueItem;
              if (item && item.id) {
                this.memoryCache.set(item.id, item);
              }
            } catch (parseErr) {
              console.warn(`Failed to parse localStorage item for key ${key}:`, parseErr);
              // Optionally remove corrupted entry to heal storage
              localStorage.removeItem(key);
            }
          }
        }
      }
    } catch {
      // Degrade gracefully to pure in-memory cache if localStorage is blocked
    }
  }

  async put(item: QueueItem): Promise<void> {
    this.memoryCache.set(item.id, item);
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(this.prefix + item.id, JSON.stringify(item));
      }
    } catch {
      // Ignore write errors (e.g. quota exceeded)
    }
  }

  async get(id: string): Promise<QueueItem | null> {
    return this.memoryCache.get(id) || null;
  }

  async getAll(): Promise<QueueItem[]> {
    return Array.from(this.memoryCache.values());
  }

  async delete(id: string): Promise<void> {
    this.memoryCache.delete(id);
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(this.prefix + id);
      }
    } catch {
      // Ignore errors
    }
  }
}

/**
 * Production-grade Store-and-Forward emergency queue for Laksha.
 */
export class StoreAndForwardQueue {
  private engine!: StorageEngine;
  private listeners = new Set<QueueUpdateListener>();
  private initialized = false;

  constructor() {
    this.engine = new IndexedDBEngine();
  }

  /**
   * Initializes the storage engine, automatically falling back to localStorage if IndexedDB fails.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    try {
      await this.engine.init();
    } catch (err) {
      console.warn('IndexedDB initialization failed. Falling back to LocalStorage/Memory engine:', err);
      this.engine = new LocalStorageEngine();
      await this.engine.init();
    }
    this.initialized = true;
  }

  /**
   * Subscribes to queue update events.
   */
  subscribe(listener: QueueUpdateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private async notify(type: string, item?: QueueItem): Promise<void> {
    const stats = await this.getQueueStats();
    this.listeners.forEach((listener) => {
      try {
        listener({ type, item, stats });
      } catch (err) {
        console.error('Error in QueueUpdateListener callback:', err);
      }
    });
  }

  /**
   * Generates a simple cryptographically secure or pseudo-random unique ID.
   */
  private generateId(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.floor(Math.random() * 1000000).toString(16)}`;
  }

  /**
   * Enqueues a new packet into the store-and-forward queue.
   */
  async enqueuePacket(rawHex: string, nodeId: number, triageType: number): Promise<QueueItem> {
    await this.initialize();
    const item: QueueItem = {
      id: this.generateId(),
      rawHex: rawHex.toUpperCase(),
      nodeId,
      triageType,
      retryCount: 0,
      maxRetries: 10,
      lastAttemptAt: null,
      status: 'QUEUED',
      createdAt: Date.now(),
    };
    await this.engine.put(item);
    await this.notify('ENQUEUED', item);
    return item;
  }

  /**
   * Evaluates if a transmitting lock on a packet has expired (e.g. unacknowledged over 15 seconds).
   */
  private isLockExpired(item: QueueItem, now: number): boolean {
    if (item.status !== 'TRANSMITTING' || !item.lastAttemptAt) {
      return false;
    }
    return now - item.lastAttemptAt > TRANSMISSION_LOCK_TIMEOUT_MS;
  }

  /**
   * Evaluates if the exponential backoff period has been respected for a retry.
   */
  private isBackoffRespected(item: QueueItem, now: number): boolean {
    if (item.retryCount === 0 || !item.lastAttemptAt) {
      return true;
    }
    const delay = Math.min(
      BACKOFF_BASE_DELAY_MS * Math.pow(2, item.retryCount - 1),
      BACKOFF_MAX_DELAY_MS
    );
    // Use a deterministic pseudo-random jitter derived from ID and retryCount to avoid fluctuating checks
    const jitter = Math.abs(calculateStringHash(item.id + String(item.retryCount))) % 2000;
    return now - item.lastAttemptAt >= delay + jitter;
  }

  /**
   * Pulls the next eligible pending packet based on priority (triageType desc, then createdAt asc).
   * Also releases expired transmitting locks back to 'QUEUED' status.
   */
  async getNextPendingPacket(): Promise<QueueItem | null> {
    await this.initialize();
    const all = await this.engine.getAll();
    const now = Date.now();

    const eligible: QueueItem[] = [];

    for (const item of all) {
      // Re-evaluate expired TRANSMITTING locks
      if (item.status === 'TRANSMITTING' && this.isLockExpired(item, now)) {
        item.status = 'QUEUED';
        await this.engine.put(item);
        await this.notify('LOCK_RELEASED', item);
      }

      if (item.retryCount >= item.maxRetries) {
        if (item.status !== 'FAILED') {
          item.status = 'FAILED';
          item.errorReason = 'Max retries exceeded';
          await this.engine.put(item);
          await this.notify('MAX_RETRIES_EXCEEDED', item);
        }
        continue;
      }

      if (item.status === 'QUEUED' && this.isBackoffRespected(item, now)) {
        eligible.push(item);
      }
    }

    if (eligible.length === 0) {
      return null;
    }

    // Sort by triageType descending, then by createdAt ascending (FIFO)
    eligible.sort((a, b) => {
      if (b.triageType !== a.triageType) {
        return b.triageType - a.triageType;
      }
      return a.createdAt - b.createdAt;
    });

    const selected = eligible[0];
    selected.status = 'TRANSMITTING';
    selected.lastAttemptAt = now;
    await this.engine.put(selected);
    await this.notify('TRANSMISSION_STARTED', selected);

    return selected;
  }

  /**
   * Marks a packet as successfully delivered.
   */
  async markDelivered(packetId: string): Promise<void> {
    await this.initialize();
    const item = await this.engine.get(packetId);
    if (!item) {
      throw new Error(`Packet with ID ${packetId} not found`);
    }
    item.status = 'DELIVERED';
    item.errorReason = null;
    await this.engine.put(item);
    await this.notify('DELIVERED', item);
  }

  /**
   * Marks a packet transmission attempt as failed, applying retry tracking.
   */
  async markAttemptFailed(packetId: string, errorReason: string): Promise<void> {
    await this.initialize();
    const item = await this.engine.get(packetId);
    if (!item) {
      throw new Error(`Packet with ID ${packetId} not found`);
    }

    item.retryCount += 1;
    item.errorReason = errorReason;

    if (item.retryCount >= item.maxRetries) {
      item.status = 'FAILED';
    } else {
      item.status = 'QUEUED';
    }

    await this.engine.put(item);
    await this.notify('ATTEMPT_FAILED', item);
  }

  /**
   * Retrieves all packet records currently in local storage.
   */
  async getAllPackets(): Promise<QueueItem[]> {
    await this.initialize();
    return this.engine.getAll();
  }

  /**
   * Purges successfully delivered or failed packets older than a retention threshold.
   */
  async purgeResolvedPackets(retentionHours: number): Promise<number> {
    await this.initialize();
    const all = await this.engine.getAll();
    const cutoff = Date.now() - retentionHours * 60 * 60 * 1000;
    let count = 0;

    for (const item of all) {
      if ((item.status === 'DELIVERED' || item.status === 'FAILED') && item.createdAt < cutoff) {
        await this.engine.delete(item.id);
        count++;
      }
    }

    if (count > 0) {
      await this.notify('PURGED');
    }
    return count;
  }

  /**
   * Computes reactive statistics of the queue status.
   */
  async getQueueStats(): Promise<QueueStats> {
    await this.initialize();
    const all = await this.engine.getAll();
    const now = Date.now();

    let pending = 0;
    let inFlight = 0;
    let delivered = 0;
    let failed = 0;

    for (const item of all) {
      if (item.status === 'DELIVERED') {
        delivered++;
      } else if (item.status === 'FAILED' || item.retryCount >= item.maxRetries) {
        failed++;
      } else if (item.status === 'TRANSMITTING' && !this.isLockExpired(item, now)) {
        inFlight++;
      } else {
        pending++;
      }
    }

    return { pending, inFlight, delivered, failed };
  }
}

/**
 * Runs a complete demonstration lifecycle of the Store and Forward Queue.
 */
export async function runQueueDemo(): Promise<void> {
  console.log('=== Starting Store-and-Forward Emergency Queue Demo ===');
  const queue = new StoreAndForwardQueue();

  // Subscribe to updates
  const unsubscribe = queue.subscribe((event) => {
    console.log(`[Event: ${event.type}]`, event.item ? `Packet: ${event.item.id} (${event.item.status})` : 'Queue Update', `Stats:`, event.stats);
  });

  // 1. Enqueue Multiple Packets with differing priorities
  console.log('\n--- Enqueuing Packets ---');
  const item1 = await queue.enqueuePacket('0000000101B34E60052BF05C1171A21A', 1, 1); // Medical
  const item2 = await queue.enqueuePacket('0000000201B34E60052BF05C2171A21B', 2, 4); // Trapped (High Priority)
  const item3 = await queue.enqueuePacket('0000000301B34E60052BF05C3171A21C', 3, 2); // Lost

  // 2. Fetch packets — highest priority (Trapped) should be pulled first
  console.log('\n--- Processing Queue (Priority Validation) ---');
  const first = await queue.getNextPendingPacket();
  console.assert(first?.id === item2.id, 'Highest priority Trapped packet must be pulled first');
  console.log(`Pulled first packet correctly: Node ${first?.nodeId} with priority ${first?.triageType}`);

  // 3. Mark attempt failed (retry increments)
  console.log('\n--- Failing Attempt ---');
  await queue.markAttemptFailed(first!.id, 'LoRa gateway out of range');

  // 4. Retrieve next (Trapped has backoff delay now, so Medical/Lost is eligible)
  const second = await queue.getNextPendingPacket();
  console.log(`Pulled next eligible packet: Node ${second?.nodeId} with priority ${second?.triageType}`);

  // 5. Deliver successfully
  console.log('\n--- Delivering Packet ---');
  await queue.markDelivered(second!.id);

  // 6. Check final stats
  const stats = await queue.getQueueStats();
  console.log('\n--- Final Stats ---', stats);

  unsubscribe();
  console.log('=== Demo Complete ===');
}

// Automatically execute self-test when run directly via tsx/node
if (typeof require !== 'undefined' && require.main === module) {
  runQueueDemo().catch(console.error);
}
