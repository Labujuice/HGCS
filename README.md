# HGCS (HTML Ground Control Station) 🚀

[繁體中文](./README.md) | [English](./README.md)

HGCS (HTML-based Ground Control Station) 是一個基於 Web 技術打造的輕量化地面控制系統，旨在平替 QGroundControl (QGC) 的核心狀態監控與任務編排功能。本專案採用**雙層解耦架構**：將物理通訊、協議解析、航點上傳狀態機完全隔離於後端代理層（Gateway），而前端網頁層（Web UI）則專注於姿態渲染與地圖任務規劃。

HGCS (HTML-based Ground Control Station) is a lightweight ground control system built on Web technologies, designed to replace the core status monitoring and mission planning capabilities of QGroundControl (QGC). This project utilizes a **decoupled architecture**: physically isolating communications, protocol parsing, and mission uploading state machines in the backend proxy (Gateway), while the frontend web application (Web UI) focuses on attitude rendering and map-based mission planning.

---

## 🌟 核心特色 (Core Features)

### 1. 雙層解耦架構 (Decoupled Architecture)
* **HGCS Gateway (後端代理)**:
  * **中**: 採用 Python 執行緒架構，流式解析 MAVLink 封包並轉譯為標準 JSON Telemetry 模型；背景執行 MAVLink Mission Protocol（Count -> Request -> Write -> ACK）狀態機，包含超時重傳與校驗機制。
  * **EN**: Built on a multi-threaded Python engine. It streams and decodes MAVLink packets into standardized JSON telemetry and runs the MAVLink Mission Protocol state machine in the background with timeout and retry mechanisms.
* **HGCS Web UI (前端網頁)**:
  * **中**: 基於 React + TypeScript + Vite，配合 HTML5 Canvas 實現高達 60fps 的 PFD 姿態儀，以及極其流暢的 Leaflet 互動地圖。
  * **EN**: Developed using React, TypeScript, and Vite. Features a 60fps Primary Flight Display (PFD) rendered via HTML5 Canvas and a smooth Leaflet-based interactive map.

### 2. QGC 沉浸式滿版排版 (QGC Fullscreen Layout)
* **中**:
  * 地圖作為 100% 全螢幕背景，所有控制板面皆為懸浮設計。
  * 左側懸浮工具列整合一鍵起飛 (Takeoff)、降落 (Land)、返航 (RTL)、暫停懸停 (Pause) 等操作。
  * 右側 Plan 面板可進行航點編輯、高度與停滯時間參數調整，並上傳/同步任務。
* **EN**:
  * The map serves as a 100% fullscreen background, with all panels hovering dynamically over it.
  * The left overlay toolbar integrates single-click commands for Takeoff, Land, RTL, and Pause.
  * The right Plan panel handles waypoint editing, altitude/hold-time adjustments, and uploading missions.

### 3. 多角色連線中心 (Comm Connections Dashboard)
* **中**: 支援 **UDP / TCP / SERIAL** 三種協定，可自由配置 Server/Client 角色連線至 PX4 SITL 模擬器或實體硬體。
* **EN**: Supports **UDP / TCP / SERIAL** protocols, allowing flexible configuration of Server/Client roles to connect to PX4 SITL simulators or real vehicle hardware.

### 4. 動態隨行資訊框與視角置中 (Dynamic Follow Popup & Auto-Center)
* **中**: 點擊無人機 Marker 會展示懸浮資訊框，在飛行移動中會平滑跟隨。提供自動置中與手動解鎖機制，操作流暢不抖動。
* **EN**: Clicking a drone icon displays a popup info box that smoothly follows the vehicle in real-time. Features an auto-center lock and manual pan override.

### 5. 離線 PWA 與地圖快取 (PWA & Offline Map Caching)
* **中**: 實作 Service Worker 快取，在完全斷網環境下也能順利啟動 HGCS，並支援 Leaflet OSM 本地離線快取，確保戶外飛測不中斷。
* **EN**: Integrates Service Worker caching, enabling HGCS to load in offline environments, and supports Leaflet map tile caching for remote field operations.

---

## 🤖 AI 驅動開發宣言 (AI-Driven Development Initiative)

> [!IMPORTANT]
> **本專案的核心開發原則為：極力推廣使用 LLM Agent 進行開發，避免使用人力編碼。**
> 
> **Core Principle: We strongly advocate for codebases developed entirely by LLM Agents (e.g., Google Antigravity / Gemini) to minimize manual human coding.**

### 中文說明：
本專案為 **AI-Native** 開發的範例。我們相信隨著大語言模型代理（LLM Agents）的成熟，軟體開發的範式正在發生根本性的轉變。本專案絕大部分的核心邏輯、修復、優化和文件，均由 AI Agent 自動掃描專案現況、自主推理並直接寫入，人工僅扮演方向指引與最終驗證的角色。我們歡迎所有開源貢獻者使用 AI Agent 來共同協同開發本專案。

### English Description:
This project is an **AI-Native** development demonstration. We believe that with the maturity of Large Language Model Agents, the paradigm of software development is undergoing a fundamental shift. The vast majority of the core logic, bug fixes, performance optimizations, and documentation in this repository have been autonomously reasoned and implemented by AI Agents. Humans only provide direction and validation. We welcome all open-source contributors to collaborate using AI Agents.

---

## 📜 開源授權 (License)

本專案採用 **[GPLv3 (GNU General Public License v3)](LICENSE)** 許可證。任何基於此專案的修改與衍生產品都必須保持開源並釋出原始碼，以維護開源社群的共享精神與開放性。詳情請參閱專案根目錄下的 [LICENSE](LICENSE) 檔案。

