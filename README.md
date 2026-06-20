# HGCS (HTML Ground Control Station) 🚀

HGCS (HTML-based Ground Control Station) 是一個基於 Web 技術打造的輕量化地面控制系統，旨在全面平替 QGroundControl (QGC) 的核心狀態監控與任務編排功能。

本專案採用**雙層解耦架構**：將物理通訊、協議解析、航點上傳狀態機完全隔離於地端代理層（Gateway），而前端網頁層（Web UI）則專注於高性能、無狀態的姿態渲染與地圖任務規劃。

---

## 🌟 核心特色 (Core Features)

1. **雙層解耦架構 (Decoupled Architecture)**
   - **HGCS Gateway**：採用 Python 執行緒架構，流式解析 MAVLink 封包並轉譯為標準 JSON Telemetry 模型；背景執行 MAVLink Mission Protocol（Count -> Request -> Write -> ACK）狀態機，包含超時重傳與校驗機制。
   - **HGCS Web UI**：基於 React + TypeScript + Vite，配合 HTML5 Canvas 實現高達 60fps 的 PFD 姿態儀，以及極其流暢的 Leaflet 互動地圖。
2. **QGC 沉浸式滿版排版 (QGC Fullscreen Layout)**
   - **滿版地圖背景**：捨棄傳統側邊欄區塊，地圖作為 100% 全螢幕背景，所有控制板面皆為玻璃透光懸浮視圖。
   - **左側懸浮工具列**：整合了 Fly/Plan 視圖切換按鈕，以及一鍵起飛 (Takeoff)、降落 (Land)、返航 (RTL)、暫停懸停 (Pause) 等直達操作。
   - **右側 Plan 編輯面板**：切換為 Plan 模式時，右側面板滑出，供任務航點編輯、高度與停滯時間參數調整，以及上傳/同步任務。
   - **右上角 HUD 儀表**：將 Primary Flight Display (PFD) 姿態儀與航向羅盤以小巧圓形卡片懸浮在右上角。
   - **底部實時遙測條**：在底部中間懸浮實時 Telemetry 數據，包含相對高度 (Alt)、垂直爬升率 (Climb Rate)、地速 (Ground Speed)、空速 (Airspeed) 及航 yaw 角。
3. **頂部連線中心與多角色支援 (Comm Connections Dashboard)**
   - 整合於頂部狀態列的 `Comm Links` 下拉選單中，完全隱藏轉接程式的 Websocket 細節。
   - 支援 **UDP / TCP / SERIAL** 三種協定：
     - **UDP**：支援 **Server** 角色（綁定並接聽飛控的遙測推播）或 **Client** 角色（向指定遠端 IP 進行主動發送）。
     - **TCP**：支援 **Client** 角色（主動連接飛控 TCP 服務端，如 SITL 5760）或 **Server** 角色（在本地開埠接聽飛控 TCP 客戶端連接）。
     - **Serial**：指定連接串口裝置路徑及鮑率。
4. **無人機動態標記與動態隨行資訊框 (Dynamic Follow Popup)**
   - 無人機標記圖標隨 `heading` 數據進行實時轉向角度渲染。
   - **隨行資訊框**：點擊無人機圖示後，展開懸浮小資訊框，即時顯示無人機 ID、Lat/Lon、Heading、Alt。當飛機在 20Hz 電腦控制下飛行移動時，小資訊框會**自動並平滑地隨行移動**，絕無任何畫面抖動。
   - **快捷置中與跟隨**：地圖左側備有 `🔒 Auto-Center` / `🔓 Manual Pan` 切換按鈕與 `🎯 Center Active` 按鈕。手動拖曳地圖會自動解開置中跟隨鎖；點擊 auto-center 則能重鎖並將無人機維持在地圖正中間。
5. **PWA 100% 離線啟動與地圖快取**
   - 實作 Service Worker 快取，即使在完全斷網環境下也能順利啟動 HGCS，並支援 Leaflet OpenStreetMap 地圖切片 (Map Tiles) 本地離線快取，確保戶外飛測不中斷。

---

## 📂 目錄結構 (Directory Structure)

