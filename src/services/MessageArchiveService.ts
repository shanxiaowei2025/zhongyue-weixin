import axios from 'axios';
import * as crypto from 'crypto';

interface MessageArchiveConfig {
  corpId: string;
  secret: string;
  privateKey: string; // RSA私钥，用于解密会话内容
}

// Go服务返回的数据结构
interface GoChatData {
  seq: number;
  msgid: string;
  publickey_ver?: number;
  message: any; // 实际的消息内容
}

interface GoChatDataResponse {
  errcode: number;
  errmsg: string;
  chatdata: GoChatData[];
}

// 标准化后的聊天记录结构
interface ChatRecord {
  msgid: string;
  action: string;
  from: string;
  tolist: string[];
  roomid?: string;
  msgtime: number;
  msgtype: string;
  content: any;
  [key: string]: any;
}

interface ChatDataResponse {
  errcode: number;
  errmsg: string;
  chatdata: ChatRecord[];
}

export class MessageArchiveService {
  private config: MessageArchiveConfig;
  private accessToken: string | null = null;
  private tokenExpireTime: number = 0;
  private readonly GO_SERVICE_URL = process.env.GO_SERVICE_URL || 'http://127.0.0.1:8889';

  constructor(config: MessageArchiveConfig) {
    this.config = config;
  }

