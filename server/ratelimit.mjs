'use strict';

// In-memory token-bucket rate limiter keyed by an opaque hash of the client.
// Raw IPs are never stored. Suitable for a single-process community node; a
// multi-process deployment would move this to shared storage.
export class RateLimiter {
  constructor({ capacity, refillPerMinute }) {
    this.capacity = capacity;
    this.refillRate = refillPerMinute / 60000; // tokens per ms
    this.buckets = new Map();
  }

  take(key, cost = 1) {
    const now = Date.now();
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: this.capacity, last: now };
      this.buckets.set(key, bucket);
    }
    bucket.tokens = Math.min(this.capacity, bucket.tokens + (now - bucket.last) * this.refillRate);
    bucket.last = now;
    if (bucket.tokens < cost) {
      return { allowed: false, remaining: Math.floor(bucket.tokens) };
    }
    bucket.tokens -= cost;
    return { allowed: true, remaining: Math.floor(bucket.tokens) };
  }

  // Prevent unbounded growth of the bucket map over a long-running process.
  prune() {
    const now = Date.now();
    const idleMs = 3600000;
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.last > idleMs) this.buckets.delete(key);
    }
  }
}
