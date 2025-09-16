import axios, { AxiosInstance } from 'axios';
import { IMessage } from '../types';

// 定义群组数据接口，与原 Group 模型保持一致
export interface IGroupData {
  id?: number;
  chatId: string;
  name: string;
  owner: string;
  members: Array<{
    userId: string;
    userType: 'employee' | 'customer';
    name?: string; // 根据响应案例，name字段可能不存在
  }>;
  lastMessage?: IMessage | null;
  lastEmployeeMessage?: IMessage | null;
  lastCustomerMessage?: IMessage | null;
  needAlert?: number; // 根据响应案例，是number类型，0表示不需要提醒
  alertLevel?: number;
  createdAt?: Date | string; // 可能是ISO字符串格式
  updatedAt?: Date | string; // 可能是ISO字符串格式
}

// 创建群组的请求体接口
export interface CreateGroupRequest {
  chatId: string;
  name: string;
  owner: string;
  members: Array<{
    userId: string;
    userType: 'employee' | 'customer';
  }>;
  lastMessage?: IMessage | null;
  lastEmployeeMessage?: IMessage | null;
  lastCustomerMessage?: IMessage | null;
}

// 更新群组的请求体接口
export interface UpdateGroupRequest {
  chatId?: string;
  name?: string;
  owner?: string;
  members?: Array<{
    userId: string;
    userType: 'employee' | 'customer';
  }>;
  lastMessage?: IMessage | null;
  lastEmployeeMessage?: IMessage | null;
  lastCustomerMessage?: IMessage | null;
}

// API错误响应接口
export interface ApiErrorResponse {
  code: number;
  timestamp: string;
  path: string;
  message: string;
  data: null;
}

// 查询群组列表的参数接口
export interface GetGroupsParams {
  page?: number;           // 页码，默认为1
  pageSize?: number;       // 每页数量，默认为10
  sortField?: 'id' | 'chatId' | 'name' | 'owner' | 'needAlert' | 'alertLevel' | 'createdAt' | 'updatedAt'; // 排序字段
  sortOrder?: 'ASC' | 'DESC'; // 排序方式，默认为DESC
  name?: string;           // 群组名称筛选（支持模糊查询）
  owner?: string;          // 群组所有者筛选
  needAlert?: boolean;     // 是否需要提醒筛选
  alertLevel?: number;     // 提醒级别筛选
}

// 查询群组列表的响应接口
export interface GetGroupsResponse {
  data: IGroupData[];      // 群组数据数组
  total: number;           // 总记录数
  page: number;            // 当前页码
  pageSize: number;        // 每页数量
  totalPages: number;      // 总页数
}

// 批量删除响应接口
export interface IBatchDeleteResponse {
  message: string;         // 删除结果消息
  deletedCount: number;    // 成功删除的群组数量
}

// 更新最后消息的请求体接口
export interface UpdateLastMessageRequest {
  from: string;            // 发送者ID
  msgId: string;           // 消息ID
  content: string;         // 消息内容
  fromType: 'employee' | 'customer'; // 发送者类型
  createTime: string;      // 消息创建时间（ISO 8601格式）
}

// 更新群组提醒设置的请求接口
export interface UpdateAlertSettingsRequest {
  needAlert: boolean;      // 是否需要提醒
  alertLevel: number;      // 提醒级别
}

// 获取需要提醒的群组列表的查询参数接口
export interface GetAlertGroupsParams {
  alertLevel?: string;     // 提醒级别筛选（可选）
}

// 标准API响应格式
export interface ApiResponse<T = any> {
  data: T;                 // 响应数据
  code: number;            // 状态码，0表示成功
  message: string;         // 响应消息
  timestamp: number;       // 时间戳
}

/**
 * 群组 API 服务类
 * 用于替代直接的数据库操作，通过 HTTP API 接口操作群组数据
 */
export class GroupApiService {
  private client: AxiosInstance;
  private baseUrl: string;

  /**
   * 统一错误处理工具函数
   * @param error axios错误对象
   * @param defaultMessage 默认错误消息
   */
  private handleApiError(error: any, defaultMessage: string): never {
    if (error.response?.data?.message) {
      // 如果服务器返回了具体错误信息，直接使用
      throw new Error(error.response.data.message);
    }
    
    // 根据HTTP状态码提供通用错误信息
    switch (error.response?.status) {
      case 404:
        throw new Error('资源不存在');
      case 409:
        throw new Error('数据冲突，可能是聊天ID已存在');
      case 400:
        throw new Error('请求参数错误');
      case 422:
        throw new Error('数据验证失败');
      case 403:
        throw new Error('没有权限执行此操作');
      case 500:
        throw new Error('服务器内部错误');
      default:
        throw new Error(defaultMessage);
    }
  }

