package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"github.com/NICEXAI/WeWorkFinanceSDK"
	"github.com/tidwall/gjson"
	"github.com/tidwall/sjson"
	"io"
	"io/ioutil"
	"log"
	"net/http"
	"os"
)

// 配置结构体
type Config struct {
	CorpId        string `json:"corp_id"`
	CorpSecret    string `json:"corp_secret"`
	RsaPrivateKey string `json:"rsa_private_key"`
	Port          string `json:"port"`
}

// 全局配置变量
var Cfg Config

// 🔧 修复：从config.json文件加载配置
func loadConfig() error {
	// 读取配置文件
	configFile := "config.json"
	if _, err := os.Stat(configFile); os.IsNotExist(err) {
		return fmt.Errorf("配置文件 %s 不存在", configFile)
	}

	configData, err := ioutil.ReadFile(configFile)
	if err != nil {
		return fmt.Errorf("读取配置文件失败: %v", err)
	}

	// 解析JSON配置
	if err := json.Unmarshal(configData, &Cfg); err != nil {
		return fmt.Errorf("解析配置文件失败: %v", err)
	}

	// 验证必要配置项
	if Cfg.CorpId == "" {
		return fmt.Errorf("corp_id 配置不能为空")
	}
	if Cfg.CorpSecret == "" {
		return fmt.Errorf("corp_secret 配置不能为空")
	}
	if Cfg.RsaPrivateKey == "" {
		return fmt.Errorf("rsa_private_key 配置不能为空")
	}
	if Cfg.Port == "" {
		Cfg.Port = "8889" // 默认端口
	}

	log.Printf("✅ 配置加载成功:")
	log.Printf("   - CorpId: %s", maskString(Cfg.CorpId))
	log.Printf("   - CorpSecret: %s", maskString(Cfg.CorpSecret))
	log.Printf("   - Port: %s", Cfg.Port)
	log.Printf("   - RSA私钥: 已加载 (%d 字符)", len(Cfg.RsaPrivateKey))

	return nil
}

// 脱敏显示字符串的辅助函数
func maskString(s string) string {
	if len(s) <= 6 {
		return "***"
	}
	return s[:3] + "***" + s[len(s)-3:]
}

type ChatData struct {
	Seq          uint64      `json:"seq,omitempty"`           // 消息的seq值，标识消息的序号。再次拉取需要带上上次回包中最大的seq。Uint64类型，范围0-pow(2,64)-1
	MsgId        string      `json:"msgid,omitempty"`         // 消息id，消息的唯一标识，企业可以使用此字段进行消息去重。
	PublickeyVer uint32      `json:"publickey_ver,omitempty"` // 加密此条消息使用的公钥版本号。
	Message      interface{} `json:"message"`
}

