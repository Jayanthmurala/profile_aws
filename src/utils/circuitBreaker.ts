/**
 * Circuit Breaker Pattern Implementation
 * Prevents cascading failures when external services are down
 * Critical for 10M+ users resilience
 */

export enum CircuitState {
  CLOSED = 'CLOSED',     // Normal operation
  OPEN = 'OPEN',         // Circuit is open, failing fast
  HALF_OPEN = 'HALF_OPEN' // Testing if service is back
}

interface CircuitBreakerOptions {
  failureThreshold: number;    // Number of failures before opening
  recoveryTimeout: number;     // Time to wait before trying again (ms)
  monitoringPeriod: number;    // Time window for failure counting (ms)
  expectedErrors?: string[];   // Error types that should trigger circuit
}

interface CircuitBreakerStats {
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureTime?: number;
  lastSuccessTime?: number;
  totalRequests: number;
  uptime: number;
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount: number = 0;
  private successCount: number = 0;
  private lastFailureTime?: number;
  private lastSuccessTime?: number;
  private totalRequests: number = 0;
  private readonly startTime: number = Date.now();

  constructor(
    private readonly name: string,
    private readonly options: CircuitBreakerOptions
  ) {}

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    this.totalRequests++;

    // Check if circuit should be opened
    if (this.shouldOpenCircuit()) {
      this.state = CircuitState.OPEN;
      this.logStateChange();
    }

    // If circuit is open, fail fast
    if (this.state === CircuitState.OPEN) {
      if (this.shouldAttemptReset()) {
        this.state = CircuitState.HALF_OPEN;
        this.logStateChange();
      } else {
        throw new CircuitBreakerError(
          `Circuit breaker is OPEN for ${this.name}`,
          this.name,
          this.getStats()
        );
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error as Error);
      throw error;
    }
  }

  private shouldOpenCircuit(): boolean {
    if (this.state !== CircuitState.CLOSED) return false;
    
    const now = Date.now();
    const windowStart = now - this.options.monitoringPeriod;
    
    // Only consider recent failures
    if (this.lastFailureTime && this.lastFailureTime < windowStart) {
      this.failureCount = 0;
      return false;
    }

    return this.failureCount >= this.options.failureThreshold;
  }

  private shouldAttemptReset(): boolean {
    if (!this.lastFailureTime) return true;
    
    const timeSinceLastFailure = Date.now() - this.lastFailureTime;
    return timeSinceLastFailure >= this.options.recoveryTimeout;
  }

  private onSuccess(): void {
    this.successCount++;
    this.lastSuccessTime = Date.now();
    
    if (this.state === CircuitState.HALF_OPEN) {
      this.state = CircuitState.CLOSED;
      this.failureCount = 0;
      this.logStateChange();
      console.info(`[CircuitBreaker] ${this.name} recovered and closed`);
    }
  }

  private onFailure(error: Error): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    // Check if this error should trigger the circuit breaker
    if (this.shouldTriggerOnError(error)) {
      console.warn(`[CircuitBreaker] ${this.name} failure recorded:`, {
        error: error.message,
        failureCount: this.failureCount,
        threshold: this.options.failureThreshold
      });

      if (this.state === CircuitState.HALF_OPEN) {
        this.state = CircuitState.OPEN;
        this.logStateChange();
      }
    }
  }

  private shouldTriggerOnError(error: Error): boolean {
    if (!this.options.expectedErrors) return true;
    
    return this.options.expectedErrors.some(expectedError => 
      error.name.includes(expectedError) || 
      error.message.includes(expectedError)
    );
  }

  private logStateChange(): void {
    console.info(`[CircuitBreaker] ${this.name} state changed to ${this.state}`, {
      failureCount: this.failureCount,
      successCount: this.successCount,
      totalRequests: this.totalRequests
    });
  }

  getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      totalRequests: this.totalRequests,
      uptime: Date.now() - this.startTime
    };
  }

  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = undefined;
    this.lastSuccessTime = undefined;
    console.info(`[CircuitBreaker] ${this.name} manually reset`);
  }

  forceOpen(): void {
    this.state = CircuitState.OPEN;
    console.warn(`[CircuitBreaker] ${this.name} manually opened`);
  }

  forceClose(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    console.info(`[CircuitBreaker] ${this.name} manually closed`);
  }
}

export class CircuitBreakerError extends Error {
  constructor(
    message: string,
    public readonly serviceName: string,
    public readonly stats: CircuitBreakerStats
  ) {
    super(message);
    this.name = 'CircuitBreakerError';
  }
}

/**
 * Circuit Breaker Manager for multiple services
 */
export class CircuitBreakerManager {
  private static breakers: Map<string, CircuitBreaker> = new Map();

  static createBreaker(
    name: string,
    options: CircuitBreakerOptions
  ): CircuitBreaker {
    const breaker = new CircuitBreaker(name, options);
    this.breakers.set(name, breaker);
    return breaker;
  }

  static getBreaker(name: string): CircuitBreaker | undefined {
    return this.breakers.get(name);
  }

  static getAllStats(): Record<string, CircuitBreakerStats> {
    const stats: Record<string, CircuitBreakerStats> = {};
    
    for (const [name, breaker] of this.breakers.entries()) {
      stats[name] = breaker.getStats();
    }
    
    return stats;
  }

  static resetAll(): void {
    for (const breaker of this.breakers.values()) {
      breaker.reset();
    }
    console.info('[CircuitBreakerManager] All circuit breakers reset');
  }

  static getHealthySystems(): string[] {
    const healthy: string[] = [];
    
    for (const [name, breaker] of this.breakers.entries()) {
      if (breaker.getStats().state === CircuitState.CLOSED) {
        healthy.push(name);
      }
    }
    
    return healthy;
  }

  static getUnhealthySystems(): string[] {
    const unhealthy: string[] = [];
    
    for (const [name, breaker] of this.breakers.entries()) {
      if (breaker.getStats().state === CircuitState.OPEN) {
        unhealthy.push(name);
      }
    }
    
    return unhealthy;
  }
}

// Pre-configured circuit breakers for common services
export const AuthServiceBreaker = CircuitBreakerManager.createBreaker('auth-service', {
  failureThreshold: 5,
  recoveryTimeout: 30000, // 30 seconds
  monitoringPeriod: 60000, // 1 minute
  expectedErrors: ['ECONNREFUSED', 'ETIMEDOUT', 'fetch failed']
});

export const DatabaseBreaker = CircuitBreakerManager.createBreaker('database', {
  failureThreshold: 3,
  recoveryTimeout: 10000, // 10 seconds
  monitoringPeriod: 30000, // 30 seconds
  expectedErrors: ['P1001', 'P1008', 'P1017'] // Prisma connection errors
});

export const RedisBreaker = CircuitBreakerManager.createBreaker('redis', {
  failureThreshold: 5,
  recoveryTimeout: 15000, // 15 seconds
  monitoringPeriod: 45000, // 45 seconds
  expectedErrors: ['ECONNREFUSED', 'Redis connection']
});
