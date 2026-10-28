# Lab06：Linux 驅動程式模組與字元裝置

依使用者提供的 `Lab6驅動程式模組編寫實習_V2.pdf` 第 11–14 頁，以及 `Lecture6_Embedded_Linux-Device-Driver.pdf` 第 12–30、34–57 頁實作。以下頁碼均為 PDF 頁序。

| Lab 要求 | 程式與操作 | 驗收環境 |
| --- | --- | --- |
| 項目一，簡易驅動（30%） | `hellod.c`：載入／卸載訊息、`lsmod`、`dmesg` | Ubuntu VM **及** TX2，分別編譯 |
| 項目二，字元驅動（40%） | `demo.c`、`test.c`：`/dev/demo`、open/read/write/release、連續寫入計數 | Ubuntu VM |

這次沒有 LED 或感測器接線需求。`demo` 使用核心記憶體保存訊息，示範使用者空間與核心空間之間的資料傳遞。Apple Silicon 的 **ARM64 Ubuntu VM** 可以依相同流程操作，不必為了投影片中的 x86 截圖改裝 x86 VM；核心標頭與編譯工具需符合實際 VM。

交付範圍是程式與操作／驗收說明。講義中的上傳、組員比例、借還登記等是課程規則；沒有代為繳交，也沒有編造實機截圖、組員資料或個人心得。

## 1. 檔案與實作差異

```text
Lab06/
├── hellod.c                    # 項目一：module_init / module_exit
├── demo.c                      # 項目二：字元驅動
├── test.c                      # 使用者程式；產生可執行檔 test.o
├── Makefile                    # Linux Kbuild；M= 取代舊 SUBDIRS=
├── scripts/
│   ├── check_environment.sh    # 唯讀環境檢查
│   └── demo_device.sh          # 明確執行載入、建立節點或卸載
└── tests/
    ├── test_host.py            # 本機使用者程式測試
    └── test_kernel.py          # 已載入 demo.ko 的 Linux 整合測試
```

相對講義範例，這份實作補齊：

- 以 `copy_from_user()` 檢查使用者資料複製結果；限制單次最多 **1024 bytes**，超過回傳 `EMSGSIZE`，不覆寫舊訊息。
- `read()` 真正將資料複製回使用者空間，支援分段讀取、正確位移與 EOF，讓 `cat` 可以結束。
- 每次非空成功 `write()` **取代整筆訊息**並將該檔案讀取位移歸零。因此可在同一個 `open()` 後直接 write → read，不必 `lseek()`。
- 訊息與 `iCount` 在 close → open 後保留；卸載重載後清空。`iCount` 從 0 開始印出，再加 1；空寫入與失敗寫入不計次。
- 原子旗標拒絕第二個獨立 `open()`，回傳 `EBUSY`；mutex 保護共享資料；`.owner = THIS_MODULE` 管理模組引用。
- 保留 `.unlocked_ioctl` 入口，但不定義額外 ioctl 命令，未支援的命令回傳 `ENOTTY`。測試主流程使用 read/write。
- 使用 `nonseekable_open()` 拒絕 seek，避免依賴新核心已移除的 `no_llseek` 名稱。

`test.o` 的副檔名沿用 Lecture6 第 52–55 頁；它是**已連結的使用者可執行檔**。`hellod.ko`、`demo.ko` 才是交給 `insmod` 的核心模組。

## 2. Mac 可先執行的檢查

```bash
cd /Users/hiyori/Documents/ChatGPT/Microprocessor/microprocessor/Lab06
make userspace host-test
./test.o --help
```

需要 C 編譯器、make、Python 3.6 以上。這只編譯使用者程式並測試參數、錯誤處理及讀回不符時的判定；macOS 無法載入 Linux `.ko`。`make`、`make hello` 在 macOS 會明確拒絕核心編譯。

## 3. Ubuntu VM：複製與準備

若 Fusion 已掛載名為 `Microprocessor` 的共享資料夾，在 **Ubuntu VM** 的終端機執行：

```bash
ls /mnt/hgfs/Microprocessor/microprocessor/Lab06
mkdir -p ~/microprocessor-lab6
cp -R /mnt/hgfs/Microprocessor/microprocessor/Lab06 ~/microprocessor-lab6/
cd ~/microprocessor-lab6/Lab06
make clean
```

共享路徑不存在時，先掛載共享資料夾，或手動複製整個 `Lab06`。編譯放在 VM 本機檔案系統。從 Mac 複製後要 `make clean`，避免誤用 Mac 產生的 `test.o`；從 TX2 複製來也一樣需要清除。

安裝符合**正在執行的核心**的標頭與工具：

```bash
uname -a
sudo apt-get update
sudo apt-get install build-essential kmod python3 "linux-headers-$(uname -r)"
sh scripts/check_environment.sh
```

預設 `KDIR=/lib/modules/$(uname -r)/build`。若安裝更新後已換了核心版本，先依 VM 狀況重新開機，再核對 `uname -r` 與標頭；不要拿另一版本的標頭勉強編譯。

