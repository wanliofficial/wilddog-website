---
title: "WDGStream"
---

表示可通过 [WDGRoom](/conference/ios/api/wdgroom/) 传输的媒体流。请参考子类 [WDGLocalStream](/conference/ios/api/wdglocalstream/) 和 [WDGRoomStream](/conference/ios/api/wdgroomstream/)。

## 属性

### videoEnabled

**定义**

```objectivec
@property (nonatomic, assign) BOOL videoEnabled;
```

**说明**

表示是否播放媒体流的视频，默认为 YES。

</br>

---

### audioEnabled

**定义**

```objectivec
@property (nonatomic, assign) BOOL audioEnabled;
```

**说明**

表示是否播放媒体流的音频，默认为 YES。

</br>

---

## 方法

### - attach:

**定义**

```objectivec
- (void)attach:(WDGVideoView *)view;
```

**说明**

绑定媒体流与视图，使媒体流的视频在指定的 [WDGVideoView](/conference/ios/api/wdgvideoview/) 中显示。

**参数**

参数名             | 说明
------------------|------------------
view              | 播放媒体流的 UI 控件。请参考 [WDGVideoView](/conference/ios/api/wdgvideoview/)。

</br>

---

### - detach:

**定义**

```objectivec
- (void)detach:(WDGVideoView *)view;
```

**说明**

解除媒体流与指定的 [WDGVideoView](/conference/ios/api/wdgvideoview/) 的绑定，停止播放。

**参数**

参数名             | 说明
------------------|------------------
view              | 播放媒体流的 UI 控件。请参考 [WDGVideoView](/conference/ios/api/wdgvideoview/)。

</br>

---
