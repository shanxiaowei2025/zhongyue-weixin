import express from 'express';
import dotenv from 'dotenv';
import dotenvExpand from 'dotenv-expand';
import path from 'path';
import schedule from 'node-schedule';
import config from './config/default';
import { MonitorService } from './services/MonitorService';
import { CallbackStatsService } from './services/CallbackStatsService';
import WeixinCallbackController from './controllers/WeixinCallbackController';
import { MessageArchiveService } from './services/MessageArchiveService';

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

// 添加手动检查响应情况接口
app.post('/api/check-responses', async (req, res) => {
  try {
    console.log('手动触发检查响应情况');
    const monitorService = new MonitorService();
    await monitorService.checkAllGroupsResponse();
    res.json({ 
      success: true, 
      message: '响应检查完成'
    });
  } catch (error: any) {
    console.error('检查响应失败:', error);
    res.status(500).json({ error: '检查响应失败', details: error.message });
  }
});

// 添加会话存档相关接口
app.get('/api/archive/health', async (req, res) => {
  try {
    const messageService = new MessageArchiveService({
      corpId: 'wwb477a7d74c001523',
      secret: '7ekI6yLsJNbkuusoeP2Vez9t_7Fz0yBDW3HrPLgY96M',
      privateKey: `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCnKOK9rpD/XTeb
NSPKWItJ5x0KAnEAgcpZOG5rY6+gpnX+NhKmWNea4m9ihd26z5spTzh1CFPtQ7qL
wZOX0LBHS5szhqEq8U5xbLHYaYhMJQAaTeHCioEREHe4oodxMONxgFS8A3eIQzGk
8nkyguGIEDjHKsV7KG1spqqe0PfFUzFkhnigG1xTjR9QdKE2PEqOceyuceaaMtE6
TcjOC5V6l3Tv7UUVt1edqD80loAFNOm98ESziV7YEHPZKO2o2y5yHzzJKDbhAXBu
50Gd4r3CBhDsLdWq+G1RnT5OLdjzrdIhL11PMFO2ly5iU1y8RkRYQB+zVHOjIG97
4RdNKaJtAgMBAAECggEACsVwruZTw5C/J4oqDzzbZNy2m1GC9JRodI1VWCgpRgHT
8piLZRqucfWLVd7oZcRA7E2Fhs0Nk2lc2OqVVyAEa+OsUYqoUfsQofBuGVLbjISJ
2CgSlxWTsYTNIiGe9qU+0q6BR0g16Jrj1Qwm0SFr5PeeoP7ZkNEPFAQ9VFSE0rsp
9toTncKgW/qGYvr6m4gIGwyfxi8O5PKDQ1eeftWZB66FyxfrcxB41umkRQT7GuyY
CtTIVeibzp7hjDWwIut4NWubB/8pxf0MmUvg2ZXWZjQnM4GG4TRqc4rxIweaqeI0
yrgpeGTexMH3essAPcZYwOJgmiXbeCLMRcR2bPcUYQKBgQDSLSUamzJ+8KANZT1L
wj4EVdg5zbCVbi/9lr3h63L70UUgfyfC2ZIlxMHNjEwWGaZu+79W5P3l7A+93Uq6
iWwldZlgm1Vm75YP4jyXJ5zGOge/8UkyDo6hoVm3qUQZeeCBbgOgqFpOqo9V1dk8
gb4Mjo0nPzvJ8FK+8DgFu+YzJQKBgQDLmsubQXRn3g2Z3Bl5ESSrRTnO1eoMnCJW
KdftxLRfY2SMPAyVZFdk7UzSIAA08ZODV0RwR9mCD8moRzRxCj2PoYr8RXQjGuUB
t9wvEkTBZQrmnKUV5ZBuhHjUqhTeHsIPO/5xJUUBfjHm7isDoSB24TY+rkOa99V8
Ip8N9wOzqQKBgQCgmkyzAwrYA0laUxU+scQwDeT3bpzT4uobDjg0zXUExcnb5i5c
72KFJ8+sINv3O0x5nDd+z+bP7c2tmM7EscQI787vCmN9D/EMXCVOn79lnexUGK2E
6ajGC4SCGn7mNMKARK/S8TJo0F5NCedBHCc8cyWbau9mBRVFwEwe3ZEvXQKBgE8s
sdJ9AJRHgEh9k5ZFuVm0wMcS3kHrEVsqSGKYpH+XegkibM5HR8jikoX/lbUA4Bkp
/V4gQo/WLdf3YIg4sDnDWvXA2GmyUq15XvEbDIucDEIjVfsO2zxu3UHtpdG+aj5c
WRSMpqnu9d7UbPurU6GG8H4ta/K+P1FXcTyP+uuJAoGBAIbRTwgUMg341txNiZXm
uftIHuH0jVa9ytUYUwZ0U7MbBeYuGpaO7dMBbSz9w0n5m5cutTCPv77UW8gxYkQt
t4uXwIg2j6fHF7wuE9opgVVZDGUoHIbIXoAHOtHBUTFAr23u3TXrl0rg283KNSGC
E3skLLFbCs1RgRWkaxNq8sO4
-----END PRIVATE KEY-----`
    });

    const isHealthy = await messageService.healthCheck();
    res.json({ 
      status: isHealthy ? 'healthy' : 'unhealthy',
      service: 'wework-archive-go-service',
      url: process.env.GO_SERVICE_URL || 'http://127.0.0.1:8889',
      message: isHealthy ? 'Go服务连接正常' : 'Go服务连接失败，请确保WeworkMsg服务正在运行'
    });
  } catch (error: any) {
    res.status(500).json({ 
      status: 'error',
      error: error.message 
    });
  }
});

