import express from 'express';
import dotenv from 'dotenv';
import dotenvExpand from 'dotenv-expand';
import path from 'path';
import schedule from 'node-schedule';
import config from './config/default';
import { MonitorService } from './services/MonitorService';
import { CallbackStatsService } from './services/CallbackStatsService';
import WeixinCallbackController from './controllers/WeixinCallbackController';

// 更详细的环境变量调试选项
const dotenvOptions = {
  path: path.resolve(process.cwd(), '.env'),
  debug: true  // 开启调试模式
};
console.log('尝试从以下路径加载环境变量:', path.resolve(process.cwd(), '.env'));

// 加载环境变量 - 使用项目根目录的.env文件
const myEnv = dotenv.config(dotenvOptions);
dotenvExpand.expand(myEnv);

console.log('环境变量加载完成。检查关键变量:');
console.log('GROUPS_API_BASE_URL:', process.env.GROUPS_API_BASE_URL || '使用默认值');

// 创建Express应用
const app = express();

// 添加请求处理中间件
app.use(express.json());

// 处理XML请求，微信回调通常以XML格式发送
app.use(express.text({ type: ['text/xml', 'application/xml'] }));
app.use(express.urlencoded({ extended: true }));

// 添加日志中间件
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} [${req.method}] ${req.url}`);
  
  // 打印查询参数
  if (Object.keys(req.query).length > 0) {
    console.log('查询参数:', req.query);
  }
  
  // 打印请求头
  console.log('请求头:', req.headers['content-type']);
  
  next();
});

// 添加主路由
app.get('/', (req, res) => {
  res.send('企业微信群消息监控服务正在运行（现已使用API服务）');
});

// 添加回调接口
app.use('/api/weixin/callback', WeixinCallbackController.getRouter());

// 添加健康检查和统计接口
app.get('/api/health', (req, res) => {
  const callbackStats = CallbackStatsService.getInstance();
  const stats = callbackStats.getStats();
  
  res.json({
    service: 'zhongyue-weixin',
    status: stats.health.status,
    timestamp: new Date().toISOString(),
    uptime: stats.uptime,
    callback: {
      verification: stats.verification,
      message: stats.message,
      health: stats.health
    },
    recentErrors: stats.recentErrors.slice(0, 5) // 只显示最近5条错误
  });
});

// 添加详细统计接口
app.get('/api/callback/stats', (req, res) => {
  const callbackStats = CallbackStatsService.getInstance();
  const stats = callbackStats.getStats();
  res.json(stats);
});

// 添加重置统计接口（仅开发环境）
if (process.env.NODE_ENV !== 'production') {
  app.post('/api/callback/reset-stats', (req, res) => {
    const callbackStats = CallbackStatsService.getInstance();
    callbackStats.resetStats();
    res.json({ message: '统计数据已重置' });
  });
}

// 添加手动同步群组信息接口
app.post('/api/sync', async (req, res) => {
  try {
    console.log('手动触发同步群组信息');
    const monitorService = new MonitorService();
    await monitorService.syncAllGroups();
    res.json({ success: true, message: '群组信息同步成功' });
  } catch (error: any) {
    console.error('群组信息同步失败:', error);
    res.status(500).json({ error: '群组信息同步失败', details: error.message });
  }
});

// 添加手动检查响应情况接口
app.post('/api/check', async (req, res) => {
  try {
    console.log('手动触发检查响应情况');
    await MonitorService.checkAndSendAlerts();
    res.json({ success: true, message: '响应情况检查成功' });
  } catch (error: any) {
    console.error('响应情况检查失败:', error);
    res.status(500).json({ error: '响应情况检查失败', details: error.message });
  }
});

// 添加模拟消息接口（用于测试）
app.post('/api/simulate/message', async (req, res) => {
  try {
    const { chatId, message } = req.body;
    
    if (!chatId || !message) {
      return res.status(400).json({ error: '参数不完整' });
    }
    
    const monitorService = new MonitorService();
    await monitorService.simulateNewMessage(chatId, message);
    res.json({ success: true, message: '消息模拟成功' });
  } catch (error: any) {
    console.error('消息模拟失败:', error);
    res.status(500).json({ error: '消息模拟失败', details: error.message });
  }
});

// 初始化应用（简化版，不再需要数据库连接）
const init = async () => {
  try {
    console.log('开始初始化应用...');
    console.log('现在使用 API 服务管理群组数据，不再需要直接连接数据库');

    // 启动定时任务
    console.log('设置定时任务...');
    schedule.scheduleJob('* * * * *', async () => {
      try {
        console.log('======= 开始自动检查 =======');
        await MonitorService.checkAndSendAlerts();
        console.log('======= 自动检查完成 =======');
      }
      catch (monitorError) {
        console.error('监控任务执行失败:', monitorError);
      }
    });

    // 启动服务器
    const port = process.env.PORT || config.server.port || 3010;
    app.listen(port, () => {
      console.log(`服务器启动在端口: ${port}`);
      console.log('群组数据通过外部 API 服务管理');
      console.log('当前服务专注于消息监控和告警功能');
      console.log('');
      console.log('🔍 监控接口:');
      console.log(`  GET  http://localhost:${port}/api/health        - 健康检查和基本统计`);
      console.log(`  GET  http://localhost:${port}/api/callback/stats - 详细回调统计`);
      if (process.env.NODE_ENV !== 'production') {
        console.log(`  POST http://localhost:${port}/api/callback/reset-stats - 重置统计（仅开发环境）`);
      }
    });
  } catch (error) {
    console.error('应用初始化失败:', error);
  }
};

app.use(express.static('public'))

// 启动应用
init().catch(err => {
  console.error('应用启动失败:', err);
}); 