# Lab04 GPIO 遠端週邊控制

依提供的兩份相同 Lab4 PDF 第 11-14、19 頁實作。Node.js 伺服器接收瀏覽器操作，透過 `child_process.execFile()` 執行 C++ GPIO 程式。預設為模擬模式，可在 Mac / Ubuntu VM 執行；TX2 必須加上 `--hardware`。

## 先在 Mac / VM 操作

在 repository 根目錄的終端機切到 Lab04：

```bash
cd Lab04
node server.js
```

開啟 <http://localhost:8080>，右上角應顯示 `SIMULATION`。也可用 `npm start`；執行程式只用 Node.js 內建模組，沒有額外 npm 套件，不需要先下載依賴。程式採用 Node.js 12 起提供的 API；目前只在本機 Node 26 驗證，TX2 的版本仍需確認。

1. 用四張 LED 卡片的滑動開關設定 ON / OFF，燈色會立即預覽：ON 為紅色、OFF 為灰色；角落紅點代表尚未送出。按下方 **Submit** 卡片一次套用四顆燈，成功後紅點消失。即使只改一顆燈，Submit 仍會提交畫面上四顆燈的整組設定。
2. 用平滑拉桿或數字欄設定 **1–100** 次，按 **Mode_Shine**：LED1／3 與 LED2／4 各亮一次算一輪，結束後全部熄滅。
3. 開啟流水燈卡片的滑動開關，立即從 LED1 開始向 LED4 循環，不需再按 Submit。只有流水燈運行時才能按 **Change Direction**；反轉會保留當前燈號，下一步反方向。
4. 關閉流水燈開關，取消流水動畫並熄滅四顆 LED。

Submit、啟動交替閃爍、啟動或停止流水燈會取消舊動畫；Change Direction 則延續目前流水燈並改變方向。LED 開關在 Submit 前只改本頁預覽，不寫入 GPIO。未修改的開關與燈色會同步伺服器狀態，未送出的選擇不會被背景更新蓋掉；但成功執行其他模式指令（含反轉）時，會清除本頁未送出預覽並顯示伺服器狀態。

送出失敗時保留預覽供重試，並在卡片下方顯示錯誤。網路中斷時，右上角顯示 `連線中斷 · 重試中`，停用控制並淡化燈號；無法確認 GPIO 輸出時顯示 `輸出狀態未知`。畫面預覽與送出成功都不能代替實體 LED 的電氣驗證。

動畫由伺服器計時，重新整理或多個瀏覽器會取得同一份已套用狀態；重新整理會清除本頁未送出預覽。關閉網頁不會停止伺服器動畫；交替閃爍會在指定輪數後停止，流水燈則需重新開啟網頁關閉開關，或在終端機 Ctrl+C 結束伺服器。

## 在 TX2 控制實體 LED

將**整個 Lab04 資料夾**複製到 TX2，例如家目錄 `~/Lab04`。Mac 編譯出的 `C++/gpio` 不能在 TX2 執行，所以必須在 TX2 重編。

以下腳位來自目前 Lab03 專案的既有接線配置，並非 Lab4 PDF 指定；本次沒有實機確認。請依實際接線核對 Linux GPIO 與實體 pin，LED 假設為寫入 1 亮、0 滅。

| LED | Linux GPIO | 實體 pin | GND pin |
| --- | --- | --- | --- |
| LED1 | 255 | 15 | 14 |
| LED2 | 428 | 21 | 20 |
| LED3 | 427 | 23 | 25 |
| LED4 | 398 | 29 | 30 |

先停止 Lab2 / Lab03 等其他 GPIO 控制程式。在 TX2 終端機依序執行：

```bash
cd ~/Lab04
node --version
g++ --version
make -C C++ clean
make -C C++
node server.js --hardware
```

如 `node` 或 `g++` 未安裝，使用課程環境的套件管理方式安裝 `nodejs npm g++ make`；不要為此更新 TX2 的作業系統或 Kernel。Node 版本低於 12 時，先確認可與該 TX2 系統搭配的 Node 執行環境。

若初始化顯示 `Permission denied`，可在課堂 TX2 的終端機使用：

```bash
sudo env GPIO_PINS=255,428,427,398 node server.js --hardware
```

密碼只在 TX2 終端機輸入。若 sudo 找不到 node，請以 `command -v node` 查出並改用完整 Node 路徑。若使用者已有 sysfs 寫入權限，直接使用一般使用者啟動即可。

腳位不同時，用實際的四個 **Linux GPIO 數字**取代環境變數，順序為 LED1-4；不要填實體 pin 編號。初始化失敗會退出，硬體模式不會自動改成模擬模式。

另開 TX2 終端機執行：

```bash
hostname -I
```

電腦與 TX2 需位於可互通的網路；在電腦瀏覽器開 `http://TX2的實際IP:8080`。確認右上角標籤是 `TX2 · GPIO`，再逐顆設定開關並按 Submit，接著驗收交替閃爍與流水燈。電腦端的 `localhost` 指向電腦本身。伺服器預設監聽 `0.0.0.0:8080`，供課堂區域網路使用，未提供帳號登入，請勿將此埠轉發到公共網路。

## 前端視覺與操作

依確認的 Figma 三卡片設計實作，以 **1980 × 1440** 為桌面設計基準：霧白背景、上方四張 LED 卡片，下方由左至右為 Submit／交替閃爍／流水燈。同一排功能卡片等高、上下邊緣對齊；Submit 較窄，接近正方形，但不鎖定長寬比，以免不同視窗寬度下無法對齊。色票集中於 `public/style.css` 的 CSS 變數；Submit 圖示以原創箭頭進入端點表示送出。

