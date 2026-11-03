# 本地开发流程

- 根目录保留公共文档与 `docs/`；macOS 工程位于 `macos/`，网页版位于 `web/`。
- 网页版使用原生 HTML、CSS 和 JavaScript，无构建依赖。在根目录运行 `python3 -m http.server 8080 --directory web` 预览。
- 本程序自测已获用户授权，可直接启动开发或隔离副本，执行绘制、打开、保存、改名等验证操作，并关闭、丢弃自测产生的文档，无需重复请示；保留用户原有文档与未保存内容。
- macOS 修改后按需使用 `./macos/scripts/build.sh` 编译，沿用现有固定自签名证书。
- 自测使用构建目录中的 `macos/build/SimplePaint.app`；每次修改并编译成功后，默认同步替换 `/Applications/SimplePaint.app`，无需再次请示。
- 构建并安装使用 `python3 macos/scripts/install_macos.py`；已有最新构建时使用 `python3 macos/scripts/install_macos.py --skip-build`。替换前正常退出安装版，保留用户文档与未保存内容；遇到保存提示时等待用户处理，禁止强制结束进程或丢弃用户内容。
- 构建产物必须先在临时目录完整打包签名，再整包切换；旧包保留于 `macos/.build/retired-apps`，禁止原地覆盖运行中的二进制或重签正在运行的应用。

# Pages 关联仓库与同步发布

- SimplePaint 源码仓库为 `jzlhll/SimplePaint`，本地目录为 `/Users/allan/codes/MacSimplePaint`；网页版地址为 https://jzlhll.github.io/SimplePaint/ ，由 `gh-pages` 分支根目录发布 `web/` 内的静态文件，源码版本使用 `webapp` 标签记录。
- 关联博客仓库为 `jzlhll/jzlhll.github.io`，本地目录为 `/Users/allan/coz/jzlhllPages`，站点地址为 https://jzlhll.github.io/ 。这是独立的第二个仓库，首页包含 SimplePaint 入口。
- 每次部署 SimplePaint Pages，必须同步检查并更新博客仓库的 `index.html` 中 SimplePaint 入口与网页版本，以及 `README.md`、`docs/game-pages-plan.md` 中相关的仓库、地址和版本说明；名称或地址变更时同步替换旧引用。
- 完成两个仓库的相应提交与普通推送。博客由正式 Release 触发 `.github/workflows/pages.yml` 部署，普通 push 不更新网站；需要同步上线的修改必须发布新的正式 Release，并等待部署完成。
- 发布后确认两个站点均可访问，博客中的 SimplePaint 入口指向本次发布的正确地址。
