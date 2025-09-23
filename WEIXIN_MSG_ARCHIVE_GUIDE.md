# 企业微信会话存档实现指南

## 🚨 重要发现

经过调试发现，**企业微信会话存档无法通过REST API直接获取聊天数据**！

### ❌ 问题现象
- 调用 `/cgi-bin/msgaudit/get_chat_data` 返回 **404 Not Found**
- 获取许可用户列表成功：`{ errcode: 0, errmsg: 'ok', ids: [ 'LiuFei' ] }`
- 说明会话存档权限已开启，但官方不提供REST API获取实际聊天数据

### ✅ 正确的实现方式

企业微信官方要求使用**原生SDK** (`libWeWorkFinanceSdk_C.so`)，而不是HTTP API。

## 🎯 **推荐方案：方案1+2 完整实施**

### 📥 **第一步：下载企业微信官方SDK**

根据你的服务器环境选择对应SDK：

#### Linux服务器（推荐 SDK v3.0）
```bash
# 1. 创建SDK目录
mkdir -p ~/weixin-sdk
cd ~/weixin-sdk

# 2. 下载最新版本 SDK v3.0 (x86服务器)
# 访问企业微信官方文档下载，或使用以下命令：
wget https://wwcdn.weixin.qq.com/node/wework/images/xxx/libWeWorkFinanceSdk_C.so
# 注意：请从官方文档获取最新下载链接

# 3. 验证SDK文件
ls -la libWeWorkFinanceSdk_C.so
chmod +x libWeWorkFinanceSdk_C.so
```

#### Windows服务器
```bash
# 下载 WeWorkFinanceSdk.dll v3.0
# 放置在项目目录下
```

### 🚀 **第二步：部署WeworkMsg Go服务（方案1）**

```bash
# 1. 下载 WeworkMsg 项目
cd ~/projects  # 或你的项目目录
git clone https://github.com/Hanson/WeworkMsg
cd WeworkMsg

# 2. 检查Go环境
go version  # 确保Go已安装

# 3. 配置环境变量 (.env)
cat > .env << EOF
# 企业微信配置
CORP_ID=你的企业ID
SECRET=会话存档应用的Secret

# SDK路径配置
SDK_PATH=/home/用户名/weixin-sdk/libWeWorkFinanceSdk_C.so

# 私钥文件路径
PRIVATE_KEY_PATH=./private_key.pem

# 服务端口 (避免与Nginx 8888端口冲突)
PORT=8889

# 日志配置
LOG_LEVEL=info
EOF

# 4. 配置私钥文件
# 将企业微信会话存档的RSA私钥内容复制到此文件
touch private_key.pem
nano private_key.pem
# 粘贴私钥内容，格式如下：
# -----BEGIN RSA PRIVATE KEY-----
# 你的私钥内容
# -----END RSA PRIVATE KEY-----

# 5. 安装依赖并编译
go mod tidy
go build -o WeworkMsg

# 6. 测试运行
./WeworkMsg
```

### 🔧 **第三步：配置systemd服务（生产环境）**

```bash
# 1. 创建服务配置文件
sudo tee /etc/systemd/system/wework-msg.service > /dev/null << EOF
[Unit]
Description=WeWork Message Archive Service
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$PWD
ExecStart=$PWD/WeworkMsg
Restart=always
RestartSec=5
Environment=PORT=8889

[Install]
WantedBy=multi-user.target
EOF

# 2. 启用并启动服务
sudo systemctl daemon-reload
sudo systemctl enable wework-msg.service
sudo systemctl start wework-msg.service

# 3. 检查服务状态
sudo systemctl status wework-msg.service

# 4. 查看日志
sudo journalctl -u wework-msg.service -f
```

### 🔌 **第四步：Node.js集成调用（方案2）**

#### 4.1 修改 MessageArchiveService.ts

