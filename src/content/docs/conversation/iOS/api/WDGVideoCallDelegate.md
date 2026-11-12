---
title: "WDGVideoCallDelegate"
---

[WDGVideoCall](/conversation/ios/api/wdgvideocall/) 的代理方法。

## 方法

### - wilddogVideoCall: didReceiveCallWithConversation: data:

**定义**

```objectivec
- (void)wilddogVideoCall:(WDGVideoCall *)videoCall didReceiveCallWithConversation:(WDGConversation *)conversation data:(NSString * _Nullable)data;
```

**说明**

[WDGVideoCall](/conversation/ios/api/wdgvideocall/) 通过调用该方法通知当前用户收到一对一视频通话邀请。

**参数**

参数名             | 说明
------------------|------------------
video             | 调用该方法的 [WDGVideoCall](/conversation/ios/api/wdgvideocall/) 实例。
conversation      | 代表收到邀请的一对一视频通话的 [WDGConversation](/conversation/ios/api/wdgconversation/) 实例。
data              | 随通话邀请传递的字符串类型的数据。

</br>

---

### - wilddogVideoCall: didFailWithTokenError:

**定义**

```objectivec
- (void)wilddogVideoCall:(WDGVideoCall *)videoCall didFailWithTokenError:(NSError * _Nullable)error;
```

**说明**

[WDGVideoCall](/conversation/ios/api/wdgvideocall/) 通过调用该方法通知当前用户配置 [WDGVideoCall](/conversation/ios/api/wdgvideocall/) 时发生 token 错误。

**参数**

 参数名 | 说明 
---|---
video | 调用该方法的 [WDGVideoCall](/conversation/ios/api/wdgvideocall/) 实例。
error | 错误信息。
