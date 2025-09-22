import { Request, Response, Router } from 'express';
import WeixinCallbackUtil from '../utils/WeixinCallbackUtil';
import { MonitorService } from '../services/MonitorService';
import { CallbackStatsService } from '../services/CallbackStatsService';
import MessageArchiveService from '../services/MessageArchiveService';
import { IMessage } from '../types';

/**
 * 企业微信回调控制器
 * 处理企业微信发送的回调请求
 */
export class WeixinCallbackController {
  private monitorService: MonitorService;
  private callbackStats: CallbackStatsService;
  private messageArchiveService: MessageArchiveService;
  private router: Router;

  constructor() {
    this.monitorService = new MonitorService();
    this.callbackStats = CallbackStatsService.getInstance();
    this.messageArchiveService = new MessageArchiveService({
      corpId: 'wwb477a7d74c001523',
      secret: '', // 需要配置会话存档应用的Secret
      privateKey: '' // 需要配置RSA私钥
    });
    this.router = Router();
    this.initializeRoutes();
  }

  /**
   * 初始化路由
   */
  private initializeRoutes(): void {
    // 处理所有HTTP方法
    this.router.all('/', (req, res) => {
      console.log(`收到${req.method}请求，路径：${req.path}`);
      
      // 处理GET请求（通常是验证URL）
      if (req.method === 'GET') {
        console.log('处理GET请求（可能是URL验证）');
        return this.handleVerification(req, res);
      }
      
      // 处理POST请求（接收消息）
      if (req.method === 'POST') {
        console.log('处理POST请求（接收消息）');
        return this.handleMessage(req, res);
      }
      
      // 其他请求方法
      console.log('不支持的请求方法');
      return res.status(405).send('Method Not Allowed');
    });
  }

  /**
   * 获取路由器
   * @returns Express路由器
   */
  public getRouter(): Router {
    return this.router;
  }

  /**
   * 处理URL验证请求
   * @param req Express请求
   * @param res Express响应
   */
  private handleVerification(req: Request, res: Response) {
    try {
      console.log('处理URL验证请求');
      console.log('请求参数:', req.query);
      
      const { 
        msg_signature, timestamp, nonce, echostr
      } = req.query as Record<string, string>;

      if (!msg_signature || !timestamp || !nonce || !echostr) {
        console.error('URL验证请求缺少必要参数');
        return res.status(400).send('Bad Request');
      }
      
      console.log('验证参数:');
      console.log('- msg_signature:', msg_signature);
      console.log('- timestamp:', timestamp);
      console.log('- nonce:', nonce);
      console.log('- echostr:', echostr);
      
        const result = WeixinCallbackUtil.handleVerification(
        msg_signature,
          timestamp,
          nonce,
          echostr
        );
        
        if (result) {
        console.log('验证成功，返回echostr:', result);
          this.callbackStats.recordVerification(true);
          res.send(result);
        } else {
        console.error('URL验证失败');
          this.callbackStats.recordVerification(false, 'URL验证失败');
          res.status(401).send('验证失败');
        }
    } catch (error) {
      console.error('处理URL验证请求失败:', error);
      this.callbackStats.recordVerification(false, `处理验证请求异常: ${error}`);
      res.status(500).send('Internal Server Error');
      }
  }

