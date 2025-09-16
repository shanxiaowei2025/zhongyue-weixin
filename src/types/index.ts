// 消息接口
export interface IMessage {
  msgId: string;           // 消息ID
  from: string;            // 发送者ID
  fromType: 'employee' | 'customer';  // 发送者类型：企业员工或客户
  content: string;         // 消息内容
  createTime: Date;        // 消息创建时间
}

// 群成员接口
export interface IMember {
  userId: string;
  userType: 'employee' | 'customer';
  name: string;
} 