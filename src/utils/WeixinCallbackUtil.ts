import * as crypto from 'crypto';
import * as xml2js from 'xml2js';
import config from '../config/default';

/**
 * 企业微信回调工具类
 * 用于验证和解密企业微信回调消息
 */
export class WeixinCallbackUtil {
  private token: string;
  private encodingAESKey: string;
  private corpId: string;

  constructor() {
    this.token = config.corpWeixin.token;
    this.encodingAESKey = config.corpWeixin.encodingAESKey;
    this.corpId = config.corpWeixin.corpId;
    
    // 添加配置信息日志，便于调试
    console.log('WeixinCallbackUtil 初始化:');
    console.log('- Token 是否存在:', !!this.token, this.token ? `(${this.token.substr(0, 3)}...)` : '');
    console.log('- EncodingAESKey 是否存在:', !!this.encodingAESKey, this.encodingAESKey ? `(${this.encodingAESKey.substr(0, 3)}...)` : '');
    console.log('- CorpId 是否存在:', !!this.corpId, this.corpId ? `(${this.corpId.substr(0, 3)}...)` : '');
    
    // 检查配置是否有效
    this.checkConfiguration();
  }
  
  /**
   * 检查配置是否有效
   */
  private checkConfiguration() {
    let hasError = false;
    
    if (!this.token || this.token.length < 3) {
      console.error('⚠️ Token无效或为空，请检查环境变量设置!');
      hasError = true;
    }
    
    if (!this.encodingAESKey || this.encodingAESKey.length !== 43) {
      console.error('⚠️ EncodingAESKey无效或长度不为43，请检查环境变量设置!');
      hasError = true;
    }
    
    if (!this.corpId || this.corpId.length < 5) {
      console.error('⚠️ CorpId无效或为空，请检查环境变量设置!');
      hasError = true;
    }
    
    if (hasError) {
      console.error('⚠️ 配置有误，可能导致验证失败。请确保环境变量正确设置!');
      console.error('当前环境变量:');
      console.error('- TOKEN:', process.env.TOKEN || '(未设置)');
      console.error('- ENCODING_AES_KEY:', process.env.ENCODING_AES_KEY ? '(已设置)' : '(未设置)');
      console.error('- CORP_ID:', process.env.CORP_ID || '(未设置)');
    } else {
      console.log('✅ 配置检查通过');
    }
  }

  /**
   * 验证企业微信回调签名
   * @param msg_signature 企业微信加密签名
   * @param timestamp 时间戳
   * @param nonce 随机数
   * @param echostr 随机字符串(加密的)
   * @returns boolean 是否通过验证
   */
  verifySignature(msg_signature: string, timestamp: string, nonce: string, echostr: string): boolean {
    // 记录输入参数
    console.log('验证签名输入参数:');
    console.log('- msg_signature:', msg_signature);
    console.log('- timestamp:', timestamp);
    console.log('- nonce:', nonce);
    console.log('- echostr:', echostr);
    console.log('- token:', this.token);
    
    // 企业微信加密模式下，URL验证的签名计算方法：
    // 1. 将token、timestamp、nonce、echostr四个参数按照字典序排序
    const arr = [this.token, timestamp, nonce, echostr].sort();
    const str = arr.join('');
    
    console.log('- 签名前字符串(包含echostr):', str);
    
    // 2. 对字符串进行sha1计算
    const sha1Sum = crypto.createHash('sha1');
    sha1Sum.update(str);
    const calculatedSignature = sha1Sum.digest('hex');
    
    console.log('- 计算得到的签名:', calculatedSignature);
    console.log('- 是否匹配:', calculatedSignature === msg_signature);
    
    return calculatedSignature === msg_signature;
  }

  /**
   * 解析XML消息
   * @param xml XML字符串
   * @returns Promise<any> 解析后的对象
   */
  async parseXml(xml: string): Promise<any> {
    return new Promise((resolve, reject) => {
      xml2js.parseString(xml, { explicitArray: false }, (err: Error | null, result: { xml: any }) => {
        if (err) {
          reject(err);
        } else {
          resolve(result.xml);
        }
      });
    });
  }

