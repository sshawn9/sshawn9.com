set shell := ["sh", "-eu", "-c"]

# 查看全部日常命令。
default:
    @just --list

# 按锁文件安装依赖，不自动安装测试浏览器。
install:
    npm ci

# 按需安装测试浏览器；使用已有 Chrome 时设置 PLAYWRIGHT_CHROME_PATH 即可。
browser-install:
    npm exec -- playwright install chromium

# 热更新开发，默认使用线上壁纸 API；搜索使用静态回退。
dev:
    npm run dev

# 构建并预览完整页面与搜索，默认使用线上壁纸 API。
preview:
    npm run preview

# 仅调试 Worker 后端；日常页面开发不需要启动。
worker-dev:
    npm run worker:dev

# 只生成部署产物；默认 production，可用 SITE_MODE=preview 覆盖。
build:
    npm run build

# 分析已有构建，导出页面、资源及双向对应清单；不构建、不联网。
inventory:
    npm run inventory

# 从当前机器探测现有资源清单，保留每轮结果；参数转交 npm 命令。
[positional-arguments]
cache-probe *args:
    npm run cache:probe -- "$@"

# 单测 → 一次构建 → 浏览器测试，不必先 build。
test:
    npm test

# 检查所有工作区和根项目的类型。
check:
    npm run check

# 使用项目锁定的 Prettier 格式化。
fmt:
    npm run format

# 检查格式，不修改文件。
fmt-check:
    npm run format:check
