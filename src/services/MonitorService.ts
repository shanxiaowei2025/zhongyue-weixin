import { WeixinService } from './WeixinService';
import { GroupApiService, IGroupData } from './GroupApiService';
import { IMessage } from '../types';
import config from '../config/default';
import moment from 'moment';

/**
 * 监控服务类
 * 用于监控客户群消息并发送提醒
 */
export class MonitorService {
  private weixinService: WeixinService;
  private groupApiService: GroupApiService;
  private alertThresholds: number[];
  
  constructor() {
    this.weixinService = new WeixinService();
    this.groupApiService = new GroupApiService();
    this.alertThresholds = config.alert.thresholds;
  }

  /**
   * 静态方法，用于在不实例化的情况下执行检查和发送提醒
   * 主要用于定时任务
   */
  static async checkAndSendAlerts(): Promise<void> {
    const monitorService = new MonitorService();
    await monitorService.checkAllGroupsResponse();
  }
  
  /**
   * 同步所有客户群信息
   * 从企业微信获取最新群聊信息并更新到 API
   */
  async syncAllGroups(): Promise<void> {
    try {
      console.log('开始同步客户群信息...');
      
      // 获取所有客户群列表
      const groupList = await this.weixinService.getGroupChatList();
      console.log(`获取到 ${groupList.length} 个客户群`);
      
      // 遍历并更新每个群的详细信息
      for (const groupInfo of groupList) {
        await this.syncGroupDetail(groupInfo.chat_id);
      }
      
      console.log('客户群信息同步完成');
    } catch (error) {
      console.error('同步客户群信息失败:', error);
      throw error;
    }
  }
  
  /**
   * 同步单个群聊详情
   * @param chatId 群聊ID
   */
  async syncGroupDetail(chatId: string): Promise<IGroupData | null> {
    try {
      // 获取群详情
      const groupDetail = await this.weixinService.getGroupChatDetail(chatId);
      
      // 数据验证和清理
      if (!groupDetail.name || groupDetail.name.trim() === '') {
        console.warn(`群组 ${chatId} 名称为空，使用默认名称`);
        groupDetail.name = `未命名群组_${chatId.substring(0, 8)}`;
      }
      
      if (!groupDetail.owner || groupDetail.owner.trim() === '') {
        console.warn(`群组 ${chatId} 群主信息为空，使用默认值`);
        groupDetail.owner = 'unknown';
      }
      
      // 将群成员分类为员工和客户
      const members = (groupDetail.member_list || []).map((member: any) => ({
        userId: member.userid || 'unknown',
        userType: member.type === 1 ? 'employee' : 'customer',
        name: member.name || '未知用户'
      }));
      
      // 查找或创建群记录 - 使用 API 服务
      const [group, created] = await this.groupApiService.findOrCreateGroup(chatId, {
          chatId: groupDetail.chat_id,
          name: groupDetail.name.trim(),
          owner: groupDetail.owner.trim(),
          members: members
      });
      
      if (!created && group.id) {
        // 更新已有群记录 - 使用 API 服务
        const updatedGroup = await this.groupApiService.updateGroup(group.id, {
          name: groupDetail.name.trim(),
          owner: groupDetail.owner.trim(),
          members: members
        });
        return updatedGroup;
      }
      
      return group;
    } catch (error) {
      console.error(`同步群 ${chatId} 详情失败:`, error);
      return null;
    }
  }
  
  /**
   * 检查所有群聊的响应情况
   * 根据设置的时间阈值检查是否需要提醒
   */
  async checkAllGroupsResponse(): Promise<void> {
    try {
      // 使用 API 服务获取所有群组
      const groups = await this.groupApiService.findAllGroups();
      
      let checkedCount = 0;
      let needAlertCount = 0;
      let noCustomerMsgCount = 0;
      let employeeRepliedCount = 0;
      
      for (const group of groups) {
        checkedCount++;
        
        // 统计分类
        if (!group.lastCustomerMessage) {
          noCustomerMsgCount++;
        } else if (group.lastMessage && group.lastMessage.fromType === 'employee') {
          employeeRepliedCount++;
        } else {
          // 计算是否需要提醒
          const lastCustomerMsgTime = moment(group.lastCustomerMessage.createTime);
          const now = moment();
          const minutesPassed = now.diff(lastCustomerMsgTime, 'minutes');
          
          for (let i = this.alertThresholds.length - 1; i >= 0; i--) {
            if (minutesPassed >= this.alertThresholds[i]) {
              needAlertCount++;
              break;
            }
          }
        }
        
        await this.checkGroupResponse(group);
      }
      
      // 输出统计信息
      console.log(`\n📊 群响应检查统计:`);
      console.log(`- 总检查群数: ${checkedCount}`);
      console.log(`- 无客户消息: ${noCustomerMsgCount}`);
      console.log(`- 员工已回复: ${employeeRepliedCount}`);
      console.log(`- 需要提醒: ${needAlertCount}`);
      console.log(`- 正常状态: ${checkedCount - noCustomerMsgCount - employeeRepliedCount - needAlertCount}`);
      
      if (needAlertCount > 0) {
        console.log(`⚠️  发现 ${needAlertCount} 个群需要提醒，详细信息见上方日志`);
      } else {
        console.log(`✅ 所有群响应正常，无需提醒`);
      }
      console.log('');
    } catch (error) {
      console.error('检查群响应情况失败:', error);
      throw error;
    }
  }
  