  /**
   * 处理接收消息请求
   * @param req Express请求
   * @param res Express响应
   */
  private async handleMessage(req: Request, res: Response) {
    try {
      console.log('=====================');
      console.log('开始处理消息请求');
      console.log('请求头:', req.headers);
      console.log('请求参数:', req.query);
      console.log('请求方法:', req.method);
      console.log('请求URL:', req.url);
      
      const { 
        msg_signature, timestamp, nonce
      } = req.query as Record<string, string>;
      
      // 检查是否为加密消息
      const encrypt_type = req.query.encrypt_type || 
                         (req.headers['encrypt-type'] as string) || 
                         'aes';
      
      console.log('消息加密类型:', encrypt_type);

      // 获取消息体
      let messageContent;
      
      if (encrypt_type === 'aes') {
        console.log('处理加密消息');
        // 处理加密消息
        const postData = req.body;
        
        console.log('请求体类型:', typeof postData);
        console.log('请求体内容:', typeof postData === 'string' ? postData : JSON.stringify(postData));
        
        if (!postData) {
          console.error('请求体为空');
          res.send('success'); // 返回success以防止微信重试
          return;
        }
        
        let msgEncrypt;
        if (typeof postData === 'string') {
          // 如果是XML字符串，尝试提取Encrypt字段
          console.log('处理XML字符串格式的请求体');
          try {
            if (postData.includes('<Encrypt>')) {
              const encryptMatch = postData.match(/<Encrypt><!?\[CDATA\[(.*?)\]\]><\/Encrypt>/);
              if (encryptMatch && encryptMatch[1]) {
                msgEncrypt = encryptMatch[1];
                console.log('从XML中提取的Encrypt:', msgEncrypt);
              } else {
                console.error('无法从XML中提取Encrypt字段');
                res.send('success');
                return;
              }
            } else {
              console.error('XML中没有Encrypt字段');
              res.send('success');
              return;
            }
          } catch (xmlError) {
            console.error('解析XML失败:', xmlError);
            res.send('success');
            return;
          }
        } else if (typeof postData === 'object' && postData.Encrypt) {
          // 如果是已解析的对象
          msgEncrypt = postData.Encrypt;
          console.log('从对象中获取的Encrypt:', msgEncrypt);
        } else if (typeof postData === 'object' && postData.xml && postData.xml.Encrypt) {
          // 如果是已解析的XML对象
          msgEncrypt = postData.xml.Encrypt;
          console.log('从XML对象中获取的Encrypt:', msgEncrypt);
        } else {
          console.error('无效的加密消息格式');
          console.error('完整请求体:', postData);
          res.send('success'); // 返回success以防止微信重试
          return;
        }
        
        console.log('加密消息内容:', msgEncrypt);
        console.log('准备解密，参数:', { msg_signature, timestamp, nonce });
        
        if (!msg_signature || !timestamp || !nonce) {
          console.error('缺少必要的解密参数');
          res.send('success');
          return;
        }
        
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
        
        console.log('解密后的XML:', decryptedXml);
        
        try {
        messageContent = await WeixinCallbackUtil.parseXml(decryptedXml);
          console.log('XML解析结果:', messageContent);
        } catch (parseError) {
          console.error('XML解析失败:', parseError);
          res.send('success');
          return;
        }
      } else {
        // 明文消息
        console.log('处理明文消息');
        const postData = req.body;
        console.log('请求体:', typeof postData === 'string' ? postData : JSON.stringify(postData));
        
        if (typeof postData === 'string') {
          try {
            messageContent = await WeixinCallbackUtil.parseXml(postData);
            console.log('明文XML解析结果:', messageContent);
          } catch (parseError) {
            console.error('明文XML解析失败:', parseError);
            res.send('success');
            return;
      }
        } else {
          messageContent = postData;
          console.log('直接使用对象格式的请求体');
        }
      }
      
      if (!messageContent) {
        console.error('解析后的消息内容为空');
        res.send('success');
        return;
      }
      
      console.log('解析后的消息内容:', JSON.stringify(messageContent));

      // 处理消息内容
      const messageType = messageContent?.MsgType || 'unknown';
      await this.processMessage(messageContent);
      
      // 记录成功统计
      this.callbackStats.recordMessage(true, messageType);
      
      // 返回成功响应
      console.log('消息处理完成，返回success');
      console.log('=====================');
      res.send('success');
    } catch (error) {
      console.error('处理消息请求失败:', error);
      // 记录失败统计
      this.callbackStats.recordMessage(false, undefined, `处理消息请求异常: ${error}`, error);
      // 即使处理失败也返回success，防止微信重试
      res.send('success');
    }
  }

  /**
   * 处理回调请求
   * @param req Express请求
   * @param res Express响应
   * @deprecated 使用handleVerification和handleMessage替代
   */
  async handleCallback(req: Request, res: Response) {
    try {
      console.log('收到企业微信回调请求（已废弃的方法）');
      
      if (req.method === 'GET') {
        return this.handleVerification(req, res);
      } else if (req.method === 'POST') {
        return this.handleMessage(req, res);
      } else {
        return res.status(405).send('Method Not Allowed');
      }
    } catch (error) {
      console.error('处理回调失败:', error);
      res.send('success');
    }
  }

