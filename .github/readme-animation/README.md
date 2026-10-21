# README 動畫來源

`scenes/subtitle-captions.js` 保留使用者提供的原始程式。原始附件未包含 `../lib/kit.js`，因此本目錄補上相容的 Grid、色盤、漸層與固定種子亂數工具。

`render.mjs` 依時間呼叫原場景，`render.py` 將字元格繪成 GIF。原場景標示 24 fps，GIF 採 80 ms／格（12.5 fps），保留完整 **26.4 秒** 循環與字幕時序。字型與缺少的原始 kit 可能造成外觀與原展示不同；沒有另行重寫場景或字幕。

## 重新產生

需要 Node.js、Python 3、Pillow，以及支援方框與區塊字元的等寬字型。這些是動畫工具的需求，與 Lab04 伺服器分開。

從 repository 根目錄執行：

```bash
python3 -m venv .github/readme-animation/.venv
.github/readme-animation/.venv/bin/python -m pip install Pillow
.github/readme-animation/.venv/bin/python .github/readme-animation/render.py --font /path/to/monospace-font.ttf
```

macOS 可指定 `/System/Library/Fonts/Menlo.ttc`；Linux 可指定已安裝的 DejaVu Sans Mono 等字型檔路徑。輸出會更新 `.github/assets/subtitle-captions.gif`，根目錄 README 以相對路徑引用此圖。

GIF 為裝飾動畫，並非 Lab04 的實際操作畫面。

GitHub 圖片嵌入與相對路徑格式可參考 [GitHub Markdown 文件](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax#images)。
