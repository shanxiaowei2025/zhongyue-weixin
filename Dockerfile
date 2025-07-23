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

# 设置工作目录
WORKDIR /app

# 安装pnpm
RUN npm install -g pnpm

# 复制package.json和pnpm-lock.yaml
COPY package.json pnpm-lock.yaml ./

# 安装仅生产依赖
RUN pnpm install --frozen-lockfile --prod

# 从构建阶段复制构建产物
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/config ./src/config

# 创建日志目录
RUN mkdir -p logs

# 设置环境变量
ENV NODE_ENV=production

# 暴露端口
EXPOSE 3010

# 启动命令
CMD ["node", "dist/index.js"] 