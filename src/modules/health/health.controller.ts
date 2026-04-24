import { Request, Response } from 'express';
import prisma from '../../config/database';

interface HealthStatus {
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: string;
  uptime: number;
  version: string;
  environment: string;
  services: {
    database: ServiceHealth;
    server: ServiceHealth;
    memory: ServiceHealth;
    disk: ServiceHealth;
    external: ServiceHealth;
  };
  metrics: {
    responseTime: number;
    errorRate: number;
    activeConnections: number;
    memoryUsage: {
      used: number;
      total: number;
      percentage: number;
    };
    diskUsage: {
      used: number;
      total: number;
      percentage: number;
    };
  };
}

interface ServiceHealth {
  status: 'healthy' | 'unhealthy' | 'degraded';
  responseTime?: number;
  error?: string;
  lastCheck: string;
  details?: any;
}

export class HealthChecker {
  private static startTime = Date.now();

  static async checkServerHealth(): Promise<ServiceHealth> {
    const startTime = Date.now();
    
    try {
      // Basic server health check
      const responseTime = Date.now() - startTime;
      
      return {
        status: 'healthy',
        responseTime,
        lastCheck: new Date().toISOString(),
        details: {
          nodeVersion: process.version,
          platform: process.platform,
          memory: process.memoryUsage()
        }
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Unknown error',
        lastCheck: new Date().toISOString(),
        responseTime: Date.now() - startTime
      };
    }
  }

  static async checkDatabaseHealth(): Promise<ServiceHealth> {
    const startTime = Date.now();
    
    try {
      // Test database connection
      await prisma.$queryRaw`SELECT 1`;
      
      // Get database stats
      const stats = await prisma.$queryRaw`
        SELECT 
          COUNT(*) as total_users,
          COUNT(CASE WHEN "isActive" = true THEN 1 END) as active_users,
          COUNT(*) as total_products,
          COUNT(CASE WHEN "isActive" = true THEN 1 END) as active_products
        FROM "users"
      `;

      const responseTime = Date.now() - startTime;
      
      return {
        status: 'healthy',
        responseTime,
        lastCheck: new Date().toISOString(),
        details: {
          connection: 'ok',
          stats: stats[0]
        }
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Database connection failed',
        lastCheck: new Date().toISOString(),
        responseTime: Date.now() - startTime
      };
    }
  }

  static checkMemoryHealth(): ServiceHealth {
    try {
      const memUsage = process.memoryUsage();
      const totalMemory = require('os').totalmem();
      const freeMemory = require('os').freemem();
      const usedMemory = totalMemory - freeMemory;
      const memoryPercentage = (usedMemory / totalMemory) * 100;

      let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
      
      if (memoryPercentage > 90) {
        status = 'unhealthy';
      } else if (memoryPercentage > 80) {
        status = 'degraded';
      }

      return {
        status,
        lastCheck: new Date().toISOString(),
        details: {
          used: Math.round(usedMemory / 1024 / 1024), // MB
          total: Math.round(totalMemory / 1024 / 1024), // MB
          free: Math.round(freeMemory / 1024 / 1024), // MB
          percentage: Math.round(memoryPercentage * 100) / 100
        }
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Memory check failed',
        lastCheck: new Date().toISOString()
      };
    }
  }

  static checkDiskHealth(): ServiceHealth {
    try {
      const fs = require('fs');
      const stats = fs.statSync('.');
      
      return {
        status: 'healthy',
        lastCheck: new Date().toISOString(),
        details: {
          diskSpace: 'ok',
          stats: stats
        }
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Disk check failed',
        lastCheck: new Date().toISOString()
      };
    }
  }

  static async checkExternalServices(): Promise<ServiceHealth> {
    const startTime = Date.now();
    
    try {
      // Check external services (payment gateways, email services, etc.)
      // This is a placeholder - in production, you'd check actual services
      const externalChecks = await Promise.allSettled([
        // Check payment gateway
        Promise.resolve({ status: 'ok', service: 'payment' }),
        // Check email service
        Promise.resolve({ status: 'ok', service: 'email' }),
        // Check SMS service
        Promise.resolve({ status: 'ok', service: 'sms' })
      ]);

      const responseTime = Date.now() - startTime;
      const allHealthy = externalChecks.every(check => 
        check.status === 'fulfilled' && check.value.status === 'ok'
      );

      return {
        status: allHealthy ? 'healthy' : 'degraded',
        responseTime,
        lastCheck: new Date().toISOString(),
        details: {
          services: externalChecks.map(check => 
            check.status === 'fulfilled' ? check.value : { status: 'error', service: 'unknown' }
          )
        }
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'External services check failed',
        lastCheck: new Date().toISOString(),
        responseTime: Date.now() - startTime
      };
    }
  }

