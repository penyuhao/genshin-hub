# 架空文字字体

本目录已内置 **7 套 HoYo-Glyphs 官方字体**（woff2 格式，共约 96KB）：

| 文件 | CSS 字族名 | 分类 | 用途 |
|---|---|---|---|
| `Teyvat_Black.woff2` | `Teyvat Black` | 提瓦特文字 | 蒙德 / 枫丹 / 纳塔 / 至冬 / 挪德卡莱 屏副标题 |
| `Inazuma_Brush.woff2` | `Inazuma Brush` | 稻妻文字 | 稻妻屏副标题 |
| `Khaenriah_Sun.woff2` | `Khaenriah Sun` | 坎瑞亚文字 | 坎瑞亚屏副标题 |
| `Khaenriah_Sun_Chasm.woff2` | `Khaenriah Sun Chasm` | 坎瑞亚变体 | 备选 |
| `Sumeru_Scribe.woff2` | `Sumeru Scribe` | 须弥文字 | 须弥屏副标题 |
| `Deshret_Inscription.woff2` | `Deshret Inscription` | 赤冠文字 | 装饰性标题 |
| `Font_Ainee.woff2` | `Font Ainee` | 其他 | 装饰用标题字 |

## 中文回退说明

这些字体**只包含拉丁字母与符号，不含中文字形**。因此：

- 画廊副标题（`TEYVAT` / `MONDSTADT` / `FONTAINE`…）会显示为架空文字 ✅
- 中文标题（原神 / 蒙德 / 璃月…）自动回退到系统衬线字体（思源宋体 → 宋体），保证可读性 ✅

这是方案 5.7.6 的预期行为，不是 bug。璃月没有对应的架空文字（官方未制作），因此使用 `system` 字体。

## 追加字体

三种方式，任选其一（后端会自动发现并注入 `@font-face`）：

```bash
# 1) 直接放进本目录（或 uploads/），刷新即生效
frontend/fonts/MyFont.woff2

# 2) 管理后台 → 备份与还原 → 上传字体文件（自动登记）

# 3) 管理后台 → 字体管理 → 手动登记字族名与文件路径
```

命名约定：文件名会解析为 CSS 字族名，`TeyvatNeue.woff2` → `Teyvat Neue`；含
`Teyvat / Inazuma / Khaenriah / Sumeru / Deshret` 关键词的文件会自动归入对应分类，
并出现在「画廊管理 → 使用字体」下拉框中。

## 版权

字体由 [SpeedyOrc-C/HoYo-Glyphs](https://github.com/SpeedyOrc-C/HoYo-Glyphs) 制作，非商业用途免费。
