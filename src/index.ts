import express from 'express';
import dotenv from 'dotenv';
import dotenvExpand from 'dotenv-expand';
import path from 'path';
import schedule from 'node-schedule';
import config from './config/default';
import { MonitorService } from './services/MonitorService';
import { Sequelize } from 'sequelize';
import Group from './models/Group';
import WeixinCallbackController from './controllers/WeixinCallbackController';

// 加载环境变量
const myEnv = dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenvExpand.expand(myEnv);

// 创建Express应用
const app = express();
app.use(express.json());
app.use(express.text({ type: 'text/xml' }));
app.use(express.urlencoded({ extended: true }));

// 创建监控服务实例
const monitorService = new MonitorService();

// 初始化数据库
const sequelize = new Sequelize(
  config.database.database,
  config.database.username,
  config.database.password,
  {
    host: config.database.host,
    port: config.database.port,
    dialect: 'mysql',
    dialectOptions: {
      charset: 'utf8mb4',
      collate: 'utf8mb4_unicode_ci'
    },
    pool: {
      max: 10,
      min: 0,
      acquire: 30000,
      idle: 10000
    }
  }
);

// 确保表已创建
async function initDatabase() {
  try {
    await sequelize.authenticate();
    console.log('数据库连接成功');
    
    // 同步模型到数据库
    await sequelize.sync();
    console.log('数据库表已同步');
  } catch (error) {
    console.error('数据库初始化失败:', error);
    process.exit(1);
  }
}

// 设置定时任务
function setupSchedules() {
  // 每隔10分钟同步一次群信息
  schedule.scheduleJob('*/10 * * * *', async () => {
    console.log('开始执行定时同步任务...');
    try {
      await monitorService.syncAllGroups();
    } catch (err) {
      console.error('定时同步任务执行失败:', err);
    }
  });

  // 每分钟检查一次响应情况
  schedule.scheduleJob('* * * * *', async () => {
    console.log('开始执行响应检查任务...');
    try {
      await monitorService.checkAllGroupsResponse();
    } catch (err) {
      console.error('响应检查任务执行失败:', err);
    }
  });
}

// 基本路由
app.get('/', (req, res) => {
  res.send('企业微信客户群响应监控工具正在运行中');
});

// API路由 - 获取所有群聊信息
app.get('/api/groups', async (req, res) => {
  try {
    const groups = await Group.findAll();
    res.json(groups);
  } catch (error) {
    res.status(500).json({ error: '获取群聊信息失败' });
  }
});

// API路由 - 手动同步群信息
app.post('/api/sync', async (req, res) => {
  try {
    await monitorService.syncAllGroups();
    res.json({ message: '群信息同步成功' });
  } catch (error) {
    res.status(500).json({ error: '群信息同步失败' });
  }
});

// API路由 - 手动检查响应情况
app.post('/api/check', async (req, res) => {
  try {
    await monitorService.checkAllGroupsResponse();
    res.json({ message: '响应情况检查成功' });
  } catch (error) {
    res.status(500).json({ error: '响应情况检查失败' });
  }
});

// API路由 - 检查配置信息（调试用）
app.get('/api/config-check', (req, res) => {
  try {
    const configInfo = {
      additionalReceivers: {
        env: process.env.ADDITIONAL_RECEIVERS || '未设置',
        parsed: config.corpWeixin.additionalReceivers,
        length: config.corpWeixin.additionalReceivers ? config.corpWeixin.additionalReceivers.length : 0
      },
      corpWeixin: {
        corpId: config.corpWeixin.corpId ? '已设置' : '未设置',
        corpSecret: config.corpWeixin.corpSecret ? '已设置' : '未设置',
        agentId: config.corpWeixin.agentId || '未设置',
        token: config.corpWeixin.token ? '已设置' : '未设置',
        encodingAESKey: config.corpWeixin.encodingAESKey ? '已设置' : '未设置'
      },
      alerts: {
        thresholds: config.alert.thresholds
      }
    };
    
    res.json({ 
      message: '配置检查', 
      config: configInfo
    });
  } catch (error) {
    res.status(500).json({ error: '配置检查失败' });
  }
});

// API路由 - 设置额外接收者（调试用）
app.post('/api/set-receivers', (req, res) => {
  try {
    const { receivers } = req.body;
    
    if (!receivers || !Array.isArray(receivers)) {
      return res.status(400).json({ error: '无效的接收者数组' });
    }
    
    console.log('通过API设置额外接收者:', receivers);
    config.corpWeixin.additionalReceivers = receivers;
    console.log('设置后的额外接收者:', config.corpWeixin.additionalReceivers);
    
    return res.json({ 
      message: '额外接收者设置成功',
      currentReceivers: config.corpWeixin.additionalReceivers
    });
  } catch (error) {
    console.error('设置额外接收者失败:', error);
    return res.status(500).json({ error: '设置额外接收者失败' });
  }
});

// 企业微信回调接口
app.all('/api/weixin/callback', (req, res) => {
  WeixinCallbackController.handleCallback(req, res);
});

// 模拟接收消息的路由（实际应用中应当由企业微信回调）
app.post('/api/simulate/message', async (req, res) => {
  try {
    const { chatId, message } = req.body;
    
    if (!chatId || !message) {
      return res.status(400).json({ error: '参数不完整' });
    }
    
    await monitorService.simulateNewMessage(chatId, message);
    res.json({ message: '消息模拟成功' });
  } catch (error) {
    console.error('消息模拟失败:', error);
    res.status(500).json({ error: '消息模拟失败' });
  }
});

// 启动函数
async function start() {
  try {
    await initDatabase();
    setupSchedules();
    
    // 手动设置额外接收者（调试用）
    if (process.env.ADDITIONAL_RECEIVERS) {
      console.log('从环境变量设置额外接收者:', process.env.ADDITIONAL_RECEIVERS);
      const receivers = process.env.ADDITIONAL_RECEIVERS.split(',').map(id => id.trim()).filter(id => id.length > 0);
      console.log('解析后的接收者:', receivers);
      config.corpWeixin.additionalReceivers = receivers;
      console.log('最终设置的额外接收者:', config.corpWeixin.additionalReceivers);
    } else {
      console.log('环境变量 ADDITIONAL_RECEIVERS 未设置');
    }
    
    // 启动服务器
    const PORT = config.server.port;
    app.listen(PORT, () => {
      console.log(`服务器已启动，监听端口 ${PORT}`);
      console.log(`监控时间阈值: ${config.alert.thresholds.join(', ')} 分钟`);
      console.log(`企业微信回调URL: http://[服务器IP]:${PORT}/api/weixin/callback`);
      
      // 启动后5秒执行一次检查
      console.log('系统将在5秒后执行一次检查...');
      setTimeout(async () => {
        try {
          console.log('\n======= 执行启动后自动检查 =======');
          await monitorService.checkAllGroupsResponse();
          console.log('======= 自动检查完成 =======\n');
        } catch (err) {
          console.error('自动检查执行失败:', err);
        }
      }, 5000);
    });
  } catch (error) {
    console.error('服务启动失败:', error);
    process.exit(1);
  }
}

// 启动应用
start(); 