# 企业微信客户群响应监控工具

这是一个企业微信客户群响应监控工具，用于监控客户群中客户发送消息后是否得到了企业员工的及时回复。如果超过设定的时间阈值（如10、30、60、120、180分钟）未回复，系统会向管理员发送提醒消息。

## 功能特点

- 自动同步企业微信客户群信息
- 监控客户消息是否得到及时回复
- 支持多个时间阈值设置（10、30、60、120、180分钟）
- 当超过时间阈值时，向群主发送提醒消息
- 提供API接口用于手动触发同步、检查等操作
- 支持模拟消息接收（用于测试）
- Docker容器化部署

## 技术架构

- 后端: Node.js + TypeScript + Express
- 数据库: MySQL
- ORM: Sequelize
- 调度: node-schedule
- API交互: axios
- 容器化: Docker + Docker Compose

## 使用方式

### 方式一：Docker方式部署（推荐）

1. 克隆代码库
```bash
git clone <repo-url>
cd weixinuntil
```

2. 配置环境变量（两种方式任选一种）
   
   方式1：创建`.env`文件：
   ```bash
   cp .env.example .env
   # 编辑.env文件，填入您的实际配置
   ```
   
   方式2：通过环境变量传递（适用于CI/CD环境）：
   ```bash
   export CORP_ID=your_corp_id
   export CORP_SECRET=your_corp_secret
   # ... 设置其他环境变量
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
cp .env.example .env
# 编辑.env文件，填入您的实际配置
```

3. 确保MySQL数据库可用
确保你有一个可用的MySQL数据库实例，并在`.env`文件中正确配置了连接信息。

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

## 连接已有的MySQL容器

如果您已经有一个单独运行的MySQL容器，请按照以下步骤配置：

1. 修改`docker-compose.yml`文件，删除或注释掉mysql服务部分

2. 确保您的应用容器可以连接到MySQL容器：
   - 如果MySQL容器在同一Docker网络中，请设置`DB_HOST`为MySQL容器名
   - 如果MySQL容器在不同网络，请设置`DB_HOST`为MySQL容器的IP地址

3. 修改`.env`文件的数据库连接信息
```
DB_HOST=your_mysql_container_name_or_ip
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=weixinMonitor
```

4. 启动应用容器
```bash
docker-compose up -d app
```

## 接口说明

### 获取所有群聊信息
```
GET /api/groups
```

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

- 每10分钟同步一次群聊信息
- 每分钟检查一次响应情况

## 企业微信配置

使用此工具需要在企业微信管理后台进行以下配置：

1. 创建自建应用并获取相关凭证
2. 开通"客户联系"功能
3. 配置API接收消息和事件的URL（生产环境中需要）

## 注意事项

- 本项目需要企业微信管理员权限
- Docker环境中，日志会保存在`./logs`目录下
- 实际生产环境中需要处理企业微信的回调验证 