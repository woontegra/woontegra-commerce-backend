import { Request, Response } from 'express';
import { AppError } from '../../common/middleware/error.middleware';
import fs from 'fs';
import path from 'path';

interface LogEntry {
  timestamp: string;
  level: 'error' | 'warn' | 'info' | 'debug';
  message: string;
  stack?: string;
  userId?: string;
  ip?: string;
  userAgent?: string;
  path?: string;
  method?: string;
  statusCode?: number;
  duration?: number;
  metadata?: Record<string, any>;
}

interface LogFilter {
  level?: string;
  startDate?: string;
  endDate?: string;
  userId?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export class ErrorLogger {
  private static logDir = path.join(process.cwd(), 'logs');
  private static maxFileSize = 10 * 1024 * 1024; // 10MB
  private static maxLogFiles = 10;

  static {
    error(message: string, error?: Error, metadata?: Record<string, any>) {
      this.log('error', message, error, metadata);
    },

    warn(message: string, metadata?: Record<string, any>) {
      this.log('warn', message, undefined, metadata);
    },

    info(message: string, metadata?: Record<string, any>) {
      this.log('info', message, undefined, metadata);
    },

    debug(message: string, metadata?: Record<string, any>) {
      this.log('debug', message, undefined, metadata);
    },

    logRequest(req: Request, res: Response, duration?: number) {
      const metadata = {
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
        duration,
        userAgent: req.get('User-Agent'),
        ip: req.ip,
        userId: (req as any).user?.id
      };

      if (res.statusCode >= 400) {
        this.log('warn', `HTTP ${res.statusCode} - ${req.method} ${req.originalUrl}`, undefined, metadata);
      } else {
        this.log('info', `HTTP ${res.statusCode} - ${req.method} ${req.originalUrl}`, undefined, metadata);
      }
    },

    logError(req: Request, error: Error, statusCode?: number) {
      const metadata = {
        method: req.method,
        path: req.originalUrl,
        statusCode,
        userAgent: req.get('User-Agent'),
        ip: req.ip,
        userId: (req as any).user?.id,
        stack: error.stack
      };

      this.log('error', error.message, error, metadata);
    }
  };

  private static log(level: LogEntry['level'], message: string, error?: Error, metadata?: Record<string, any>) {
    const logEntry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      stack: error?.stack,
      metadata
    };

    // Write to file
    this.writeToFile(logEntry);
    
    // Also log to console in development
    if (process.env.NODE_ENV === 'development') {
      const logMessage = `[${logEntry.timestamp}] ${level.toUpperCase()}: ${message}`;
      if (error) {
        console.error(logMessage, error);
      } else {
        console.log(logMessage);
      }
    }
  }