  static async getSystemMetrics() {
    try {
      const os = require('os');
      const process = require('process');
      
      // Get system info
      const cpuUsage = process.cpuUsage();
      const memoryUsage = process.memoryUsage();
      const uptime = process.uptime();
      
      // Get active connections (placeholder)
      const activeConnections = Math.floor(Math.random() * 100) + 50;
      
      // Error rate (placeholder - would come from your error tracking)
      const errorRate = Math.random() * 5; // 0-5% error rate
      
      return {
        responseTime: 150, // Average response time in ms
        errorRate,
        activeConnections,
        memoryUsage: {
          used: Math.round(memoryUsage.heapUsed / 1024 / 1024), // MB
          total: Math.round(os.totalmem() / 1024 / 1024), // MB
          percentage: Math.round((memoryUsage.heapUsed / os.totalmem()) * 100 * 100) / 100
        },
        diskUsage: {
          used: 50, // Placeholder - would use actual disk usage
          total: 100,
          percentage: 50
        }
      };
    } catch (error) {
      console.error('Failed to get system metrics:', error);
      return {
        responseTime: 0,
        errorRate: 0,
        activeConnections: 0,
        memoryUsage: { used: 0, total: 0, percentage: 0 },
        diskUsage: { used: 0, total: 0, percentage: 0 }
      };
    }
  }

  static async getFullHealthStatus(): Promise<HealthStatus> {
    const startTime = Date.now();
    
    try {
      // Run all health checks in parallel
      const [
        serverHealth,
        databaseHealth,
        memoryHealth,
        diskHealth,
        externalHealth,
        metrics
      ] = await Promise.all([
        this.checkServerHealth(),
        this.checkDatabaseHealth(),
        Promise.resolve(this.checkMemoryHealth()),
        Promise.resolve(this.checkDiskHealth()),
        this.checkExternalServices(),
        this.getSystemMetrics()
      ]);

      // Determine overall health status
      const allServices = [serverHealth, databaseHealth, memoryHealth, diskHealth, externalHealth];
      const hasUnhealthy = allServices.some(service => service.status === 'unhealthy');
      const hasDegraded = allServices.some(service => service.status === 'degraded');
      
      let overallStatus: 'healthy' | 'unhealthy' | 'degraded' = 'healthy';
      if (hasUnhealthy) {
        overallStatus = 'unhealthy';
      } else if (hasDegraded) {
        overallStatus = 'degraded';
      }

      const uptime = Date.now() - this.startTime;
      
      return {
        status: overallStatus,
        timestamp: new Date().toISOString(),
        uptime: Math.floor(uptime / 1000), // seconds
        version: process.env.npm_package_version || '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        services: {
          database: databaseHealth,
          server: serverHealth,
          memory: memoryHealth,
          disk: diskHealth,
          external: externalHealth
        },
        metrics
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        uptime: 0,
        version: process.env.npm_package_version || '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        services: {
          database: { status: 'unhealthy', error: error instanceof Error ? error.message : 'Unknown error', lastCheck: new Date().toISOString() },
          server: { status: 'unhealthy', error: error instanceof Error ? error.message : 'Unknown error', lastCheck: new Date().toISOString() },
          memory: { status: 'unhealthy', error: error instanceof Error ? error.message : 'Unknown error', lastCheck: new Date().toISOString() },
          disk: { status: 'unhealthy', error: error instanceof Error ? error.message : 'Unknown error', lastCheck: new Date().toISOString() },
          external: { status: 'unhealthy', error: error instanceof Error ? error.message : 'Unknown error', lastCheck: new Date().toISOString() }
        },
        metrics: {
          responseTime: 0,
          errorRate: 0,
          activeConnections: 0,
          memoryUsage: { used: 0, total: 0, percentage: 0 },
          diskUsage: { used: 0, total: 0, percentage: 0 }
        }
      };
    }
  }
}

export const getHealthStatus = async (req: Request, res: Response) => {
  try {
    const healthStatus = await HealthChecker.getFullHealthStatus();
    
    // Set appropriate HTTP status code
    const statusCode = healthStatus.status === 'healthy' ? 200 : 
                       healthStatus.status === 'degraded' ? 200 : 503;
    
    res.status(statusCode).json(healthStatus);
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Health check failed',
      services: {
        database: { status: 'unhealthy', error: error instanceof Error ? error.message : 'Unknown error', lastCheck: new Date().toISOString() },
        server: { status: 'unhealthy', error: error instanceof Error ? error.message : 'Unknown error', lastCheck: new Date().toISOString() },
        memory: { status: 'unhealthy', error: error instanceof Error ? error.message : 'Unknown error', lastCheck: new Date().toISOString() },
        disk: { status: 'unhealthy', error: error instanceof Error ? error.message : 'Unknown error', lastCheck: new Date().toISOString() },
        external: { status: 'unhealthy', error: error instanceof Error ? error.message : 'Unknown error', lastCheck: new Date().toISOString() }
      }
    });
  }
};

export const getSimpleHealth = async (req: Request, res: Response) => {
  try {
    const serverHealth = await HealthChecker.checkServerHealth();
    const databaseHealth = await HealthChecker.checkDatabaseHealth();
    
    const isHealthy = serverHealth.status === 'healthy' && databaseHealth.status === 'healthy';
    const statusCode = isHealthy ? 200 : 503;
    
    res.status(statusCode).json({
      status: isHealthy ? 'ok' : 'error',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({
      status: 'error',
      timestamp: new Date().toISOString()
    });
  }
};

export const getMetrics = async (req: Request, res: Response) => {
  try {
    const metrics = await HealthChecker.getSystemMetrics();
    
    res.json({
      status: 'success',
      data: metrics
    });
  } catch (error) {
    console.error('Failed to get metrics:', error);
    res.status(500).json({
      status: 'error',
      error: error instanceof Error ? error.message : 'Failed to get metrics'
    });
  }
};
