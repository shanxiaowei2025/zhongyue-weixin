/**
 * 回调统计服务
 * 用于记录和查询企业微信回调的处理统计
 */
export class CallbackStatsService {
  private static instance: CallbackStatsService;
  
  // 统计数据
  private stats = {
    // 验证请求统计
    verification: {
      total: 0,
      success: 0,
      failed: 0,
      lastTime: null as Date | null,
      lastError: null as string | null
    },
    // 消息请求统计
    message: {
      total: 0,
      success: 0,
      failed: 0,
      lastTime: null as Date | null,
      lastError: null as string | null,
      // 按消息类型统计
      byType: {
        text: 0,
        image: 0,
        voice: 0,
        video: 0,
        event: 0,
        other: 0
      }
    },
    // 服务启动时间
    startTime: new Date(),
    // 最近的错误记录（保留最近10条）
    recentErrors: [] as Array<{
      timestamp: Date;
      type: 'verification' | 'message';
      error: string;
      details?: any;
    }>
  };

  private constructor() {}

  /**
   * 获取单例实例
   */
  public static getInstance(): CallbackStatsService {
    if (!CallbackStatsService.instance) {
      CallbackStatsService.instance = new CallbackStatsService();
    }
    return CallbackStatsService.instance;
  }

  /**
   * 记录验证请求
   */
  public recordVerification(success: boolean, error?: string): void {
    this.stats.verification.total++;
    this.stats.verification.lastTime = new Date();
    
    if (success) {
      this.stats.verification.success++;
      this.stats.verification.lastError = null;
    } else {
      this.stats.verification.failed++;
      this.stats.verification.lastError = error || 'Unknown error';
      this.addRecentError('verification', error || 'Unknown error');
    }
  }

  /**
   * 记录消息处理
   */
  public recordMessage(success: boolean, messageType?: string, error?: string, details?: any): void {
    this.stats.message.total++;
    this.stats.message.lastTime = new Date();
    
    if (success) {
      this.stats.message.success++;
      this.stats.message.lastError = null;
      
      // 记录消息类型统计
      if (messageType) {
        if (messageType in this.stats.message.byType) {
          (this.stats.message.byType as any)[messageType]++;
        } else {
          this.stats.message.byType.other++;
        }
      }
    } else {
      this.stats.message.failed++;
      this.stats.message.lastError = error || 'Unknown error';
      this.addRecentError('message', error || 'Unknown error', details);
    }
  }

  /**
   * 添加最近错误记录
   */
  private addRecentError(type: 'verification' | 'message', error: string, details?: any): void {
    this.stats.recentErrors.unshift({
      timestamp: new Date(),
      type,
      error,
      details
    });
    
    // 只保留最近10条错误
    if (this.stats.recentErrors.length > 10) {
      this.stats.recentErrors = this.stats.recentErrors.slice(0, 10);
    }
  }

  /**
   * 获取统计数据
   */
  public getStats() {
    const now = new Date();
    const uptime = now.getTime() - this.stats.startTime.getTime();
    
    return {
      ...this.stats,
      uptime: {
        milliseconds: uptime,
        seconds: Math.floor(uptime / 1000),
        minutes: Math.floor(uptime / 1000 / 60),
        hours: Math.floor(uptime / 1000 / 60 / 60),
        formatted: this.formatUptime(uptime)
      },
      health: this.getHealthStatus()
    };
  }

  /**
   * 获取健康状态
   */
  private getHealthStatus(): {
    status: 'healthy' | 'warning' | 'error';
    issues: string[];
  } {
    const issues: string[] = [];
    let status: 'healthy' | 'warning' | 'error' = 'healthy';
    
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    
    // 检查是否长时间没有收到回调
    if (this.stats.message.lastTime && this.stats.message.lastTime < oneHourAgo) {
      issues.push(`超过1小时未收到消息回调 (最后时间: ${this.stats.message.lastTime.toLocaleString()})`);
      status = 'warning';
    }
    
    // 检查失败率
    const totalRequests = this.stats.verification.total + this.stats.message.total;
    const totalFailures = this.stats.verification.failed + this.stats.message.failed;
    
    if (totalRequests > 0) {
      const failureRate = totalFailures / totalRequests;
      if (failureRate > 0.1) { // 失败率超过10%
        issues.push(`回调失败率过高: ${(failureRate * 100).toFixed(1)}%`);
        status = failureRate > 0.3 ? 'error' : 'warning';
      }
    }
    
    // 检查最近是否有错误
    if (this.stats.recentErrors.length > 0) {
      const recentError = this.stats.recentErrors[0];
      const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
      
      if (recentError.timestamp > fiveMinutesAgo) {
        issues.push(`最近有错误: ${recentError.error}`);
        if (status === 'healthy') {
          status = 'warning';
        }
      }
    }
    
    return { status, issues };
  }

  /**
   * 格式化运行时间
   */
  private formatUptime(milliseconds: number): string {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) {
      return `${days}天 ${hours % 24}小时 ${minutes % 60}分钟`;
    } else if (hours > 0) {
      return `${hours}小时 ${minutes % 60}分钟`;
    } else if (minutes > 0) {
      return `${minutes}分钟 ${seconds % 60}秒`;
    } else {
      return `${seconds}秒`;
    }
  }

  /**
   * 重置统计数据
   */
  public resetStats(): void {
    this.stats.verification = {
      total: 0,
      success: 0,
      failed: 0,
      lastTime: null,
      lastError: null
    };
    
    this.stats.message = {
      total: 0,
      success: 0,
      failed: 0,
      lastTime: null,
      lastError: null,
      byType: {
        text: 0,
        image: 0,
        voice: 0,
        video: 0,
        event: 0,
        other: 0
      }
    };
    
    this.stats.startTime = new Date();
    this.stats.recentErrors = [];
  }
} 