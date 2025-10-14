import axios from 'axios';
import { env } from '../config/env.js';
import { AuthServiceBreaker, CircuitBreakerError } from './circuitBreaker.js';
import { MetricsLogger } from './logger.js';

export interface AuthUser {
  id: string;
  email: string;
  displayName?: string;
  avatarUrl?: string;
  collegeId?: string;
  collegeMemberId?: string;
  department?: string;
  year?: number;
  roles?: string[];
  createdAt?: string;
}

export interface AuthCollege {
  id: string;
  name: string;
  domain?: string;
  location?: string;
}

export class AuthServiceClient {
  private static readonly baseUrl = env.AUTH_SERVICE_URL;
  private static readonly timeout = 5000;

  /**
   * Get user information from auth service with circuit breaker
   */
  static async getUser(userId: string, authHeader: string): Promise<AuthUser | null> {
    const startTime = Date.now();
    
    try {
      // Validate inputs
      if (!userId || !authHeader) {
        console.warn('[AuthServiceClient] Missing required parameters');
        return null;
      }

      // Use circuit breaker for resilience
      const response = await AuthServiceBreaker.execute(async () => {
        console.log(`[AuthServiceClient] Fetching user info from: ${this.baseUrl}/v1/users/${userId}`);
        
        const axiosResponse = await axios.get(`${this.baseUrl}/v1/users/${userId}`, {
          headers: {
            'Authorization': authHeader,
          },
          timeout: this.timeout,
          validateStatus: (status) => status < 500, // Don't throw on 4xx errors
        });

        return axiosResponse;
      });
      
      const duration = Date.now() - startTime;
      
      // Log external service call
      MetricsLogger.logExternalService(
        'auth-service',
        `/v1/users/${userId}`,
        'GET',
        response.status,
        duration
      );
      
      console.log(`[AuthServiceClient] Auth service response: ${response.status} (${duration}ms)`);
      
      // Handle different response statuses
      if (response.status === 200) {
        return response.data.user || null;
      } else if (response.status === 404) {
        console.warn(`[AuthServiceClient] User ${userId} not found`);
        return null;
      } else if (response.status === 401) {
        console.warn('[AuthServiceClient] Unauthorized - invalid token');
        return null;
      } else if (response.status === 403) {
        console.warn('[AuthServiceClient] Forbidden - insufficient permissions');
        return null;
      } else {
        console.error(`[AuthServiceClient] Unexpected response status: ${response.status}`);
        return null;
      }
      
    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Handle circuit breaker errors
      if (error instanceof CircuitBreakerError) {
        console.warn(`[AuthServiceClient] Circuit breaker is open for auth service`, {
          serviceName: error.serviceName,
          stats: error.stats,
          duration
        });
        
        // Log external service failure
        MetricsLogger.logExternalService(
          'auth-service',
          `/v1/users/${userId}`,
          'GET',
          503, // Service unavailable
          duration,
          error
        );
        
        return null; // Graceful degradation
      }
      
      console.error(`[AuthServiceClient] Failed to fetch user info (${duration}ms):`, error);
      
      if (axios.isAxiosError(error)) {
        const errorDetails = {
          status: error.response?.status,
          statusText: error.response?.statusText,
          data: error.response?.data,
          message: error.message,
          code: error.code,
          timeout: error.code === 'ECONNABORTED'
        };
        
        console.error('[AuthServiceClient] Axios error details:', errorDetails);
        
        // Log external service failure
        MetricsLogger.logExternalService(
          'auth-service',
          `/v1/users/${userId}`,
          'GET',
          error.response?.status || 0,
          duration,
          error
        );
        
        // Handle specific error types
        if (error.code === 'ECONNABORTED') {
          console.error('[AuthServiceClient] Request timeout - auth service may be down');
        } else if (error.code === 'ECONNREFUSED') {
          console.error('[AuthServiceClient] Connection refused - auth service unavailable');
        } else if (error.response?.status && error.response.status >= 500) {
          console.error('[AuthServiceClient] Auth service internal error');
        }
      }
      
      return null;
    }
  }

  /**
   * Get college information from auth service
   */
  static async getCollege(collegeId: string, authHeader: string): Promise<AuthCollege | null> {
    try {
      const response = await axios.get(`${this.baseUrl}/v1/colleges/${collegeId}`, {
        headers: {
          'Authorization': authHeader,
        },
        timeout: this.timeout,
      });
      
      return response.data || null;
    } catch (error) {
      console.error('[AuthServiceClient] Failed to fetch college info:', error);
      return null;
    }
  }

  /**
   * Update user information in auth service
   */
  static async updateUser(userId: string, updateData: Partial<AuthUser>, authHeader: string): Promise<boolean> {
    try {
      await axios.put(`${this.baseUrl}/v1/users/${userId}`, 
        updateData,
        {
          headers: {
            'Authorization': authHeader,
          },
          timeout: this.timeout,
        }
      );
      return true;
    } catch (error) {
      console.error('[AuthServiceClient] Failed to update user data:', error);
      return false;
    }
  }

  /**
   * Get multiple users from auth service
   */
  static async getUsers(params: {
    offset?: number;
    limit?: number;
    search?: string;
    collegeId?: string;
  }, authHeader: string): Promise<{
    users: AuthUser[];
    nextOffset?: number;
    hasMore?: boolean;
    totalCount?: number;
  } | null> {
    try {
      const queryParams = new URLSearchParams();
      if (params.offset !== undefined) queryParams.append('offset', params.offset.toString());
      if (params.limit !== undefined) queryParams.append('limit', Math.min(params.limit, 100).toString());
      if (params.search) queryParams.append('search', params.search);
      if (params.collegeId) queryParams.append('collegeId', params.collegeId);

      const response = await axios.get(`${this.baseUrl}/v1/users?${queryParams}`, {
        headers: {
          'Authorization': authHeader,
        },
        timeout: 10000,
      });

      return response.data || null;
    } catch (error) {
      console.error('[AuthServiceClient] Failed to fetch users:', error);
      return null;
    }
  }

  /**
   * Batch get user details for multiple user IDs
   */
  static async getBatchUsers(userIds: string[], authHeader: string): Promise<Map<string, AuthUser>> {
    const userDetails = new Map<string, AuthUser>();

    // Process in batches to avoid overwhelming the auth service
    const batchSize = 10;
    for (let i = 0; i < userIds.length; i += batchSize) {
      const batch = userIds.slice(i, i + batchSize);
      
      const promises = batch.map(async (userId) => {
        const user = await this.getUser(userId, authHeader);
        if (user) {
          userDetails.set(userId, user);
        }
      });

      await Promise.all(promises);
    }

    return userDetails;
  }
}