  constructor() {
    // 从环境变量或配置文件获取 API 基础 URL  https://manage.zhongyuekuaiji.cn
    this.baseUrl = process.env.GROUPS_API_BASE_URL || 'https://manage.zhongyuekuaiji.cn';
    
    // 创建 axios 实例
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 10000, // 10秒超时
      headers: {
        'Content-Type': 'application/json'
      }
    });

    // 添加请求拦截器用于日志记录
    this.client.interceptors.request.use(
      (config) => {
        console.log(`API请求: ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error) => {
        console.error('API请求错误:', error);
        return Promise.reject(error);
      }
    );

    // 添加响应拦截器用于错误处理和数据提取
    this.client.interceptors.response.use(
      (response) => {
        console.log(`API响应: ${response.status} ${response.config.url}`);
        // 如果响应有标准格式，提取data字段
        if (response.data && typeof response.data === 'object' && 'data' in response.data) {
          return { ...response, data: response.data };
        }
        return response;
      },
      (error) => {
        console.error('API响应错误:', error.response?.status, error.response?.data || error.message);
        return Promise.reject(error);
      }
    );
  }

  /**
   * 创建群组
   * POST /api/groups
   * 
   * 请求体格式：
   * {
   *   "chatId": "chat_1234567891",
   *   "name": "项目讨论群1", 
   *   "owner": "user_admin1",
   *   "members": [
   *     { "userId": "ZhongYueHuiJiCaoHaiLing1318023501", "userType": "employee" }
   *   ],
   *   "lastMessage": { "content": "欢迎加入群组", "sender": "user_admin1", "timestamp": "2025-01-11T10:00:00Z" }
   * }
   * 
   * 成功响应：201，返回创建的群组数据
   * 错误响应：409，聊天ID已存在
   */
  async createGroup(groupData: CreateGroupRequest): Promise<IGroupData> {
    try {
      const response = await this.client.post<ApiResponse<IGroupData>>('/api/groups', groupData);
      return response.data.data;
    } catch (error: any) {
      console.error('创建群组失败:', error);
      
      // 提供更详细的错误信息
      if (error.response?.status === 409) {
        throw new Error(error.response?.data?.message || '聊天ID已存在');
      } else if (error.response?.status === 400) {
        throw new Error('请求参数错误: ' + (error.response?.data?.message || '未知错误'));
      } else if (error.response?.status === 422) {
        throw new Error('数据验证失败: ' + (error.response?.data?.message || '未知错误'));
      }
      
      throw new Error('创建群组失败');
    }
  }

  /**
   * 查询群组列表（带分页和筛选）
   * GET /api/groups
   * 
   * 查询参数：
   * - page: 页码，默认为1
   * - pageSize: 每页数量，默认为10
   * - sortField: 排序字段 (id, chatId, name, owner, needAlert, alertLevel, createdAt, updatedAt)
   * - sortOrder: 排序方式 (ASC/DESC)，默认为DESC
   * - name: 群组名称筛选（支持模糊查询）
   * - owner: 群组所有者筛选
   * - needAlert: 是否需要提醒筛选
   * - alertLevel: 提醒级别筛选
   * 
   * 响应格式：
   * {
   *   "data": {
   *     "data": [群组数据数组],
   *     "total": 2153,
   *     "page": 1,
   *     "pageSize": 10,
   *     "totalPages": 216
   *   },
   *   "code": 0,
   *   "message": "操作成功",
   *   "timestamp": 1757918299699
   * }
   */
  async getGroups(params?: GetGroupsParams): Promise<GetGroupsResponse> {
    try {
      const response = await this.client.get<ApiResponse<GetGroupsResponse>>('/api/groups', {
        params: params
      });
      // 注意：响应中的data字段是双层嵌套的 { data: { data: [...], total, page, ... } }
      return response.data.data;
    } catch (error) {
      console.error('查询群组列表失败:', error);
      throw new Error('查询群组列表失败');
    }
  }

  /**
   * 查询所有群组（不分页，向后兼容）
   * GET /api/groups?pageSize=999999
   * 
   * 这是一个向后兼容的方法，获取所有群组数据而不进行分页。
   * 实际上是调用分页接口但设置一个很大的pageSize值。
   */
  async getAllGroups(): Promise<IGroupData[]> {
    try {
      const response = await this.getGroups({ pageSize: 999999 });
      return response.data;
    } catch (error) {
      console.error('查询群组列表失败:', error);
      throw new Error('查询群组列表失败');
    }
  }

  /**
   * 根据ID查询群组详情
   * GET /api/groups/{id}
   * 
   * 查询指定ID的群组完整信息，包含所有成员详情。
   * 
   * 响应格式：
   * {
   *   "data": {
   *     "id": 4,
   *     "chatId": "wrFA_1BwAADQjir3sitXjAoCww46Q3hA",
   *     "name": "腾奕商贸——中岳会计群",
   *     "owner": "ZhongYueHuiJi-YuLiLi18331239319",
   *     "members": [
   *       { "userId": "LiuFei", "userType": "employee" },
   *       { "userId": "ZhongYueHuiJiCaoHaiLing131802350", "userType": "employee" },
   *       { "userId": "wmFA_1BwAA1zdwm9zeLIyKTQDofOkP8Q", "userType": "customer" }
   *     ],
   *     "lastMessage": null,
   *     "lastEmployeeMessage": null,
   *     "lastCustomerMessage": null,
   *     "needAlert": 0,
   *     "alertLevel": 0,
   *     "createdAt": "2025-07-21T06:40:10.000Z",
   *     "updatedAt": "2025-07-24T06:55:00.000Z"
   *   },
   *   "code": 0,
   *   "message": "操作成功",
   *   "timestamp": 1757918399423
   * }
   * 
   * @param id 群组ID
   * @returns 群组详情数据，如果不存在则返回null
   */
  async getGroupById(id: number): Promise<IGroupData | null> {
    try {
      const response = await this.client.get<ApiResponse<IGroupData>>(`/api/groups/${id}`);
      return response.data.data;
    } catch (error: any) {
      if (error.response?.status === 404) {
        return null; // 群组不存在
      }
      console.error('查询群组详情失败:', error);
      throw new Error('查询群组详情失败');
    }
  }

  /**
   * 根据聊天ID查询群组
   * GET /api/groups/chat/{chatId}
   * 
   * 这是一个特殊的查询接口，用于根据微信群的chatId直接查找对应的群组。
   * 用于通过微信群聊天ID快速定位对应的群组信息。
   * 
   * @param chatId 微信群聊天ID，例如："wrFA_1BwAAsI2cAdG3ogCa-XkRWMMeRQ"
   * @returns Promise<IGroupData | null> 找到时返回群组数据，不存在时返回null
   * 
   * 成功响应示例：
   * {
   *   "data": {
   *     "id": 2145,
   *     "chatId": "wrFA_1BwAAsI2cAdG3ogCa-XkRWMMeRQ",
   *     "name": "高碑店佑尚果蔬、恒果商贸  中岳会计服务群",
   *     "owner": "ZhongYuePiaoWuBuLiShuangXu13020823222",
   *     "members": [
   *       { "userId": "LiuFei", "userType": "employee" },
   *       { "userId": "ZhongYueHuiJiCaoHaiLing131802350", "userType": "employee" },
   *       { "userId": "wmFA_1BwAAVwf-AQf2ZoL4zZ9vktpURA", "userType": "customer" }
   *     ],
   *     "lastMessage": null,
   *     "lastEmployeeMessage": null,
   *     "lastCustomerMessage": null,
   *     "needAlert": 0,
   *     "alertLevel": 0,
   *     "createdAt": "2025-07-21T06:59:58.000Z",
   *     "updatedAt": "2025-07-24T06:39:25.000Z"
   *   },
   *   "code": 0,
   *   "message": "操作成功",
   *   "timestamp": 1757906480885
   * }
   * 
   * 404错误响应示例：
   * {
   *   "code": 404,
   *   "timestamp": "2025-09-15T06:48:28.419Z",
   *   "path": "/api/groups/chat/wrFA_1BwAAsI2cAdG3ogCa-XkR222",
   *   "message": "聊天ID为 \"wrFA_1BwAAsI2cAdG3ogCa-XkR222\" 的群组不存在",
   *   "data": null
   * }
   * 
   * @throws Error 当网络错误或其他非404错误时抛出异常
   */
  async getGroupByChatId(chatId: string): Promise<IGroupData | null> {
    try {
      const response = await this.client.get<ApiResponse<IGroupData>>(`/api/groups/chat/${chatId}`);
      return response.data.data;
    } catch (error: any) {
      if (error.response?.status === 404) {
        return null; // 群组不存在
      }
      console.error('根据聊天ID查询群组失败:', error);
      this.handleApiError(error, '根据聊天ID查询群组失败');
    }
  }

  /**
   * 更新群组信息
   * PATCH /api/groups/{id}
   * 
   * 更新指定ID的群组信息，支持部分字段更新。
   * 
   * 请求体格式：
   * {
   *   "chatId": "chat_1234567891",
   *   "name": "项目讨论群",
   *   "owner": "user_admin1",
   *   "members": [
   *     { "userId": "ZhongYueHuiJiCaoHaiLing1318023501", "userType": "employee" },
   *     { "userId": "aZhongYueHuiJiFuWuZhangYiRu138311", "userType": "employee" },
   *     { "userId": "wmFA_1BwAAXJlx117zYC0dObdL96UldA1", "userType": "customer" }
   *   ],
   *   "lastMessage": {
   *     "content": "欢迎加入群组1",
   *     "sender": "user_admin1", 
   *     "timestamp": "2025-01-11T10:00:00Z"
   *   },
   *   "lastEmployeeMessage": {
   *     "content": "员工消息内容1",
   *     "sender": "employee1",
   *     "timestamp": "2025-01-11T10:00:00Z"
   *   },
   *   "lastCustomerMessage": {
   *     "content": "客户消息内容1",
   *     "sender": "customer1",
   *     "timestamp": "2025-01-11T10:00:00Z"
   *   }
   * }
   * 
   * 响应格式：
   * {
   *   "data": {
   *     "id": 2157,
   *     "chatId": "chat_1234567891",
   *     "name": "项目讨论群",
   *     "owner": "user_admin1",
   *     "members": [...],
   *     "lastMessage": {...},
   *     "lastEmployeeMessage": {...},
   *     "lastCustomerMessage": {...},
   *     "needAlert": 0,
   *     "alertLevel": 0,
   *     "createdAt": "2025-09-15T06:36:50.000Z",
   *     "updatedAt": "2025-09-15T06:42:16.000Z"
   *   },
   *   "code": 0,
   *   "message": "操作成功",
   *   "timestamp": 1757918536873
   * }
   * 
   * @param id 群组ID
   * @param updateData 要更新的群组数据（支持部分更新）
   * @returns 更新后的群组完整信息
   */
  async updateGroup(id: number, updateData: UpdateGroupRequest): Promise<IGroupData> {
    try {
      const response = await this.client.patch<ApiResponse<IGroupData>>(`/api/groups/${id}`, updateData);
      return response.data.data;
    } catch (error: any) {
      console.error('更新群组信息失败:', error);
      
      // 提供更详细的错误信息
      if (error.response?.status === 404) {
        throw new Error(error.response?.data?.message || '群组不存在');
      } else if (error.response?.status === 409) {
        throw new Error(error.response?.data?.message || '聊天ID已存在');
      } else if (error.response?.status === 400) {
        throw new Error('请求参数错误: ' + (error.response?.data?.message || '未知错误'));
      } else if (error.response?.status === 422) {
        throw new Error('数据验证失败: ' + (error.response?.data?.message || '未知错误'));
      }
      
      throw new Error('更新群组信息失败');
    }
  }

  /**
   * 删除群组
   * DELETE /api/groups/{id}
   * 
   * 成功响应格式：
   * {
   *   "data": {
   *     "message": "群组 \"项目讨论群\" 已成功删除"
   *   },
   *   "code": 0,
   *   "message": "操作成功",
   *   "timestamp": 1757918784834
   * }
   * 
   * 404错误响应：
   * {
   *   "code": 404,
   *   "timestamp": "2025-09-15T06:46:37.940Z",
   *   "path": "/api/groups/2157",
   *   "message": "ID为 2157 的群组不存在",
   *   "data": null
   * }
   * 
   * @param id 群组ID
   * @returns 删除成功的消息
   * @throws 当群组不存在时抛出404错误
   */
  async deleteGroup(id: number): Promise<{ message: string }> {
    try {
      const response = await this.client.delete<ApiResponse<{ message: string }>>(`/api/groups/${id}`);
      return response.data.data;
    } catch (error: any) {
      console.error('删除群组失败:', error);
      this.handleApiError(error, '删除群组失败');
    }
  }

  /**
   * 批量删除群组
   * DELETE /api/groups/batch/remove
   * 
   * @param ids 要删除的群组ID数组
   * @returns Promise<IBatchDeleteResponse> 删除结果，包含删除数量信息
   * 
   * @example
   * // 成功删除示例
   * const result = await groupApi.batchDeleteGroups([1, 2, 3]);
   * console.log(result.message); // "成功删除 3 个群组"
   * console.log(result.deletedCount); // 3
   * 
   * // 完整的成功响应：
   * // {
   * //   "data": {
   * //     "message": "成功删除 3 个群组",
   * //     "deletedCount": 3
   * //   },
   * //   "code": 0,
   * //   "message": "操作成功",
   * //   "timestamp": 1757917628156
   * // }
   * 
   * @throws {Error} 当没有找到要删除的群组时会抛出404错误
   * // 404错误响应：
   * // {
   * //   "code": 404,
   * //   "timestamp": "2025-09-15T06:55:31.950Z",
   * //   "path": "/api/groups/batch/remove",
   * //   "message": "没有找到要删除的群组",
   * //   "data": null
   * // }
   */
  async batchDeleteGroups(ids: number[]): Promise<IBatchDeleteResponse> {
    try {
      const response = await this.client.delete<ApiResponse<IBatchDeleteResponse>>('/api/groups/batch/remove', {
        data: { ids }
      });
      return response.data.data;
    } catch (error: any) {
      if (error.response?.status === 404) {
        throw new Error('没有找到要删除的群组');
      }
      console.error('批量删除群组失败:', error);
      this.handleApiError(error, '批量删除群组失败');
      // 添加返回以确保类型一致性（虽然 handleApiError 会抛出异常）
      throw error;
    }
  }

  /**
   * 更新群组最后消息
   * PATCH /api/groups/{id}/last-message
   * 
   * 根据type参数决定更新哪个消息字段：
   * - general: 更新 lastMessage
   * - employee: 更新 lastEmployeeMessage  
   * - customer: 更新 lastCustomerMessage
   * 
   * @param id 群组ID
   * @param messageData 消息数据
   * @param type 消息类型，可选值: 'general' | 'employee' | 'customer'
   * @returns Promise<IGroupData> 更新后的群组数据
   * 
   * @example
   * // 更新员工消息
   * const result = await groupApi.updateGroupLastMessage(4, {
   *   from: "emp_123456",
   *   msgId: "test123", 
   *   content: "这是一条员工测试消息",
   *   fromType: "employee",
   *   createTime: "2025-07-21T16:00:00Z"
   * }, 'employee');
   * 
   * @example
   * // 更新客户消息
   * const result = await groupApi.updateGroupLastMessage(4, {
   *   from: "cust_789012",
   *   msgId: "test456",
   *   content: "这是一条客户测试消息", 
   *   fromType: "customer",
   *   createTime: "2025-07-21T16:05:00Z"
   * }, 'customer');
   * 
   * @throws {Error} 当群组不存在时抛出错误 "ID为 {id} 的群组不存在"
   */
  async updateGroupLastMessage(
    id: number, 
    messageData: UpdateLastMessageRequest,
    type: 'general' | 'employee' | 'customer' = 'general'
  ): Promise<IGroupData> {
    try {
      const response = await this.client.patch<ApiResponse<IGroupData>>(
        `/api/groups/${id}/last-message`,
        messageData,
        {
          params: { type }
        }
      );
      return response.data.data;
    } catch (error: any) {
      console.error('更新群组最后消息失败:', error);
      
      // 处理404错误
      if (error.response?.status === 404) {
        throw new Error(error.response?.data?.message || `ID为 ${id} 的群组不存在`);
      }
      
      // 使用统一的错误处理
      this.handleApiError(error, '更新群组最后消息失败');
      throw error;
    }
  }

  /**
   * 更新群组的通用最后消息 (lastMessage)
   * 
   * @param id 群组ID
   * @param messageData 消息数据
   * @returns Promise<IGroupData> 更新后的群组数据
   */
  async updateGeneralLastMessage(id: number, messageData: UpdateLastMessageRequest): Promise<IGroupData> {
    return await this.updateGroupLastMessage(id, messageData, 'general');
  }

  /**
   * 更新群组的员工最后消息 (lastEmployeeMessage)
   * 
   * @param id 群组ID
   * @param messageData 消息数据
   * @returns Promise<IGroupData> 更新后的群组数据
   */
  async updateEmployeeLastMessage(id: number, messageData: UpdateLastMessageRequest): Promise<IGroupData> {
    return await this.updateGroupLastMessage(id, messageData, 'employee');
  }

  /**
   * 更新群组的客户最后消息 (lastCustomerMessage)
   * 
   * @param id 群组ID
   * @param messageData 消息数据
   * @returns Promise<IGroupData> 更新后的群组数据
   */
  async updateCustomerLastMessage(id: number, messageData: UpdateLastMessageRequest): Promise<IGroupData> {
    return await this.updateGroupLastMessage(id, messageData, 'customer');
  }

  /**
   * 更新群组提醒设置
   * PATCH /api/groups/{id}/alert-settings
   * 
   * @param id 群组ID
   * @param alertData 提醒设置数据
   * @returns Promise<IGroupData> 更新后的群组数据
   * @throws 当群组不存在时抛出错误
   * 
   * @example
   * ```typescript
   * const groupApi = new GroupApiService();
   * 
   * // 开启提醒并设置级别为3
   * const updatedGroup = await groupApi.updateGroupAlertSettings(2, {
   *   needAlert: true,
   *   alertLevel: 3
   * });
   * console.log(`群组 "${updatedGroup.name}" 的提醒设置已更新`);
   * console.log(`需要提醒: ${updatedGroup.needAlert}`);
   * console.log(`提醒级别: ${updatedGroup.alertLevel}`);
   * 
   * // 关闭提醒
   * const disabledAlertGroup = await groupApi.updateGroupAlertSettings(2, {
   *   needAlert: false,
   *   alertLevel: 1
   * });
   * ```
   */
  async updateGroupAlertSettings(id: number, alertData: UpdateAlertSettingsRequest): Promise<IGroupData> {
    try {
      const response = await this.client.patch<ApiResponse<IGroupData>>(`/api/groups/${id}/alert-settings`, alertData);
      return response.data.data;
    } catch (error: any) {
      // 处理404错误
      if (error.response?.status === 404) {
        throw new Error(`ID为 ${id} 的群组不存在`);
      }
      
      // 处理其他错误
      this.handleApiError(error, '更新群组提醒设置');
    }
  }

  /**
   * 获取需要提醒的群组列表
   * GET /api/groups/alerts/list
   * 
   * @param params - 查询参数，可选的提醒级别筛选
   * @returns Promise<IGroupData[]> - 返回需要提醒的群组数组
   * 
   * @example
   * // 获取所有需要提醒的群组
   * const allAlertGroups = await groupApi.getGroupsNeedAlert();
   * 
   * @example  
   * // 获取提醒级别为3的群组
   * const level3Groups = await groupApi.getGroupsNeedAlert({ alertLevel: '3' });
   * 
   * @example
   * // 根据查询结果进行后续处理
   * const alertGroups = await groupApi.getGroupsNeedAlert({ alertLevel: '5' });
   * console.log(`找到 ${alertGroups.length} 个高优先级提醒群组`);
   * alertGroups.forEach(group => {
   *   console.log(`群组: ${group.name}, 级别: ${group.alertLevel}`);
   * });
   * 
   * @example
   * // 监控系统使用示例
   * const groupApi = new GroupApiService();
   * 
   * // 获取所有需要提醒的群组
   * const allAlertGroups = await groupApi.getGroupsNeedAlert();
   * console.log(`总共有 ${allAlertGroups.length} 个群组需要提醒`);
   * 
   * // 获取高优先级群组（级别3）
   * const highPriorityGroups = await groupApi.getGroupsNeedAlert({ alertLevel: '3' });
   * console.log(`高优先级群组: ${highPriorityGroups.length} 个`);
   * 
   * // 处理响应数据结构
   * if (allAlertGroups.length > 0) {
   *   const firstGroup = allAlertGroups[0];
   *   console.log(`群组名称: ${firstGroup.name}`);
   *   console.log(`群组ID: ${firstGroup.id}`);
   *   console.log(`提醒级别: ${firstGroup.alertLevel}`);
   *   console.log(`成员数量: ${firstGroup.members.length}`);
   *   
   *   // 检查最后消息
   *   if (firstGroup.lastCustomerMessage) {
   *     console.log(`最后客户消息: ${firstGroup.lastCustomerMessage.content}`);
   *     console.log(`消息时间: ${firstGroup.lastCustomerMessage.createTime}`);
   *   }
   * }
   */
  async getGroupsNeedAlert(params?: GetAlertGroupsParams): Promise<IGroupData[]> {
    try {
      const response = await this.client.get<ApiResponse<IGroupData[]>>('/api/groups/alerts/list', {
        params: params || {}
      });
      return response.data.data;
    } catch (error) {
      console.error('获取需要提醒的群组列表失败:', error);
      throw this.handleApiError(error, '获取需要提醒的群组列表失败');
    }
  }

  /**
   * 模拟 Sequelize 的 findOrCreate 方法
   * 先尝试根据 chatId 查找群组，如果不存在则创建
   */
  async findOrCreateGroup(
    chatId: string,
    defaults: CreateGroupRequest
  ): Promise<[IGroupData, boolean]> {
    try {
      // 先尝试查找
      const existingGroup = await this.getGroupByChatId(chatId);
      
      if (existingGroup) {
        return [existingGroup, false]; // 找到了，返回 [群组数据, false表示未创建]
      }
      
      // 没找到，创建新群组
      const newGroup = await this.createGroup(defaults);
      return [newGroup, true]; // 创建成功，返回 [群组数据, true表示已创建]
      
    } catch (error) {
      console.error('findOrCreateGroup 操作失败:', error);
      throw error;
    }
  }

  /**
   * 模拟 Sequelize 的 findOne 方法
   * 根据 chatId 查找群组
   */
  async findOneGroup(chatId: string): Promise<IGroupData | null> {
    return await this.getGroupByChatId(chatId);
  }

  /**
   * 兼容性方法别名 - 根据聊天ID查找群组
   */
  async findGroupByChatId(chatId: string): Promise<IGroupData | null> {
    return await this.getGroupByChatId(chatId);
  }

  /**
   * 兼容性方法别名 - 批量删除群组
   */
  async batchRemoveGroups(ids: number[]): Promise<IBatchDeleteResponse> {
    return await this.batchDeleteGroups(ids);
  }

  /**
   * 模拟 Sequelize 的 findAll 方法
   * 查询所有群组
   */
  async findAllGroups(): Promise<IGroupData[]> {
    return await this.getAllGroups();
  }
} 

/*
 * ===== 群组更新功能使用示例 =====
 * 
 * // 1. 更新群组基本信息
 * const groupApi = new GroupApiService();
 * 
 * const updatedGroup = await groupApi.updateGroup(2157, {
 *   name: "新的项目讨论群",
 *   owner: "new_admin_user"
 * });
 * 
 * // 2. 更新群组成员
 * await groupApi.updateGroup(2157, {
 *   members: [
 *     { userId: "employee1", userType: "employee" },
 *     { userId: "employee2", userType: "employee" },
 *     { userId: "customer1", userType: "customer" }
 *   ]
 * });
 * 
 * // 3. 更新最后消息信息
 * await groupApi.updateGroup(2157, {
 *   lastMessage: {
 *     content: "项目进展更新",
 *     sender: "project_manager",
 *     timestamp: "2025-09-15T10:30:00Z"
 *   },
 *   lastEmployeeMessage: {
 *     content: "员工反馈意见",
 *     sender: "employee1",
 *     timestamp: "2025-09-15T10:25:00Z"
 *   }
 * });
 * 
 * // 4. 完整更新群组信息
 * await groupApi.updateGroup(2157, {
 *   chatId: "chat_new_id",
 *   name: "重构后的讨论群",
 *   owner: "super_admin",
 *   members: [
 *     { userId: "lead_developer", userType: "employee" },
 *     { userId: "product_manager", userType: "employee" },
 *     { userId: "client_representative", userType: "customer" }
 *   ],
 *   lastMessage: {
 *     content: "欢迎使用新的群组功能",
 *     sender: "super_admin",
 *     timestamp: new Date().toISOString()
 *   }
 * });
 * 
 * // ===== 更新群组最后消息示例 =====
 * 
 * // 1. 更新员工最后消息
 * const updatedGroupWithEmployeeMsg = await groupApi.updateEmployeeLastMessage(4, {
 *   from: "emp_123456",
 *   msgId: "test123",
 *   content: "这是一条员工测试消息",
 *   fromType: "employee",
 *   createTime: "2025-07-21T16:00:00Z"
 * });
 * console.log(`群组 "${updatedGroupWithEmployeeMsg.name}" 的员工消息已更新`);
 * 
 * // 2. 更新客户最后消息
 * const updatedGroupWithCustomerMsg = await groupApi.updateCustomerLastMessage(4, {
 *   from: "cust_789012",
 *   msgId: "test456",
 *   content: "这是一条客户测试消息",
 *   fromType: "customer",
 *   createTime: "2025-07-21T16:05:00Z"
 * });
 * console.log(`群组 "${updatedGroupWithCustomerMsg.name}" 的客户消息已更新`);
 * 
 * // 3. 更新通用最后消息
 * const updatedGroupWithGeneralMsg = await groupApi.updateGeneralLastMessage(4, {
 *   from: "admin_user",
 *   msgId: "admin_msg_001",
 *   content: "系统通知：群组功能已升级",
 *   fromType: "employee",
 *   createTime: new Date().toISOString()
 * });
 * 
 * // 4. 使用通用方法指定类型
 * const result = await groupApi.updateGroupLastMessage(4, {
 *   from: "emp_123456",
 *   msgId: "direct_msg_001",
 *   content: "直接使用通用方法更新",
 *   fromType: "employee",
 *   createTime: "2025-07-21T17:00:00Z"
 * }, 'employee');
 * 
 * // ===== 更新群组提醒设置示例 =====
 * 
 * // 1. 开启提醒并设置级别为3
 * const alertEnabledGroup = await groupApi.updateGroupAlertSettings(2, {
 *   needAlert: true,
 *   alertLevel: 3
 * });
 * console.log(`群组 "${alertEnabledGroup.name}" 的提醒已开启`);
 * console.log(`提醒级别: ${alertEnabledGroup.alertLevel}`);
 * 
 * // 2. 关闭提醒
 * const alertDisabledGroup = await groupApi.updateGroupAlertSettings(2, {
 *   needAlert: false,
 *   alertLevel: 1
 * });
 * console.log(`群组 "${alertDisabledGroup.name}" 的提醒已关闭`);
 * 
 * // 3. 更新提醒级别（保持开启状态）
 * const updatedAlertGroup = await groupApi.updateGroupAlertSettings(2, {
 *   needAlert: true,
 *   alertLevel: 5
 * });
 * console.log(`群组提醒级别已更新为: ${updatedAlertGroup.alertLevel}`);
 * 
 * // ===== 错误处理示例 =====
 * try {
 *   await groupApi.updateGroup(3, { name: "新群组名称" });
 * } catch (error) {
 *   console.error(error.message); // "ID为 3 的群组不存在"
 * }
 * 
 * try {
 *   await groupApi.createGroup({
 *     chatId: "wrFA_1BwAAyyDN4gFtxlxjM1awiiFhlw",
 *     name: "测试群",
 *     owner: "test_user"
 *   });
 * } catch (error) {
 *   console.error(error.message); // "聊天ID \"wrFA_1BwAAyyDN4gFtxlxjM1awiiFhlw\" 已存在"
 * }
 * 
 * // 更新最后消息错误处理示例
 * try {
 *   await groupApi.updateEmployeeLastMessage(1, {
 *     from: "emp_123456",
 *     msgId: "test123",
 *     content: "测试消息",
 *     fromType: "employee",
 *     createTime: "2025-07-21T16:00:00Z"
 *   });
 * } catch (error) {
 *   console.error(error.message); // "ID为 1 的群组不存在"
 * }
 * 
 * // 更新提醒设置错误处理示例
 * try {
 *   await groupApi.updateGroupAlertSettings(999, {
 *     needAlert: true,
 *     alertLevel: 3
 *   });
 * } catch (error) {
 *   console.error(error.message); // "ID为 999 的群组不存在"
 * }
 * 
 * // ===== 删除群组示例 =====
 * try {
 *   const result = await groupApi.deleteGroup(2157);
 *   console.log(result.message); // "群组 \"项目讨论群\" 已成功删除"
 * } catch (error) {
 *   console.error(error.message); // "ID为 2157 的群组不存在"
 * }
 * 
 * // ===== 批量删除群组示例 =====
 * try {
 *   const result = await groupApi.batchDeleteGroups([1, 2, 3]);
 *   console.log(result.message); // "成功删除 3 个群组"
 *   console.log(result.deletedCount); // 3
 * } catch (error) {
 *   console.error(error.message); // "没有找到要删除的群组"
 * }
 * 
 * // ===== 根据聊天ID查询群组示例 =====
 * // 成功查询示例
 * const group = await groupApi.getGroupByChatId("wrFA_1BwAAsI2cAdG3ogCa-XkRWMMeRQ");
 * if (group) {
 *   console.log(`找到群组: ${group.name}`); // "高碑店佑尚果蔬、恒果商贸  中岳会计服务群"
 *   console.log(`群组ID: ${group.id}`); // 2145
 *   console.log(`成员数量: ${group.members.length}`); // 6
 * } else {
 *   console.log("群组不存在");
 * }
 * 
 * // 404错误示例（聊天ID不存在）
 * const notFoundGroup = await groupApi.getGroupByChatId("wrFA_1BwAAsI2cAdG3ogCa-XkR222");
 * console.log(notFoundGroup); // null
 * 
 * // 注意：
 * // - 所有字段都是可选的，支持部分更新
 * // - userType 只能是 'employee' 或 'customer'
 * // - 更新成功后返回完整的群组信息
 * // - 错误信息直接来自服务器响应，提供准确的错误描述
 * // - 支持的HTTP状态码：200(成功), 404(不存在), 409(冲突), 400(参数错误), 422(验证失败)
 * // 
 * // ===== 更新最后消息功能说明 =====
 * // - updateGroupLastMessage(): 通用方法，支持type参数指定更新类型
 * // - updateEmployeeLastMessage(): 专门更新员工最后消息 (lastEmployeeMessage)
 * // - updateCustomerLastMessage(): 专门更新客户最后消息 (lastCustomerMessage)  
 * // - updateGeneralLastMessage(): 专门更新通用最后消息 (lastMessage)
 * // - 消息数据必须包含: from, msgId, content, fromType, createTime
 * // - fromType 必须是 'employee' 或 'customer'
 * // - createTime 必须是ISO 8601格式的时间字符串
 * // - type 参数可选值: 'general', 'employee', 'customer'，默认为 'general'
 * // 
 * // ===== 更新群组提醒设置功能说明 =====
 * // - updateGroupAlertSettings(): 更新群组的提醒开关和提醒级别
 * // - needAlert: 布尔值，控制是否开启提醒功能
 * // - alertLevel: 数字，表示提醒级别（通常1-5，数值越高优先级越高）
 * // - 提醒设置会影响消息推送和通知行为
 * // - 支持单独更新提醒开关或级别，也可以同时更新
 * // 
 * // ===== 获取需要提醒的群组列表功能说明 =====
 * // - getGroupsNeedAlert(): 获取所有需要提醒的群组列表
 * // - 支持按提醒级别筛选，通过 alertLevel 查询参数
 * // - alertLevel 参数为字符串类型，可以指定特定的提醒级别
 * // - 返回的群组数组包含完整的群组信息，包括成员、消息等
 * // - 只返回 needAlert 为真（或非0）的群组
 * // - 适用于监控系统批量处理需要提醒的群组
 */ 