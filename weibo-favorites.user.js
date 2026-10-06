// ==UserScript==
// @name         微博收藏增强
// @namespace    https://github.com/wuzh07
// @version      2.0.0
// @description  微博收藏功能增强：左侧菜单添加「我的收藏」入口 + 为每条帖子添加一键收藏/取消收藏按钮（适用于首页、收藏页、个人主页等全部页面）
// @author       wuzh07
// @match        https://weibo.com/*
// @match        https://www.weibo.com/*
// @run-at       document-start
// @grant        none
// @noframes
// @homepageURL  https://github.com/wuzh07/weibo-favorites-userscript
// @supportURL   https://github.com/wuzh07/weibo-favorites-userscript/issues
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    /* ==========================================================
     * 功能一：左侧菜单添加「我的收藏」入口
     * ========================================================== */

    const FAV_URL = '/u/favorites';

    function findLatestWeibo() {
        const links = document.querySelectorAll('a[href]');

        for (const link of links) {
            const spans = link.querySelectorAll('span');

            for (const span of spans) {
                if (span.textContent.trim() === '最新微博') {
                    return link;
                }
            }
        }

        return null;
    }

    function insertFavorites() {
        if (document.querySelector('.tm-fav-menu')) {
            return;
        }

        const latestWeibo = findLatestWeibo();

        if (!latestWeibo || !latestWeibo.parentNode) {
            return;
        }

        const favLink = latestWeibo.cloneNode(true);

        favLink.classList.add('tm-fav-menu');
        favLink.href = FAV_URL;

        // 修改菜单文字
        const spans = favLink.querySelectorAll('span');

        for (const span of spans) {
            if (span.textContent.trim() === '最新微博') {
                span.textContent = '我的收藏';
                break;
            }
        }

        // 修改 tooltip
        favLink.setAttribute('title', '我的收藏');

        latestWeibo.parentNode.insertBefore(
            favLink,
            latestWeibo
        );
    }

    let menuTimer = null;

    function scheduleInsert() {
        if (menuTimer) return;

        menuTimer = setTimeout(() => {
            menuTimer = null;
            insertFavorites();
        }, 100);
    }

    function startMenuFeature() {
        if (!document.documentElement) {
            return;
        }

        const menuObserver = new MutationObserver(scheduleInsert);
        menuObserver.observe(document.documentElement, {
            childList: true,
            subtree: true
        });

        scheduleInsert();
    }

    /* ==========================================================
     * 功能二：帖子一键收藏 / 取消收藏
     * ========================================================== */

    const BTN_CLASS = 'wb-fav-btn';
    const LIKE_BTN_SELECTOR = 'button[title="赞"]';
    const STATE = { UNKNOWN: 0, FAVORITED: 1, NOT_FAVORITED: 2, LOADING: 3 };
    const SCAN_DEBOUNCE_MS = 200;
    const CACHE_TTL_MS = 60 * 60 * 1000; // 收藏状态缓存 1 小时

    // 调试开关：控制台执行 localStorage.setItem('wbFavDebug','1') 后刷新开启
    const DEBUG = (() => {
        try { return localStorage.getItem('wbFavDebug') === '1'; } catch (e) { return false; }
    })();
    function log(...args) {
        if (DEBUG) console.log('[wb-fav]', ...args);
    }

    // blogID -> { id, state, lastUpdated }
    const blogCache = new Map();

    // ---------- 工具 ----------
    function getToken() {
        const m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
        return m ? m[1] : null;
    }

    // 微博 permalink：https://weibo.com/<uid>/<base62 ID>
    // ID 为 base62 字符串（如 Rlp0rwpH8）；/u/<uid> 个人主页链接因 uid 段是 'u' 不会误匹配
    const PERMALINK_RE = /^https?:\/\/(?:www\.)?weibo\.com\/\d+\/([0-9A-Za-z]+)/;

    function extractBlogID(postNode) {
        return (extractPermalink(postNode) || [])[1] || null;
    }

    // 返回匹配 permalink 正则的完整链接，如 https://weibo.com/2377356574/Rlp0rwpH8
    function extractPermalink(postNode) {
        // 优先时间链接（class 含 _time_，但混淆后缀可能变化）
        const timeA = postNode.querySelector('a[class*="_time_"]');
        if (timeA && timeA.href) {
            const m = timeA.href.match(PERMALINK_RE);
            if (m) return m;
        }
        // 兜底：扫描帖子内所有链接找 permalink
        const links = postNode.querySelectorAll('a[href]');
        for (const a of links) {
            const m = a.href.match(PERMALINK_RE);
            if (m) return m;
        }
        return null;
    }

    function findPostNode(el) {
        // 向上找帖子根节点：同时包含赞按钮和时间链接的最近容器
        let node = el;
        while (node && node !== document.body) {
            if (node.querySelector && node.querySelector(LIKE_BTN_SELECTOR) && extractBlogID(node)) {
                return node;
            }
            node = node.parentNode;
        }
        return null;
    }

    // ---------- 微博接口 ----------
    // 接口用当前页面的 origin，避免 www.weibo.com 与 weibo.com 跨域
    const API_BASE = location.origin;

    function apiGet(url) {
        return fetch(url, { credentials: 'include' }).then(res => res.json());
    }

    function apiPost(url, data) {
        const token = getToken();
        return fetch(url, {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'X-Xsrf-Token': token || ''
            },
            body: JSON.stringify(data)
        }).then(res => res.json());
    }

    function fetchFavState(blogID) {
        return apiGet(`${API_BASE}/ajax/statuses/show?id=${blogID}`).then(res => {
            if (res && res.id !== undefined) {
                const entry = blogCache.get(blogID);
                if (entry) entry.numId = String(res.id); // createFavorites 需要数字型 id64
                return res.favorited ? STATE.FAVORITED : STATE.NOT_FAVORITED;
            }
            return STATE.UNKNOWN;
        }).catch(() => STATE.UNKNOWN);
    }

    function favAdd(blogID) {
        return apiPost(`${API_BASE}/ajax/statuses/createFavorites`, { id: String(blogID) })
            .then(res => res && res.ok === 1);
    }

    function favRemove(blogID) {
        return apiPost(`${API_BASE}/ajax/statuses/destoryFavorites`, { id: String(blogID) })
            .then(res => res && res.ok === 1);
    }

    // ---------- 缓存 ----------
    function getEntry(blogID) {
        let entry = blogCache.get(blogID);
        if (!entry) {
            entry = { id: blogID, state: STATE.UNKNOWN, lastUpdated: 0 };
            blogCache.set(blogID, entry);
        }
        const expired = Date.now() - entry.lastUpdated > CACHE_TTL_MS;
        if (entry.state === STATE.UNKNOWN || (expired && entry.state !== STATE.LOADING)) {
            entry.state = STATE.LOADING;
            fetchFavState(blogID).then(state => {
                entry.state = state;
                entry.lastUpdated = Date.now();
                refreshButtonsOf(blogID);
            });
        }
        return entry;
    }

    // ---------- 按钮 ----------
    function applyStyle(btn) {
        Object.assign(btn.style, {
            display: 'inline-flex',
            alignItems: 'center',
            height: '28px',
            margin: '0 5px',
            padding: '0 10px',
            minWidth: '46px',
            borderRadius: '4px',
            border: '1px solid rgba(255,153,0,.8)',
            background: 'transparent',
            color: 'rgb(255,153,0)',
            fontSize: '13px',
            cursor: 'pointer',
            lineHeight: '1'
        });
    }

    function stateText(state) {
        if (state === STATE.FAVORITED) return '取消收藏';
        if (state === STATE.NOT_FAVORITED) return '收藏';
        return '收藏…';
    }

    function createButton(blogID) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = BTN_CLASS;
        btn.dataset.blogId = blogID;
        applyStyle(btn);
        btn.textContent = stateText(getEntry(blogID).state);

        btn.addEventListener('click', ev => {
            ev.preventDefault();
            ev.stopPropagation();
            const entry = blogCache.get(blogID);
            if (!entry || entry.state === STATE.LOADING) return;

            const doFav = entry.state !== STATE.FAVORITED;
            btn.textContent = doFav ? '收藏中…' : '取消中…';

            // 确保拿到数字型 id64（show 响应的 id 字段）
            const ensureNumId = entry.numId
                ? Promise.resolve(entry.numId)
                : apiGet(`${API_BASE}/ajax/statuses/show?id=${blogID}`).then(res => {
                    if (res && res.id !== undefined) {
                        entry.numId = String(res.id);
                        if (res.favorited !== undefined) {
                            entry.state = res.favorited ? STATE.FAVORITED : STATE.NOT_FAVORITED;
                            if (entry.state !== (doFav ? STATE.NOT_FAVORITED : STATE.FAVORITED)) {
                                // 状态与按钮预期不符，刷新后让用户重试
                                entry.lastUpdated = Date.now();
                                refreshButtonsOf(blogID);
                                return null;
                            }
                        }
                        return entry.numId;
                    }
                    return null;
                });

            ensureNumId.then(numId => {
                if (!numId) return;
                const req = doFav ? favAdd(numId) : favRemove(numId);
                req.then(ok => {
                    if (ok) {
                        entry.state = doFav ? STATE.FAVORITED : STATE.NOT_FAVORITED;
                        entry.lastUpdated = Date.now();
                    }
                    refreshButtonsOf(blogID);
                }).catch(() => {
                    btn.textContent = '失败';
                    setTimeout(() => refreshButtonsOf(blogID), 1500);
                });
            }).catch(() => {
                // 换取 id64 失败（网络异常等），恢复按钮文字以便重试
                btn.textContent = '失败';
                setTimeout(() => refreshButtonsOf(blogID), 1500);
            });
        });
        return btn;
    }

    function createOpenButton(permalink) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = BTN_CLASS;
        btn.dataset.permalink = permalink; // 与收藏按钮的 data-blog-id 区分
        applyStyle(btn);
        btn.style.border = '1px solid rgba(83,157,247,.8)';
        btn.style.color = 'rgb(83,157,247)';
        btn.textContent = '新页面打开';
        btn.addEventListener('click', ev => {
            ev.preventDefault();
            ev.stopPropagation();
            window.open(permalink);
        });
        return btn;
    }

    function refreshButtonsOf(blogID) {
        const entry = blogCache.get(blogID);
        const text = entry ? stateText(entry.state) : '收藏';
        document.querySelectorAll(`button.${BTN_CLASS}[data-blog-id="${blogID}"]`).forEach(btn => {
            btn.textContent = text;
        });
    }

    // ---------- 扫描与注入 ----------
    // 头部插入点：多级候选，兼容信息流与博文详情页的 header 结构差异
    const HEADER_TARGET_SELECTORS = [
        'header > div[class*="woo-box-flex"] > :nth-child(1)', // 信息流：操作条第一项
        'header > div[class*="woo-box-flex"]',                 // 详情页：直接子级
        'header'                                               // 兜底：header 本身
    ];

    // 已处理的赞按钮记忆，避免每 3 秒兜底扫描的重复爬升开销
    const processedLikeButtons = new WeakSet();

    function injectToLikeButton(likeBtn) {
        if (processedLikeButtons.has(likeBtn)) return;

        // 帖子的赞按钮位于 <footer> 操作条内；评论区、嵌入原微博等的赞不在 footer，跳过
        if (!likeBtn.closest('footer')) {
            log('跳过非帖子操作条的赞按钮（评论区等）');
            return;
        }

        // 跳过转发微博中嵌入「原微博」内部的赞按钮，只处理最外层帖子
        if (likeBtn.closest('div[class*="Feed_retweet"], div.retweet')) {
            log('跳过嵌入原微博的赞按钮');
            return;
        }

        const postNode = findPostNode(likeBtn);
        if (!postNode) {
            log('未找到帖子根节点', likeBtn);
            return;
        }

        const permalinkMatch = extractPermalink(postNode);
        const blogID = permalinkMatch ? permalinkMatch[1] : null;
        if (!blogID) {
            log('未提取到博客ID', postNode);
            return;
        }

        // 已有本脚本的按钮则跳过
        if (postNode.querySelector(`.${BTN_CLASS}`)) return;

        const btn = createButton(blogID);

        // 优先插入头部操作条（原版位置）；找不到则插到帖子底部操作条最左端（如博文详情页）
        const headerTarget = HEADER_TARGET_SELECTORS.map(s => postNode.querySelector(s))
            .find(el => el && el.parentNode);
        if (headerTarget && headerTarget.parentNode) {
            log('注入按钮（头部）', blogID);
            headerTarget.parentNode.insertBefore(btn, headerTarget);
            headerTarget.parentNode.insertBefore(createOpenButton(permalinkMatch[0]), headerTarget);
        } else {
            const bar = likeBtn.closest('footer') || likeBtn.parentElement;
            log('注入按钮（操作条最左端）', blogID);
            bar.insertBefore(createOpenButton(permalinkMatch[0]), bar.firstElementChild);
            bar.insertBefore(btn, bar.firstElementChild);
        }
        processedLikeButtons.add(likeBtn);
    }

    function scan() {
        const likeButtons = document.querySelectorAll(LIKE_BTN_SELECTOR);
        log('扫描：找到赞按钮', likeButtons.length, '个');
        likeButtons.forEach(injectToLikeButton);
    }

    let btnTimer = null;
    function scheduleScan() {
        if (btnTimer) return;
        btnTimer = setTimeout(() => {
            btnTimer = null;
            scan();
        }, SCAN_DEBOUNCE_MS);
    }

    function startFavButtonFeature() {
        if (!document.body) {
            setTimeout(startFavButtonFeature, 200);
            return;
        }
        scan();

        const btnObserver = new MutationObserver(scheduleScan);
        btnObserver.observe(document.body, { childList: true, subtree: true });

        // 定期兜底扫描：虚拟列表节点复用可能导致按钮丢失
        setInterval(scan, 3000);
    }

    /* ==========================================================
     * 启动
     * ========================================================== */

    startMenuFeature();
    startFavButtonFeature();
})();
