import { Sequelize } from 'sequelize';
import config from '../config/default';

// 调试输出配置信息
console.log('===== 数据库配置信息 =====');
console.log('DB_HOST 环境变量:', process.env.DB_HOST);
console.log('DB_PORT 环境变量:', process.env.DB_PORT);
console.log('DB_USER 环境变量:', process.env.DB_USER);
console.log('DB_PASSWORD 环境变量是否设置:', process.env.DB_PASSWORD ? '已设置' : '未设置');
console.log('DB_NAME 环境变量:', process.env.DB_NAME);

console.log('config.database.host:', config.database.host);
console.log('config.database.port:', config.database.port);
console.log('config.database.username:', config.database.username);
console.log('config.database.password 是否设置:', config.database.password ? '已设置' : '未设置');
console.log('config.database.password 长度:', config.database.password ? config.database.password.length : 0);
console.log('config.database.database:', config.database.database);

// 确保密码传入，如果环境变量未设置则使用默认密码
const dbPassword = process.env.DB_PASSWORD || config.database.password || 'default_password_for_testing';

// 创建共享的 Sequelize 实例
const sequelize = new Sequelize(
  config.database.database,
  config.database.username,
  dbPassword, // 确保传入密码
  {
    host: config.database.host,
    port: config.database.port,
    dialect: 'mysql',
    dialectOptions: {
      charset: 'utf8mb4',
      // 不要设置collate选项，这会导致警告
    },
    logging: console.log, // 打开SQL查询日志
    pool: {
      max: 10,
      min: 0,
      acquire: 60000, // 增加获取连接的超时时间
      idle: 10000
    },
    retry: {
      match: [
        /Deadlock/i,
        /Lock wait timeout/i,
        /Connection lost/i,
        /PROTOCOL_CONNECTION_LOST/i,
        /Connection refused/i,
        /ECONNREFUSED/,
        /ETIMEDOUT/,
        /ER_ACCESS_DENIED_ERROR/
      ],
      max: 10 // 增加重试次数
    }
  }
);

console.log('Sequelize实例已创建，使用的密码长度:', dbPassword.length);

// 初始化连接函数
const initConnection = async (retryCount = 0, maxRetries = 5) => {
  try {
    console.log(`尝试连接数据库 (尝试 ${retryCount + 1}/${maxRetries + 1})...`);
    await sequelize.authenticate();
    console.log('数据库连接已成功建立');
    return true;
  } catch (error: any) {
    console.error(`数据库连接失败 (尝试 ${retryCount + 1}/${maxRetries + 1}):`, error.message);
    
    if (error.original) {
      console.error('原始错误:', error.original.message);
      console.error('错误代码:', error.original.code);
    }
    
    if (retryCount < maxRetries) {
      const delay = (retryCount + 1) * 5000; // 每次重试增加等待时间
      console.log(`将在 ${delay / 1000} 秒后重试连接...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return initConnection(retryCount + 1, maxRetries);
    } else {
      console.error('数据库连接失败，已达到最大重试次数');
      return false;
    }
  }
};

// 导出初始化函数供外部使用
export const initDatabase = initConnection;

export default sequelize; 