* `gateway/`
  * [gateway.py](file:///home/kenny/Git_KennySpace/HGCS/gateway/gateway.py)：地端代理層主程式。包含 MAVLink 解碼器、支援 TCP/UDP 各角色與 Serial 連接建立、航點協議狀態機與 WebSocket 伺服器。
* `web-ui/`
  * [src/App.tsx](file:///home/kenny/Git_KennySpace/HGCS/web-ui/src/App.tsx)：控制台主頁面。管理連線配置、懸浮 HUD 與左側工具列、控制命令發送、航點編輯。
  * [src/components/PFD.tsx](file:///home/kenny/Git_KennySpace/HGCS/web-ui/src/components/PFD.tsx)：利用 Canvas 渲染的 Primary Flight Display 姿態儀。
  * [src/components/Map.tsx](file:///home/kenny/Git_KennySpace/HGCS/web-ui/src/components/Map.tsx)：懸浮式 Leaflet 互動地圖。支援自適應視窗縮放 (invalidatesSize)、動態隨行 popup、置中鎖定跟隨。
  * [src/index.css](file:///home/kenny/Git_KennySpace/HGCS/web-ui/src/index.css)：Vanilla CSS 設計系統，提供精美暗黑科技風格 UI、PFD HUD、底部遙測條與佈局工具。

---

## 🛠️ 環境配置與依賴安裝 (Setup & Prerequisites)

系統需安裝 **Node.js (>= 20)** 與 **Python (>= 3.10)**。

### 1. 前端網頁層
進入網頁目錄並安裝依賴：
```bash
cd web-ui
npm install
```

### 2. 地端代理層
地端代理層需要 `websockets` (用於前端通訊) 和 `pymavlink` (用於飛控通訊)：
```bash
# 安裝地端依賴 (若環境已安裝可跳過)
pip3 install websockets pymavlink pyserial
```

---

## 🚀 啟動與使用說明 (Usage Guide)

### 💡 快速體驗方式（不需要任何實體飛控/硬體）
1. 在第一個終端機啟動 Web UI：
   ```bash
   cd web-ui
   npm run dev
   ```
2. 開啟瀏覽器進入 `http://localhost:5173`。
3. 點擊右上角 **Comm Links**，在下拉卡片中點擊 **Launch Local Sim**。
4. 網頁會自動切換至 **Fly** 視圖，地圖將平滑移至預設無人機位置（選中綠色 Glow 框）。
5. 點擊左側工具列的 **Plan**，右側會滑出任務編輯面板：
   - 點擊 "Sample Mission" 快速載入預設航點，或在地圖上**雙擊滑鼠**自行新增航點、拖拽紫點修改高度。
   - 點擊 **Upload to Drone #1** 將任務載入模擬器。
6. 切換回左側工具列 **Fly**：
   - 點擊 **Arm** 解鎖馬達。
   - 底部滑動條向右滑動確認解鎖。
   - 點擊 **Takeoff** 起飛，並向右滑動確認。
   - 起飛後即可看到無人機在 PFD 姿態儀、地圖與底部實時遙測條上順暢移動！
   - 點擊無人機 Marker，會彈出隨行小框框即時顯示飛機高度、偏航角與經緯度，並跟隨飛機一同移動。
   - 手動拖動地圖可解開視角跟隨鎖，點擊地圖左側的 **🔒 Auto-Center** 或 **🎯 Center Active** 可重新將地圖視角移回飛機中心。

---

### 🔌 連接真實載具 / PX4 SIH 模擬器
1. **連接硬體**：將飛控透過 USB 連接至電腦，或在背景執行 PX4 SITL 模擬器（預設會開放在 UDP `127.0.0.1:14540` 上進行 MAVLink 通訊）。
2. **啟動 Gateway 代理**：
   ```bash
   python3 gateway/gateway.py
   ```
   *(註：Gateway 預設會在本機 `127.0.0.1:8080` 開放 WebSocket Server 連接)*
3. **網頁連線與控制**：
   - 打開網頁 `http://localhost:5173`，點擊右上角 **Comm Links**。
   - 第一欄 **PROXY WEBSOCKET** 點擊 **Connect** 連線地端代理（成功時狀態列會轉為綠色 `GATEWAY LINK`）。
   - 在第三欄 **SPAWN MAVLINK BRIDGE** 中設定如何接到您的飛機：
     - **UDP Server**：IP 填 `0.0.0.0`，Port 填 `14540`（用於監聽 PX4 SITL / SIH 連接），點擊 **Add Bridge Connection**。
     - **TCP Client**：IP 填 `127.0.0.1`，Port 填 `5760`（連接 TCP 控制端），點擊 **Add Bridge Connection**。
     - 成功建立連接後，上方狀態 badges（Mode、Motor、GPS、Battery）隨即啟動，並且 PFD 姿態儀會開始流暢反應飛機真實數據。
   - **任務與飛行**：上傳好航點任務後，使用左側 Fly 工具列的 Arm 與 Takeoff 按鈕進行解鎖飛行即可。

---

## 📈 PX4 SIH 閉環驗證流程 (Verification Process)

1. 將 SYS_HITL 參數配置為 SIH 模式（Simulation-In-Hardware），重啟飛控。
2. 啟動 Gateway 連接實體飛控埠。
3. 前端網頁點擊 Connect 成功後，手動搖晃飛控，確認 PFD 姿態儀能極速流暢反應 Roll/Pitch 變化（確認 60fps 刷新）。
4. 上傳任務，確認 Web UI 收到 `SUCCESS` 回報，且沒有任何卡頓。
5. 解鎖並切換至 Mission 模式，觀察飛機軌跡是否在 Map 上流暢同步移動，完成閉環驗證。