  /**
   * 获取访问凭证
   */
  async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpireTime) {
      return this.accessToken;
    }

    try {
      const response = await axios.get(
        `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${this.config.corpId}&corpsecret=${this.config.secret}`
      );

      if (response.data.errcode === 0) {
        this.accessToken = response.data.access_token;
        this.tokenExpireTime = Date.now() + (response.data.expires_in - 300) * 1000; // 提前5分钟过期
        return this.accessToken!;
      } else {
        throw new Error(`获取访问凭证失败: ${response.data.errmsg}`);
      }
    } catch (error) {
      console.error('获取访问凭证失败:', error);
      throw error;
    }
  }

  /**
   * 健康检查 - 测试Go服务连接
   * 由于WeworkMsg服务可能没有标准的/health端点，我们尝试多种方式检测服务可用性
   */
  async healthCheck(): Promise<boolean> {
    // 尝试多个可能的端点来检测服务是否运行
    const endpointsToTry = [
      '/health',
      '/ping', 
      '/status',
      '/'
    ];

    for (const endpoint of endpointsToTry) {
      try {
        const response = await axios.get(`${this.GO_SERVICE_URL}${endpoint}`, {
          timeout: 3000
        });
        
        // 如果得到任何响应（即使是404），说明服务在运行
        if (response.status >= 200 && response.status < 500) {
          console.log(`Go服务检测成功，端点: ${endpoint}, 状态码: ${response.status}`);
          return true;
        }
      } catch (error: any) {
        // 如果是404错误，说明服务在运行但端点不存在
        if (error.response && error.response.status === 404) {
          console.log(`Go服务检测成功，端点: ${endpoint} 返回404但服务正在运行`);
          return true;
        }
        
        // 继续尝试下一个端点
        console.log(`端点 ${endpoint} 检测失败:`, error.message);
      }
    }

    // 最后尝试TCP连接检测
    try {
      const net = require('net');
      const socket = new net.Socket();
      
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          socket.destroy();
          console.error('Go服务TCP连接超时');
          resolve(false);
        }, 3000);

        const host = process.env.GO_SERVICE_HOST || 'host.docker.internal';
        socket.connect(8889, host, () => {
          clearTimeout(timeout);
          socket.destroy();
          console.log('Go服务TCP连接成功');
          resolve(true);
        });

        socket.on('error', (error: any) => {
          clearTimeout(timeout);
          console.error('Go服务TCP连接失败:', error.message);
          resolve(false);
        });
      });
    } catch (error) {
      console.error('Go服务连接检测失败:', error);
      return false;
    }
  }

  /**
   * 通过Go服务获取群聊记录数据（只返回群消息）
   * @param seq 起始序号，首次传0
   * @param limit 限制数量，最大1000
   * @param timeout 超时时间，秒
   * @param groupOnly 是否只返回群消息，默认true
   */
  async getChatRecordsFromGoService(seq: number = 0, limit: number = 100, timeout: number = 3, groupOnly: boolean = true): Promise<ChatRecord[]> {
    try {
      console.log(`正在通过Go服务获取聊天数据，seq: ${seq}, limit: ${limit}`);
      
      const response = await axios.post(`${this.GO_SERVICE_URL}/get_chat_data`, {
        seq,
        limit,
        timeout,
        proxy: "",
        passwd: ""
      }, {
        timeout: 10000, // HTTP请求超时10秒
        headers: {
          'Content-Type': 'application/json'
        }
      });

      // 处理Go服务返回的数据结构
      const goData: GoChatDataResponse = response.data;
      
      if (goData.errcode !== 0) {
        throw new Error(`获取聊天数据失败: ${goData.errmsg}`);
      }

      console.log(`✅ 成功获取 ${goData.chatdata?.length || 0} 条聊天记录`);
      
      // 转换Go服务数据结构为标准ChatRecord格式
      const chatRecords: ChatRecord[] = [];
      
      for (const goRecord of goData.chatdata || []) {
        try {
          // 调试：打印前几条消息的原始结构
          if (chatRecords.length < 3) {
            console.log(`调试 - Go服务返回的原始消息结构 (msgid: ${goRecord.msgid}):`);
            console.log(JSON.stringify(goRecord, null, 2));
          }
          
          const chatRecord = this.convertGoChatDataToChatRecord(goRecord);
          if (chatRecord) {
            chatRecords.push(chatRecord);
          }
        } catch (convertError) {
          console.error(`转换消息记录失败 (msgid: ${goRecord.msgid}):`, convertError);
          // 继续处理其他记录，不中断整个流程
        }
      }
      
      // 🎯 如果启用了群消息过滤，只返回群消息
      if (groupOnly) {
        const groupMessages = chatRecords.filter(record => {
          const hasRoomId = record.roomid && record.roomid.trim() !== '';
          if (!hasRoomId) {
            console.log(`🚫 过滤掉非群消息: ${record.msgid}`);
          }
          return hasRoomId;
        });
        console.log(`✅ 成功转换 ${chatRecords.length} 条记录，其中群消息 ${groupMessages.length} 条`);
        return groupMessages;
      }
      
      console.log(`✅ 成功转换 ${chatRecords.length} 条聊天记录`);
      return chatRecords;
      
    } catch (error) {
      console.error('通过Go服务获取聊天数据失败:', error);
      throw error;
    }
  }

  /**
   * 分页获取所有群聊记录（过滤掉单聊消息）
   * @param startSeq 起始序号
   * @param batchSize 每批次大小
   */
  async getAllChatRecordsFromGoService(startSeq: number = 0, batchSize: number = 100): Promise<ChatRecord[]> {
    const allGroupRecords: ChatRecord[] = [];
    let currentSeq = startSeq;
    
    try {
      while (true) {
        // 🎯 默认启用群消息过滤
        const groupRecords = await this.getChatRecordsFromGoService(currentSeq, batchSize, 3, true);
        
        if (groupRecords.length === 0) {
          break; // 没有更多群消息数据
        }
        
        allGroupRecords.push(...groupRecords);
        console.log(`📊 已获取群消息: ${allGroupRecords.length} 条`);
        
        // 更新seq（注意：这里需要根据实际获取的记录数更新，而不是过滤后的数量）
        // 为了安全起见，我们按批次大小递增
        currentSeq += batchSize;
        
        // 避免请求过于频繁
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      console.log(`🎯 群消息获取完成: 共 ${allGroupRecords.length} 条群消息`);
      return allGroupRecords;
    } catch (error) {
      console.error('批量获取群聊记录失败:', error);
      throw error;
    }
  }

  /**
   * 获取指定群的聊天记录
   * @param roomId 群ID
   * @param startSeq 起始序号
   * @param batchSize 每批次大小
   */
  async getGroupChatRecords(roomId: string, startSeq: number = 0, batchSize: number = 100): Promise<ChatRecord[]> {
    try {
      console.log(`🎯 开始获取群 ${roomId} 的聊天记录`);
      
      const allRecords = await this.getAllChatRecordsFromGoService(startSeq, batchSize);
      
      // 过滤出指定群的消息
      const groupMessages = allRecords.filter(record => record.roomid === roomId);
      
      console.log(`✅ 群 ${roomId} 共有 ${groupMessages.length} 条消息`);
      return groupMessages;
    } catch (error) {
      console.error(`获取群 ${roomId} 聊天记录失败:`, error);
      throw error;
    }
  }

  /**
   * 获取群消息统计信息
   * @param startSeq 起始序号
   * @param batchSize 每批次大小
   */
  async getGroupMessageStats(startSeq: number = 0, batchSize: number = 100): Promise<any> {
    try {
      console.log('📊 开始统计群消息数据...');
      
      const allGroupRecords = await this.getAllChatRecordsFromGoService(startSeq, batchSize);
      
      // 按群ID分组统计
      const groupStats: { [roomId: string]: any } = {};
      const messageTypeStats: { [type: string]: number } = {};
      const senderStats: { [sender: string]: number } = {};
      
      for (const record of allGroupRecords) {
        const roomId = record.roomid || 'unknown';
        
        // 群消息统计
        if (!groupStats[roomId]) {
          groupStats[roomId] = {
            roomId,
            messageCount: 0,
            messageTypes: {},
            senders: new Set(),
            latestMessage: null,
            earliestMessage: null
          };
        }
        
        groupStats[roomId].messageCount++;
        groupStats[roomId].senders.add(record.from);
        
        // 消息类型统计
        const msgType = record.msgtype || 'unknown';
        groupStats[roomId].messageTypes[msgType] = (groupStats[roomId].messageTypes[msgType] || 0) + 1;
        messageTypeStats[msgType] = (messageTypeStats[msgType] || 0) + 1;
        
        // 发送者统计
        senderStats[record.from] = (senderStats[record.from] || 0) + 1;
        
        // 更新最新和最早消息时间
        if (!groupStats[roomId].latestMessage || record.msgtime > groupStats[roomId].latestMessage.msgtime) {
          groupStats[roomId].latestMessage = record;
        }
        if (!groupStats[roomId].earliestMessage || record.msgtime < groupStats[roomId].earliestMessage.msgtime) {
          groupStats[roomId].earliestMessage = record;
        }
      }
      
      // 转换Set为数量
      Object.keys(groupStats).forEach(roomId => {
        groupStats[roomId].senderCount = groupStats[roomId].senders.size;
        delete groupStats[roomId].senders;
      });
      
      const stats = {
        totalGroupMessages: allGroupRecords.length,
        totalGroups: Object.keys(groupStats).length,
        groupStats,
        messageTypeStats,
        topSenders: Object.entries(senderStats)
          .sort(([,a], [,b]) => (b as number) - (a as number))
          .slice(0, 10),
        summary: {
          mostActiveGroup: Object.entries(groupStats)
            .sort(([,a], [,b]) => (b as any).messageCount - (a as any).messageCount)[0],
          mostCommonMessageType: Object.entries(messageTypeStats)
            .sort(([,a], [,b]) => (b as number) - (a as number))[0]
        }
      };
      
      console.log('📈 群消息统计完成:');
      console.log(`- 总群消息数: ${stats.totalGroupMessages}`);
      console.log(`- 涉及群数: ${stats.totalGroups}`);
      console.log(`- 最活跃群: ${stats.summary.mostActiveGroup?.[1]?.messageCount || 0} 条消息`);
      console.log(`- 最常见消息类型: ${stats.summary.mostCommonMessageType?.[0] || 'unknown'} (${stats.summary.mostCommonMessageType?.[1] || 0} 条)`);
      
      return stats;
    } catch (error) {
      console.error('获取群消息统计失败:', error);
      throw error;
    }
  }

  /**
   * 获取会话内容存档内部群信息
   */
  async getGroupChatData(roomId: string): Promise<any> {
    try {
      const accessToken = await this.getAccessToken();
      
      const response = await axios.post(
        `https://qyapi.weixin.qq.com/cgi-bin/msgaudit/groupchat/get?access_token=${accessToken}`,
        {
          roomid: roomId
        }
      );

      if (response.data.errcode === 0) {
        return response.data;
      } else {
        throw new Error(`获取群聊信息失败: ${response.data.errmsg}`);
      }
    } catch (error) {
      console.error('获取群聊信息失败:', error);
      throw error;
    }
  }

  /**
   * 拉取会话记录（原有方法，保持兼容性）
   * 
   * 重要说明：企业微信会话存档无法通过REST API直接获取聊天数据！
   * 官方要求使用原生SDK (libWeWorkFinanceSdk_C.so)
   * 
   * 解决方案：
   * 1. 使用 https://github.com/Hanson/WeworkMsg (Go封装的HTTP服务)
   * 2. 或使用 https://github.com/go-laoji/wecom.dev-audit
   */
  async getChatRecords(seq: number = 0, limit: number = 1000): Promise<ChatRecord[]> {
    try {
      // 优先尝试使用Go服务
      if (await this.healthCheck()) {
        console.log('✅ Go服务可用，使用Go服务获取聊天数据');
        return await this.getChatRecordsFromGoService(seq, limit);
      }

      // 如果Go服务不可用，显示说明信息
      console.log('⚠️ Go服务不可用，返回说明信息');
      
      // 检查是否配置了会话存档专用的secret
      if (!process.env.WEIXIN_MSGAUDIT_SECRET) {
        throw new Error('未配置会话存档专用的WEIXIN_MSGAUDIT_SECRET');
      }

      // 获取会话存档专用的access_token
      const msgauditSecret = process.env.WEIXIN_MSGAUDIT_SECRET;
      const tokenResponse = await axios.get(
        `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${this.config.corpId}&corpsecret=${msgauditSecret}`
      );

      if (tokenResponse.data.errcode !== 0) {
        throw new Error(`获取会话存档access_token失败: ${tokenResponse.data.errmsg}`);
      }

      const accessToken = tokenResponse.data.access_token;
      
      // 先检查许可用户列表（这个API是有效的）
      const response = await axios.post(
        `https://qyapi.weixin.qq.com/cgi-bin/msgaudit/get_permit_user_list?access_token=${accessToken}`,
        {}
      );

      console.log('会话存档API响应:', response.data);

      if (response.data.errcode === 0) {
        console.log('✅ 许可用户列表获取成功，用户ID:', response.data.ids);
        
        // 企业微信会话存档的聊天数据拉取必须使用原生SDK
        // 这里返回一个说明性的错误，指导用户正确的实现方式
        throw new Error(`
🚨 企业微信会话存档限制说明：

❌ 问题：REST API无法直接获取聊天数据（/cgi-bin/msgaudit/get_chat_data 返回404）

✅ 解决方案：
1. 使用企业微信官方原生SDK (libWeWorkFinanceSdk_C.so)
2. 推荐开源方案：
   • https://github.com/Hanson/WeworkMsg (Go语言HTTP服务)
   • https://github.com/go-laoji/wecom.dev-audit

📋 当前状态：
• 许可用户: ${response.data.ids?.join(', ') || '无'}
• 会话存档权限: ✅ 已开启
      • Go服务状态: ❌ 不可用 (请确保 http://127.0.0.1:8889 服务正在运行)

🔧 快速部署建议：
1. 启动 WeworkMsg Go服务 (端口8889)
2. 配置 .env 和 private_key.pem  
3. 调用 getChatRecordsFromGoService() 方法获取数据
        `);
      } else {
        throw new Error(`获取许可用户列表失败: ${response.data.errmsg}`);
      }
    } catch (error) {
      console.error('拉取会话记录失败:', error);
      throw error;
    }
  }

  /**
   * 处理会话存档通知
   */
  async processMsgAuditNotify(): Promise<void> {
    try {
      console.log('开始处理会话存档通知...');
      
      // 1. 优先使用Go服务拉取最新的会话记录
      let chatRecords: ChatRecord[] = [];
      
      if (await this.healthCheck()) {
        chatRecords = await this.getChatRecordsFromGoService();
      } else {
        console.log('⚠️ Go服务不可用，跳过会话记录处理');
        return;
      }
      
      console.log(`拉取到 ${chatRecords.length} 条会话记录`);
      
      // 2. 处理每条记录
      for (const record of chatRecords) {
        await this.processChatRecord(record);
      }
      
      console.log('会话存档通知处理完成');
    } catch (error) {
      console.error('处理会话存档通知失败:', error);
    }
  }

  /**
   * 提取时间戳，尝试多种可能的字段名
   */
  private extractTimestamp(message: any, goRecord: any): number {
    // 尝试从消息中提取时间戳
    const possibleFields = [
      'msgtime', 'time', 'timestamp', 'CreateTime', 'create_time',
      'sendTime', 'send_time', 'messageTime', 'message_time'
    ];
    
    for (const field of possibleFields) {
      if (message[field]) {
        const timestamp = parseInt(message[field]);
        if (!isNaN(timestamp) && timestamp > 0) {
          return timestamp;
        }
      }
    }
    
    // 尝试从goRecord中提取时间戳
    for (const field of possibleFields) {
      if (goRecord[field]) {
        const timestamp = parseInt(goRecord[field]);
        if (!isNaN(timestamp) && timestamp > 0) {
          return timestamp;
        }
      }
    }
    
    // 特殊处理：尝试从msgid中提取时间戳（针对external消息）
    if (goRecord.msgid && goRecord.msgid.includes('_')) {
      const parts = goRecord.msgid.split('_');
      if (parts.length >= 2) {
        const possibleTimestamp = parseInt(parts[1]);
        if (!isNaN(possibleTimestamp) && possibleTimestamp > 0) {
          // 检查是否是合理的时间戳格式
          const timestampStr = possibleTimestamp.toString();
          
          // 如果是13位，可能是毫秒时间戳
          if (timestampStr.length === 13) {
            const date = new Date(possibleTimestamp);
            // 检查是否是合理的日期（2000年-2030年）
            if (date.getFullYear() >= 2000 && date.getFullYear() <= 2030) {
              console.log(`从msgid提取到毫秒时间戳: ${possibleTimestamp}`);
              return Math.floor(possibleTimestamp / 1000); // 转换为秒
            }
          }
          
          // 如果是10位，可能是秒时间戳
          if (timestampStr.length === 10) {
            const date = new Date(possibleTimestamp * 1000);
            if (date.getFullYear() >= 2000 && date.getFullYear() <= 2030) {
              console.log(`从msgid提取到秒时间戳: ${possibleTimestamp}`);
              return possibleTimestamp;
            }
          }
        }
      }
    }
    
    // 如果都没有找到，返回当前时间
    console.warn(`无法提取时间戳，使用当前时间 (msgid: ${goRecord.msgid})`);
    return Math.floor(Date.now() / 1000); // 返回秒级时间戳
  }

  /**
   * 格式化消息时间戳
   */
  private formatMessageTime(msgtime: number): string {
    try {
      if (!msgtime || msgtime === 0) {
        return '时间未知';
      }

      // 处理不同的时间戳格式
      let timestamp = msgtime;
      
      // 如果是13位时间戳（毫秒），直接使用
      if (timestamp.toString().length === 13) {
        return new Date(timestamp).toLocaleString('zh-CN');
      }
      
      // 如果是10位时间戳（秒），转换为毫秒
      if (timestamp.toString().length === 10) {
        return new Date(timestamp * 1000).toLocaleString('zh-CN');
      }
      
      // 如果是16位或17位时间戳（微秒），转换为毫秒
      if (timestamp.toString().length >= 16) {
        return new Date(Math.floor(timestamp / 1000)).toLocaleString('zh-CN');
      }
      
      // 如果时间戳看起来不合理（比如太大或太小），尝试不同的处理方式
      const now = Date.now();
      const timestampMs = timestamp * 1000;
      
      // 检查转换后的时间是否合理（在1970年到2100年之间）
      if (timestampMs > 0 && timestampMs < 4102444800000) { // 2100年的时间戳
        return new Date(timestampMs).toLocaleString('zh-CN');
      }
      
      // 如果都不合理，返回原始值和当前时间
      return `时间戳异常: ${msgtime} (${new Date().toLocaleString('zh-CN')})`;
      
    } catch (error) {
      console.error('时间格式化失败:', error);
      return `时间格式错误: ${msgtime}`;
    }
  }

  /**
   * 处理单条群聊记录（只处理群消息）
   */
  private async processChatRecord(record: ChatRecord): Promise<void> {
    try {
      // 🎯 只处理群消息，跳过单聊
      if (!record.roomid || record.roomid.trim() === '') {
        console.log(`🚫 跳过非群消息: ${record.msgid}`);
        return;
      }

      console.log(`📱 处理群消息: ${record.msgid}`);
      console.log(`- 消息类型: ${record.msgtype}`);
      console.log(`- 发送者: ${record.from}`);
      console.log(`- 群聊ID: ${record.roomid}`);
      // 智能处理时间戳格式
      const formattedTime = this.formatMessageTime(record.msgtime);
      console.log(`- 消息时间: ${formattedTime}`);
      
      // 如果所有关键字段都是空的，输出完整的记录内容用于调试
      if (!record.msgtype && !record.from && record.msgtime === 0) {
        console.log('⚠️  检测到空消息记录，完整内容:');
        console.log(JSON.stringify(record, null, 2));
      }
      
      // 根据消息类型处理
      switch (record.msgtype) {
        case 'text':
          await this.processTextRecord(record);
          break;
        case 'image':
          await this.processImageRecord(record);
          break;
        case 'voice':
          await this.processVoiceRecord(record);
          break;
        case 'video':
          await this.processVideoRecord(record);
          break;
        case '':
        case null:
        case undefined:
          // 处理空消息类型（可能是系统消息或external消息）
          await this.processSystemRecord(record);
          break;
        default:
          console.log(`未处理的消息类型: ${record.msgtype}`);
          break;
      }
    } catch (error) {
      console.error(`处理会话记录失败: ${record.msgid}`, error);
    }
  }

  /**
   * 处理文本消息记录
   */
  private async processTextRecord(record: ChatRecord): Promise<void> {
    try {
      // Go服务已经解密了消息，直接从content中提取文本内容
      let textContent = '';
      
      if (record.content && typeof record.content === 'object') {
        // 尝试不同的可能字段
        textContent = record.content.text?.content || 
                     record.content.content || 
                     record.content.Content ||
                     record.content.text ||
                     JSON.stringify(record.content);
      } else if (typeof record.content === 'string') {
        textContent = record.content;
      }
      
      console.log(`文本消息内容: ${textContent}`);
    
      // TODO: 这里可以调用你的业务逻辑
      // 例如：更新群消息记录、触发监控逻辑等
    } catch (error) {
      console.error('处理文本消息失败:', error);
    }
  }

  /**
   * 处理图片消息记录
   */
  private async processImageRecord(record: ChatRecord): Promise<void> {
    try {
      // Go服务已经解密了消息，直接从content中提取图片信息
      let imageInfo = '';
      
      if (record.content && typeof record.content === 'object') {
        // 尝试提取图片相关信息
        const image = record.content.image || record.content.Image || record.content;
        imageInfo = JSON.stringify(image, null, 2);
      } else if (typeof record.content === 'string') {
        imageInfo = record.content;
      }
      
      console.log(`图片消息内容: ${imageInfo}`);
      
      // TODO: 处理图片消息
      // 可能需要下载图片文件等
    } catch (error) {
      console.error('处理图片消息失败:', error);
    }
  }

  /**
   * 处理语音消息记录
   */
  private async processVoiceRecord(record: ChatRecord): Promise<void> {
    try {
      // Go服务已经解密了消息，直接从content中提取语音信息
      let voiceInfo = '';
      
      if (record.content && typeof record.content === 'object') {
        // 尝试提取语音相关信息
        const voice = record.content.voice || record.content.Voice || record.content;
        voiceInfo = JSON.stringify(voice, null, 2);
      } else if (typeof record.content === 'string') {
        voiceInfo = record.content;
      }
      
      console.log(`语音消息内容: ${voiceInfo}`);
      
      // TODO: 处理语音消息
      // 可能需要下载语音文件等
    } catch (error) {
      console.error('处理语音消息失败:', error);
    }
  }

  /**
   * 处理系统消息记录（包括external类型消息）
   */
  private async processSystemRecord(record: ChatRecord): Promise<void> {
    try {
      console.log('🔧 处理系统/外部消息记录');
      
      // 检查是否是external类型消息
      if (record.msgid && record.msgid.includes('_external')) {
        console.log('📱 检测到external消息（外部联系人相关）');
        console.log('可能的消息类型：');
        console.log('- 外部联系人添加/删除通知');
        console.log('- 外部群成员变更记录'); 
        console.log('- 好友申请或验证消息');
        console.log('- 外部联系人状态变更');
      }
      
      // 输出可用的内容信息
      if (record.content) {
        console.log('消息内容:', JSON.stringify(record.content, null, 2));
      } else {
        console.log('无消息内容（系统级操作记录）');
      }
      
      // TODO: 根据具体业务需求处理系统消息
      // 例如：记录外部联系人变更、更新群成员状态等
      
    } catch (error) {
      console.error('处理系统消息失败:', error);
    }
  }

  /**
   * 处理视频消息记录
   */
  private async processVideoRecord(record: ChatRecord): Promise<void> {
    try {
      // Go服务已经解密了消息，直接从content中提取视频信息
      let videoInfo = '';
      
      if (record.content && typeof record.content === 'object') {
        // 尝试提取视频相关信息
        const video = record.content.video || record.content.Video || record.content;
        videoInfo = JSON.stringify(video, null, 2);
      } else if (typeof record.content === 'string') {
        videoInfo = record.content;
      }
      
      console.log(`视频消息内容: ${videoInfo}`);
      
      // TODO: 处理视频消息
      // 可能需要下载视频文件等
    } catch (error) {
      console.error('处理视频消息失败:', error);
    }
  }

  /**
   * 转换Go服务返回的数据结构为标准ChatRecord格式
   * @param goRecord Go服务返回的聊天数据
   * @returns 标准化的ChatRecord或null
   */
  private convertGoChatDataToChatRecord(goRecord: GoChatData): ChatRecord | null {
    try {
      if (!goRecord.message) {
        console.log(`消息 ${goRecord.msgid} 没有message字段，跳过处理`);
        return null;
      }

      const message = goRecord.message;
      
      // 企业微信SDK返回的消息结构通常直接包含这些字段
      // 如果message本身就是解密后的标准消息对象，直接使用
      if (message.msgid && message.action && message.from) {
        // 标准的企业微信消息格式
        const chatRecord: ChatRecord = {
          msgid: message.msgid || goRecord.msgid,
          action: message.action || 'send',
          from: message.from || '',
          tolist: Array.isArray(message.tolist) ? message.tolist : [],
          roomid: message.roomid || '',
          msgtime: this.extractTimestamp(message, goRecord),
          msgtype: message.msgtype || '',
          content: message
        };
        return chatRecord;
      } else {
        // 如果消息格式不标准，尝试从不同的可能字段中提取
        console.log(`消息 ${goRecord.msgid} 格式不标准，尝试提取字段:`);
        console.log('完整goRecord:', JSON.stringify(goRecord, null, 2));
        console.log('message字段:', JSON.stringify(message, null, 2));
        
        // 构建一个基础的ChatRecord，使用可用的字段
        const chatRecord: ChatRecord = {
          msgid: goRecord.msgid,
          action: 'send',
          from: message.from || message.FromUserName || '',
          tolist: message.tolist || (message.ToUserName ? [message.ToUserName] : []),
          roomid: message.roomid || message.ChatId || '',
          msgtime: this.extractTimestamp(message, goRecord),
          msgtype: message.msgtype || message.MsgType || '',
          content: message
        };
        
        return chatRecord;
      }
    } catch (error) {
      console.error(`转换Go聊天数据失败 (msgid: ${goRecord.msgid}):`, error);
      console.error('消息内容:', JSON.stringify(goRecord, null, 2));
      return null;
    }
  }

  /**
   * 解密消息内容
   * @param encryptedData 加密的消息数据
   * @returns 解密后的消息内容
   */
  private decryptMessage(encryptedData: any): string {
    try {
      if (!encryptedData || !encryptedData.encrypt_random_key || !encryptedData.encrypt_chat_msg) {
        throw new Error('消息数据格式不正确');
      }

      // 解密随机密钥
      const randomKey = crypto.privateDecrypt(
        {
          key: this.config.privateKey,
          padding: crypto.constants.RSA_PKCS1_PADDING
        },
        Buffer.from(encryptedData.encrypt_random_key, 'base64')
      );

      // 使用随机密钥解密消息内容
      const decipher = crypto.createDecipheriv('aes-256-cbc', randomKey, Buffer.alloc(16, 0));
      decipher.setAutoPadding(false);
      
      const encrypted = Buffer.from(encryptedData.encrypt_chat_msg, 'base64');
      const decrypted = Buffer.concat([
        decipher.update(encrypted),
        decipher.final()
      ]);

      // 移除PKCS7填充
      const padLength = decrypted[decrypted.length - 1];
      const unpadded = decrypted.slice(0, decrypted.length - padLength);

      return unpadded.toString('utf8');
    } catch (error) {
      console.error('解密消息失败:', error);
      throw error;
    }
  }
}

export default MessageArchiveService;