字體透過 Google Fonts 載入 Noto Sans TC（300 / 400 / 500 / 700），無網路時使用 sans-serif。前端無額外套件，不固定鎖住瀏覽器視窗尺寸。視窗寬度不超過 900px 時，流水燈卡片移到下一排；不超過 560px 時，LED 卡片改成兩欄、下方三張功能卡片改為單欄，Submit 以橫向卡片呈現。

- LED 與流水燈使用相同的滑動開關，ON 為紅色、OFF 為黑色；燈號與流水順序同步動畫。
- 拉桿與數字欄雙向同步，支援鍵盤方向鍵及 Home / End，範圍 1–100。
- 「完成」與進度條顯示伺服器最近一次交替閃爍的完成輪數／要求輪數；改動次數欄不會重啟動畫，需按 Mode_Shine 才套用新輪數。
- Submit 一次提交四顆燈的設定；請求期間停用控制，避免重複送出。
- 保留清楚的鍵盤焦點、開關狀態、減少動態效果偏好、連線與輸出錯誤提示。
- 畫面以燈色、開關、進度與右上角模式標籤呈現狀態，不另外列出 LED1 ON／LED2 OFF 等重複文字；操作錯誤才顯示可見提示。

## 結構與設定

```text
Lab04/
├── server.js             HTTP、輸入驗證、靜態檔案、關閉處理
├── lib/controller.js     LED 狀態、操作序列、非阻塞動畫
├── lib/output.js         模擬輸出 / execFile GPIO 介面
├── public/               HTML、CSS、JavaScript
├── C++/gpio.cpp          TX2 sysfs 初始化、四燈輸出、釋放
├── C++/Makefile
└── test/run.js            控制邏輯、HTTP、C++ 檔案介面測試
```

| 設定 | 預設 | 用途 |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | 監聽網路介面，僅本機可設 `127.0.0.1` |
| `PORT` | `8080` | HTTP 埠 |
| `GPIO_PINS` | `255,428,427,398` | 硬體模式 LED1-4 的 Linux GPIO |
| `INTERVAL_MS` | `500` | 每個動畫步驟的間隔，50-10000 ms |

例如 `INTERVAL_MS=250 PORT=8081 node server.js`。每個 GPIO 子程序完成後才排下一步，實際切換間隔含子程序執行時間。

`GET /api/state` 取得即時狀態。`POST /api/command` 使用 `Content-Type: application/json`。目前網頁的 Submit 依 LED1–4 順序提交四個布林值，例如 LED1、LED3 亮，其餘滅：

```json
{"action":"manual","states":[true,false,true,false]}
```

舊的 `{"action":"manual","leds":[1,3],"on":true}` 介面仍保留，只修改指定的燈、保留其餘輸出，但新版網頁不使用此格式。兩種手動格式不能混用。

其他操作為 `{"action":"shine","count":5}`、`{"action":"run"}`、`{"action":"reverse"}`、`{"action":"stop"}`。次數限整數 1-100；未啟動流水燈時反轉回傳 409。非法參數回傳 400；GPIO 失敗回傳 503 並停止動畫。伺服器以序列方式寫入 GPIO，避免同時操作互相覆蓋。

GPIO 介面沿用課程的 `/sys/class/gpio`。四個 value 是依序寫入，整組提交不代表電氣上完全同步。正常 Ctrl+C / SIGTERM 會嘗試熄滅所有 LED，並只 unexport 本次自行 export 的腳位；已有的 export 保留。寫入失敗、強制終止或斷電時無法保證清理。API 的 `outputKnown: false` 表示無法確認輸出，頁面會顯示 `輸出狀態未知`；沒有電氣回授。帶紅點的燈色只代表尚未送出的預覽。

## 驗證

```bash
npm test
```

測試涵蓋指定 LED、整組混合亮滅提交、1–100 範圍驗證、精確輪次、循環反轉、模式切換、舊計時器、同時操作、GPIO 錯誤與重試、HTTP/API 驗證、C++ 編譯與 `execFile` 寫入暫存 sysfs。測試需要 `make` 與 C++ 編譯器，會在本機產生 `C++/gpio`；上 TX2 前仍需 clean 後重編。

`npm test` 不會驗證瀏覽器排版與互動。修改前端後，另外在模擬模式檢查：

1. 以 1980 × 1440 及一般桌面寬度開啟頁面，確認下方三張卡片上下對齊；窄螢幕重排後沒有橫向溢出。
2. 切換 LED1／LED3：開關與燈色立即變紅、出現紅點；等待背景更新後仍保留預覽。按 Submit 後紅點消失，重新整理仍顯示已送出的亮滅設定。
3. 拉桿分別移到 1 與 100，確認數字欄同步；直接輸入 5，確認拉桿同步，再執行 Mode_Shine，確認進度完成且四燈全滅。
4. 開啟流水燈，確認方向按鈕啟用、燈號循環；反轉後箭頭與下一顆燈的方向改變；關閉後全滅，方向按鈕停用。

暫存 sysfs 是一般檔案，只驗證參數與寫入流程，無法驗證 TX2 pinmux、Linux sysfs 驅動、GPIO 電壓、接線、實際 LED、真實網路或權限。`GPIO_SYSFS_ROOT` 僅供測試替換路徑，實機不要設定。


實作參考：[Node.js execFile 文件](https://nodejs.org/api/child_process.html#child_processexecfilefile-args-options-callback)、[Linux GPIO sysfs 文件](https://www.kernel.org/doc/Documentation/gpio/sysfs.txt)。Linux 已將 sysfs GPIO 列為舊介面，本專案配合課程現有 TX2 使用。
