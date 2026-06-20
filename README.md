# HGCS (HTML Ground Control Station) 🚀

HGCS (HTML-based Ground Control Station) 是一個基於 Web 技術打造的輕量化地面控制系統，旨在全面平替 QGroundControl (QGC) 的核心狀態監控與任務編排功能。

本專案採用**雙層解耦架構**：將物理通訊、協議解析、航點上傳狀態機完全隔離於地端代理層（Gateway），而前端網頁層（Web UI）則專注於高性能、無狀態的姿態渲染與地圖任務規劃。

---

## 🌟 核心特色 (Core Features)

1. **雙層解耦架構 (Decoupled Architecture)**
   - **HGCS Gateway**：採用 Python 異步/執行緒架構，流式解析 MAVLink 封包並轉譯為標準 JSON Telemetry 模型；背景執行 MAVLink Mission Protocol（Count -> Request -> Write -> ACK）狀態機，包含超時重傳與校驗機制。
   - **HGCS Web UI**：基於 React + TypeScript + Vite，配合 HTML5 Canvas 實現高達 60fps 的 PFD 姿態儀，以及極其流暢的 Leaflet 互動地圖。
2. **PWA 100% 離線啟動與地圖快取**
   - 實作 Service Worker 快取，即使在完全斷網環境下也能順利啟動 HGCS，並支援 Leaflet OpenStreetMap 地圖切片 (Map Tiles) 本地離線快取，確保戶外飛測不中斷。
3. **內建雙端 Mock 模擬器 (Dual Mock Simulators)**
   - **網頁端單機模擬**：在未啟動地端代理的狀況下，可一鍵點擊 "Start Sim" 啟動純網頁端模擬器。模擬器內建簡易飛控動力學模型，支援解鎖、切換模式、規劃航點與自動飛行演示。
   - **地端 Mock 模式**：啟動 Gateway 時加上 `--mock` 參數，即可在無實體飛控的狀態下向網頁端發送 20Hz 標準 JSON 訊號並模擬異步航點上傳。

---

## 📂 目錄結構 (Directory Structure)

* `gateway/`
  * [gateway.py](file:///home/kenny/Git_KennySpace/HGCS/gateway/gateway.py)：地端代理層主程式。包含 MAVLink 解碼器、航點協議狀態機與 WebSocket 伺服器。
* `web-ui/`
  * [src/App.tsx](file:///home/kenny/Git_KennySpace/HGCS/web-ui/src/App.tsx)：控制台主頁面。管理連線、控制命令發送、航點編輯。
  * [src/components/PFD.tsx](file:///home/kenny/Git_KennySpace/HGCS/web-ui/src/components/PFD.tsx)：利用 Canvas 渲染的 Primary Flight Display 姿態儀。
  * [src/components/Map.tsx](file:///home/kenny/Git_KennySpace/HGCS/web-ui/src/components/Map.tsx)：基於 Leaflet 的互動式地圖，支援新增、編輯、拖拽航點。
  * [src/index.css](file:///home/kenny/Git_KennySpace/HGCS/web-ui/src/index.css)：Vanilla CSS 設計系統，提供精美暗黑科技風格 UI 與佈局工具。
  * [public/sw.js](file:///home/kenny/Git_KennySpace/HGCS/web-ui/public/sw.js)：PWA 靜態資源與離線地圖切片快取 Service Worker。

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
3. **一鍵點擊 "Start Sim"**：UI 會立即切換至本機模擬器。您可以：
   - 點擊 "Load Demo" 在新竹科学园区上方生成預設航點（Takeoff -> 3個航點 -> RTL）。
   - 在地圖上**雙擊滑鼠**新增航點，或**拖曳紫點**修改位置。
   - 點擊 "Arm Motors" 解鎖馬達。
   - 點擊 "Upload Mission" 將任務載入模擬器。
   - 點擊 "Mission Auto" 即可看到無人機圖標開始自動循跡起飛與繞行！

---

### 🔌 連接真實載具 / PX4 SIH 模擬器
若要進行端到端閉環飛測，請依以下步驟操作：

1. **連接硬體**：將刷有 PX4 (並配置為 SIH 模式) 的飛控透過 USB 連接至電腦，或者在背景執行 PX4 SITL 模擬器（預設會開放在 UDP `127.0.0.1:14540` 上進行 MAVLink 通訊）。
2. **啟動 Gateway**：
   - **透過 UDP 連接 PX4 模擬器 (預設)**：
     ```bash
     python3 gateway/gateway.py --conn udp:127.0.0.1:14540
     ```
   - **透過 Serial 連接實體數傳電台 / 飛控 (例如波特率 57600)**：
     ```bash
     python3 gateway/gateway.py --conn /dev/ttyUSB0:57600
     ```
   - **啟動地端 Mock 模式（模擬地端數據）**：
     ```bash
     python3 gateway/gateway.py --mock
     ```
   *(註：Gateway 預設會在 `127.0.0.1:8080` 開放 WebSocket Server)*

3. **網頁連線與控制**：
   - 打開網頁 `http://localhost:5173`，確認上方連線網址為 `ws://127.0.0.1:8080`。
   - 點擊 **"Connect"**，狀態列將立刻轉為綠色，姿態儀（PFD）也會開始以 20Hz 顯示飛機真實姿態。
   - **航點編排**：在地圖編輯器中新增/調整航點後，點擊 **"Upload Mission"**，此時 Gateway 的任務狀態機（Mission Worker）將會在背景與飛控握手，網頁端能即時看到上傳進度條與對應日誌。
   - **執行飛行**：完成上傳後，點擊 **"Arm Motors"** 解鎖馬達，並切換至 **"Mission Auto"** 模式，無人機便會起飛並開始執行任務！

---

## 📈 PX4 SIH 閉環驗證流程 (Verification Process)

1. 將 SYS_HITL 參數配置為 SIH 模式（Simulation-In-Hardware），重啟飛控。
2. 啟動 Gateway 連接實體飛控埠。
3. 前端網頁點擊 Connect 成功後，手動搖晃飛控，確認 PFD 姿態儀能極速流暢反應 Roll/Pitch 變化（確認 60fps 刷新）。
4. 上傳任務，確認 Web UI 收到 `SUCCESS` 回報，且沒有任何卡頓。
5. 解鎖並切換至 Mission 模式，觀察飛機軌跡是否在 Map 上流暢同步移動，完成閉環驗證。
