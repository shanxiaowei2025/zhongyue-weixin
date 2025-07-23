import { Request, Response } from 'express';
import WeixinCallbackUtil from '../utils/WeixinCallbackUtil';
import { MonitorService } from '../services/MonitorService';
import { IMessage } from '../models/Group';

/**
 * 企业微信回调控制器
 * 处理企业微信发送的回调请求
 */
export class WeixinCallbackController {
  private monitorService: MonitorService;

  constructor() {
    this.monitorService = new MonitorService();
  }

  /**
   * 处理回调请求
   * @param req Express请求
   * @param res Express响应
   */
  async handleCallback(req: Request, res: Response): Promise<void> {
    try {
      const { 
        signature, timestamp, nonce, echostr, 
        msg_signature, encrypt_type
      } = req.query as Record<string, string>;

      // 处理URL验证请求
      if (echostr) {
        console.log('处理企业微信回调URL验证');
        const result = WeixinCallbackUtil.handleVerification(
          signature,
          timestamp,
          nonce,
          echostr
        );
        
        if (result) {
          res.send(result);
        } else {
          console.error('回调URL验证失败');
          res.status(401).send('验证失败');
        }
        return;
      }

      // 获取消息体
      let messageContent;
      if (encrypt_type === 'aes') {
        console.log('处理加密消息');
        // 处理加密消息
        const postData = req.body;
        
        if (!postData || !postData.Encrypt) {
          console.error('无效的加密消息');
          res.send('success'); // 返回success以防止微信重试
          return;
        }
        
        const msgEncrypt = postData.Encrypt;
        const decryptedXml = WeixinCallbackUtil.decryptMessage(
          msgEncrypt,
          msg_signature,
          timestamp,
          nonce
        );
        
        if (!decryptedXml) {
          console.error('消息解密失败');
          res.send('success'); // 返回success以防止微信重试
          return;
        }
        
        messageContent = await WeixinCallbackUtil.parseXml(decryptedXml);
      } else {
        // 明文消息
        console.log('处理明文消息');
        messageContent = req.body;
      }

      // 处理消息内容
      await this.processMessage(messageContent);
      
      // 返回成功响应
      res.send('success');
    } catch (error) {
      console.error('处理回调失败:', error);
      // 即使处理失败也返回success，防止微信重试
      res.send('success');
    }
  }

  /**
   * 处理消息内容
   * @param message 消息内容
   */
  private async processMessage(message: any): Promise<void> {
    try {
      console.log('收到消息:', JSON.stringify(message));
      
      // 区分消息类型
      const msgType = message.MsgType;

      // 根据消息类型处理
      switch (msgType) {
        case 'text': // 文本消息
          await this.processTextMessage(message);
          break;
        case 'image': // 图片消息
        case 'voice': // 语音消息
        case 'video': // 视频消息
          await this.processMediaMessage(message, msgType);
          break;
        case 'event': // 事件消息
          await this.processEventMessage(message);
          break;
        default:
          console.log(`未处理的消息类型: ${msgType}`);
          break;
      }
    } catch (error) {
      console.error('处理消息失败:', error);
    }
  }

  /**
   * 处理文本消息
   * @param message 消息内容
   */
  private async processTextMessage(message: any): Promise<void> {
    try {
      const { FromUserName, ToUserName, Content, CreateTime, MsgId } = message;
      
      // 判断是否来自客户群
      if (message.ChatInfo && message.ChatInfo.ChatId) {
        const chatId = message.ChatInfo.ChatId;
        const fromType = this.isEmployee(FromUserName) ? 'employee' as const : 'customer' as const;
        
        // 构建消息对象
        const msgObj: IMessage = {
          msgId: MsgId,
          from: FromUserName,
          fromType,
          content: Content,
          createTime: new Date(parseInt(CreateTime) * 1000)
        };

        // 更新消息记录
        await this.monitorService.simulateNewMessage(chatId, msgObj);
        console.log(`已更新群 ${chatId} 的消息记录`);
      }
    } catch (error) {
      console.error('处理文本消息失败:', error);
    }
  }

  /**
   * 处理媒体消息
   * @param message 消息内容
   * @param type 媒体类型
   */
  private async processMediaMessage(message: any, type: string): Promise<void> {
    try {
      const { FromUserName, ToUserName, CreateTime, MsgId } = message;
      
      // 判断是否来自客户群
      if (message.ChatInfo && message.ChatInfo.ChatId) {
        const chatId = message.ChatInfo.ChatId;
        const fromType = this.isEmployee(FromUserName) ? 'employee' as const : 'customer' as const;
        
        // 构建消息对象
        const msgObj: IMessage = {
          msgId: MsgId,
          from: FromUserName,
          fromType,
          content: `[${type}消息]`,
          createTime: new Date(parseInt(CreateTime) * 1000)
        };

        // 更新消息记录
        await this.monitorService.simulateNewMessage(chatId, msgObj);
        console.log(`已更新群 ${chatId} 的${type}消息记录`);
      }
    } catch (error) {
      console.error(`处理${type}消息失败:`, error);
    }
  }

  /**
   * 处理事件消息
   * @param message 消息内容
   */
  private async processEventMessage(message: any): Promise<void> {
    try {
      const { Event } = message;
      
      switch (Event) {
        case 'change_external_chat': // 客户群变更事件
          await this.processGroupChangeEvent(message);
          break;
        case 'change_external_contact': // 客户变更事件
          // 可以处理客户添加/删除事件
          break;
        default:
          console.log(`未处理的事件类型: ${Event}`);
          break;
      }
    } catch (error) {
      console.error('处理事件消息失败:', error);
    }
  }

  /**
   * 处理群变更事件
   * @param message 消息内容
   */
  private async processGroupChangeEvent(message: any): Promise<void> {
    try {
      const { ChangeType, ChatId } = message;
      
      // 根据变更类型处理
      switch (ChangeType) {
        case 'create': // 创建群聊
        case 'update': // 更新群聊
          // 同步群聊信息
          await this.monitorService.syncGroupDetail(ChatId);
          console.log(`已同步群 ${ChatId} 的信息`);
          break;
        case 'dismiss': // 解散群聊
          // 这里可以处理群解散逻辑
          break;
        default:
          console.log(`未处理的群变更类型: ${ChangeType}`);
          break;
      }
    } catch (error) {
      console.error('处理群变更事件失败:', error);
    }
  }

  /**
   * 判断用户是否为企业员工
   * @param userId 用户ID
   * @returns boolean 是否为员工
   */
  private isEmployee(userId: string): boolean {
    // 企业微信的员工ID通常是企业微信CorpId前缀
    // 这里简单实现，实际应用中可能需要更复杂的判断
    return !userId.includes('wm') && !userId.includes('wxid');
  }
}

export default new WeixinCallbackController(); 