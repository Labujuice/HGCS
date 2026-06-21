# HGCS Feature Roadmap & QGC Function Gap 🗺️

[繁體中文](./feature.md) | [English](./feature.md)

本文件詳盡列出了 HGCS (HTML Ground Control Station) 目前已實現的特色功能，並系統化盤點其與業界標準 **QGroundControl (QGC)** 之間的功能落差，作為未來 LLM Agent 進行自主開發與功能補強的藍圖指南。

This document details the currently implemented features of HGCS and systematically analyzes the functional gaps between HGCS and the industry-standard **QGroundControl (QGC)**, serving as a development roadmap for future LLM Agent iterations.

---

## 🚀 已實現特色功能 (Currently Implemented Features)

### 1. 系統架構與自動化 (Architecture & Automation)
* **雙層解耦架構 (Decoupled Architecture)**: Python 後端 Gateway 處理通訊與協定，React 前端專注姿態渲染與 UI。
* **單一入口與自動關閉 (Single Entry & Auto-Shutdown)**: 執行 Python 自動編譯裝載並啟動瀏覽器；所有網頁分頁關閉 5 秒後後端自動結束進程。
* **PWA 離線支援 (PWA Offline Capability)**: 支援無網環境下離線啟氣並具備地圖快取功能。

### 2. 遙測監控與姿態儀 (Telemetry & HUD)
* **60fps PFD 姿態儀**: 以 HTML5 Canvas 實時渲染高流暢度的 Primary Flight Display。
* **隨行資訊框 (Dynamic Follow Popup)**: 地圖上的無人機圖示點擊可展示平滑隨行資訊框，不抖動。
* **置中鎖定 (Auto-Center Lock)**: 支持手動解鎖拖曳與自動跟隨置中無人機。

### 3. 引導模式與任務編排 (Guided Mode & Planning)
* **高精度 Guided 操控**: 修正 `MAV_CMD_DO_REPOSITION` (Go To) 與 `MAV_CMD_DO_ORBIT` 精度，全面採用 `COMMAND_INT` 並支援基於 `Home MSL` 的絕對高度基準修正，解決起飛警報與飛控指令拒絕（`notify negative`）問題。
* **Lawnmower S型掃描測繪航線**: 獨立實作 boustrophedon 掃描線求交幾何演算法，支援線距、角度、高度與反向的實時預覽。
* **MAVLink 任務上傳自動防錯**: 
  * 自動相容 `MISSION_REQUEST` (MAVLink 1.0 浮點數座標) 與 `MISSION_REQUEST_INT` (MAVLink 2.0 整數座標)。
  * 強制在任務首點前置 `TAKEOFF` 指令以通過飛控 feasibility checker 可行性檢查。

---

## 🔍 與 QGroundControl 的功能落差 (Functional Gaps with QGC)

為了讓 HGCS 能夠平替 QGC 的核心功能，我們將未來待開發的功能與落差整理如下：

### 📈 1. 飛行控制與多機管理 (Control & Multi-Vehicle)
| 功能分類 (Category) | QGC 支援功能 (QGC Feature) | HGCS 當前狀況 (HGCS Status) | 補強建議 (Action Items for LLM Agent) |
| :--- | :--- | :--- | :--- |
| **群飛控制 (Swarm Control)** | 多機並列監控、群飛任務同步上傳、一鍵群飛解鎖/返航 | 目前僅支援單選無人機並分別發送指令 | 設計多機側邊欄列，支援「群組選擇」並將指令廣播至多個車輛 ID |
| **搖桿控制 (Joystick)** | 支援手把/搖桿經由 GCS 發送 `MANUAL_CONTROL` 遙控 | 無手把操控介面 | 實作 HTML5 Gamepad API，捕獲手把輸入並由 Gateway 封裝 `MANUAL_CONTROL` MAVLink 訊息發送 |
| **影片串流 (Video Stream)** | 支援 RTSP / WebRTC 視訊流解碼與畫中畫 (PIP) 疊加顯示 | 目前無影像傳輸 | 前端引入 WebRTC 或 H.264/H.265 解碼組件，地圖上預留畫中畫懸浮視窗 |