  /**
   * 处理消息内容
   * @param message 消息内容
   */
  private async processMessage(message: any): Promise<void> {
    try {
      console.log('开始处理消息内容:');
      console.log('- 消息对象:', JSON.stringify(message));
      
      // 区分消息类型
      const msgType = message.MsgType;
      console.log('- 消息类型:', msgType);

      if (!msgType) {
        console.error('消息类型为空，无法处理');
        return;
      }

      // 根据消息类型处理
      switch (msgType) {
        case 'text': // 文本消息
          console.log('- 处理文本消息');
          await this.processTextMessage(message);
          break;
        case 'image': // 图片消息
          console.log('- 处理图片消息');
          await this.processMediaMessage(message, msgType);
          break;
        case 'voice': // 语音消息
          console.log('- 处理语音消息');
          await this.processMediaMessage(message, msgType);
          break;
        case 'video': // 视频消息
          console.log('- 处理视频消息');
          await this.processMediaMessage(message, msgType);
          break;
        case 'event': // 事件消息
          console.log('- 处理事件消息');
          await this.processEventMessage(message);
          break;
        default:
          console.log(`- 未处理的消息类型: ${msgType}`);
          break;
      }
    } catch (error) {
      console.error('处理消息内容失败:', error);
    }
  }

  /**
   * 处理文本消息
   * @param message 消息内容
   */
  private async processTextMessage(message: any): Promise<void> {
    try {
      console.log('处理文本消息:');
      console.log('- 消息详情:', JSON.stringify(message));
      
      const { FromUserName, ToUserName, Content, CreateTime, MsgId } = message;
      console.log('- FromUserName:', FromUserName);
      console.log('- ToUserName:', ToUserName);
      console.log('- Content:', Content);
      console.log('- CreateTime:', CreateTime);
      console.log('- MsgId:', MsgId);
      
      // 检查ChatInfo信息
      console.log('- ChatInfo:', message.ChatInfo ? JSON.stringify(message.ChatInfo) : '无ChatInfo信息');
      
      // 判断是否来自客户群
      if (message.ChatInfo && message.ChatInfo.ChatId) {
        const chatId = message.ChatInfo.ChatId;
        console.log('- 消息来自群聊，ChatId:', chatId);
        
        const fromType = this.isEmployee(FromUserName) ? 'employee' as const : 'customer' as const;
        console.log('- 发送者类型:', fromType);
        
        // 构建消息对象
        const msgObj: IMessage = {
          msgId: MsgId,
          from: FromUserName,
          fromType,
          content: Content,
          createTime: new Date(parseInt(CreateTime) * 1000)
        };
        
        console.log('- 构建的消息对象:', msgObj);

        // 更新消息记录
        try {
          console.log('- 尝试更新消息记录...');
        await this.monitorService.simulateNewMessage(chatId, msgObj);
          console.log(`- 成功更新群 ${chatId} 的消息记录`);
        } catch (storageError) {
          console.error('- 存储消息失败:', storageError);
        }
      } else {
        console.log('- 消息不是来自群聊，或缺少ChatId，无法处理');
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
        case 'msgaudit_notify': // 会话存档通知事件
          await this.processMsgAuditNotifyEvent(message);
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
   * 处理会话存档通知事件
   * @param message 消息内容
   */
  private async processMsgAuditNotifyEvent(message: any): Promise<void> {
    try {
      console.log('处理会话存档通知事件:');
      console.log('- 事件详情:', JSON.stringify(message));
      
      const { ToUserName, FromUserName, CreateTime, AgentID } = message;
      console.log('- ToUserName (企业ID):', ToUserName);
      console.log('- FromUserName:', FromUserName);
      console.log('- CreateTime:', CreateTime);
      console.log('- AgentID:', AgentID);
      
      console.log('⚠️  收到会话存档通知 - 当前应用配置为会话存档模式');
      console.log('💡 这意味着有新的会话数据可以拉取，但需要额外配置：');
      console.log('');
      console.log('🔧 解决方案选择：');
      console.log('');
      console.log('【方案1】切换为直接消息接收模式（推荐）：');
      console.log('   1. 登录企业微信管理后台');
      console.log('   2. 进入应用管理 → 找到你的应用');
      console.log('   3. 设置"接收消息" → 配置回调URL');
      console.log('   4. 关闭"会话内容存档"功能');
      console.log('   ✅ 优点：直接接收消息，实时性好，配置简单');
      console.log('');
      console.log('【方案2】继续使用会话存档模式：');
      console.log('   1. 配置会话存档应用的Secret和RSA私钥');
      console.log('   2. 启用MessageArchiveService服务');
      console.log('   3. 通过API主动拉取会话记录');
      console.log('   ✅ 优点：完整的会话记录，支持历史消息');
      console.log('');
      console.log('📖 参考文档：https://developer.work.weixin.qq.com/document/path/91774');
      
      // 如果配置了会话存档服务，尝试拉取消息
      // 注意：需要先配置正确的secret和privateKey
      // await this.messageArchiveService.processMsgAuditNotify();
      
      console.log('会话存档通知处理完成');
    } catch (error) {
      console.error('处理会话存档通知事件失败:', error);
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