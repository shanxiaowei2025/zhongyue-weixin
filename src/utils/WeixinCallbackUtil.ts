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
    console.log('- Token 是否存在:', !!this.token);
    console.log('- EncodingAESKey 是否存在:', !!this.encodingAESKey);
    console.log('- CorpId 是否存在:', !!this.corpId);
  }

  /**
   * 验证企业微信回调签名
   * @param signature 企业微信加密签名
   * @param timestamp 时间戳
   * @param nonce 随机数
   * @param echostr 随机字符串
   * @returns boolean 是否通过验证
   */
  verifySignature(signature: string, timestamp: string, nonce: string, echostr?: string): boolean {
    // 记录输入参数
    console.log('验证签名输入参数:');
    console.log('- signature:', signature);
    console.log('- timestamp:', timestamp);
    console.log('- nonce:', nonce);
    console.log('- token:', this.token);
    
    const arr = [this.token, timestamp, nonce].sort();
    const str = arr.join('');
    
    console.log('- 签名前字符串:', str);
    
    const sha1Sum = crypto.createHash('sha1');
    sha1Sum.update(str);
    const calculatedSignature = sha1Sum.digest('hex');
    
    console.log('- 计算得到的签名:', calculatedSignature);
    console.log('- 是否匹配:', calculatedSignature === signature);
    
    return calculatedSignature === signature;
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
   * @param signature 企业微信加密签名
   * @param timestamp 时间戳
   * @param nonce 随机数
   * @param echostr 随机字符串
   * @returns string|null 验证成功返回echostr，失败返回null
   */
  handleVerification(signature: string, timestamp: string, nonce: string, echostr: string): string | null {
    console.log('处理验证请求:');
    
    // 对参数进行URL解码
    const decodedEchostr = decodeURIComponent(echostr);
    console.log('- 原始echostr:', echostr);
    console.log('- 解码后echostr:', decodedEchostr);
    
    if (this.verifySignature(signature, timestamp, nonce)) {
      console.log('- 验证成功，返回echostr');
      return decodedEchostr;
    }
    
    console.log('- 验证失败');
    return null;
  }
}

export default new WeixinCallbackUtil(); 