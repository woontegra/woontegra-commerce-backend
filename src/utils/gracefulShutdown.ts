import { logger } from '../utils/logger';

// Graceful shutdown handler
export const setupGracefulShutdown = (): void => {
  const gracefulShutdown = (signal: string) => {
    logger.error({
      message: `Received ${signal}, starting graceful shutdown`,
      timestamp: new Date().toISOString(),
    });

    // Close database connections
    // Add any cleanup logic here
    
    logger.info({
      message: 'Graceful shutdown completed',
      timestamp: new Date().toISOString(),
    });
    
    process.exit(0);
  };

  // Handle uncaught exceptions
  process.on('uncaughtException', (error: Error) => {
    logger.error({
      message: 'Uncaught Exception',
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
    });

    // Attempt graceful shutdown
    gracefulShutdown('uncaughtException');
  });

  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
    logger.error({
      message: 'Unhandled Promise Rejection',
      error: reason?.message || reason,
      stack: reason?.stack,
      promise: promise.toString(),
      timestamp: new Date().toISOString(),
    });

    // Attempt graceful shutdown
    gracefulShutdown('unhandledRejection');
  });

  // Handle SIGTERM (kill signal)
  process.on('SIGTERM', () => {
    logger.info({
      message: 'Received SIGTERM',
      timestamp: new Date().toISOString(),
    });
    
    gracefulShutdown('SIGTERM');
  });

  // Handle SIGINT (Ctrl+C)
  process.on('SIGINT', () => {
    logger.info({
      message: 'Received SIGINT',
      timestamp: new Date().toISOString(),
    });
    
    gracefulShutdown('SIGINT');
  });

  // Handle SIGUSR2 (nodemon restart)
  process.on('SIGUSR2', () => {
    logger.info({
      message: 'Received SIGUSR2 (nodemon restart)',
      timestamp: new Date().toISOString(),
    });
    
    gracefulShutdown('SIGUSR2');
  });

  // Handle process exit
  process.on('exit', (code: number) => {
    logger.info({
      message: `Process exiting with code ${code}`,
      timestamp: new Date().toISOString(),
    });
  });
};

// Memory usage monitoring
export const setupMemoryMonitoring = (): void => {
  const checkMemoryUsage = () => {
    const usage = process.memoryUsage();
    const usedMB = Math.round(usage.rss / 1024 / 1024);
    const totalMB = Math.round(usage.heapTotal / 1024 / 1024);
    const percentage = Math.round((usedMB / totalMB) * 100);

    if (percentage > 80) {
      logger.warn({
        message: 'High memory usage detected',
        usedMB,
        totalMB,
        percentage,
        timestamp: new Date().toISOString(),
      });
    }
  };

  // Check every 30 seconds
  setInterval(checkMemoryUsage, 30000);
};

// CPU usage monitoring (basic)
export const setupCPUMonitoring = (): void => {
  const startTime = process.hrtime();
  let startUsage = process.cpuUsage();

  const checkCPUUsage = () => {
    const now = process.hrtime(startTime);
    const usage = process.cpuUsage(startUsage);
    
    const userTime = usage.user / 1000000; // Convert to seconds
    const systemTime = usage.system / 1000000;
    const totalTime = now[0] + now[1] / 1000000;
    
    const cpuPercentage = ((userTime + systemTime) / totalTime) * 100;

    if (cpuPercentage > 80) {
      logger.warn({
        message: 'High CPU usage detected',
        cpuPercentage: Math.round(cpuPercentage),
        timestamp: new Date().toISOString(),
      });
    }
  };

  // Check every 30 seconds
  setInterval(checkCPUUsage, 30000);
};

// Health check endpoint
export const healthCheck = () => {
  return {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: process.version,
    platform: process.platform,
  };
};