```typescript
// 修改现有的 MessageArchiveService.ts
import axios from 'axios';

interface ChatRecord {
  msgid: string;
  action: string;
  from: string;
  tolist: string[];
  roomid?: string;
  msgtime: number;
  msgtype: string;
  [key: string]: any;
}

interface ChatDataResponse {
  errcode: number;
  errmsg: string;
  chatdata: ChatRecord[];
}

export class MessageArchiveService {
  private readonly GO_SERVICE_URL = 'http://localhost:8889';

  /**
   * 获取聊天记录数据
   * @param seq 起始序号，首次传0
   * @param limit 限制数量，最大1000
   * @param timeout 超时时间，秒
   */
  async getChatRecords(seq: number = 0, limit: number = 100, timeout: number = 3): Promise<ChatRecord[]> {
    try {
      console.log(`正在获取聊天数据，seq: ${seq}, limit: ${limit}`);
      
      const response = await axios.post(`${this.GO_SERVICE_URL}/get_chat_data`, {
        seq,
        limit,
        timeout
      }, {
        timeout: 10000, // HTTP请求超时10秒
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const data: ChatDataResponse = response.data;
      
      if (data.errcode !== 0) {
        throw new Error(`获取聊天数据失败: ${data.errmsg}`);
      }

      console.log(`成功获取 ${data.chatdata?.length || 0} 条聊天记录`);
      return data.chatdata || [];
      
    } catch (error) {
      console.error('获取聊天数据失败:', error);
      throw error;
    }
  }

  /**
   * 分页获取所有聊天记录
   * @param startSeq 起始序号
   * @param batchSize 每批次大小
   */
  async getAllChatRecords(startSeq: number = 0, batchSize: number = 100): Promise<ChatRecord[]> {
    const allRecords: ChatRecord[] = [];
    let currentSeq = startSeq;
    
    try {
      while (true) {
        const records = await this.getChatRecords(currentSeq, batchSize);
        
        if (records.length === 0) {
          break; // 没有更多数据
        }
        
        allRecords.push(...records);
        console.log(`已获取 ${allRecords.length} 条记录`);
        
        // 更新seq为最后一条记录的seq + 1
        currentSeq += records.length;
        
        // 避免请求过于频繁
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      return allRecords;
    } catch (error) {
      console.error('批量获取聊天记录失败:', error);
      throw error;
    }
  }

  /**
   * 健康检查 - 测试Go服务连接
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await axios.get(`${this.GO_SERVICE_URL}/health`, {
        timeout: 5000
      });
      return response.status === 200;
    } catch (error) {
      console.error('Go服务连接失败:', error);
      return false;
    }
  }
}
```

#### 4.2 在路由中使用

```typescript
// 在你的路由文件中添加
import { MessageArchiveService } from './services/MessageArchiveService';

const messageService = new MessageArchiveService();

// 测试连接
app.get('/api/archive/health', async (req, res) => {
  try {
    const isHealthy = await messageService.healthCheck();
    res.json({ 
      status: isHealthy ? 'healthy' : 'unhealthy',
      service: 'wework-archive-go-service'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 获取聊天记录
app.get('/api/archive/records', async (req, res) => {
  try {
    const { seq = 0, limit = 100 } = req.query;
    const records = await messageService.getChatRecords(
      parseInt(seq as string), 
      parseInt(limit as string)
    );
    
    res.json({
      success: true,
      count: records.length,
      data: records
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});
```

### 🔍 **第五步：测试验证**

```bash
# 1. 测试Go服务是否正常运行
curl http://localhost:8889/health

# 2. 测试获取聊天数据
curl -X POST http://localhost:8889/get_chat_data \
  -H "Content-Type: application/json" \
  -d '{
    "seq": 0,
    "limit": 10,
    "timeout": 3
  }'

# 3. 测试Node.js API
curl http://localhost:3010/api/archive/health
curl "http://localhost:3010/api/archive/records?seq=0&limit=10"
```

### 🛡️ **第六步：安全配置**

#### 6.1 防火墙配置
```bash
# 仅允许本地访问Go服务（推荐）
sudo ufw allow from 127.0.0.1 to any port 8889

# 或者开放给特定IP
sudo ufw allow from 你的IP地址 to any port 8889
```

#### 6.2 Nginx反向代理（可选）
```nginx
# /etc/nginx/sites-available/default
location /api/archive/go/ {
    proxy_pass http://localhost:8889/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

## 📋 **完整架构总览**

```
┌─────────────────────────────────────────────────────────────┐
│                    企业微信会话存档架构                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│  │ Node.js API │───▶│ Go服务:8889  │───▶│ 企业微信SDK  │     │
│  │ (你的项目)   │    │ WeworkMsg   │    │ (C/C++库)   │     │
│  │ Port: 3010  │    │             │    │             │     │
│  └─────────────┘    └─────────────┘    └─────────────┘     │
│         │                   │                   │          │
│         ▼                   ▼                   ▼          │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│  │   业务逻辑   │    │   HTTP接口   │    │  原生SDK调用 │     │
│  │   数据存储   │    │   JSON响应   │    │   数据解密   │     │
│  │   API路由   │    │   错误处理   │    │   媒体下载   │     │
│  └─────────────┘    └─────────────┘    └─────────────┘     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 🎯 **关键配置项总结**

| 配置项 | 位置 | 说明 |
|--------|------|------|
| **企业ID** | WeworkMsg/.env | 企业微信后台获取 |
| **Secret** | WeworkMsg/.env | 会话存档应用密钥 |
| **私钥** | WeworkMsg/private_key.pem | RSA私钥文件 |
| **SDK路径** | WeworkMsg/.env | libWeWorkFinanceSdk_C.so位置 |
| **端口** | 8889 | 避免与Nginx冲突 |

## ✅ **完成检查清单**

- [ ] 下载并配置企业微信官方SDK
- [ ] 部署WeworkMsg Go服务
- [ ] 配置环境变量和私钥
- [ ] 修改Node.js MessageArchiveService
- [ ] 测试服务连接和数据获取
- [ ] 配置systemd服务（生产环境）
- [ ] 设置防火墙和安全策略

按照以上步骤操作后，你就能在Node.js项目中成功获取企业微信会话存档数据了！