This project is licensed under the **[GPLv3 (GNU General Public License v3)](LICENSE)**. Any modifications or derivative works of this project must remain open-source and make their source code available under the same terms to protect the collaborative spirit of the open-source community. For details, please refer to the [LICENSE](LICENSE) file in the root directory.

---

## 📂 目錄結構 (Directory Structure)

* `gateway/`
  * [gateway.py](gateway/gateway.py): 后端代理層主程序。包含 MAVLink 解碼、UDP/TCP/Serial 連接管理器、高精度 `COMMAND_INT` 指引控制、任務上傳狀態機與 WebSocket 伺服器。
  * [gateway.py](gateway/gateway.py): Backend proxy main script. Features MAVLink decoding, connection managers, high-precision `COMMAND_INT` guided commands, mission upload state machine, and WebSocket server.
* `web-ui/`
  * [src/App.tsx](web-ui/src/App.tsx): 前端控制台主頁面。管理連線配置、懸浮 HUD 與左側工具列、控制命令發送、航點編輯。
  * [src/App.tsx](web-ui/src/App.tsx): Frontend dashboard main controller. Manages links, PFD HUD overlays, left fly tool actions, command uploads, and waypoint parameters.
  * [src/components/PFD.tsx](web-ui/src/components/PFD.tsx): Canvas 姿態儀。
  * [src/components/Map.tsx](web-ui/src/components/Map.tsx): 懸浮式 Leaflet 互動地圖。
  * [src/index.css](web-ui/src/index.css): Vanilla CSS 設計系統，提供精美暗黑科技風格 UI。

---

## 🛠️ 環境配置與依賴安裝 (Setup & Prerequisites)

系統需安裝 **Node.js (>= 20)** 與 **Python (>= 3.10)**。
Requires **Node.js (>= 20)** and **Python (>= 3.10)**.

### 1. 前端網頁層 (Frontend Web UI)
```bash
cd web-ui
npm install
```

### 2. 後端代理層 (Backend Gateway)
```bash
pip3 install websockets pymavlink pyserial
```

---

## 🚀 啟動與使用說明 (Usage Guide)

### 💡 快速模擬體驗（不需要任何實體飛控/硬體）
### 💡 Quick Mock Experience (No hardware needed)

1. **啟動模擬服務 / Start Mock Service**:
   ```bash
   python3 gateway/gateway.py --mock
   ```
2. **自動載入 / Auto Loading**:
   系統會**自動開啟瀏覽器**導向網頁介面 `http://127.0.0.1:8082`。網頁會自動與後端連線。
   The system will **automatically open your browser** to `http://127.0.0.1:8082`, which will auto-connect to the gateway.
3. **規劃與起飛 / Mission Planning & Takeoff**:
   - 進入 **Plan** 視圖，在衛星地圖上**雙擊滑鼠**自行新增航點，或點擊 "Sample Mission"。
   - 點擊 **Upload to Drone** 上傳任務。
   - 回到 **Fly** 視圖，點擊 **Arm** 並滑動解鎖，再點擊 **Takeoff** 滑動起飛，無人機將開始平滑飛行。
   - 體驗完畢後直接**關閉瀏覽器分頁**，過 5 秒後後端服務偵測到無連線即會**自動結束退出**。
   - Switch to **Plan** view, **double-click** the map to add waypoints, or select "Sample Mission".
   - Click **Upload to Drone** to transfer.
   - Switch to **Fly** view, click **Arm** and slide to unlock, then click **Takeoff** and slide to launch.
   - When finished, **close the browser tab**. The gateway will automatically shut down after 5 seconds of inactivity.

---

### 🔌 連接真實載具 / PX4 SITL 模擬器
### 🔌 Connecting to a Real Vehicle or PX4 SITL

1. 啟動 PX4 SITL 模擬器（預設使用 UDP `14540`）或連接 Pixhawk 硬體。
   Start PX4 SITL (defaults to UDP `14540`) or connect Pixhawk hardware.
2. 啟動 Gateway:
   ```bash
   python3 gateway/gateway.py
   ```
3. 在網頁右上角 **Comm Links** 面板中設定對接：
   - **UDP Server** (對於 SITL): Port 填 `14540`，點擊 **Add Bridge Connection**。
   - **TCP Client**: IP 填 `127.0.0.1`，Port 填 `5760`。
   - In the **Comm Links** overlay panel, configure:
     - **UDP Server** (for SITL): Port `14540`, click **Add Bridge Connection**.
     - **TCP Client**: Host `127.0.0.1`, Port `5760`.

---

## 📈 PX4 SIH / SITL 驗證流程 (Verification Process)

1. 將 SYS_HITL 參數配置為 SIH 模式（Simulation-In-Hardware），重載飛控。
   Set SYS_HITL parameter to SIH mode and reboot the autopilot.
2. 啟動 Gateway 連接實體飛控埠。
   Start the gateway pointing to the autopilot link.
3. 前端網頁點擊 Connect 成功後，手動搖晃飛控，確認 PFD 姿態儀能流暢反應 Roll/Pitch 變化（確認 60fps 刷新）。
   Check that the PFD attitude gauge responds to hardware movement smoothly at 60fps.
4. 上傳任務，解鎖並切換至 Mission 模式，觀察飛機軌跡是否在 Map 上流暢同步移動，完成閉環驗證。
   Upload the mission, arm and change mode to Mission, and observe the drone trajectory on the map.
