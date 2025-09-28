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
   * 通过Go服务获取聊天记录数据（推荐方法）
   * @param seq 起始序号，首次传0
   * @param limit 限制数量，最大1000
   * @param timeout 超时时间，秒
   */
  async getChatRecordsFromGoService(seq: number = 0, limit: number = 100, timeout: number = 3): Promise<ChatRecord[]> {
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
          const chatRecord = this.convertGoChatDataToChatRecord(goRecord);
          if (chatRecord) {
            chatRecords.push(chatRecord);
          }
        } catch (convertError) {
          console.error(`转换消息记录失败 (msgid: ${goRecord.msgid}):`, convertError);
          // 继续处理其他记录，不中断整个流程
        }
      }
      
      console.log(`✅ 成功转换 ${chatRecords.length} 条聊天记录`);
      return chatRecords;
      
    } catch (error) {
      console.error('通过Go服务获取聊天数据失败:', error);
      throw error;
    }
  }

  /**
   * 分页获取所有聊天记录
   * @param startSeq 起始序号
   * @param batchSize 每批次大小
   */
  async getAllChatRecordsFromGoService(startSeq: number = 0, batchSize: number = 100): Promise<ChatRecord[]> {
    const allRecords: ChatRecord[] = [];
    let currentSeq = startSeq;
    
    try {
      while (true) {
        const records = await this.getChatRecordsFromGoService(currentSeq, batchSize);
        
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
   * 处理单条会话记录
   */
  private async processChatRecord(record: ChatRecord): Promise<void> {
    try {
      console.log(`处理会话记录: ${record.msgid}`);
      console.log(`- 消息类型: ${record.msgtype}`);
      console.log(`- 发送者: ${record.from}`);
      console.log(`- 群聊ID: ${record.roomid || '单聊'}`);
      console.log(`- 消息时间: ${new Date(record.msgtime * 1000).toLocaleString()}`);
      
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
      // 解密消息内容
      const decryptedContent = this.decryptMessage(record.content);
      console.log(`文本消息内容: ${decryptedContent}`);
    
    // TODO: 这里可以调用你的业务逻辑
    // 例如：更新群消息记录、触发监控逻辑等
    } catch (error) {
      console.error('解密文本消息失败:', error);
    }
  }

  /**
   * 处理图片消息记录
   */
  private async processImageRecord(record: ChatRecord): Promise<void> {
    console.log('处理图片消息记录');
    // TODO: 处理图片消息
  }

  /**
   * 处理语音消息记录
   */
  private async processVoiceRecord(record: ChatRecord): Promise<void> {
    console.log('处理语音消息记录');
    // TODO: 处理语音消息
  }

  /**
   * 处理视频消息记录
   */
  private async processVideoRecord(record: ChatRecord): Promise<void> {
    console.log('处理视频消息记录');
    // TODO: 处理视频消息
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
          msgtime: message.msgtime || 0,
          msgtype: message.msgtype || '',
          content: message
        };
        return chatRecord;
      } else {
        // 如果消息格式不标准，尝试从不同的可能字段中提取
        console.log(`消息 ${goRecord.msgid} 格式不标准，尝试提取字段:`, JSON.stringify(message, null, 2));
        
        // 构建一个基础的ChatRecord，使用可用的字段
        const chatRecord: ChatRecord = {
          msgid: goRecord.msgid,
          action: 'send',
          from: message.from || message.FromUserName || '',
          tolist: message.tolist || (message.ToUserName ? [message.ToUserName] : []),
          roomid: message.roomid || message.ChatId || '',
          msgtime: message.msgtime || message.CreateTime || 0,
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