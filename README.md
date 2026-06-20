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
     - **TCP**：支援 **Client** 角色（主動連接飛控 TCP 服務端，如 SITL 5760） or **Server** 角色（在本地開埠接聽飛控 TCP 客戶端連接）。
     - **Serial**：指定連接串口裝置路徑及鮑率。
4. **無人機動態標記與動態隨行資訊框 (Dynamic Follow Popup)**
   - 無人機標記圖標隨 `heading` 數據進行實時轉向角度渲染。
   - **隨行資訊框**：點擊無人機圖示後，展開懸浮小資訊框，即時顯示無人機 ID、Lat/Lon、Heading、Alt。當飛機在 20Hz 電腦控制下飛行移動時，小資訊框會**自動並平滑地隨行移動**，絕無任何畫面抖動。
   - **快捷置中與跟隨**：地圖左側備有 `🔒 Auto-Center` / `🔓 Manual Pan` 切換按鈕與 `🎯 Center Active` 按鈕。手動拖曳地圖會自動解開置中跟隨鎖；點擊 auto-center 則能重鎖並將無人機維持在地圖正中間。
5. **單一入口極簡啟動與自動生命週期 (Single Entry & Auto-Shutdown)**
   - **內建網頁伺服器**：Python Gateway 內建靜態檔案伺服器，自動裝載前端編譯後的 `web-ui/dist/` 資料夾，無需依賴外部 Web Server。
   - **自動喚起瀏覽器**：執行 Gateway 會自動啟動預設瀏覽器開啟網頁 UI。
   - **自動連線與適應**：前端進入網頁後會自動與後端連線，且會自適應解析當前網址來連接 WebSocket，無需人為設定 IP。
   - **無連線自動關閉**：當關閉所有瀏覽器網頁後，Gateway 監測到 5 秒內無任何 Web 連線即會自動結束運行，徹底關閉後端進程。
6. **PWA 100% 離線啟動與地圖快取**
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

本系統支援**單一入口極簡啟動**。在生產環境下，您無需手動開啟多個伺服器，只需執行 Python 腳本即可一次開啟所有服務。

### 💡 快速模擬體驗（不需要任何實體飛控/硬體）
如果您想體驗模擬的多機任務飛行：
1. 啟動並預載模擬無人機：
   ```bash
   python3 gateway/gateway.py --mock
   ```
2. 系統會**自動開啟瀏覽器**導向網頁介面 `http://127.0.0.1:8082`。
3. 進入後，前端已**自動與地端代理完成連線**，畫面將自動切換至 **Fly** 視圖，並載入兩架處於暫停懸停狀態的模擬無人機（點擊即可在 Esri 世界衛星地圖上切換選取）。
4. **編輯並上傳任務**：
   - 點擊左側工具列的 **Plan**，右側會滑出任務編輯面板。
   - 點擊 "Sample Mission" 快速載入預設航點，或在地圖上**雙擊滑鼠**自行新增航點，並能拖拽控制點修改高度。
   - 點擊 **Upload to Drone #1** 將任務載入模擬器。
5. **起飛與飛行控制**：
   - 切換回左側工具列的 **Fly** 視圖。
   - 點擊 **Arm** 並滑動確認解鎖。
   - 點擊 **Takeoff** 並滑動確認起飛。無人機將開始平滑飛行。
   - 點擊無人機 Marker 會彈出即時隨行資訊框，並穩定跟隨無人機移動而不抖動。
   - 手動拖動地圖可解開視角鎖；點擊地圖左側的 **🔒 Auto-Center** 或 **🎯 Center Active** 可重新將地圖視角對齊飛機中心。
6. **關閉與退出**：
   - 體驗完畢後，直接**關閉瀏覽器分頁**。過 5 秒後，背景的 Python 服務檢測到無活躍連線便會**自動終止退出**，無需手動於終端機按下 Ctrl+C。

---

### 🔌 連接真實載具 / PX4 SITL 模擬器
1. **硬體/模擬器準備**：將真實飛控（如 Pixhawk）透過 USB 連接至電腦，或者於背景啟動 PX4 SITL 模擬器（預設會使用 UDP `14540`）。
2. **啟動 Gateway**：
   ```bash
   python3 gateway/gateway.py
   ```
   *(預設將會開埠 WebSocket 8080 及 Web UI 服務 8082，並啟動瀏覽器)*
3. **網頁連線與配置**：
   - 瀏覽器打開後已自動連上本機代理（頂部狀態列會轉為綠色 `GATEWAY LINK`）。
   - 點擊右上角 **Comm Links** 開啟設定面板。
   - 在 **SPAWN MAVLINK BRIDGE** 卡片中設定如何接到您的飛機：
     - **UDP Server** (QGC 預設)：Port 填 `14540`（用於 PX4 SITL 連接），點擊 **Add Bridge Connection**。
     - **TCP Client**：IP 填 `127.0.0.1`，Port 填 `5760`，點擊 **Add Bridge Connection**。
   - 建立連線後，無人機資訊將自動載入地圖，且 PFD 姿態儀會以 60fps 同步反應即時姿態與遙測數據。

---

### ⚙️ 進階命令列參數說明 (CLI Options)
如果需要自訂啟動行為，可在執行 `gateway.py` 時傳入以下參數：
- `--no-serve`：不要啟動靜態網頁伺服器（僅執行 WebSocket 代理，供本機開發配合 `npm run dev` 使用）。
- `--serve-port <PORT>`：自訂靜態網頁服務 Port（預設為 `8082`）。
- `--serve-dir <PATH>`：自訂靜態網頁資源的路徑（預設會自動定位至 `../web-ui/dist`）。
- `--no-open`：啟動服務後不要自動開啟瀏覽器。
- `--no-shutdown`：關閉網頁分頁後，不要自動結束 Python 後端服務。
- `--shutdown-timeout <SECONDS>`：自訂斷線後自動結束的緩衝秒數（預設為 `5.0` 秒，以容忍網頁重新整理）。
- `--port <PORT>`：自訂 WebSocket 服務的 Port（預設為 `8080`）。
- `--host <IP>`：自訂 WebSocket 服務的主機監聽地址（預設為 `127.0.0.1`）。

---

## 📈 PX4 SIH 閉環驗證流程 (Verification Process)

1. 將 SYS_HITL 參數配置為 SIH 模式（Simulation-In-Hardware），重啟飛控。
2. 啟動 Gateway 連接實體飛控埠。
3. 前端網頁點擊 Connect 成功後，手動搖晃飛控，確認 PFD 姿態儀能極速流暢反應 Roll/Pitch 變化（確認 60fps 刷新）。
4. 上傳任務，確認 Web UI 收到 `SUCCESS` 回報，且沒有任何卡頓。
5. 解鎖並切換至 Mission 模式，觀察飛機軌跡是否在 Map 上流暢同步移動，完成閉環驗證。
