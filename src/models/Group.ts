import { 
  Model, DataTypes, Sequelize, 
  InferAttributes, InferCreationAttributes, 
  CreationOptional
} from 'sequelize';
import config from '../config/default';

// 创建 Sequelize 实例
const sequelize = new Sequelize(
  config.database.database,
  config.database.username,
  config.database.password,
  {
    host: config.database.host,
    port: config.database.port,
    dialect: 'mysql',
    dialectOptions: {
      // 使用MySQL native认证插件
      charset: 'utf8mb4',
      collate: 'utf8mb4_unicode_ci'
    },
    logging: false
  }
);

// 消息接口
export interface IMessage {
  msgId: string;           // 消息ID
  from: string;            // 发送者ID
  fromType: 'employee' | 'customer';  // 发送者类型：企业员工或客户
  content: string;         // 消息内容
  createTime: Date;        // 消息创建时间
}

// 群成员接口
interface IMember {
  userId: string;
  userType: 'employee' | 'customer';
  name: string;
}

// 群聊模型类
export class Group extends Model<InferAttributes<Group>, InferCreationAttributes<Group>> {
  declare id: CreationOptional<number>;
  declare chatId: string;
  declare name: string;
  declare owner: string;
  declare members: IMember[];
  declare lastMessage: IMessage | null;
  declare lastEmployeeMessage: IMessage | null;
  declare lastCustomerMessage: IMessage | null;
  declare needAlert: boolean;
  declare alertLevel: number;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

// 初始化模型
Group.init({
  id: {
    type: DataTypes.INTEGER.UNSIGNED,
    autoIncrement: true,
    primaryKey: true
  },
  chatId: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  owner: {
    type: DataTypes.STRING,
    allowNull: false
  },
  members: {
    type: DataTypes.JSON,
    allowNull: false
  },
  lastMessage: {
    type: DataTypes.JSON,
    allowNull: true
  },
  lastEmployeeMessage: {
    type: DataTypes.JSON,
    allowNull: true
  },
  lastCustomerMessage: {
    type: DataTypes.JSON,
    allowNull: true
  },
  needAlert: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  alertLevel: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  createdAt: DataTypes.DATE,
  updatedAt: DataTypes.DATE
}, {
  sequelize,
  tableName: 'groups',
  timestamps: true
});

// 导出模型
export default Group; 