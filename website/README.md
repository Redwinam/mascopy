# 大师拷贝官网

线上地址：https://mascopy.if9.cool

纯静态站（HTML + 一份 CSS + 一份 JS），结构与组件沿用开发启动器官网，配色取自大师拷贝的图标与界面。
不依赖任何字体或脚本 CDN；下载按钮直链下载服务的稳定版（`https://dl.if9.cool/v1/app/mascopy/stable/download/darwin-aarch64`），版本号、大小与发布日期由 `assets/site.js` 从 `https://dl.if9.cool/v1/app/mascopy/stable` 读取，读不到时保留静态文字。发新版见仓库 README「发布到下载服务」。

| 路径 | 内容 |
| --- | --- |
| `index.html` | 首页：三步备份、归档与判重、联机拍摄、Eagle 挑图、可靠性、格式、章节导览、下载 |
| `backup.html` … `reference.html` | 五个功能章节 |
| `_template.html` | 功能页模板（不发布） |
| `assets/shots/` | 界面截图（WebP，2× 清晰度）；示例文件名为虚构，照片来自 Unsplash |

## 部署

部署为 Cloudflare Worker `mascopy-web`（静态资源），配置在 `wrangler.jsonc`，`.assetsignore` 排除说明与配置文件。在本目录执行：

```bash
CLOUDFLARE_API_TOKEN=<deploy 令牌> CLOUDFLARE_ACCOUNT_ID=<账户 ID> npx wrangler deploy
```

域名走大陆优选入口（`[if9-edge-worker]` 接法）：DNS 灰云 A → `172.64.147.185`，由 `wrangler.jsonc` 里的 Route 接管。

## 截图

截图用无头浏览器连前端开发服务器（`npm --prefix src-ui run dev`），注入虚构的 Tauri IPC 数据拍摄，不含真实素材。界面改版后需要重拍。