  /**
   * 检查单个群聊的响应情况
   * @param group 群聊对象
   */
  async checkGroupResponse(group: IGroupData): Promise<void> {
    try {
      // 如果没有客户最后消息记录，则不需要提醒（静默处理）
      if (!group.lastCustomerMessage) {
        return;
      }
      
      // 如果最后一条消息是员工发的，则不需要提醒（静默处理）
      if (group.lastMessage && group.lastMessage.fromType === 'employee') {
        if (group.id) {
          await this.groupApiService.updateGroupAlertSettings(group.id, {
          needAlert: false,
          alertLevel: 0
        });
        }
        return;
      }
      
      // 计算客户最后一条消息的时间到现在的分钟数
      const lastCustomerMsgTime = moment(group.lastCustomerMessage.createTime);
      const now = moment();
      const minutesPassed = now.diff(lastCustomerMsgTime, 'minutes');
      
      // 确定提醒级别
      let alertLevel = 0;
      let needAlert = false;
      
      for (let i = this.alertThresholds.length - 1; i >= 0; i--) {
        if (minutesPassed >= this.alertThresholds[i]) {
          alertLevel = i + 1;
          needAlert = true;
          break;
        }
      }
      
      // 只有在需要提醒或提醒级别有变化时才输出详细日志
      const hasAlertChange = group.alertLevel !== alertLevel;
      const shouldShowLog = needAlert || hasAlertChange;
      
      if (shouldShowLog) {
        console.log(`\n==== 检查群 ${group.name} (${group.chatId}) 的响应情况 ====`);
        
        // 转换为北京时间显示
        const lastMsgTimeLocal = lastCustomerMsgTime.utcOffset(8).format('YYYY-MM-DD HH:mm:ss');
        const nowLocal = now.utcOffset(8).format('YYYY-MM-DD HH:mm:ss');
        
        console.log(`群 ${group.name} 客户最后消息时间(北京时间): ${lastMsgTimeLocal}`);
        console.log(`现在时间(北京时间): ${nowLocal}`);
        console.log(`已经过去 ${minutesPassed} 分钟`);
        console.log(`当前提醒阈值设置:`, this.alertThresholds);
        
        if (needAlert) {
          console.log(`超过阈值 ${this.alertThresholds[alertLevel - 1]} 分钟，设置提醒级别为 ${alertLevel}`);
        }
        
        console.log(`旧提醒级别: ${group.alertLevel}, 新提醒级别: ${alertLevel}, 是否需要提醒: ${needAlert}`);
      }
      
      // 如果提醒级别有变化，则更新记录
      if (hasAlertChange && group.id) {
        if (shouldShowLog) {
          console.log(`提醒级别有变化，更新API记录`);
        }
        await this.groupApiService.updateGroupAlertSettings(group.id, {
          needAlert,
          alertLevel
        });
        
        // 如果需要提醒，则发送提醒消息
        if (needAlert) {
          if (shouldShowLog) {
            console.log(`需要发送提醒消息...`);
          }
          await this.sendAlert({ ...group, needAlert: needAlert ? 1 : 0, alertLevel }, minutesPassed);
        }
      } else if (shouldShowLog) {
        console.log(`提醒级别无变化，不发送提醒`);
      }
      
      if (shouldShowLog) {
        console.log(`==== 检查群 ${group.name} 响应情况完成 ====\n`);
      }
    } catch (error) {
      console.error(`检查群 ${group.chatId} 响应情况失败:`, error);
    }
  }
  