  private static writeToFile(logEntry: LogEntry) {
    try {
      // Ensure log directory exists
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }

      // Create log file for current date
      const today = new Date().toISOString().split('T')[0];
      const logFile = path.join(this.logDir, `app-${today}.log`);
      
      // Format log entry
      const logLine = JSON.stringify(logEntry) + '\n';
      
      // Check file size and rotate if necessary
      if (fs.existsSync(logFile)) {
        const stats = fs.statSync(logFile);
        if (stats.size > this.maxFileSize) {
          this.rotateLogFile(logFile);
        }
      }
      
      // Append to log file
      fs.appendFileSync(logFile, logLine);
      
      // Clean up old log files
      this.cleanupOldLogs();
    } catch (error) {
      console.error('Failed to write to log file:', error);
    }
  }

  private static rotateLogFile(currentLogFile: string) {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const rotatedFile = currentLogFile.replace('.log', `-${timestamp}.log`);
      fs.renameSync(currentLogFile, rotatedFile);
    } catch (error) {
      console.error('Failed to rotate log file:', error);
    }
  }

  private static cleanupOldLogs() {
    try {
      const files = fs.readdirSync(this.logDir)
        .filter(file => file.startsWith('app-') && file.endsWith('.log'))
        .map(file => ({
          name: file,
          path: path.join(this.logDir, file),
          mtime: fs.statSync(path.join(this.logDir, file)).mtime
        }))
        .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

      // Remove oldest files if we have too many
      if (files.length > this.maxLogFiles) {
        const filesToDelete = files.slice(this.maxLogFiles);
        filesToDelete.forEach(file => {
          fs.unlinkSync(file.path);
        });
      }
    } catch (error) {
      console.error('Failed to cleanup old logs:', error);
    }
  }

  static async getLogs(filter: LogFilter = {}): Promise<{
    logs: LogEntry[];
    total: number;
    hasMore: boolean;
  }> {
    try {
      const { level, startDate, endDate, userId, search, limit = 100, offset = 0 } = filter;
      
      // Get all log files
      const files = fs.readdirSync(this.logDir)
        .filter(file => file.startsWith('app-') && file.endsWith('.log'))
        .sort((a, b) => b.localeCompare(a)); // Sort descending
      
      let allLogs: LogEntry[] = [];
      
      // Read and parse log files
      for (const file of files) {
        try {
          const filePath = path.join(this.logDir, file);
          const content = fs.readFileSync(filePath, 'utf8');
          const fileLogs = content
            .split('\n')
            .filter(line => line.trim())
            .map(line => {
              try {
                return JSON.parse(line);
              } catch {
                return null;
              }
            })
            .filter(log => log !== null);
          
          allLogs = [...allLogs, ...fileLogs];
        } catch (error) {
          console.error(`Failed to read log file ${file}:`, error);
        }
      }
      
      // Apply filters
      let filteredLogs = allLogs;
      
      // Filter by level
      if (level) {
        filteredLogs = filteredLogs.filter(log => log.level === level);
      }
      
      // Filter by date range
      if (startDate) {
        const start = new Date(startDate);
        filteredLogs = filteredLogs.filter(log => new Date(log.timestamp) >= start);
      }
      
      if (endDate) {
        const end = new Date(endDate);
        filteredLogs = filteredLogs.filter(log => new Date(log.timestamp) <= end);
      }
      
      // Filter by user ID
      if (userId) {
        filteredLogs = filteredLogs.filter(log => log.userId === userId);
      }
      
      // Filter by search term
      if (search) {
        const searchLower = search.toLowerCase();
        filteredLogs = filteredLogs.filter(log => 
          log.message.toLowerCase().includes(searchLower) ||
          log.level.toLowerCase().includes(searchLower) ||
          (log.stack && log.stack.toLowerCase().includes(searchLower))
        );
      }
      
      // Sort by timestamp (newest first)
      filteredLogs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      
      // Apply pagination
      const total = filteredLogs.length;
      const paginatedLogs = filteredLogs.slice(offset, offset + limit);
      const hasMore = offset + limit < total;
      
      return {
        logs: paginatedLogs,
        total,
        hasMore
      };
    } catch (error) {
      console.error('Failed to get logs:', error);
      return {
        logs: [],
        total: 0,
        hasMore: false
      };
    }
  }

  static async getLogStats(): Promise<{
    totalLogs: number;
    logsByLevel: Record<string, number>;
    logsByHour: Record<string, number>;
    recentErrors: LogEntry[];
  }> {
    try {
      const { logs } = await this.getLogs({ limit: 10000 }); // Get last 10k logs
      
      const logsByLevel: Record<string, number> = {
        error: 0,
        warn: 0,
        info: 0,
        debug: 0
      };
      
      const logsByHour: Record<string, number> = {};
      
      logs.forEach(log => {
        logsByLevel[log.level] = (logsByLevel[log.level] || 0) + 1;
        
        const hour = new Date(log.timestamp).getHours().toString();
        logsByHour[hour] = (logsByHour[hour] || 0) + 1;
      });
      
      const recentErrors = logs
        .filter(log => log.level === 'error')
        .slice(0, 10);
      
      return {
        totalLogs: logs.length,
        logsByLevel,
        logsByHour,
        recentErrors
      };
    } catch (error) {
      console.error('Failed to get log stats:', error);
      return {
        totalLogs: 0,
        logsByLevel: {},
        logsByHour: {},
        recentErrors: []
      };
    }
  }

  static async clearLogs(): Promise<{ success: boolean; message: string }> {
    try {
      const files = fs.readdirSync(this.logDir)
        .filter(file => file.startsWith('app-') && file.endsWith('.log'));
      
      for (const file of files) {
        const filePath = path.join(this.logDir, file);
        fs.unlinkSync(filePath);
      }
      
      return {
        success: true,
        message: `Cleared ${files.length} log files`
      };
    } catch (error) {
      console.error('Failed to clear logs:', error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to clear logs'
      };
    }
  }
}

export const getLogs = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user || user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const result = await ErrorLogger.getLogs(req.query);
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Failed to get logs:', error);
    res.status(500).json({ error: 'Failed to get logs' });
  }
};

export const getLogStats = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user || user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const stats = await ErrorLogger.getLogStats();
    
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Failed to get log stats:', error);
    res.status(500).json({ error: 'Failed to get log stats' });
  }
};

export const clearLogs = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user || user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const result = await ErrorLogger.clearLogs();
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Failed to clear logs:', error);
    res.status(500).json({ error: 'Failed to clear logs' });
  }
};

export const downloadLogs = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user || user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { logs } = await ErrorLogger.getLogs(req.query);
    const logContent = logs.map(log => JSON.stringify(log)).join('\n');
    
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename="logs-${new Date().toISOString().split('T')[0]}.json"`);
    res.send(logContent);
  } catch (error) {
    console.error('Failed to download logs:', error);
    res.status(500).json({ error: 'Failed to download logs' });
  }
};
