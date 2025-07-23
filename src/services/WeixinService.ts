import axios from 'axios';
import config from '../config/default';

/**
 * 企业微信API服务类
 * 用于调用企业微信的各种接口，包括获取token、获取群列表、获取消息等
 */
export class WeixinService {
  private accessToken: string = '';
  private tokenExpireTime: number = 0;
  
  constructor() {}
  
  /**
   * 获取访问令牌
   * @returns Promise<string> 访问令牌
   */
  async getAccessToken(): Promise<string> {
    // 如果token还在有效期内，直接返回
    if (this.accessToken && Date.now() < this.tokenExpireTime) {
      return this.accessToken;
    }
    
    try {
      const { corpId, corpSecret } = config.corpWeixin;
      const response = await axios.get(
        `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${corpId}&corpsecret=${corpSecret}`
      );
      
      const { access_token, expires_in } = response.data;
      
      if (!access_token) {
        throw new Error(`获取AccessToken失败: ${JSON.stringify(response.data)}`);
      }
      
      this.accessToken = access_token;
      // 提前5分钟过期，确保安全
      this.tokenExpireTime = Date.now() + (expires_in - 300) * 1000;
      
      return this.accessToken;
    } catch (error) {
      console.error('获取AccessToken失败:', error);
      throw error;
    }
  }
  
  /**
   * 获取客户群列表
   * @returns Promise<any[]> 群列表
   */
  async getGroupChatList(): Promise<any[]> {
    try {
      const token = await this.getAccessToken();
      const response = await axios.post(
        `https://qyapi.weixin.qq.com/cgi-bin/externalcontact/groupchat/list?access_token=${token}`,
        {
          status_filter: 0,  // 0表示所有列表
          limit: 100,        // 每次拉取的数量，最大100
          cursor: '',        // 首次拉取不需要cursor
        }
      );
      
      const { errcode, group_chat_list, next_cursor } = response.data;
      
      if (errcode !== 0) {
        throw new Error(`获取客户群列表失败: ${JSON.stringify(response.data)}`);
      }
      
      // 如果有下一页，递归获取
      let allGroups = [...group_chat_list];
      if (next_cursor) {
        const nextGroups = await this.getGroupChatListByCursor(next_cursor);
        allGroups = [...allGroups, ...nextGroups];
      }
      
      return allGroups;
    } catch (error) {
      console.error('获取客户群列表失败:', error);
      throw error;
    }
  }
  
  /**
   * 通过游标获取更多客户群列表
   * @param cursor 游标
   * @returns Promise<any[]> 群列表
   */
  private async getGroupChatListByCursor(cursor: string): Promise<any[]> {
    try {
      const token = await this.getAccessToken();
      const response = await axios.post(
        `https://qyapi.weixin.qq.com/cgi-bin/externalcontact/groupchat/list?access_token=${token}`,
        {
          status_filter: 0,
          limit: 100,
          cursor: cursor,
        }
      );
      
      const { errcode, group_chat_list, next_cursor } = response.data;
      
      if (errcode !== 0) {
        throw new Error(`获取客户群列表失败: ${JSON.stringify(response.data)}`);
      }
      
      let allGroups = [...group_chat_list];
      if (next_cursor) {
        const nextGroups = await this.getGroupChatListByCursor(next_cursor);
        allGroups = [...allGroups, ...nextGroups];
      }
      
      return allGroups;
    } catch (error) {
      console.error('通过游标获取客户群列表失败:', error);
      throw error;
    }
  }
  
  /**
   * 获取群聊详情
   * @param chatId 群聊ID
   * @returns Promise<any> 群详情
   */
  async getGroupChatDetail(chatId: string): Promise<any> {
    try {
      const token = await this.getAccessToken();
      const response = await axios.post(
        `https://qyapi.weixin.qq.com/cgi-bin/externalcontact/groupchat/get?access_token=${token}`,
        { chat_id: chatId }
      );
      
      const { errcode, group_chat } = response.data;
      
      if (errcode !== 0) {
        throw new Error(`获取群详情失败: ${JSON.stringify(response.data)}`);
      }
      
      return group_chat;
    } catch (error) {
      console.error(`获取群详情失败 (${chatId}):`, error);
      throw error;
    }
  }
  
  /**
   * 发送应用消息（提醒管理员）
   * @param content 消息内容
   * @param toUser 接收消息的用户ID
   * @returns Promise<boolean> 是否发送成功
   */
  async sendAppMessage(content: string, toUser: string): Promise<boolean> {
    try {
      console.log(`\n==== 开始发送应用消息 ====`);
      console.log(`接收者: ${toUser}`);
      console.log(`消息内容: ${content.substring(0, 100)}${content.length > 100 ? '...' : ''}`);
      
      const token = await this.getAccessToken();
      const { agentId } = config.corpWeixin;
      
      console.log(`Access Token: ${token ? token.substring(0, 10) + '...' : '未获取'}`);
      console.log(`应用ID: ${agentId}`);
      
      const requestData = {
        touser: toUser,
        msgtype: 'text',
        agentid: agentId,
        text: {
          content: content
        }
      };
      
      console.log(`发送请求数据:`, JSON.stringify(requestData, null, 2));
      
      const response = await axios.post(
        `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`,
        requestData
      );
      
      console.log(`微信API响应:`, JSON.stringify(response.data, null, 2));
      
      const { errcode, errmsg } = response.data;
      
      if (errcode !== 0) {
        console.error(`发送应用消息失败: errcode=${errcode}, errmsg=${errmsg}`);
        throw new Error(`发送应用消息失败: ${JSON.stringify(response.data)}`);
      }
      
      console.log(`应用消息发送成功`);
      console.log(`==== 发送应用消息完成 ====\n`);
      
      return true;
    } catch (error) {
      console.error('发送应用消息失败:', error);
      return false;
    }
  }
} 