### 🗺️ 2. 航路任務編排 (Mission Planning)
| 功能分類 (Category) | QGC 支援功能 (QGC Feature) | HGCS 當前狀況 (HGCS Status) | 補強建議 (Action Items for LLM Agent) |
| :--- | :--- | :--- | :--- |
| **多元任務指令** | 支援 `LOITER_TIME`、`LOITER_TURNS`、`JUMP` (循環)、`VTOL_TAKEOFF`/`LAND` 等指令 | 目前僅支援 `WAYPOINT`、`TAKEOFF`、`LAND`、`RTL`、`LOITER` | 於右側 Plan 面板的 Command 下拉選單增加對應 MAVLink 指令，並在 Gateway 實作對應編譯 |
| **地形隨行 (Terrain Follow)** | 根據 3D 地形數據 (DEM) 自動調節航點高度，保持相對地面高度 | 高度全為相對於起飛點的相對高度固定值 | 前端串接網格地形服務（如 Mapbox Terrain 或全球免費 DEM 服務），實時計算地表高度並累加至航點 |
| **檔案匯入/匯出** | 支援匯入/匯出 `.plan` (QGC 格式)、`KML`、`GPX` 航線檔 | 目前僅支援 Sample Mission 與手動繪製 | 在 Plan 面板增加檔案上傳/下載按鈕，實作 JSON 與 XML 解析器以讀寫 `.plan` 及 KML/GPX |

### ⚙️ 3. 載具設定與校準 (Vehicle Setup & Calibration)
| 功能分類 (Category) | QGC 支援功能 (QGC Feature) | HGCS 當前狀況 (HGCS Status) | 補強建議 (Action Items for LLM Agent) |
| :--- | :--- | :--- | :--- |
| **參數編輯器 (Parameters)** | 讀取所有飛控內建參數 (約 1000+)，支援即時搜尋、修改與批次導入匯出 | 目前無參數管理面板 | 1. 實作 MAVLink Parameter Protocol 狀態機。 <br> 2. 前端開發參數管理網格，支援分類過濾與實時寫入 |
| **感測器校準 (Calibration)** | 羅盤旋轉 (Compass)、加速度計 (Accel) 六面置放校準介面 | 目前無校準介面 | 封裝 `MAV_CMD_PREFLIGHT_CALIBRATION` 命令，並以動畫與進度條指引使用者進行多面擺放校準 |
| **遙控器配置 (RC Setup)** | 遙控器通道映射、極限值校準與死區 (Deadband) 設定 | 目前無 RC 設定 | 繪製即時通道搖桿條（`RC_CHANNELS` 監聽），提供極限值校準按鈕與狀態回饋 |

### 🛡️ 4. 安全與地圖管理 (Safety & Maps)
| 功能分類 (Category) | QGC 支援功能 (QGC Feature) | HGCS 當前狀況 (HGCS Status) | 補強建議 (Action Items for LLM Agent) |
| :--- | :--- | :--- | :--- |
| **地理圍欄 (Geofence)** | 規劃多邊形/圓形禁航區，並上傳至飛控進行硬體圍欄保護 | 地圖上沒有圍欄編輯 | 實作 `FENCE_POLYGON` 圍欄編輯與協議上傳，並在地圖上以紅色半透明渲染 |
| **主動地圖下載** | 提供離線地圖管理器，供使用者框選大範圍並預下載地圖切片 | Service Worker 僅能被動快取已看過的地圖 | 前端開發「離線地圖下載面板」，允許選定範圍、縮放層級（Zoom Level）並批次抓取地圖切片存入 IndexedDB |

### 📊 5. 日誌與數據分析 (Log & Playback)
| 功能分類 (Category) | QGC 支援功能 (QGC Feature) | HGCS 當前狀況 (HGCS Status) | 補強建議 (Action Items for LLM Agent) |
| :--- | :--- | :--- | :--- |
| **數據繪圖 (Plotter)** | 實時將多路遙測數據（例如高度、電壓、震動度）繪製為折線圖進行診斷 | 僅有純文字數值顯示 | 引入 Chart.js 或 ECharts，提供自訂遙測欄位繪圖面板，便於飛行中診斷感測器趨勢 |
| **日誌回放 (Playback)** | 讀取飛行 ULog 或 TLog 數據，並在地圖/HUD 上以指定倍速進行 3D 軌跡回放 | 目前無回放功能 | 1. 後端實作 ULog/TLog 解析器。 <br> 2. 前端新增回放控制條（播放、暫停、倍速、拖曳進度）實時驅動虛擬遙測 |
