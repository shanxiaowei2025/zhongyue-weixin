console.log("src/config/default.ts 被加载");

export default {
  corpWeixin: {
    corpId: process.env.CORP_ID || '',
    corpSecret: process.env.CORP_SECRET || '',
    agentId: process.env.AGENT_ID || '',
    token: process.env.TOKEN || '',
    encodingAESKey: process.env.ENCODING_AES_KEY || '',
    additionalReceivers: process.env.ADDITIONAL_RECEIVERS ? process.env.ADDITIONAL_RECEIVERS.split(',').map(id => id.trim()).filter(id => id.length > 0) : []
  },
  server: {
    port: process.env.PORT || 3000
  },
  alert: {
    thresholds: (process.env.ALERT_THRESHOLDS || '10,30,60,120,180').split(',').map(Number)
  }
}
