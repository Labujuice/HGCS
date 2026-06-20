# HGCS (HTML-based Ground Control Station) 完整工程規格書

## 1. 專案願景與最終目標 (Project Vision)
HGCS 是一個基於 Web 技術的輕量化地面控制系統。本專案的最終目標是**全面平替 QGroundControl (QGC)** 的核心功能（狀態監控與任務編排）。
為確保系統具備極佳的跨平台特性與未來的商用擴充性，本系統嚴格禁止前端直接與底層硬體或特定通訊協議（如 MAVLink）綁定。系統必須採用**「雙層解耦架構」**，將物理通訊、協議解析、狀態機管理完全隔離於地端代理層。

---

## 2. 系統架構與分層規範 (System Architecture)

HGCS 由兩個獨立的子系統組成，雙方透過標準的 WebSocket (JSON) 與 WebRTC 進行資料交換。


```

+-----------------------------------------------------------------+
|                  HGCS Web UI (前端網頁層)                       |
|  [Mapbox/Cesium] <-> [標準 UI 組件] <-> [通用 Telemetry/Mission JSON] |
+-----------------------------------------------------------------+
^
| WebSocket (JSON) & WebRTC
v
+-----------------------------------------------------------------+
|                  HGCS Gateway (地端代理層)                      |
|  [協定轉換器] <-> [異步任務狀態機] <-> [串流轉發(WebRTC Proxy)] |
+-----------------------------------------------------------------+
^
| 實體鏈路 (Serial / UDP / TCP)
v
+-----------------------------------------------------------------+
|           載具層 (物理無人機 或 PX4 SIH 模擬器)                 |
+-----------------------------------------------------------------+

```

### 2.1 HGCS Gateway (地端代理層) 規範
* **開發語言：** 建議使用 Go 或 Python (需打包為獨立可執行檔，免安裝環境)。
* **通訊對介：** 對下支援 Serial (USB 數傳電台)、UDP、TCP 封包接收；對上提供 WebSocket Server 供前端網頁連線。
* **核心職責：**
  * **協議抽象化：** 即時解析 MAVLink (v1/v2) 封包，並將其流式轉換（Stream）為 HGCS 通用 JSON 模型後廣播。
  * **異步任務阻斷處理：** 接收前端 JSON 航點後，在背景執行 MAVLink Mission Protocol（Count -> Request -> Write -> ACK）狀態機。必須具備超時重傳與校驗機制，並將進度異步推播給前端。

### 2.2 HGCS Web UI (前端網頁層) 規範
* **開發語言：** React 或 Vue 3 搭配 TypeScript，建構工具使用 Vite。
* **核心職責：**
  * **無狀態渲染：** 僅依賴 HGCS 通用 JSON 模型進行儀表與 2D/3D 地圖渲染，主執行緒效能必須鎖定在 60fps。
  * **PWA 支援：** 必須實作 Service Worker 進行 100% 離線啟動快取，並具備地圖 Tile 離線暫存機制。

---

## 3. 資料交換格式標準 (Data Schema)

### 3.1 載具動態狀態模型 (Gateway -> Web UI)
更新頻率：固定 20Hz。
```json
{
  "timestamp": 1718812800000,
  "vehicle_id": 1,
  "status": {
    "armed": true,
    "mode": "HOLD",
    "battery_percent": 92,
    "battery_voltage": 22.8,
    "gps_satellites": 16,
    "gps_fix_type": 4
  },
  "pose": {
    "roll": 0.00,
    "pitch": 0.00,
    "yaw": 90.00,
    "heading": 90
  },
  "navigation": {
    "latitude": 24.7746,
    "longitude": 121.0446,
    "relative_altitude": 0.0,
    "airspeed": 0.0,
    "groundspeed": 0.0
  }
}

```

### 3.2 任務編排與狀態回報模型 (Web UI <-> Gateway)

* **Web UI 發送任務：**

```json
{
  "vehicle_id": 1,
  "mission_id": "mission_uuid_2026",
  "waypoints": [
    { "command": "TAKEOFF", "latitude": 24.7746, "longitude": 121.0446, "altitude": 30.0 },
    { "command": "WAYPOINT", "latitude": 24.7750, "longitude": 121.0450, "altitude": 50.0, "hold_time": 5 },
    { "command": "RTL" }
  ]
}

```

* **Gateway 異步回報進度：**

```json
{
  "mission_id": "mission_uuid_2026",
  "state": "UPLOADING", 
  "progress": 45,
  "message": "Sending waypoint 2 of 3"
}

```

---

## 4. 測試與驗證規範 (Testing & Simulation)

為驗證 HGCS 能達到「平替 QGC」之工業級穩定度，專案必須導入 **PX4 SIH (Simulation-In-Hardware)** 進行閉環測試。

* **測試環境架設：** * 飛控硬體（如 Pixhawk）刷入 PX4 Autopilot 韌體，並將 SYS_HITL 參數配置為 SIH 模式（Simulation-In-Hardware）。
* 飛控將透過內部空氣動力學模型模擬真實飛機（固定翼或多旋翼）的物理動態。


