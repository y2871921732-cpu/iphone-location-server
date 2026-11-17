# iPhone A端 + B端卡密查看网页（仅知情授权测试）

这是一个**可运行的源码测试版**，不是已经部署的网址。A端持有人须在Safari中显式勾选授权、点击“开始共享”，并保留页面在前台。B端通过手机浏览器输入管理员生成的卡密查看。代码不提供隐蔽定位、绕过iOS提示或持续后台追踪。

## 功能

- `https://部署域名/a` — A端 iPhone 开启/停止可见位置共享。开始时立即尝试获取精确定位；页面保持前台时，每3分钟尝试再次采样并上传。浏览器进入后台时主动停止，且服务器使用90秒心跳超时保护。
- `https://部署域名/` — B端卡密验证后查看最近上传的位置、精度、采集时间、当日历史坐标。自动每10秒刷新（页面可见时）。OpenStreetMap地图显示原始WGS84坐标；“在苹果地图打开”针对中国大陆给出GCJ-02转换参考坐标。
- `https://部署域名/admin` — 管理员生成一次性展示的随机卡密、设置精确过期时间、查看状态或撤销卡密。一个时刻只有一张有效查看卡密，重新生成时旧卡密失效。

## Windows部署：推荐 Node.js HTTPS 云服务

1. 新建**另一个**GitHub仓库，上传该文件夹中的全部文件（包含 `public/` 及其中所有文件，且不要上传 `data/`、`.env`）。可以将本仓库作为普通Node项目上传，**不要当作GitHub Pages静态站点发布**。
2. 在支持Node.js和HTTPS的托管平台创建Web Service（如Render），连接该GitHub仓库，启动命令为 `npm start`，无需安装第三方npm依赖。
3. 在托管平台的私有环境变量中添加：
   - `ADMIN_PASSWORD`：至少16位的独立随机管理员密码；
   - `DEVICE_TOKEN`：至少24位的另一串随机设备令牌（仅用于A端）；
   - `PUBLIC_HTTPS=1`（确保B端会话Cookie仅经HTTPS传输）。
   - 平台通常自动提供 `PORT`，无需硬编码。**不要**将任何真实密钥写入公开GitHub仓库。
4. 部署完成后访问 `https://你的服务域名/api/health`，应返回 `{"ok":true}`。请在手机上使用HTTPS服务域名，HTTP网页不能正常请求Safari精确定位。
5. 打开 `/admin` 设置到期时间，生成随机B端卡密，复制并安全保存。
6. A手机Safari打开 `/a`，输入**A端设备令牌**、明确同意共享并点击开始，等待定位和上传成功。
7. B手机Safari/Chrome打开 `/`，输入**B端查看卡密**，显示A端最近一次上传的位置，并可在苹果地图查看转换后的坐标。
8. A手机点击“停止共享”，B端立即失去查看权限。

## 必须理解的限制

- 旧的`GitHub Pages` GPS测试页只获取**本机**坐标，没有上传；B端无法直接读取旧页的定位结果。GitHub Pages不能运行本项目的Node服务器/API。
- 这个Safari演示版会**立即上传每次采样**以方便两台手机联测，不遵循计划中的“每30分钟批量上传”。计划中的3分钟采样/30分钟批量上传，需要后续原生iOS APP及进一步后台测试，iOS也不保证严格定时。
- A端只有主动开启共享、且网页保持前台时才进行采集，不会尝试隐藏位置权限、绕过系统提示或在页面关闭后后台继续采集。心跳超时后B端无法查看旧位置。
- 实际位置精度取决于GPS、网络和环境；B端永远显示真实采集时间，不能将“最近位置”当作“当前位置”。
- 历史位置在演示版保存在服务器私有磁盘的JSON文件中，默认保留最多30天；许多免费云主机磁盘为临时存储，重启/重新部署可能丢失。正式使用前请升级为持久数据库、静态资源的供应链安全保护、数据加密、审计记录与备份策略。
- OpenStreetMap瓦片/CDN可能在部分地区不可达，也可能接收到地图访问区域信息。苹果地图链接无需加载第三方瓦片到当前页面。
- 本包仅用于自己的设备或设备持有人明确知情并同意的位置共享。

## API参考

- `GET /api/health`
- `POST /api/admin/cards` (`X-Admin-Password` + `expiresAt`)
- `POST /api/admin/revoke`
- `GET /api/admin/status`
- `POST /api/viewer/login` (`{code}`)
- `GET /api/viewer/latest`
- `GET /api/viewer/history?date=YYYY-MM-DD`
- `POST /api/viewer/logout`
- `POST /api/device/sharing` (`Authorization: Bearer DEVICE_TOKEN`, `{enabled, mode:'web'}`)
- `POST /api/device/heartbeat`
- `POST /api/device/locations`
- `POST /api/device/delete-history`

## 已验证项目

Node.js语法通过；在本地模拟接口测试：卡密生成、错误卡密拒绝、B登录、A授权共享、位置上传、B查询位置、A停止共享后B会话失效。尚未部署公网、未在真实iPhone上验证本新版代码，不能保证iOS锁屏后台定位。