func main() {
	log.SetFlags(log.Ltime | log.Lshortfile)
	log.Println("🚀 启动WeworkMsg服务...")

	// 🔧 修复：正确加载配置
	if err := loadConfig(); err != nil {
		log.Fatalf("❌ 配置加载失败: %v", err)
	}

	// 初始化SDK客户端
	log.Println("🔧 初始化企业微信SDK...")
	client, err := WeWorkFinanceSDK.NewClient(Cfg.CorpId, Cfg.CorpSecret, Cfg.RsaPrivateKey)
	if err != nil {
		log.Printf("❌ SDK 初始化失败：%v", err)
		log.Println("⚠️  将以有限功能模式启动服务（仅健康检查可用）")
	} else {
		log.Println("✅ SDK 初始化成功")
	}

	// 健康检查接口
	http.HandleFunc("/health", func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		writer.Header().Set("Access-Control-Allow-Origin", "*")
		
		// 检查SDK是否正常初始化
		sdkStatus := "ok"
		sdkMessage := "SDK初始化成功"
		if err != nil {
			sdkStatus = "error"
			sdkMessage = err.Error()
		}
		
		response := fmt.Sprintf(`{
			"status": "healthy",
			"service": "wework-msg-service",
			"message": "服务运行正常",
			"sdk_status": "%s",
			"sdk_message": "%s",
			"port": "%s",
			"config_loaded": true,
			"corp_id": "%s",
			"endpoints": ["/health", "/get_chat_data", "/get_media_data"]
		}`, sdkStatus, sdkMessage, Cfg.Port, maskString(Cfg.CorpId))
		
		writer.WriteHeader(http.StatusOK)
		writer.Write([]byte(response))
		
		log.Printf("🩺 健康检查请求 - 服务状态: 正常, SDK状态: %s", sdkStatus)
	})

	// 根路径接口
	http.HandleFunc("/", func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		writer.Header().Set("Access-Control-Allow-Origin", "*")
		
		response := fmt.Sprintf(`{
			"message": "WeworkMsg服务正在运行",
			"version": "1.1.0",
			"port": "%s",
			"endpoints": ["/health", "/get_chat_data", "/get_media_data"],
			"description": "企业微信会话存档服务",
			"config_status": "loaded from config.json"
		}`, Cfg.Port)
		
		writer.WriteHeader(http.StatusOK)
		writer.Write([]byte(response))
	})

	// 获取聊天数据接口
	http.HandleFunc("/get_chat_data", func(writer http.ResponseWriter, request *http.Request) {
		defer request.Body.Close()
		
		log.Printf("📨 收到获取聊天数据请求")
		
		// 检查SDK是否可用
		if err != nil {
			log.Printf("❌ SDK未正确初始化: %v", err)
			responseError(writer, fmt.Errorf("SDK未正确初始化: %v", err))
			return
		}

		b, err := io.ReadAll(request.Body)
		if err != nil {
			log.Printf("❌ 读取请求体失败: %v", err)
			responseError(writer, err)
			return
		}

		seq := gjson.GetBytes(b, "seq").Uint()
		limit := gjson.GetBytes(b, "limit").Uint()
		proxy := gjson.GetBytes(b, "proxy").String()
		passwd := gjson.GetBytes(b, "passwd").String()
		timeout := gjson.GetBytes(b, "timeout").Int()

		log.Printf("📋 请求参数: seq=%d, limit=%d, timeout=%d", seq, limit, timeout)

		// 同步消息
		log.Printf("🔄 开始获取聊天数据...")
		chatDataList, err := client.GetChatData(seq, limit, proxy, passwd, int(timeout))
		if err != nil {
			log.Printf("❌ 获取聊天数据失败: %v", err)
			responseError(writer, err)
			return
		}

		log.Printf("✅ 获取到 %d 条聊天数据", len(chatDataList))

		var list []ChatData

		for i, chatData := range chatDataList {
			log.Printf("🔓 解密第 %d 条消息 (seq: %d, msgid: %s)", i+1, chatData.Seq, chatData.MsgId)
			
			// 消息解密
			chatInfo, err := client.DecryptData(chatData.EncryptRandomKey, chatData.EncryptChatMsg)
			if err != nil {
				log.Printf("❌ 解密消息失败: %v", err)
				responseError(writer, err)
				return
			}

			var cd ChatData
			cd.Seq = chatData.Seq
			cd.MsgId = chatData.MsgId
			cd.PublickeyVer = chatData.PublickeyVer

			// 根据消息类型解析
			switch chatInfo.Type {
			case "text":
				cd.Message = chatInfo.GetTextMessage()
			case "image":
				cd.Message = chatInfo.GetImageMessage()
			case "revoke":
				cd.Message = chatInfo.GetRevokeMessage()
			case "agree":
				cd.Message = chatInfo.GetAgreeMessage()
			case "voice":
				cd.Message = chatInfo.GetVoiceMessage()
			case "video":
				cd.Message = chatInfo.GetVideoMessage()
			case "card":
				cd.Message = chatInfo.GetCardMessage()
			default:
				log.Printf("⚠️  未知消息类型: %s", chatInfo.Type)
				cd.Message = map[string]interface{}{
					"type": chatInfo.Type,
					"raw_data": "unsupported message type",
				}
			}

			list = append(list, cd)
		}

		log.Printf("✅ 成功处理 %d 条消息", len(list))
		responseOk(writer, list)
	})
	
	// 获取媒体数据接口
	http.HandleFunc("/get_media_data", func(writer http.ResponseWriter, request *http.Request) {
		defer request.Body.Close()
		
		log.Printf("📁 收到获取媒体数据请求")
		
		// 检查SDK是否可用
		if err != nil {
			log.Printf("❌ SDK未正确初始化: %v", err)
			responseError(writer, fmt.Errorf("SDK未正确初始化: %v", err))
			return
		}

		b, err := io.ReadAll(request.Body)
		if err != nil {
			log.Printf("❌ 读取请求体失败: %v", err)
			responseError(writer, err)
			return
		}

		sdkfileid := gjson.GetBytes(b, "sdk_file_id").String()
		proxy := gjson.GetBytes(b, "proxy").String()
		passwd := gjson.GetBytes(b, "passwd").String()
		timeout := gjson.GetBytes(b, "timeout").Int()

		log.Printf("📋 媒体文件ID: %s, timeout: %d", sdkfileid, timeout)

		isFinish := false
		buffer := bytes.Buffer{}
		indexBuf := ""
		chunkCount := 0
		
		log.Printf("🔄 开始下载媒体数据...")
		for !isFinish {
			chunkCount++
			log.Printf("📦 下载第 %d 个数据块...", chunkCount)
			
			// 获取媒体数据
			mediaData, err := client.GetMediaData(indexBuf, sdkfileid, proxy, passwd, int(timeout))
			if err != nil {
				log.Printf("❌ 获取媒体数据失败: %v", err)
				responseError(writer, err)
				return
			}
			
			buffer.Write(mediaData.Data)
			if mediaData.IsFinish {
				isFinish = mediaData.IsFinish
			}
			indexBuf = mediaData.OutIndexBuf
			
			log.Printf("📊 已下载: %d 字节", buffer.Len())
		}

		log.Printf("✅ 媒体数据下载完成，总大小: %d 字节", buffer.Len())
		responseOk(writer, base64.StdEncoding.EncodeToString(buffer.Bytes()))
	})

	// 启动服务器
	log.Printf("🚀 WeworkMsg服务启动成功，监听端口: %s", Cfg.Port)
	log.Printf("📋 可用接口:")
	log.Printf("   GET  http://localhost:%s/health - 健康检查", Cfg.Port)
	log.Printf("   GET  http://localhost:%s/ - 服务信息", Cfg.Port)
	log.Printf("   POST http://localhost:%s/get_chat_data - 获取聊天数据", Cfg.Port)
	log.Printf("   POST http://localhost:%s/get_media_data - 获取媒体数据", Cfg.Port)
	log.Printf("🎯 服务已就绪，等待请求...")
	
	if err := http.ListenAndServe(":"+Cfg.Port, nil); err != nil {
		log.Fatalf("❌ 服务器启动失败: %v", err)
	}
}

func responseError(w http.ResponseWriter, err error) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	response(w, 1, err.Error())
}

func responseOk(w http.ResponseWriter, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	response(w, 0, data)
}

func response(w http.ResponseWriter, errCode int, data interface{}) {
	resp, _ := sjson.SetBytes([]byte{}, "errcode", errCode)
	if errCode == 0 {
		// 成功时，将数据放在 chatdata 字段中
		resp, _ = sjson.SetBytes(resp, "chatdata", data)
		resp, _ = sjson.SetBytes(resp, "errmsg", "ok")
	} else {
		// 错误时，将错误信息放在 errmsg 字段中
		resp, _ = sjson.SetBytes(resp, "errmsg", data)
	}
	_, _ = w.Write(resp)
} 