// ============================================================================
// CACHE UTILITY
// ============================================================================
// Purpose: Pluggable cache with in-memory backend (Redis-ready for future)
// ============================================================================

const logger = require('../config/logger');

class InMemoryCache {
  constructor() {
    this.store = new Map();
    this.timers = new Map();
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0
    };
  }

  async get(key) {
    const entry = this.store.get(key);
    if (!entry) {
      this.stats.misses++;
      return null;
    }
    
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.delete(key);
      this.stats.misses++;
      return null;
    }
    
    this.stats.hits++;
    return entry.value;
  }

  async set(key, value, ttlSeconds = 300) {
    const expiresAt = ttlSeconds > 0 ? Date.now() + (ttlSeconds * 1000) : null;
    
    this.store.set(key, { value, expiresAt });
    this.stats.sets++;
    
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key));
    }
    
    if (ttlSeconds > 0) {
      const timer = setTimeout(() => {
        this.delete(key);
      }, ttlSeconds * 1000);
      this.timers.set(key, timer);
    }
    
    return true;
  }

  async delete(key) {
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key));
      this.timers.delete(key);
    }
    const deleted = this.store.delete(key);
    if (deleted) this.stats.deletes++;
    return deleted;
  }

  async clear() {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.store.clear();
    return true;
  }

  async has(key) {
    const value = await this.get(key);
    return value !== null;
  }

  getStats() {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? ((this.stats.hits / total) * 100).toFixed(2) : '0.00';
    return {
      size: this.store.size,
      backend: 'in-memory',
      hits: this.stats.hits,
      misses: this.stats.misses,
      sets: this.stats.sets,
      deletes: this.stats.deletes,
      hitRate: `${hitRate}%`,
      totalRequests: total
    };
  }
}

class CacheManager {
  constructor() {
    this.backend = null;
    this.inFlightRequests = new Map();
  }

  initialize(backendType = 'memory') {
    if (backendType === 'memory') {
      this.backend = new InMemoryCache();
      logger.info('Cache initialized with in-memory backend');
    } else if (backendType === 'redis') {
      throw new Error('Redis backend not yet implemented. Use "memory" for now.');
    } else {
      throw new Error(`Unknown cache backend: ${backendType}`);
    }
  }

  async get(key) {
    if (!this.backend) {
      throw new Error('Cache not initialized. Call initialize() first.');
    }
    return this.backend.get(key);
  }

  async set(key, value, ttlSeconds = 300) {
    if (!this.backend) {
      throw new Error('Cache not initialized. Call initialize() first.');
    }
    return this.backend.set(key, value, ttlSeconds);
  }

  async delete(key) {
    if (!this.backend) {
      throw new Error('Cache not initialized. Call initialize() first.');
    }
    return this.backend.delete(key);
  }

  async clear() {
    if (!this.backend) {
      throw new Error('Cache not initialized. Call initialize() first.');
    }
    return this.backend.clear();
  }

  async has(key) {
    if (!this.backend) {
      throw new Error('Cache not initialized. Call initialize() first.');
    }
    return this.backend.has(key);
  }

  async wrap(key, ttlSeconds, fetchFn) {
    const cached = await this.get(key);
    if (cached !== null) {
      return cached;
    }

    if (this.inFlightRequests.has(key)) {
      return this.inFlightRequests.get(key);
    }

    const promise = (async () => {
      try {
        const value = await fetchFn();
        await this.set(key, value, ttlSeconds);
        return value;
      } finally {
        this.inFlightRequests.delete(key);
      }
    })();

    this.inFlightRequests.set(key, promise);
    return promise;
  }

  getStats() {
    if (!this.backend) {
      return { initialized: false };
    }
    return {
      initialized: true,
      inFlight: this.inFlightRequests.size,
      ...this.backend.getStats()
    };
  }
}

const cache = new CacheManager();

module.exports = cache;
