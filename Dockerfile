# 构建阶段
FROM node:18-alpine AS builder

# 安装pnpm
RUN npm install -g pnpm

# 设置npm镜像和超时配置
RUN npm config set registry https://registry.npmmirror.com/ && \
    npm config set fetch-timeout 600000 && \
    npm config set fetch-retries 5 && \
    npm config set network-timeout 600000 && \
    npm config set timeout 600000

# 创建应用目录
WORKDIR /app

# 复制package.json和pnpm-lock.yaml
COPY package.json pnpm-lock.yaml ./

# 安装依赖，增加重试和超时设置
RUN pnpm config set registry https://registry.npmmirror.com/ && \
    pnpm config set network-timeout 600000 && \
    pnpm install --frozen-lockfile --network-timeout 600000

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

# 设置npm镜像和超时配置
RUN npm config set registry https://registry.npmmirror.com/ && \
    npm config set fetch-timeout 600000 && \
    npm config set fetch-retries 5 && \
    npm config set network-timeout 600000 && \
    npm config set timeout 600000

# 复制package.json和pnpm-lock.yaml
COPY package.json pnpm-lock.yaml ./

# 安装仅生产依赖，增加重试和超时设置
RUN pnpm config set registry https://registry.npmmirror.com/ && \
    pnpm config set network-timeout 600000 && \
    pnpm install --frozen-lockfile --prod --network-timeout 600000

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