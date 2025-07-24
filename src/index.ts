import express from 'express';
import dotenv from 'dotenv';
import dotenvExpand from 'dotenv-expand';
import path from 'path';
import schedule from 'node-schedule';
import config from './config/default';
import { MonitorService } from './services/MonitorService';
import Group from './models/Group';
import WeixinCallbackController from './controllers/WeixinCallbackController';
import sequelize, { initDatabase } from './utils/database';

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
console.log('DB_PASSWORD存在:', !!process.env.DB_PASSWORD);
console.log('DB_HOST:', process.env.DB_HOST);

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
  res.send('企业微信群消息监控服务正在运行');
});

// 添加回调接口
app.use('/api/weixin/callback', WeixinCallbackController.getRouter());

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

// 初始化数据库并启动应用
const init = async () => {
  try {
    console.log('开始初始化应用...');

    // 尝试连接数据库并重试
    const dbConnected = await initDatabase();
    if (!dbConnected) {
      console.error('数据库连接失败，应用将尝试继续运行');
    } else {
      console.log('数据库连接成功');

      try {
        // 同步数据库模型
        console.log('正在同步数据库模型...');
        await Group.sync();
        console.log('数据库模型同步成功');
      } catch (syncError) {
        console.error('数据库模型同步失败:', syncError);
      }
    }

    // 启动定时任务，即使数据库连接失败也启动服务
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