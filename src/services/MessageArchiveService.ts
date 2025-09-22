import axios from 'axios';

interface MessageArchiveConfig {
  corpId: string;
  secret: string;
  privateKey: string; // RSA私钥，用于解密会话内容
}

interface ChatRecord {
  msgid: string;
  action: string;
  from: string;
  tolist: string[];
  roomid?: string;
  msgtime: number;
  msgtype: string;
  content: any;
}

export class MessageArchiveService {
  private config: MessageArchiveConfig;
  private accessToken: string | null = null;
  private tokenExpireTime: number = 0;

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
   * 拉取会话记录
   */
  async getChatRecords(seq: number = 0, limit: number = 1000): Promise<ChatRecord[]> {
    try {
      const accessToken = await this.getAccessToken();
      
      const response = await axios.post(
        `https://qyapi.weixin.qq.com/cgi-bin/msgaudit/get_robot_info?access_token=${accessToken}`,
        {
          seq: seq,
          limit: limit
        }
      );

      if (response.data.errcode === 0) {
        return response.data.chatdata || [];
      } else {
        throw new Error(`拉取会话记录失败: ${response.data.errmsg}`);
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
      
      // 1. 拉取最新的会话记录
      const chatRecords = await this.getChatRecords();
      
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
    const content = record.content;
    console.log(`文本消息内容: ${content}`);
    
    // TODO: 这里可以调用你的业务逻辑
    // 例如：更新群消息记录、触发监控逻辑等
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
}

export default MessageArchiveService; 