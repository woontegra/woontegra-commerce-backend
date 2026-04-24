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
    this.ensureLogDir();
  }

  private static ensureLogDir(): void {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  static log(level: 'error' | 'warn' | 'info' | 'debug', message: string, error?: Error, metadata?: Record<string, any>): void {
    const logEntry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      stack: error?.stack,
      metadata,
    };

    const logFile = path.join(this.logDir, `app-${new Date().toISOString().split('T')[0]}.log`);
    const logLine = JSON.stringify(logEntry) + '\n';

    try {
      fs.appendFileSync(logFile, logLine);
      this.rotateLogIfNeeded(logFile);
    } catch (err) {
      console.error('Failed to write log:', err);
    }
  }

  static error(message: string, error?: Error, metadata?: Record<string, any>): void {
    this.log('error', message, error, metadata);
  }

  static warn(message: string, metadata?: Record<string, any>): void {
    this.log('warn', message, undefined, metadata);
  }

  static info(message: string, metadata?: Record<string, any>): void {
    this.log('info', message, undefined, metadata);
  }

  static debug(message: string, metadata?: Record<string, any>): void {
    this.log('debug', message, undefined, metadata);
  }

  private static rotateLogIfNeeded(logFile: string): void {
    try {
      const stats = fs.statSync(logFile);
      if (stats.size > this.maxFileSize) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const rotatedFile = logFile.replace('.log', `-${timestamp}.log`);
        fs.renameSync(logFile, rotatedFile);
        this.cleanOldLogs();
      }
    } catch (err) {
      console.error('Failed to rotate log:', err);
    }
  }

  private static cleanOldLogs(): void {
    try {
      const files = fs.readdirSync(this.logDir)
        .filter(file => file.endsWith('.log'))
        .map(file => ({
          name: file,
          path: path.join(this.logDir, file),
          mtime: fs.statSync(path.join(this.logDir, file)).mtime,
        }))
        .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

      if (files.length > this.maxLogFiles) {
        const filesToDelete = files.slice(this.maxLogFiles);
        filesToDelete.forEach(file => {
          try {
            fs.unlinkSync(file.path);
          } catch (err) {
            console.error('Failed to delete old log file:', file.name, err);
          }
        });
      }
    } catch (err) {
      console.error('Failed to clean old logs:', err);
    }
  }

  static async getLogs(filter: LogFilter = {}): Promise<{ logs: LogEntry[], total: number }> {
    try {
      const logFiles = fs.readdirSync(this.logDir)
        .filter(file => file.endsWith('.log'))
        .sort()
        .reverse();

      let allLogs: LogEntry[] = [];

      for (const file of logFiles) {
        const filePath = path.join(this.logDir, file);
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const lines = content.trim().split('\n').filter(line => line);
          
          for (const line of lines) {
            try {
              const log = JSON.parse(line) as LogEntry;
              
              // Apply filters
              if (filter.level && log.level !== filter.level) continue;
              if (filter.startDate && log.timestamp < filter.startDate) continue;
              if (filter.endDate && log.timestamp > filter.endDate) continue;
              if (filter.userId && log.metadata?.userId !== filter.userId) continue;
              if (filter.search && !log.message.toLowerCase().includes(filter.search.toLowerCase())) continue;
              
              allLogs.push(log);
            } catch (parseErr) {
              // Skip invalid log lines
              continue;
            }
          }
        } catch (err) {
          console.error('Failed to read log file:', file, err);
          continue;
        }
      }

      // Sort by timestamp (newest first)
      allLogs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      // Apply pagination
      const limit = filter.limit || 100;
      const offset = filter.offset || 0;
      const paginatedLogs = allLogs.slice(offset, offset + limit);

      return {
        logs: paginatedLogs,
        total: allLogs.length,
      };
    } catch (err) {
      console.error('Failed to get logs:', err);
      return { logs: [], total: 0 };
    }
  }

  static async getLogStats(): Promise<{
    totalLogs: number;
    errorCount: number;
    warnCount: number;
    infoCount: number;
    debugCount: number;
    latestError?: LogEntry;
  }> {
    try {
      const { logs, total } = await this.getLogs({ limit: 1000 });
      
      const stats = {
        totalLogs: total,
        errorCount: logs.filter(log => log.level === 'error').length,
        warnCount: logs.filter(log => log.level === 'warn').length,
        infoCount: logs.filter(log => log.level === 'info').length,
        debugCount: logs.filter(log => log.level === 'debug').length,
        latestError: logs.find(log => log.level === 'error'),
      };

      return stats;
    } catch (err) {
      console.error('Failed to get log stats:', err);
      return {
        totalLogs: 0,
        errorCount: 0,
        warnCount: 0,
        infoCount: 0,
        debugCount: 0,
      };
    }
  }

  static async clearLogs(): Promise<void> {
    try {
      const files = fs.readdirSync(this.logDir);
      for (const file of files) {
        const filePath = path.join(this.logDir, file);
        try {
          fs.unlinkSync(filePath);
        } catch (err) {
          console.error('Failed to delete log file:', file, err);
        }
      }
    } catch (err) {
      console.error('Failed to clear logs:', err);
    }
  }

  static async exportLogs(filter: LogFilter = {}): Promise<string> {
    try {
      const { logs } = await this.getLogs(filter);
      
      // Convert to CSV format
      const headers = ['Timestamp', 'Level', 'Message', 'User ID', 'IP', 'Path', 'Method', 'Status Code'];
      const csvLines = [headers.join(',')];
      
      for (const log of logs) {
        const row = [
          log.timestamp,
          log.level,
          `"${log.message.replace(/"/g, '""')}"`,
          log.metadata?.userId || '',
          log.ip || '',
          log.path || '',
          log.method || '',
          log.statusCode?.toString() || '',
        ];
        csvLines.push(row.join(','));
      }
      
      return csvLines.join('\n');
    } catch (err) {
      console.error('Failed to export logs:', err);
      return '';
    }
  }
}

export default ErrorLogger;