Lab 第 13 頁另列出以下相依套件。遇到對應缺少套件的錯誤再補裝，預設 Ubuntu 發行版標頭編譯不一定全部需要：

```bash
sudo apt-get install libncurses-dev flex bison openssl libssl-dev \
  dkms libelf-dev libudev-dev libpci-dev libiberty-dev autoconf
```

## 4. 項目一：VM 的 hellod

在 VM 的 `~/microprocessor-lab6/Lab06`：

```bash
make hello
modinfo ./hellod.ko
sudo insmod ./hellod.ko
lsmod | grep '^hellod '
sudo dmesg | grep 'hellod:' | tail -n 10
sudo rmmod hellod
sudo dmesg | grep 'hellod:' | tail -n 10
```

預期新訊息（範例，並非本次已取得的執行紀錄）：

```text
hellod: Hello, TX2 module is installed !
hellod: Good-bye, TX2 module was removed!
```

文字沿用講義，所以在 VM 也會顯示 `TX2`。截圖請包含 `uname -a`、成功編譯、載入後 `lsmod`，以及載入／卸載的最新 `dmesg` 時間戳記。卸載後再次執行 `lsmod | grep '^hellod '` 應無輸出。

## 5. 項目一：TX2 的 hellod

先從 **Ubuntu VM** 傳原始碼，下面帳號與 IP 請換成已確認的值：

```bash
cd ~/microprocessor-lab6
TX2_USER=nvidia
TX2_IP=192.168.55.1
scp -r Lab06 "$TX2_USER@$TX2_IP:~/"
ssh "$TX2_USER@$TX2_IP"
```

接下來在 **TX2** 終端機操作：

```bash
cd ~/Lab06
make clean
uname -a
ls -l /lib/modules/"$(uname -r)"/build
sh scripts/check_environment.sh
make hello
modinfo ./hellod.ko
sudo insmod ./hellod.ko
lsmod | grep '^hellod '
sudo dmesg | grep 'hellod:' | tail -n 10
sudo rmmod hellod
sudo dmesg | grep 'hellod:' | tail -n 10
```

**TX2 要用其 L4T／JetPack 對應的 NVIDIA 核心標頭與建置資料。** VM 與 TX2 即使都是 ARM64，也不能共用編譯產物。

若 TX2 的 `build` 連結不存在，而課程板的標頭確實位於 Lecture6 第 15 頁路徑，可改用以下方式；這是講義範例路徑，不代表每塊板都是此版本：

```bash
KDIR=/usr/src/linux-headers-4.9.201-tegra-ubuntu18.04_aarch64/kernel-4.9
make -s -C "$KDIR" kernelrelease
uname -r
KDIR="$KDIR" sh scripts/check_environment.sh
make hello KDIR="$KDIR"
```

兩個版本輸出需相符。若路徑或版本不符，先找到／安裝該板**實際執行中**的 L4T 核心標頭；不要照抄 4.9.201，也不要用一般 Ubuntu `generic` 標頭替代。保留 TX2 自己的編譯、`uname`、`lsmod`、載入與卸載訊息截圖。

## 6. 項目二：VM 的 demo 字元裝置

回到 **Ubuntu VM**，在 `~/microprocessor-lab6/Lab06`：

```bash
make char userspace
sudo sh scripts/demo_device.sh load
cat /sys/module/demo/parameters/major
ls -l /dev/demo
sudo dmesg | grep 'demo:' | tail -n 15
```

helper 執行 `insmod demo.ko major=60`，並以實際主設備號建立 `/dev/demo`，minor 為 0、權限為 600。若 `/dev/demo` 已存在，會停止並要求先檢查，不會直接取代。

對照講義，預設 major 60 時，等價的**手動替代操作**如下。選 helper 或手動其中一種，不要重複載入：

```bash
sudo insmod ./demo.ko
sudo mknod -m 600 /dev/demo c 60 0
```

如果 major 60 已被其他裝置占用而載入失敗，可用動態設備號：

```bash
sudo sh scripts/demo_device.sh load 0
```

這時以 `/sys/module/demo/parameters/major` 及 `/proc/devices` 顯示的實際數字為準，不能仍手動建立 `c 60 0`。

### 連續執行使用者程式

```bash
sudo ./test.o
sudo ./test.o /dev/demo 'second message'
sudo dmesg | grep 'demo:' | tail -n 30
```

第一次的預期畫面：

```text
WRITE 29 bytes: Data Input 123456 hello world
READ  29 bytes: Data Input 123456 hello world
PASS: readback matches; end of file reached.
```

若剛載入後只執行上面兩次，核心紀錄應依序含 `iCount=0`、`iCount=1`、open、write、read、close；中間沒有卸載重載，才可證明計數保留。整合測試也會增加計數，請先拍這兩次的驗收畫面。

### 用 echo 與 cat 測試

```bash
printf '%s\n' 'test123' | sudo tee /dev/demo
sudo cat /dev/demo
sudo dmesg | grep 'demo:' | tail -n 20
```

