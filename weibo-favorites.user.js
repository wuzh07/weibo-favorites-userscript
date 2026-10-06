// ==UserScript==
// @name         微博左侧菜单添加「我的收藏」
// @namespace    https://greasyfork.org/
// @version      1.0.0
// @description  在微博左侧导航菜单中添加「我的收藏」入口
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

    let timer = null;

    function scheduleInsert() {
        if (timer) return;

        timer = setTimeout(() => {
            timer = null;
            insertFavorites();
        }, 100);
    }

    const observer = new MutationObserver(scheduleInsert);

    function start() {
        if (!document.documentElement) {
            return;
        }

        observer.observe(document.documentElement, {
            childList: true,
            subtree: true
        });

        scheduleInsert();
    }

    start();

})();
