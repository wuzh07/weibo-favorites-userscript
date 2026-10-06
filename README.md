# weibo-favorites-userscript

在微博左侧导航菜单中添加「我的收藏」入口的油猴（Tampermonkey / Greasemonkey）用户脚本。

## 功能

- 在微博左侧菜单「最新微博」条目前插入「我的收藏」入口
- 链接指向 `/u/favorites`
- 使用 MutationObserver，适应微博动态渲染的页面结构

## 安装

1. 浏览器安装 [Tampermonkey](https://www.tampermonkey.net/)
2. 新建脚本，粘贴 `weibo-favorites.user.js` 的内容保存即可

## 许可

MIT
