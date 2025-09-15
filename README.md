# 企业微信客户群响应监控工具

这是一个企业微信客户群响应监控工具，用于监控客户群中客户发送消息后是否得到了企业员工的及时回复。如果超过设定的时间阈值（如10、30、60、120、180分钟）未回复，系统会向管理员发送提醒消息。

**🔄 重要更新：本项目现已改为使用 API 服务管理群组数据，不再直接连接数据库！**

## 功能特点

- 自动同步企业微信客户群信息
- 监控客户消息是否得到及时回复
- 支持多个时间阈值设置（10、30、60、120、180分钟）
- 当超过时间阈值时，向群主发送提醒消息
- 提供API接口用于手动触发同步、检查等操作
- 支持模拟消息接收（用于测试）
- Docker容器化部署
- **新功能：通过HTTP API接口管理群组数据，支持分布式部署**

## 技术架构

- 后端: Node.js + TypeScript + Express
- **数据存储: 通过 HTTP API 服务（替代原有的直接数据库访问）**
- ~~数据库: MySQL~~（已弃用）
- ~~ORM: Sequelize~~（已弃用）
- 调度: node-schedule
- API交互: axios
- 容器化: Docker + Docker Compose

## 数据架构变更说明

### 原有架构（已弃用）
```
应用 → Sequelize ORM → MySQL 数据库
```

### 新架构（当前）
```
应用 → GroupApiService → HTTP API 服务 → 后端数据存储
```

### 支持的 API 接口

本项目现在通过以下 API 接口管理群组数据：

- `POST /api/groups` - 创建群组
- `GET /api/groups` - 查询群组列表  
- `GET /api/groups/{id}` - 查询群组详情
- `PATCH /api/groups/{id}` - 更新群组信息
- `DELETE /api/groups/{id}` - 删除群组
- `GET /api/groups/chat/{chatId}` - 根据聊天ID查询群组
- `DELETE /api/groups/batch/remove` - 批量删除群组
- `PATCH /api/groups/{id}/last-message` - 更新群组最后消息
- `PATCH /api/groups/{id}/alert-settings` - 更新群组提醒设置
- `GET /api/groups/alerts/list` - 获取需要提醒的群组列表

## 使用方式

### 方式一：Docker方式部署（推荐）

1. 克隆代码库
```bash
git clone <repo-url>
cd zhongyue-weixin
```

2. 配置环境变量（两种方式任选一种）
   
   方式1：创建`.env`文件：
   ```bash
   # 企业微信群消息监控服务环境变量配置

   # 服务器端口
   PORT=3010

   # Groups API 基础 URL（重要：新增配置）
   GROUPS_API_BASE_URL=https://manage.zhongyuekuaiji.cn

   # 企业微信配置
   CORP_ID=your_corp_id
   CORP_SECRET=your_corp_secret
   AGENT_ID=your_agent_id

   # 额外提醒接收者（用逗号分隔的用户ID）
   ADDITIONAL_RECEIVERS=user1,user2,user3

   # 以下数据库配置现在已不再使用（因为使用API服务）
   # DB_HOST=localhost
   # DB_USER=root
   # DB_PASSWORD=your_password
   # DB_NAME=zhongyue_weixin
   # DB_PORT=3306
   ```

3. 构建和启动Docker容器
```bash
docker-compose up -d
```

4. 检查服务状态
```bash
docker-compose ps
docker logs weixin-monitor
```

### 方式二：本地开发/部署

1. 安装依赖
```bash
pnpm install
```

2. 配置环境变量
```bash
# 创建.env文件，设置必要的环境变量
# 特别注意设置 GROUPS_API_BASE_URL
```

3. **不再需要MySQL数据库配置**
   现在应用通过 API 服务管理数据，无需直接连接数据库。

4. 构建项目
```bash
pnpm build
```

5. 启动服务
```bash
pnpm start
```

6. 开发模式（监听文件变更）
```bash
pnpm dev
```

## ~~连接已有的MySQL容器~~（已弃用）

**注意：此部分已不再适用，因为应用现在使用 API 服务管理数据。**

## 接口说明

### 手动触发群信息同步
```
POST /api/sync
```

### 手动检查响应情况
```
POST /api/check
```

### 模拟接收消息（测试用）
```
POST /api/simulate/message
请求体:
{
  "chatId": "群聊ID",
  "message": {
    "msgId": "消息ID",
    "from": "发送者ID",
    "fromType": "employee|customer",
    "content": "消息内容",
    "createTime": "消息时间"
  }
}
```

## 定时任务

- ~~每10分钟同步一次群聊信息~~
- 每分钟检查一次响应情况

## 企业微信配置

使用此工具需要在企业微信管理后台进行以下配置：

1. 创建自建应用并获取相关凭证
2. 开通"客户联系"功能
3. 配置API接收消息和事件的URL（生产环境中需要）

## 环境变量配置

### 必需配置

- `GROUPS_API_BASE_URL`: 群组管理 API 的基础 URL（默认：https://manage.zhongyuekuaiji.cn）
- `CORP_ID`: 企业微信企业ID
- `CORP_SECRET`: 企业微信应用密钥
- `AGENT_ID`: 企业微信应用ID

### 可选配置

- `PORT`: 服务端口（默认：3010）
- `ADDITIONAL_RECEIVERS`: 额外的提醒接收者，用逗号分隔

## 注意事项

- 本项目需要企业微信管理员权限
- Docker环境中，日志会保存在`./logs`目录下
- 实际生产环境中需要处理企业微信的回调验证 
- **重要：确保群组管理 API 服务正常运行并且 GROUPS_API_BASE_URL 配置正确**
- **网络连接：应用需要能够访问配置的 API 服务地址**

## 迁移说明

如果您从旧版本（使用数据库）升级到新版本（使用API服务），请注意：

1. 现有的数据库数据需要通过 API 接口迁移到新的数据存储系统
2. 更新环境变量配置，添加 `GROUPS_API_BASE_URL`
3. 移除数据库相关的环境变量（如 DB_HOST, DB_PASSWORD 等）
4. 确保 API 服务正常运行并可访问 