* **驗收標準流程：**
1. 將 HGCS Gateway 透過 USB/Serial 連接至執行 PX4 SIH 的飛控。
2. 打開 HGCS Web UI，確認姿態儀（PFD）能流暢顯示 SIH 模擬的飛機即時姿態（Roll/Pitch/Yaw 變動）。
3. 透過 HGCS Web UI 規劃一個包含 Takeoff、3個航點、RTL 的任務並點擊上傳，觀察 Gateway 背景握手狀態是否正確。
4. 解鎖（Arm）並切換至 Mission 模式，驗證 SIH 模擬飛機是否確實按照 HGCS 規劃的軌跡飛行，且 Web UI 地圖上的圖標有即時同步移動。



---

## 5. 工程實作 TODO 清單與里程碑 (Milestones & Tasks)

工程團隊必須依照以下階段進行開發與交付：

### Phase 1: 架構驗證與 Mock 開發 (TODO)

* [x] **【前端】** 建立 HGCS Web UI 基礎專案（React/Vue3 + Vite + TypeScript）。
* [x] **【前端】** 實作 Mock Server，模擬 20Hz 的 Telemetry JSON 訊號，完成前端姿態儀與地圖組件的流暢度測試（確保 60fps）。
* [x] **【地端】** 建立 HGCS Gateway 基礎骨架，實作 WebSocket Server，並定義好前後端通訊介面（Interface）。

### Phase 2: 協定轉譯與監控對接 (TODO)

* [x] **【地端】** 整合 MAVLink 解析模組（如 go-mavlink 或 pymavlink）。
* [x] **【地端】** 實作 Telemetry 轉譯器：將 MAVLink 的 `ATTITUDE` 與 `GLOBAL_POSITION_INT` 封包轉換為標準 JSON 格式。
* [x] **【系統】** 連接 **PX4 SIH 模擬器**，驗證實體數據能正確透過 Gateway 餵給 HGCS Web UI，完成動態監控功能。

### Phase 3: 航點任務狀態機實作 (TODO)

* [x] **【前端】** 實作地圖航點編輯器（支援新增、刪除、拖拽、高度修改），並能導出標準航點 JSON。
* [x] **【地端】** 實作異步任務管理器（Mission Worker Thread/Goroutine）。
* [x] **【地端】** 實作 MAVLink Mission Protocol 狀態機，包含發送 `MISSION_COUNT`、回應 `MISSION_REQUEST`、接收 `MISSION_ACK` 的完整閉環。
* [x] **【系統】** 搭配 **PX4 SIH** 進行端到端的航點上傳、下載、清除測試，並驗證背景執行時前端 UI 不得有任何卡頓。

### Phase 4: 高級功能與生產環境優化 (TODO)

* [x] **【前端】** 導入 PWA 機制，實作 Service Worker 快取，確保斷網環境下 HGCS 可啟動。
* [x] **【前端】** 實作地圖切片（Map Tiles）本地快取或離線包載入功能。
* [x] **【地端】** 實作斷線自動重連機制（Serial/UDP 斷線重啟與 WebSocket 斷線重連）。
* [x] **【系統】** 進行 4 小時連續掛機與高頻資料吞吐測試，驗證前後端均無記憶體洩漏（Memory Leak）。

### Phase 5: 使用者界面與多機連線調整 (TODO)
* [x] **【前端】** 實作類 QGC 界面配置，讓地圖幾乎佈滿整個畫面，提供沉浸式體驗。
* [x] **【前端】** 在地圖上新增「快速定位載具 (Locate Drone)」按鈕，快速置中無人機。
* [x] **【前端】** 右上角新增連線設定選單，可設定地端代理連線實體載具的通訊配置（下層軟體連線）。
* [x] **【前端】** 下層連線選單支援 **UDP、TCP、Serial (串口)** 三種連接模式，包含連接地址、埠口、鮑率等設定。
* [x] **【系統】** 支援管理與監控多台載具 (Multi-Vehicle Connection)，能接收多台遙測訊號並可切換當前主控載具。

### Phase 6: QGC 界面平替與指點/滑動起飛功能實作 (TODO)
* [x] **【前端】** 實作主分頁視圖切換 (Fly / Plan / Setup)，實現專注、精簡的沉浸式操作空間。
* [x] **【前端】** 實作 QGC 風格頂部狀態列，包含 Armed、Flight Mode、Battery %、GPS Fix 狀態指示。
* [x] **【前端】** 實作 QGC 左側 Fly Tools 工具列，提供一鍵解鎖、起飛、降落、返航與懸停懸停控制。
* [x] **【前端】** 實作地圖點擊引導彈窗 (Guided Action Popup)，提供「前往此處 (Go To)」與「圍繞此處 (Orbit)」指點動作。
* [x] **【前端】** 實作 QGC 滑動確認條 (Slide to Confirm Slider)，對所有危險飛控動作進行二次滑動防誤觸確認。
* [x] **【地端與模擬】** 於地端代理及前端模擬器完整支援起飛、降落、返航、指點 reposition 與環繞 orbit 物理運動與遙測流。

```

---

### 🚀 老骨頭的最後叮嚀
這份規格書包含了**架構定義、API 協議、測試環境（PX4 SIH）到開發里程碑（TODO）**，是非常完整的工程交付文件。你直接發給工程師，他們絕對無話可說，只能擼起袖子開幹。祝 HGCS 開發順利，一舉平替 QGC！

```