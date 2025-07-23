export default {
  corpWeixin: {
    corpId: process.env.CORP_ID || '',
    corpSecret: process.env.CORP_SECRET || '',
    agentId: process.env.AGENT_ID || '',
    token: process.env.TOKEN || '',
    encodingAESKey: process.env.ENCODING_AES_KEY || '',
    additionalReceivers: process.env.ADDITIONAL_RECEIVERS ? process.env.ADDITIONAL_RECEIVERS.split(',').map(id => id.trim()).filter(id => id.length > 0) : []
  },
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306'),
    username: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'weixinMonitor',
    dialect: 'mysql'
  },
  server: {
    port: process.env.PORT || 3000
  },
  alert: {
    thresholds: (process.env.ALERT_THRESHOLDS || '10,30,60,120,180').split(',').map(Number)
  }
}