  /**
   * 解密企业微信消息
   * @param msgEncrypt 加密的消息内容
   * @param msgSignature 消息签名
   * @param timestamp 时间戳
   * @param nonce 随机数
   * @returns 解密后的消息或null
   */
  decryptMessage(msgEncrypt: string, msgSignature: string, timestamp: string, nonce: string): string | null {
    try {
      // 1. 验证消息签名
      const arr = [this.token, timestamp, nonce, msgEncrypt].sort();
      const str = arr.join('');
      const sha1Sum = crypto.createHash('sha1');
      sha1Sum.update(str);
      const calculatedSignature = sha1Sum.digest('hex');
      
      if (calculatedSignature !== msgSignature) {
        console.error('消息签名验证失败');
        return null;
      }

      // 2. 解密消息
      const aesKey = Buffer.from(this.encodingAESKey + '=', 'base64');
      const iv = aesKey.slice(0, 16);
      
      const decipher = crypto.createDecipheriv('aes-256-cbc', aesKey, iv);
      decipher.setAutoPadding(false);
      
      let decrypted = decipher.update(msgEncrypt, 'base64', 'utf8');
      decrypted += decipher.final('utf8');
      
      // 去除填充
      const pad = decrypted.charCodeAt(decrypted.length - 1);
      decrypted = decrypted.slice(0, -pad);
      
      // 去除16字节随机字符串、4字节消息长度和corpId
      const content = decrypted.slice(20);
      const corpId = content.slice(-this.corpId.length);
      
      if (corpId !== this.corpId) {
        console.error('corpId不匹配');
        return null;
      }
      
      return content.slice(0, -this.corpId.length);
    } catch (error) {
      console.error('解密消息失败:', error);
      return null;
    }
  }

  /**
   * 处理企业微信回调验证请求
   * @param msg_signature 企业微信加密签名
   * @param timestamp 时间戳
   * @param nonce 随机数
   * @param echostr 随机字符串（可能加密也可能明文）
   * @returns string|null 验证成功返回echostr，失败返回null
   */
  handleVerification(msg_signature: string, timestamp: string, nonce: string, echostr: string): string | null {
    console.log('处理验证请求:');
    
    // 对参数进行URL解码
    const decodedEchostr = decodeURIComponent(echostr);
    console.log('- 原始echostr:', echostr);
    console.log('- 解码后echostr:', decodedEchostr);
    
    try {
      // 在企业微信URL验证阶段，echostr通常是明文
      // 我们只需要验证签名，然后返回原始的echostr
      if (!this.verifySignature(msg_signature, timestamp, nonce, decodedEchostr)) {
        console.log('- 签名验证失败');
        return null;
      }
      
      console.log('- 签名验证成功');
      
      // 对于URL验证，直接返回echostr（明文）
      // 企业微信会检查返回的内容是否与发送的echostr一致
      console.log('- 返回原始echostr:', decodedEchostr);
      
      return decodedEchostr;
    } catch (error) {
      console.error('- 处理验证请求异常:', error);
      return null;
    }
  }
  
  /**
   * 解密企业微信验证字符串
   * @param echostr 加密的验证字符串
   * @returns 解密后的字符串或null
   */
  decryptEchoStr(echostr: string): string | null {
    try {
      console.log('尝试解密echostr:', echostr);
      
      // 使用AES解密
      const aesKey = Buffer.from(this.encodingAESKey + '=', 'base64');
      const iv = aesKey.slice(0, 16);
      
      console.log('- 密钥长度:', aesKey.length);
      console.log('- IV长度:', iv.length);
      
      // 将Base64编码的密文解码为Buffer
      const encrypted = Buffer.from(echostr, 'base64');
      
      // 使用AES-256-CBC模式解密
      const decipher = crypto.createDecipheriv('aes-256-cbc', aesKey, iv);
      decipher.setAutoPadding(false); // 关闭自动填充，企业微信使用PKCS#7填充
      
      let decrypted = Buffer.concat([
        decipher.update(encrypted),
        decipher.final()
      ]);
      
      // 去除PKCS#7填充
      const padLength = decrypted[decrypted.length - 1];
      if (padLength < 1 || padLength > 32) {
        console.error('无效的填充值:', padLength);
        return null;
      }
      decrypted = decrypted.slice(0, -padLength);
      
      // 检查数据格式：16字节随机字符串 + 4字节消息长度 + 消息内容 + CorpId
      if (decrypted.length < 20 + this.corpId.length) {
        console.error('解密后数据长度不足');
        return null;
      }
      
      // 取出消息内容
      const random = decrypted.slice(0, 16);
      const msgLenBuf = decrypted.slice(16, 20);
      const msgLen = msgLenBuf.readUInt32BE(0);
      const msgContent = decrypted.slice(20, 20 + msgLen);
      const receivedCorpId = decrypted.slice(20 + msgLen).toString();
      
      console.log('- 解析解密结果:');
      console.log('  - 随机字符串(16字节):', random.toString('hex'));
      console.log('  - 消息长度(4字节):', msgLen);
      console.log('  - 接收到的企业ID:', receivedCorpId);
      console.log('  - 期望的企业ID:', this.corpId);
      
      if (receivedCorpId !== this.corpId) {
        console.error('企业ID不匹配');
        return null;
      }
      
      const result = msgContent.toString();
      console.log('- 解密后的echostr:', result);
      return result;
    } catch (error) {
      console.error('解密echostr失败:', error);
      return null;
    }
  }
}

export default new WeixinCallbackUtil(); 