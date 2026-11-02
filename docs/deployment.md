# GitHub Pages 部署与相对路径说明

> 目标：纯静态、无构建、无后端。仓库推送后即可由 GitHub Pages 托管。

## 1. 本地预览

ES Module 不能从 `file://` 跨文件加载，因此本地请使用：

```text
双击 启动本地预览.bat
```

或：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\serve.ps1 -Port 8000
```

访问 `http://127.0.0.1:8000/`。

`serve.ps1` 是一个只读静态文件服务器，不参与应用逻辑，也不会读取或上传 API Key。

## 2. 部署到 GitHub Pages

### 2.1 仓库根目录部署

1. 将 `cthulhu-table/` 的全部内容放到仓库根目录。
2. 推送到 `main`。
3. 仓库 **Settings → Pages**：
   - Source: `Deploy from a branch`
   - Branch: `main`
   - Folder: `/(root)`
4. 保存，等待 GitHub 构建。
5. 访问 `https://<username>.github.io/<repo>/`。

### 2.2 子目录部署

也可以把整个目录放到仓库的 `docs/` 或 `cthulhu-table/` 子目录，并在 Pages 中选择对应目录。所有应用资源均使用**相对路径**：

```html
<link rel="stylesheet" href="css/main.css">
<script type="module" src="js/app.js"></script>
<img src="assets/sigil.svg">
```

因此项目放在 `/<repo>/` 还是 `/<repo>/subdir/` 都能正确加载。

## 3. 路由方式

项目使用 **Hash 路由**：

```text
https://<username>.github.io/<repo>/#/home
https://<username>.github.io/<repo>/#/characters
https://<username>.github.io/<repo>/#/builder
https://<username>.github.io/<repo>/#/modules
https://<username>.github.io/<repo>/#/table
https://<username>.github.io/<repo>/#/settings
```

Hash 后面的部分不会发送给 GitHub Pages，因此**不需要**配置 SPA fallback 或重写规则。

## 4. `.nojekyll`

仓库根目录包含空文件 `.nojekyll`：

```text
.nojekyll
```

它告诉 GitHub Pages 不要用 Jekyll 处理静态文件，避免以下划线开头的文件/目录被忽略。不要删除。

## 5. 404 处理

Hash 路由本身不会产生 404，但用户可能：

- 访问不存在的普通路径；
- 把 `#/...` 之前的路径拼错；
- 从外部链接进入错误路径。

根目录的 [`404.html`](../404.html) 会：

1. 显示克苏鲁风格提示；
2. 计算项目根路径（兼容 `/<repo>/` 子路径）；
3. 700ms 后跳转到 `<项目根>/#/home`；
4. 提供可点击的返回链接。

如果使用自定义域名且站点部署在根路径，脚本会回到 `/`；如果是项目站，则回到 `/<repo>/`。

## 6. 常见部署问题

### 页面空白 / 一直停在启动页

检查：

- 是否通过 HTTP(S) 打开，而不是 `file://`；
- 浏览器控制台是否有模块 404；
- 是否正确上传了 `js/`、`css/`、`assets/` 目录；
- 是否误把 `cthulhu-table/` 这一层目录也放进了仓库，导致入口变成 `/repo/cthulhu-table/index.html`。如果这样，请把 Pages 目录设为 `/(root)/cthulhu-table` 或移动文件。

### CSS 正常但 JS 不执行

通常是 ES Module 的 MIME 类型问题。GitHub Pages 会正确返回 `text/javascript`；本地请使用项目提供的服务器，不要用会返回 `text/plain` 的简易工具。

### 404 页面跳到错误地址

GitHub Pages 项目站首页是 `/<repo>/`。`404.html` 使用路径第一段作为项目根；如果部署在多层子目录，请手动修改脚本中的 `base` 计算逻辑。

### API 请求被浏览器拦截（CORS）

本应用是纯前端，API 请求由浏览器直接发往你填写的接口。接口必须允许：

- `Access-Control-Allow-Origin` 包含站点源（或 `*`）；
- 允许 `Authorization` 与 `Content-Type` 请求头；
- 允许 POST。

如果服务商不支持浏览器 CORS，需要使用其官方前端 SDK 或允许 CORS 的中转地址。**不要**在页面里硬编码任何密钥。

### 更新后仍是旧版本

GitHub Pages 有 CDN 缓存。可以：

- 等待几分钟；
- 强制刷新（Ctrl/Cmd + Shift + R）；
- 在仓库设置中重新发布；
- 在 URL 后加 `?v=2` 验证。

## 7. 数据备份与迁移

- **设置页 → 导出完整备份**：包含设置、角色、战役、模组、聊天、存档。
- 备份包含 API Key，不要提交到 Git 或公开网盘。
- 换设备：在新设备导入备份，再在设置页确认接口配置。
- 清除浏览器站点数据会删除全部本地战役。

## 8. 发布前检查

- [ ] `.nojekyll` 在仓库根目录
- [ ] `404.html` 在仓库根目录
- [ ] `index.html` 使用相对路径
- [ ] `js/`、`css/`、`assets/` 全部上传
- [ ] 线上打开 `/#/home` 无控制台错误
- [ ] 刷新 `/#/table` 仍能加载
- [ ] 模组导入、骰子、接口测试可用
- [ ] 备份导出可下载，且未误提交到仓库