// 获取聊天记录接口
app.get('/api/archive/records', async (req, res) => {
  try {
    const { seq = '0', limit = '100', timeout = '3' } = req.query;
    
    const messageService = new MessageArchiveService({
      corpId: 'wwb477a7d74c001523',
      secret: '7ekI6yLsJNbkuusoeP2Vez9t_7Fz0yBDW3HrPLgY96M',
      privateKey: `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCnKOK9rpD/XTeb
NSPKWItJ5x0KAnEAgcpZOG5rY6+gpnX+NhKmWNea4m9ihd26z5spTzh1CFPtQ7qL
wZOX0LBHS5szhqEq8U5xbLHYaYhMJQAaTeHCioEREHe4oodxMONxgFS8A3eIQzGk
8nkyguGIEDjHKsV7KG1spqqe0PfFUzFkhnigG1xTjR9QdKE2PEqOceyuceaaMtE6
TcjOC5V6l3Tv7UUVt1edqD80loAFNOm98ESziV7YEHPZKO2o2y5yHzzJKDbhAXBu
50Gd4r3CBhDsLdWq+G1RnT5OLdjzrdIhL11PMFO2ly5iU1y8RkRYQB+zVHOjIG97
4RdNKaJtAgMBAAECggEACsVwruZTw5C/J4oqDzzbZNy2m1GC9JRodI1VWCgpRgHT
8piLZRqucfWLVd7oZcRA7E2Fhs0Nk2lc2OqVVyAEa+OsUYqoUfsQofBuGVLbjISJ
2CgSlxWTsYTNIiGe9qU+0q6BR0g16Jrj1Qwm0SFr5PeeoP7ZkNEPFAQ9VFSE0rsp
9toTncKgW/qGYvr6m4gIGwyfxi8O5PKDQ1eeftWZB66FyxfrcxB41umkRQT7GuyY
CtTIVeibzp7hjDWwIut4NWubB/8pxf0MmUvg2ZXWZjQnM4GG4TRqc4rxIweaqeI0
yrgpeGTexMH3essAPcZYwOJgmiXbeCLMRcR2bPcUYQKBgQDSLSUamzJ+8KANZT1L
wj4EVdg5zbCVbi/9lr3h63L70UUgfyfC2ZIlxMHNjEwWGaZu+79W5P3l7A+93Uq6
iWwldZlgm1Vm75YP4jyXJ5zGOge/8UkyDo6hoVm3qUQZeeCBbgOgqFpOqo9V1dk8
gb4Mjo0nPzvJ8FK+8DgFu+YzJQKBgQDLmsubQXRn3g2Z3Bl5ESSrRTnO1eoMnCJW
KdftxLRfY2SMPAyVZFdk7UzSIAA08ZODV0RwR9mCD8moRzRxCj2PoYr8RXQjGuUB
t9wvEkTBZQrmnKUV5ZBuhHjUqhTeHsIPO/5xJUUBfjHm7isDoSB24TY+rkOa99V8
Ip8N9wOzqQKBgQCgmkyzAwrYA0laUxU+scQwDeT3bpzT4uobDjg0zXUExcnb5i5c
72KFJ8+sINv3O0x5nDd+z+bP7c2tmM7EscQI787vCmN9D/EMXCVOn79lnexUGK2E
6ajGC4SCGn7mNMKARK/S8TJo0F5NCedBHCc8cyWbau9mBRVFwEwe3ZEvXQKBgE8s
sdJ9AJRHgEh9k5ZFuVm0wMcS3kHrEVsqSGKYpH+XegkibM5HR8jikoX/lbUA4Bkp
/V4gQo/WLdf3YIg4sDnDWvXA2GmyUq15XvEbDIucDEIjVfsO2zxu3UHtpdG+aj5c
WRSMpqnu9d7UbPurU6GG8H4ta/K+P1FXcTyP+uuJAoGBAIbRTwgUMg341txNiZXm
uftIHuH0jVa9ytUYUwZ0U7MbBeYuGpaO7dMBbSz9w0n5m5cutTCPv77UW8gxYkQt
t4uXwIg2j6fHF7wuE9opgVVZDGUoHIbIXoAHOtHBUTFAr23u3TXrl0rg283KNSGC
E3skLLFbCs1RgRWkaxNq8sO4
-----END PRIVATE KEY-----`
    });

    const records = await messageService.getChatRecordsFromGoService(
      parseInt(seq as string), 
      parseInt(limit as string),
      parseInt(timeout as string)
    );
    
    res.json({
      success: true,
      count: records.length,
      data: records,
      params: {
        seq: parseInt(seq as string),
        limit: parseInt(limit as string),
        timeout: parseInt(timeout as string)
      }
    });
  } catch (error: any) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// 批量获取所有聊天记录接口
app.get('/api/archive/records/all', async (req, res) => {
  try {
    const { startSeq = '0', batchSize = '100' } = req.query;
    
    const messageService = new MessageArchiveService({
      corpId: 'wwb477a7d74c001523',
      secret: '7ekI6yLsJNbkuusoeP2Vez9t_7Fz0yBDW3HrPLgY96M',
      privateKey: `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCnKOK9rpD/XTeb
NSPKWItJ5x0KAnEAgcpZOG5rY6+gpnX+NhKmWNea4m9ihd26z5spTzh1CFPtQ7qL
wZOX0LBHS5szhqEq8U5xbLHYaYhMJQAaTeHCioEREHe4oodxMONxgFS8A3eIQzGk
8nkyguGIEDjHKsV7KG1spqqe0PfFUzFkhnigG1xTjR9QdKE2PEqOceyuceaaMtE6
TcjOC5V6l3Tv7UUVt1edqD80loAFNOm98ESziV7YEHPZKO2o2y5yHzzJKDbhAXBu
50Gd4r3CBhDsLdWq+G1RnT5OLdjzrdIhL11PMFO2ly5iU1y8RkRYQB+zVHOjIG97
4RdNKaJtAgMBAAECggEACsVwruZTw5C/J4oqDzzbZNy2m1GC9JRodI1VWCgpRgHT
8piLZRqucfWLVd7oZcRA7E2Fhs0Nk2lc2OqVVyAEa+OsUYqoUfsQofBuGVLbjISJ
2CgSlxWTsYTNIiGe9qU+0q6BR0g16Jrj1Qwm0SFr5PeeoP7ZkNEPFAQ9VFSE0rsp
9toTncKgW/qGYvr6m4gIGwyfxi8O5PKDQ1eeftWZB66FyxfrcxB41umkRQT7GuyY
CtTIVeibzp7hjDWwIut4NWubB/8pxf0MmUvg2ZXWZjQnM4GG4TRqc4rxIweaqeI0
yrgpeGTexMH3essAPcZYwOJgmiXbeCLMRcR2bPcUYQKBgQDSLSUamzJ+8KANZT1L
wj4EVdg5zbCVbi/9lr3h63L70UUgfyfC2ZIlxMHNjEwWGaZu+79W5P3l7A+93Uq6
iWwldZlgm1Vm75YP4jyXJ5zGOge/8UkyDo6hoVm3qUQZeeCBbgOgqFpOqo9V1dk8
gb4Mjo0nPzvJ8FK+8DgFu+YzJQKBgQDLmsubQXRn3g2Z3Bl5ESSrRTnO1eoMnCJW
KdftxLRfY2SMPAyVZFdk7UzSIAA08ZODV0RwR9mCD8moRzRxCj2PoYr8RXQjGuUB
t9wvEkTBZQrmnKUV5ZBuhHjUqhTeHsIPO/5xJUUBfjHm7isDoSB24TY+rkOa99V8
Ip8N9wOzqQKBgQCgmkyzAwrYA0laUxU+scQwDeT3bpzT4uobDjg0zXUExcnb5i5c
72KFJ8+sINv3O0x5nDd+z+bP7c2tmM7EscQI787vCmN9D/EMXCVOn79lnexUGK2E
6ajGC4SCGn7mNMKARK/S8TJo0F5NCedBHCc8cyWbau9mBRVFwUwe3ZEvXQKBgE8s
sdJ9AJRHgEh9k5ZFuVm0wMcS3kHrEVsqSGKYpH+XegkibM5HR8jikoX/lbUA4Bkp
/V4gQo/WLdf3YIg4sDnDWvXA2GmyUq15XvEbDIucDEIjVfsO2zxu3UHtpdG+aj5c
WRSMpqnu9d7UbPurU6GG8H4ta/K+P1FXcTyP+uuJAoGBAIbRTwgUMg341txNiZXm
uftIHuH0jVa9ytUYUwZ0U7MbBeYuGpaO7dMBbSz9w0n5m5cutTCPv77UW8gxYkQt
t4uXwIg2j6fHF7wuE9opgVVZDGUoHIbIXoAHOtHBUTFAr23u3TXrl0rg283KNSGC
E3skLLFbCs1RgRWkaxNq8sO4
-----END PRIVATE KEY-----`
    });

    const allRecords = await messageService.getAllChatRecordsFromGoService(
      parseInt(startSeq as string), 
      parseInt(batchSize as string)
    );
    
    res.json({
      success: true,
      total: allRecords.length,
      data: allRecords,
      params: {
        startSeq: parseInt(startSeq as string),
        batchSize: parseInt(batchSize as string)
      }
    });
  } catch (error: any) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// 处理会话存档通知接口
app.post('/api/archive/process', async (req, res) => {
  try {
    const messageService = new MessageArchiveService({
      corpId: 'wwb477a7d74c001523',
      secret: '7ekI6yLsJNbkuusoeP2Vez9t_7Fz0yBDW3HrPLgY96M',
      privateKey: `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCnKOK9rpD/XTeb
NSPKWItJ5x0KAnEAgcpZOG5rY6+gpnX+NhKmWNea4m9ihd26z5spTzh1CFPtQ7qL
wZOX0LBHS5szhqEq8U5xbLHYaYhMJQAaTeHCioEREHe4oodxMONxgFS8A3eIQzGk
8nkyguGIEDjHKsV7KG1spqqe0PfFUzFkhnigG1xTjR9QdKE2PEqOceyuceaaMtE6
TcjOC5V6l3Tv7UUVt1edqD80loAFNOm98ESziV7YEHPZKO2o2y5yHzzJKDbhAXBu
50Gd4r3CBhDsLdWq+G1RnT5OLdjzrdIhL11PMFO2ly5iU1y8RkRYQB+zVHOjIG97
4RdNKaJtAgMBAAECggEACsVwruZTw5C/J4oqDzzbZNy2m1GC9JRodI1VWCgpRgHT
8piLZRqucfWLVd7oZcRA7E2Fhs0Nk2lc2OqVVyAEa+OsUYqoUfsQofBuGVLbjISJ
2CgSlxWTsYTNIiGe9qU+0q6BR0g16Jrj1Qwm0SFr5PeeoP7ZkNEPFAQ9VFSE0rsp
9toTncKgW/qGYvr6m4gIGwyfxi8O5PKDQ1eeftWZB66FyxfrcxB41umkRQT7GuyY
CtTIVeibzp7hjDWwIut4NWubB/8pxf0MmUvg2ZXWZjQnM4GG4TRqc4rxIweaqeI0
yrgpeGTexMH3essAPcZYwOJgmiXbeCLMRcR2bPcUYQKBgQDSLSUamzJ+8KANZT1L
wj4EVdg5zbCVbi/9lr3h63L70UUgfyfC2ZIlxMHNjEwWGaZu+79W5P3l7A+93Uq6
iWwldZlgm1Vm75YP4jyXJ5zGOge/8UkyDo6hoVm3qUQZeeCBbgOgqFpOqo9V1dk8
gb4Mjo0nPzvJ8FK+8DgFu+YzJQKBgQDLmsubQXRn3g2Z3Bl5ESSrRTnO1eoMnCJW
KdftxLRfY2SMPAyVZFdk7UzSIAA08ZODV0RwR9mCD8moRzRxCj2PoYr8RXQjGuUB
t9wvEkTBZQrmnKUV5ZBuhHjUqhTeHsIPO/5xJUUBfjHm7isDoSB24TY+rkOa99V8
Ip8N9wOzqQKBgQCgmkyzAwrYA0laUxU+scQwDeT3bpzT4uobDjg0zXUExcnb5i5c
72KFJ8+sINv3O0x5nDd+z+bP7c2tmM7EscQI787vCmN9D/EMXCVOn79lnexUGK2E
6ajGC4SCGn7mNMKARK/S8TJo0F5NCedBHCc8cyWbau9mBRVFwEwe3ZEvXQKBgE8s
sdJ9AJRHgEh9k5ZFuVm0wMcS3kHrEVsqSGKYpH+XegkibM5HR8jikoX/lbUA4Bkp
/V4gQo/WLdf3YIg4sDnDWvXA2GmyUq15XvEbDIucDEIjVfsO2zxu3UHtpdG+aj5c
WRSMpqnu9d7UbPurU6GG8H4ta/K+P1FXcTyP+uuJAoGBAIbRTwgUMg341txNiZXm
uftIHuH0jVa9ytUYUwZ0U7MbBeYuGpaO7dMBbSz9w0n5m5cutTCPv77UW8gxYkQt
t4uXwIg2j6fHF7wuE9opgVVZDGUoHIbIXoAHOtHBUTFAr23u3TXrl0rg283KNSGC
E3skLLFbCs1RgRWkaxNq8sO4
-----END PRIVATE KEY-----`
    });

    await messageService.processMsgAuditNotify();
    
    res.json({
      success: true,
      message: '会话存档通知处理完成'
    });
  } catch (error: any) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// 测试实时消息拉取的路由
app.get('/test-realtime-messages', async (req, res) => {
  try {
    console.log('\n🚀 开始测试实时消息拉取...');
    
    const timeWindowHours = parseInt(req.query.hours as string) || 1;
    console.log(`⏰ 时间窗口: 最近 ${timeWindowHours} 小时`);
    
    // 拉取实时消息
    const messageService = new MessageArchiveService({
      corpId: 'wwb477a7d74c001523',
      secret: '7ekI6yLsJNbkuusoeP2Vez9t_7Fz0yBDW3HrPLgY96M',
      privateKey: `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCnKOK9rpD/XTeb
NSPKWItJ5x0KAnEAgcpZOG5rY6+gpnX+NhKmWNea4m9ihd26z5spTzh1CFPtQ7qL
wZOX0LBHS5szhqEq8U5xbLHYaYhMJQAaTeHCioEREHe4oodxMONxgFS8A3eIQzGk
8nkyguGIEDjHKsV7KG1spqqe0PfFUzFkhnigG1xTjR9QdKE2PEqOceyuceaaMtE6
TcjOC5V6l3Tv7UUVt1edqD80loAFNOm98ESziV7YEHPZKO2o2y5yHzzJKDbhAXBu
50Gd4r3CBhDsLdWq+G1RnT5OLdjzrdIhL11PMFO2ly5iU1y8RkRYQB+zVHOjIG97
4RdNKaJtAgMBAAECggEACsVwruZTw5C/J4oqDzzbZNy2m1GC9JRodI1VWCgpRgHT
8piLZRqucfWLVd7oZcRA7E2Fhs0Nk2lc2OqVVyAEa+OsUYqoUfsQofBuGVLbjISJ
2CgSlxWTsYTNIiGe9qU+0q6BR0g16Jrj1Qwm0SFr5PeeoP7ZkNEPFAQ9VFSE0rsp
9toTncKgW/qGYvr6m4gIGwyfxi8O5PKDQ1eeftWZB66FyxfrcxB41umkRQT7GuyY
CtTIVeibzp7hjDWwIut4NWubB/8pxf0MmUvg2ZXWZjQnM4GG4TRqc4rxIweaqeI0
yrgpeGTexMH3essAPcZYwOJgmiXbeCLMRcR2bPcUYQKBgQDSLSUamzJ+8KANZT1L
wj4EVdg5zbCVbi/9lr3h63L70UUgfyfC2ZIlxMHNjEwWGaZu+79W5P3l7A+93Uq6
iWwldZlgm1Vm75YP4jyXJ5zGOge/8UkyDo6hoVm3qUQZeeCBbgOgqFpOqo9V1dk8
gb4Mjo0nPzvJ8FK+8DgFu+YzJQKBgQDLmsubQXRn3g2Z3Bl5ESSrRTnO1eoMnCJW
KdftxLRfY2SMPAyVZFdk7UzSIAA08ZODV0RwR9mCD8moRzRxCj2PoYr8RXQjGuUB
t9wvEkTBZQrmnKUV5ZBuhHjUqhTeHsIPO/5xJUUBfjHm7isDoSB24TY+rkOa99V8
Ip8N9wOzqQKBgQCgmkyzAwrYA0laUxU+scQwDeT3bpzT4uobDjg0zXUExcnb5i5c
72KFJ8+sINv3O0x5nDd+z+bP7c2tmM7EscQI787vCmN9D/EMXCVOn79lnexUGK2E
6ajGC4SCGn7mNMKARK/S8TJo0F5NCedBHCc8cyWbau9mBRVFwEwe3ZEvXQKBgE8s
sdJ9AJRHgEh9k5ZFuVm0wMcS3kHrEVsqSGKYpH+XegkibM5HR8jikoX/lbUA4Bkp
/V4gQo/WLdf3YIg4sDnDWvXA2GmyUq15XvEbDIucDEIjVfsO2zxu3UHtpdG+aj5c
WRSMpqnu9d7UbPurU6GG8H4ta/K+P1FXcTyP+uuJAoGBAIbRTwgUMg341txNiZXm
uftIHuH0jVa9ytUYUwZ0U7MbBeYuGpaO7dMBbSz9w0n5m5cutTCPv77UW8gxYkQt
t4uXwIg2j6fHF7wuE9opgVVZDGUoHIbIXoAHOtHBUTFAr23u3TXrl0rg283KNSGC
E3skLLFbCs1RgRWkaxNq8sO4
-----END PRIVATE KEY-----`
    });

    const realtimeMessages = await messageService.getLatestRealTimeMessages(timeWindowHours);
    
    const response = {
      success: true,
      message: `成功拉取最近 ${timeWindowHours} 小时内的实时消息`,
      data: {
        timeWindow: `${timeWindowHours} 小时`,
        messageCount: realtimeMessages.length,
        messages: realtimeMessages.map(msg => ({
          msgid: msg.msgid,
          msgtime: msg.msgtime,
          formattedTime: messageService.formatMessageTime(msg.msgtime),
          msgtype: msg.msgtype,
          from: msg.from,
          roomid: msg.roomid,
          content: typeof msg.content === 'string' ? msg.content.substring(0, 100) : JSON.stringify(msg.content).substring(0, 100)
        }))
      }
    };
    
    res.json(response);
    
  } catch (error) {
    console.error('❌ 测试实时消息拉取失败:', error);
    res.status(500).json({
      success: false,
      message: '测试实时消息拉取失败',
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

// 启动实时消息监控的路由
app.post('/start-realtime-monitoring', async (req, res) => {
  try {
    const { intervalMinutes = 5, timeWindowHours = 1 } = req.body;
    
    console.log(`🔄 启动实时消息监控 - 间隔: ${intervalMinutes}分钟, 时间窗口: ${timeWindowHours}小时`);
    
    const messageService = new MessageArchiveService({
      corpId: 'wwb477a7d74c001523',
      secret: '7ekI6yLsJNbkuusoeP2Vez9t_7Fz0yBDW3HrPLgY96M',
      privateKey: `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCnKOK9rpD/XTeb
NSPKWItJ5x0KAnEAgcpZOG5rY6+gpnX+NhKmWNea4m9ihd26z5spTzh1CFPtQ7qL
wZOX0LBHS5szhqEq8U5xbLHYaYhMJQAaTeHCioEREHe4oodxMONxgFS8A3eIQzGk
8nkyguGIEDjHKsV7KG1spqqe0PfFUzFkhnigG1xTjR9QdKE2PEqOceyuceaaMtE6
TcjOC5V6l3Tv7UUVt1edqD80loAFNOm98ESziV7YEHPZKO2o2y5yHzzJKDbhAXBu
50Gd4r3CBhDsLdWq+G1RnT5OLdjzrdIhL11PMFO2ly5iU1y8RkRYQB+zVHOjIG97
4RdNKaJtAgMBAAECggEACsVwruZTw5C/J4oqDzzbZNy2m1GC9JRodI1VWCgpRgHT
8piLZRqucfWLVd7oZcRA7E2Fhs0Nk2lc2OqVVyAEa+OsUYqoUfsQofBuGVLbjISJ
2CgSlxWTsYTNIiGe9qU+0q6BR0g16Jrj1Qwm0SFr5PeeoP7ZkNEPFAQ9VFSE0rsp
9toTncKgW/qGYvr6m4gIGwyfxi8O5PKDQ1eeftWZB66FyxfrcxB41umkRQT7GuyY
CtTIVeibzp7hjDWwIut4NWubB/8pxf0MmUvg2ZXWZjQnM4GG4TRqc4rxIweaqeI0
yrgpeGTexMH3essAPcZYwOJgmiXbeCLMRcR2bPcUYQKBgQDSLSUamzJ+8KANZT1L
wj4EVdg5zbCVbi/9lr3h63L70UUgfyfC2ZIlxMHNjEwWGaZu+79W5P3l7A+93Uq6
iWwldZlgm1Vm75YP4jyXJ5zGOge/8UkyDo6hoVm3qUQZeeCBbgOgqFpOqo9V1dk8
gb4Mjo0nPzvJ8FK+8DgFu+YzJQKBgQDLmsubQXRn3g2Z3Bl5ESSrRTnO1eoMnCJW
KdftxLRfY2SMPAyVZFdk7UzSIAA08ZODV0RwR9mCD8moRzRxCj2PoYr8RXQjGuUB
t9wvEkTBZQrmnKUV5ZBuhHjUqhTeHsIPO/5xJUUBfjHm7isDoSB24TY+rkOa99V8
Ip8N9wOzqQKBgQCgmkyzAwrYA0laUxU+scQwDeT3bpzT4uobDjg0zXUExcnb5i5c
72KFJ8+sINv3O0x5nDd+z+bP7c2tmM7EscQI787vCmN9D/EMXCVOn79lnexUGK2E
6ajGC4SCGn7mNMKARK/S8TJo0F5NCedBHCc8cyWbau9mBRVFwEwe3ZEvXQKBgE8s
sdJ9AJRHgEh9k5ZFuVm0wMcS3kHrEVsqSGKYpH+XegkibM5HR8jikoX/lbUA4Bkp
/V4gQo/WLdf3YIg4sDnDWvXA2GmyUq15XvEbDIucDEIjVfsO2zxu3UHtpdG+aj5c
WRSMpqnu9d7UbPurU6GG8H4ta/K+P1FXcTyP+uuJAoGBAIbRTwgUMg341txNiZXm
uftIHuH0jVa9ytUYUwZ0U7MbBeYuGpaO7dMBbSz9w0n5m5cutTCPv77UW8gxYkQt
t4uXwIg2j6fHF7wuE9opgVVZDGUoHIbIXoAHOtHBUTFAr23u3TXrl0rg283KNSGC
E3skLLFbCs1RgRWkaxNq8sO4
-----END PRIVATE KEY-----`
    });
    
    // 在后台启动监控（不等待）
    messageService.startRealTimeMessageMonitoring(intervalMinutes, timeWindowHours)
      .catch((error: Error) => {
        console.error('实时消息监控出错:', error);
      });
    
    res.json({
      success: true,
      message: `实时消息监控已启动，每 ${intervalMinutes} 分钟检查一次，时间窗口 ${timeWindowHours} 小时`
    });
    
  } catch (error) {
    console.error('❌ 启动实时消息监控失败:', error);
    res.status(500).json({
      success: false,
      message: '启动实时消息监控失败',
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

// 获取指定时间范围内的消息
app.get('/messages-by-time-range', async (req, res) => {
  try {
    const { startTime, endTime } = req.query;
    
    if (!startTime || !endTime) {
      return res.status(400).json({
        success: false,
        message: '请提供 startTime 和 endTime 参数 (ISO 格式)'
      });
    }
    
    const start = new Date(startTime as string);
    const end = new Date(endTime as string);
    
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({
        success: false,
        message: '时间格式无效，请使用 ISO 格式 (例如: 2024-01-01T10:00:00.000Z)'
      });
    }
    
    console.log(`📅 获取时间范围内的消息: ${start.toLocaleString('zh-CN')} 到 ${end.toLocaleString('zh-CN')}`);
    
    const messageService = new MessageArchiveService({
      corpId: 'wwb477a7d74c001523',
      secret: '7ekI6yLsJNbkuusoeP2Vez9t_7Fz0yBDW3HrPLgY96M',
      privateKey: `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCnKOK9rpD/XTeb
NSPKWItJ5x0KAnEAgcpZOG5rY6+gpnX+NhKmWNea4m9ihd26z5spTzh1CFPtQ7qL
wZOX0LBHS5szhqEq8U5xbLHYaYhMJQAaTeHCioEREHe4oodxMONxgFS8A3eIQzGk
8nkyguGIEDjHKsV7KG1spqqe0PfFUzFkhnigG1xTjR9QdKE2PEqOceyuceaaMtE6
TcjOC5V6l3Tv7UUVt1edqD80loAFNOm98ESziV7YEHPZKO2o2y5yHzzJKDbhAXBu
50Gd4r3CBhDsLdWq+G1RnT5OLdjzrdIhL11PMFO2ly5iU1y8RkRYQB+zVHOjIG97
4RdNKaJtAgMBAAECggEACsVwruZTw5C/J4oqDzzbZNy2m1GC9JRodI1VWCgpRgHT
8piLZRqucfWLVd7oZcRA7E2Fhs0Nk2lc2OqVVyAEa+OsUYqoUfsQofBuGVLbjISJ
2CgSlxWTsYTNIiGe9qU+0q6BR0g16Jrj1Qwm0SFr5PeeoP7ZkNEPFAQ9VFSE0rsp
9toTncKgW/qGYvr6m4gIGwyfxi8O5PKDQ1eeftWZB66FyxfrcxB41umkRQT7GuyY
CtTIVeibzp7hjDWwIut4NWubB/8pxf0MmUvg2ZXWZjQnM4GG4TRqc4rxIweaqeI0
yrgpeGTexMH3essAPcZYwOJgmiXbeCLMRcR2bPcUYQKBgQDSLSUamzJ+8KANZT1L
wj4EVdg5zbCVbi/9lr3h63L70UUgfyfC2ZIlxMHNjEwWGaZu+79W5P3l7A+93Uq6
iWwldZlgm1Vm75YP4jyXJ5zGOge/8UkyDo6hoVm3qUQZeeCBbgOgqFpOqo9V1dk8
gb4Mjo0nPzvJ8FK+8DgFu+YzJQKBgQDLmsubQXRn3g2Z3Bl5ESSrRTnO1eoMnCJW
KdftxLRfY2SMPAyVZFdk7UzSIAA08ZODV0RwR9mCD8moRzRxCj2PoYr8RXQjGuUB
t9wvEkTBZQrmnKUV5ZBuhHjUqhTeHsIPO/5xJUUBfjHm7isDoSB24TY+rkOa99V8
Ip8N9wOzqQKBgQCgmkyzAwrYA0laUxU+scQwDeT3bpzT4uobDjg0zXUExcnb5i5c
72KFJ8+sINv3O0x5nDd+z+bP7c2tmM7EscQI787vCmN9D/EMXCVOn79lnexUGK2E
6ajGC4SCGn7mNMKARK/S8TJo0F5NCedBHCc8cyWbau9mBRVFwEwe3ZEvXQKBgE8s
sdJ9AJRHgEh9k5ZFuVm0wMcS3kHrEVsqSGKYpH+XegkibM5HR8jikoX/lbUA4Bkp
/V4gQo/WLdf3YIg4sDnDWvXA2GmyUq15XvEbDIucDEIjVfsO2zxu3UHtpdG+aj5c
WRSMpqnu9d7UbPurU6GG8H4ta/K+P1FXcTyP+uuJAoGBAIbRTwgUMg341txNiZXm
uftIHuH0jVa9ytUYUwZ0U7MbBeYuGpaO7dMBbSz9w0n5m5cutTCPv77UW8gxYkQt
t4uXwIg2j6fHF7wuE9opgVVZDGUoHIbIXoAHOtHBUTFAr23u3TXrl0rg283KNSGC
E3skLLFbCs1RgRWkaxNq8sO4
-----END PRIVATE KEY-----`
    });

    const messages = await messageService.getMessagesByTimeRange(start, end);
    
    res.json({
      success: true,
      message: `成功获取指定时间范围内的消息`,
      data: {
        timeRange: {
          start: start.toISOString(),
          end: end.toISOString(),
          startFormatted: start.toLocaleString('zh-CN'),
          endFormatted: end.toLocaleString('zh-CN')
        },
        messageCount: messages.length,
        messages: messages.map(msg => ({
          msgid: msg.msgid,
          msgtime: msg.msgtime,
          formattedTime: messageService.formatMessageTime(msg.msgtime),
          msgtype: msg.msgtype,
          from: msg.from,
          roomid: msg.roomid,
          content: typeof msg.content === 'string' ? msg.content.substring(0, 100) : JSON.stringify(msg.content).substring(0, 100)
        }))
      }
    });
    
  } catch (error) {
    console.error('❌ 获取指定时间范围消息失败:', error);
    res.status(500).json({
      success: false,
      message: '获取指定时间范围消息失败',
      error: error instanceof Error ? error.message : String(error)
    });
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
      console.log(`  POST http://localhost:${port}/api/sync          - 手动同步群组信息`);
      console.log(`  POST http://localhost:${port}/api/check-responses - 手动检查响应情况`);
      console.log('');
      console.log('📄 会话存档接口:');
      console.log(`  GET  http://localhost:${port}/api/archive/health - Go服务健康检查`);
      console.log(`  GET  http://localhost:${port}/api/archive/records?seq=0&limit=100 - 获取聊天记录`);
      console.log(`  GET  http://localhost:${port}/api/archive/records/all?startSeq=0&batchSize=100 - 批量获取所有记录`);
      console.log(`  POST http://localhost:${port}/api/archive/process - 处理会话存档通知`);
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