  /**
   * 发送提醒消息
   * @param group 需要提醒的群
   * @param minutesPassed 已经过去的分钟数
   */
  async sendAlert(group: IGroupData, minutesPassed: number): Promise<void> {
    try {
      console.log('==== 开始发送提醒 ====');
      console.log('群信息:', {
        chatId: group.chatId,
        name: group.name,
        owner: group.owner,
        needAlert: group.needAlert,
        alertLevel: group.alertLevel,
        minutesPassed: minutesPassed
      });
      
      // 查找群主
      const owner = group.owner;
      console.log('发送提醒给群主:', owner);
      
      // 确保lastCustomerMessage存在
      if (!group.lastCustomerMessage) {
        console.log('没有客户最后消息记录，不发送提醒');
        return;
      }
      
      const content = group.lastCustomerMessage.content || '';
      
      // 转换为北京时间 (UTC+8)
      const lastMsgTime = moment(group.lastCustomerMessage.createTime).utcOffset(8).format('MM-DD HH:mm:ss');
      
      // 构建提醒消息
      const alertMessage = `【客户群响应提醒】\n群名称: ${group.name}\n已超过 ${minutesPassed} 分钟未回复客户消息\n客户最后消息时间: ${lastMsgTime}\n客户最后消息: ${content.substring(0, 50)}${content.length > 50 ? '...' : ''}`;
      
      console.log('提醒消息内容:', alertMessage);
      
      // 发送提醒给群主
      const sendResult = await this.weixinService.sendAppMessage(alertMessage, owner);
      console.log(`向群主 ${owner} 发送提醒结果:`, sendResult ? '成功' : '失败');
      
      // 发送给额外的接收者
      // 调试环境变量
      console.log('环境变量 ADDITIONAL_RECEIVERS:', process.env.ADDITIONAL_RECEIVERS || '未设置');
      
      const additionalReceivers = config.corpWeixin.additionalReceivers;
      console.log('额外接收者配置解析结果:', additionalReceivers);
      console.log('额外接收者数组长度:', additionalReceivers ? additionalReceivers.length : 0);
      
      if (additionalReceivers && additionalReceivers.length > 0) {
        console.log('存在额外接收者，准备发送提醒');
        for (const receiver of additionalReceivers) {
          console.log(`检查额外接收者: ${receiver}, 类型: ${typeof receiver}, 长度: ${receiver ? receiver.length : 0}`);
          
          if (receiver && receiver !== owner) {
            console.log(`准备向额外接收者 ${receiver} 发送提醒消息`);
            const extraSendResult = await this.weixinService.sendAppMessage(alertMessage, receiver);
            console.log(`向额外接收者 ${receiver} 发送提醒结果:`, extraSendResult ? '成功' : '失败');
          } else {
            console.log(`跳过额外接收者: ${receiver} ${receiver === owner ? '(与群主相同)' : '(无效用户ID)'}`);
          }
        }
      } else {
        console.log('没有找到有效的额外接收者配置，跳过额外发送');
      }
      
      console.log('==== 提醒发送完成 ====');
    } catch (error) {
      console.error(`发送群 ${group.chatId} 提醒失败:`, error);
    }
  }
  
  /**
   * 模拟更新消息记录
   * 在实际应用中，这部分应由接收企业微信回调的API处理
   * 这里仅作为演示用途
   */
  async simulateNewMessage(chatId: string, message: IMessage): Promise<void> {
    try {
      console.log(`\n==== 模拟新消息 ====`);
      console.log(`群ID: ${chatId}`);
      console.log(`消息内容:`, JSON.stringify(message, null, 2));
      
      // 使用 API 服务查找群组
      const group = await this.groupApiService.findOneGroup(chatId);
      
      if (!group) {
        console.error(`找不到群 ${chatId}`);
        throw new Error(`找不到群 ${chatId}`);
      }
      
      console.log(`找到群: ${group.name}`);
      
      const updateData: any = {
        lastMessage: message
      };
      
      // 根据消息发送者类型更新对应的最后消息记录
      if (message.fromType === 'employee') {
        console.log(`这是员工消息，发送者: ${message.from}`);
        updateData.lastEmployeeMessage = message;
        // 如果是员工回复，重置提醒状态
        updateData.needAlert = false;
        updateData.alertLevel = 0;
      } else {
        console.log(`这是客户消息，发送者: ${message.from}`);
        updateData.lastCustomerMessage = message;
      }
      
      console.log(`更新前数据:`, {
        lastMessage: group.lastMessage ? { 
          from: group.lastMessage.from,
          content: group.lastMessage.content,
          createTime: group.lastMessage.createTime
        } : null,
        lastEmployeeMessage: group.lastEmployeeMessage ? {
          from: group.lastEmployeeMessage.from,
          content: group.lastEmployeeMessage.content,
          createTime: group.lastEmployeeMessage.createTime
        } : null,
        lastCustomerMessage: group.lastCustomerMessage ? {
          from: group.lastCustomerMessage.from,
          content: group.lastCustomerMessage.content,
          createTime: group.lastCustomerMessage.createTime
        } : null,
        needAlert: group.needAlert,
        alertLevel: group.alertLevel
      });
      
      if (group.id) {
        // 使用 API 服务更新群组最后消息
        await this.groupApiService.updateGroupLastMessage(group.id, updateData);
      }
      
      console.log(`已更新群 ${chatId} 的消息记录`);
      console.log(`==== 模拟新消息完成 ====\n`);
    } catch (error) {
      console.error(`更新群 ${chatId} 消息记录失败:`, error);
      throw error;
    }
  }
} 