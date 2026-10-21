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

以下流程由 **MacBook M4 → VMware Fusion Ubuntu ARM64 → USB OTG → Jetson TX2**。程式在 TX2 執行，Ubuntu VM 用 SSH 管理 TX2、用瀏覽器操作 UI。

### 1. USB 與 Ubuntu VM

- 用可傳資料的 Micro-USB 線連接 TX2 的 Micro-B OTG 埠與 Mac，並替 TX2 接上電源。
- VMware Fusion 詢問 USB 裝置連線位置時，選 **Linux (Ubuntu)**；若沒跳提示，到「虛擬機 → USB 和藍牙」選 NVIDIA / USB Ethernet 裝置。
- Ubuntu VM 終端機安裝 VMware 工具（選用，改善剪貼簿）：

```bash
sudo apt update && sudo apt install -y open-vm-tools open-vm-tools-desktop
```

- 終端機貼上使用 `Ctrl+Shift+V`。如需改用 Xorg，編輯 GDM 設定並重開 VM：

```bash
sudo nano /etc/gdm3/custom.conf  # 將 #WaylandEnable=false 改成 WaylandEnable=false
sudo reboot
```

### 2. Ubuntu VM 建立網路並登入 TX2

```bash
ip -br link                         # 找 TX2 USB 網卡名稱，常見為 usb0
NET_IF=usb0                         # 若介面名稱不同，替換 usb0
sudo ip link set "$NET_IF" up
sudo dhclient "$NET_IF"            # 向 TX2 的 USB 網路 DHCP 取得位址；若找不到指令，先安裝 isc-dhcp-client
ip -4 addr show "$NET_IF"          # 預期取得 192.168.55.x/24
ping -c 3 192.168.55.1              # TX2 USB 網路預設位址
TX2_USER=nvidia                     # 改成 TX2 上實際帳號
TX2_IP=192.168.55.1
ssh "$TX2_USER@$TX2_IP"            # 首次輸入 yes 與 TX2 密碼；exit 回 Ubuntu VM
```

`dhclient` 不存在時：`sudo apt update && sudo apt install -y isc-dhcp-client`。

若偏好 NetworkManager，可用 `sudo nmcli device connect "$NET_IF"` 代替 `dhclient`。`Connection refused` 時稍候 30–60 秒後重試；必要時在 TX2 本機啟用 SSH：

```bash
sudo apt update && sudo apt install -y openssh-server
sudo systemctl enable --now ssh
```

`Permission denied`：確認輸入的是 TX2 帳號密碼。主機金鑰改變時：

```bash
ssh-keygen -R "$TX2_IP"
ssh "$TX2_USER@$TX2_IP"
```

### 3. 在 Ubuntu VM 傳送 Lab04 至 TX2

在 **Ubuntu VM** 執行；把 `REPO` 改成 repository 在 VM 中的路徑：

```bash
REPO=~/microprocessor                 # 替換為實際 repository 路徑
cd "$REPO"
tar -czf /tmp/Lab04.tar.gz --exclude=Lab04/C++/gpio --exclude=Lab04/node_modules --exclude=Lab04/test/artifacts -C . Lab04
scp /tmp/Lab04.tar.gz "$TX2_USER@$TX2_IP:~/Lab04.tar.gz"
ssh "$TX2_USER@$TX2_IP" 'mkdir -p ~/Lab04 && tar -xzf ~/Lab04.tar.gz -C ~'
```

選用：在 Ubuntu VM 交叉編譯 GPIO helper

```bash
sudo apt update && sudo apt install -y build-essential gcc-aarch64-linux-gnu g++-aarch64-linux-gnu
cd "$REPO/Lab04"
aarch64-linux-gnu-g++ -std=c++11 -O2 -Wall -Wextra -pedantic C++/gpio.cpp -o /tmp/gpio
scp /tmp/gpio "$TX2_USER@$TX2_IP:~/Lab04/C++/gpio"
```

### 4. 在 TX2 編譯並啟動 GPIO 伺服器

在 **TX2 SSH 終端機**執行；先停止其他 Lab 的 GPIO 程式。TX2 缺少工具時才安裝

```bash
sudo apt update && sudo apt install -y nodejs npm g++ make
node --version                       # 需要 Node.js 12+；套件太舊時勿升級 TX2 系統 / Kernel
cd ~/Lab04
make -C C++ clean                    # 在 TX2 本機編譯時執行
make -C C++                          # 若已從 Ubuntu VM 傳入交叉編譯的 gpio，跳過以上兩行
node server.js --hardware
```

保持伺服器終端機開啟；若 GPIO 初始化顯示 `Permission denied`，改用：

```bash
sudo env GPIO_PINS=255,428,427,398 node server.js --hardware
```

如果 TX2 啟用 UFW，在另一個 TX2 終端機放行連線：

```bash
sudo ufw status
sudo ufw allow 22/tcp
sudo ufw allow 8080/tcp
```

### GPIO 接線

以下腳位沿用 Lab03 配置，非 Lab4 PDF 指定且尚未實機確認。請依實際接線核對 Linux GPIO 與實體 pin；輸出假設為寫入 1 亮、0 滅。

| LED | Linux GPIO | 實體 pin | GND pin |
| --- | --- | --- | --- |
| LED1 | 255 | 15 | 14 |
| LED2 | 428 | 21 | 20 |
| LED3 | 427 | 23 | 25 |
| LED4 | 398 | 29 | 30 |


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

暫存 sysfs 是一般檔案，只驗證參數與寫入流程，無法驗證 TX2 pinmux、Linux sysfs 驅動、GPIO 電壓、接線、實際 LED、真實網路或權限。`GPIO_SYSFS_ROOT` 僅供測試替換路徑，實機不要設定。

## Turn off server
```bash
lsof -nP -iTCP:8080 -sTCP:LISTEN //抓那個port 被佔用
kill "port_number"
```


實作參考：[Node.js execFile 文件](https://nodejs.org/api/child_process.html#child_processexecfilefile-args-options-callback)、[Linux GPIO sysfs 文件](https://www.kernel.org/doc/Documentation/gpio/sysfs.txt)。Linux 已將 sysfs GPIO 列為舊介面，本專案配合課程現有 TX2 使用。