`tee` 顯示一次輸入內容，`cat` 再讀回一次；裝置不是空讀取。等價的講義寫法是 `sudo sh -c 'echo test123 > /dev/demo'`。不能只寫 `sudo echo ... > /dev/demo`，因為 `>` 由目前 shell 執行，沒有取得 root 權限。

### 核心整合測試與卸載

```bash
sudo make kernel-test
sudo sh scripts/demo_device.sh unload
sudo dmesg | grep 'demo:' | tail -n 30
lsmod | grep '^demo '
```

整合測試直接操作已載入的真實 `/dev/demo`，包含 UTF-8 分段讀取與 EOF、1024-byte 二進位資料、超長拒絕且保留原資料、零長度、EOF 後覆寫、重新開啟保留資料、重複開啟的 `EBUSY`、ioctl／seek 錯誤，以及無效使用者指標的讀／寫 `EFAULT`。共 **10 項**；未在本機 macOS 執行，沒有用模擬結果冒充核心驗證。

卸載後應看到 `demo: removed writes=...`，`lsmod` 無 `demo`，節點也被 helper 移除。如果仍有程式開著裝置，`rmmod` 會失敗，先關閉該程式再卸載。

## 7. 常見問題

| 訊息／現象 | 檢查方式 |
| --- | --- |
| `Missing kernel build tree` | 核對 `uname -r`、`/lib/modules/.../build`、相符標頭；TX2 使用對應 L4T 標頭 |
| Makefile `missing separator` | 指令列開頭要保留 Tab，使用這份 Makefile 的原檔 |
| 舊 `SUBDIRS=` 無法編譯 | 本版已使用 `M=`，不需套用講義舊寫法 |
| `Invalid module format`、symbol version 不符 | 看最新 `sudo dmesg` 與 `modinfo` 的 vermagic；在該系統重新 `make clean`、編譯 |
| `Key was rejected by service`、`Operation not permitted` | 看 `dmesg`、Secure Boot／核心 lockdown 與 `modules_disabled`；依課程 VM 的模組簽章設定處理 |
| `Device or resource busy` | 看 `/proc/devices` 是否已占用 major，或是否已有程式開啟 `/dev/demo`；不要卸載不相關驅動 |
| `/dev/demo` 存在但無法開啟 | 裝置節點與核心模組是兩件事；核對模組是否載入、節點是否為 char、major/minor 是否相符 |
| `dmesg: Operation not permitted` | 改用 `sudo dmesg`，不必為 Lab 修改全系統的 dmesg 權限 |
| `Exec format error` 執行 `test.o` | 清除從其他系統複製的產物，在目前 Linux 重新 `make userspace` |

## 8. 驗證狀態與報告取證

目前在 macOS 已實際完成：

- C99 使用者程式編譯；`-Wall -Wextra -Wpedantic` 與 Clang 靜態分析未回報問題。
- `make host-test` 的 7 項測試通過。
- 兩支 shell 腳本的語法檢查、Python 測試腳本語法檢查。
- macOS 核心編譯與核心整合測試明確拒絕執行，避免顯示假的成功。

**尚未完成 VM／TX2 的 Linux Kbuild 編譯、insmod／rmmod、dmesg 及 10 項核心整合測試。** 原始碼使用兩種目標皆有的基礎介面，但這不等於已取得兩個目標的編譯或執行結果。

報告／現場驗收請逐項補上真實證據：

- [ ] VM：`uname -a`、`make hello`、`lsmod`、Hello／Good-bye 訊息。
- [ ] TX2：自己的 `uname -a`、`make hello`、`lsmod`、Hello／Good-bye 訊息。
- [ ] VM：`make char userspace`、`demo` 載入、`/dev/demo` 的 `c` 與設備號。
- [ ] VM：連續兩次 `test.o` 成功讀回，核心 `iCount` 從 0 到 1。
- [ ] VM：echo／cat、核心整合測試輸出、卸載訊息。
- [ ] 小組、組員、實際操作截圖與說明、合計 100% 的貢獻比例；個人心得另寫。

講義要求繳交時使用 `Lab06_第XX組/Code/` 與 `Report/`，Mac 報告為 PDF；壓縮方式依講義採 Windows 系統壓縮或 7z。請用真實資料完成報告後再整理繳交，本資料夾沒有代填這些資訊。

## 參考

- 使用者提供的 Lab6 與 Lecture6 PDF，頁碼見開頭。
- [Linux Kbuild：Building External Modules](https://docs.kernel.org/kbuild/modules.html)：外部模組的 `M=` 與核心建置需求。
- [Linux 4.9 fs.h](https://github.com/torvalds/linux/blob/v4.9/include/linux/fs.h)、[uaccess.h](https://github.com/torvalds/linux/blob/v4.9/include/linux/uaccess.h)：TX2 舊核心介面的參考。
- [Linux 現行 fs.h](https://github.com/torvalds/linux/blob/master/include/linux/fs.h)：檢查 VM 新核心介面差異；仍須以實際安裝核心編譯驗證。
