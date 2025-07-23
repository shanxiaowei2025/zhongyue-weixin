# 构建阶段
FROM node:18-alpine AS builder

# 安装pnpm
RUN npm install -g pnpm

# 创建应用目录
WORKDIR /app

# 复制package.json和pnpm-lock.yaml
COPY package.json pnpm-lock.yaml ./

# 安装依赖
RUN pnpm install --frozen-lockfile

# 复制源代码
COPY . .

# 构建应用
RUN pnpm build

# 生产阶段
FROM node:18-alpine AS production

# 创建应用目录并设置权限
WORKDIR /app

# 创建非root用户
RUN addgroup -g 1001 -S nodejs && \
    adduser -S weixin -u 1001 -G nodejs

# 安装pnpm和生产依赖
RUN npm install -g pnpm

# 复制构建产物和必要文件
COPY --from=builder /app/dist ./dist
COPY package.json pnpm-lock.yaml ./
COPY --from=builder /app/src/config ./src/config

# 安装仅生产依赖
RUN pnpm install --prod --frozen-lockfile

# 创建日志目录并设置权限
RUN mkdir -p logs && chown -R weixin:nodejs logs

# 切换到非root用户
USER weixin

# 设置环境变量
ENV NODE_ENV=production
ENV PORT=3010

# 暴露端口
EXPOSE 3010

# 启动命令
CMD ["node", "dist/index.js"] 