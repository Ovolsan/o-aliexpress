// ==UserScript==
// @name         O Aliexpress
// @namespace    o-aliexpress
// @version      1.0.0
// @author       Ovolsan
// @description  Сбор купонов AliExpress (центр купонов 1 и 2), актуальные промокоды и применение промокодов по таймеру.
// @license      GPL-3.0
// @homepageURL  https://github.com/Ovolsan/o-aliexpress
// @supportURL   https://github.com/Ovolsan/o-aliexpress/issues
// @updateURL    https://raw.githubusercontent.com/Ovolsan/o-aliexpress/main/o-aliexpress.user.js
// @downloadURL  https://raw.githubusercontent.com/Ovolsan/o-aliexpress/main/o-aliexpress.user.js
// @match        https://*.aliexpress.com/*
// @match        https://aliexpress.com/*
// @run-at       document-start
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @grant        GM_openInTab
// @grant        GM_setClipboard
// @grant        unsafeWindow
// ==/UserScript==

// O Aliexpress — Copyright (C) 2026 Ovolsan
// Это свободная программа: её можно распространять и изменять на условиях GNU General Public License
// версии 3, опубликованной Free Software Foundation. Программа распространяется без каких-либо гарантий.
// Полный текст лицензии — в файле LICENSE и на https://www.gnu.org/licenses/gpl-3.0.html

(function () {
    "use strict";

    const CHECKOUT_PATH = "/p/trade/confirm.html";
    const PENDING_TTL_MS = 3 * 60000;
    const RESUME_TTL_MS = 30 * 60000;

    const CONFIG = {
        // Адрес каждого центра купонов и начало пути, по которому скрипт узнаёт его страницу.
        couponCenters: {
            btn1: { url: "https://www.aliexpress.com/ssr/300001418/ewmfcxaSee?wh_pid=300001418%2FewmfcxaSee", pathPrefix: "/ssr/300001418/" },
            btn2: { url: "https://www.aliexpress.com/ssr/300003448/glo-coupon-center-8ymmrs", pathPrefix: "/ssr/300003448/glo-coupon-center-8ymmrs" }
        },
        couponSettings: {
            clickPauseMinMs: 900,
            clickPauseMaxMs: 2200,
            preClickMinMs: 350,
            preClickMaxMs: 800,
            batchSizeMin: 10,
            batchSizeMax: 20,
            batchPauseMinMs: 3000,
            batchPauseMaxMs: 7000,
            scrollPauseMinMs: 1200,
            scrollPauseMaxMs: 2800,
            scrollStepMin: 0.35,
            scrollStepMax: 0.75,
            longPauseEveryMin: 60,
            longPauseEveryMax: 80,
            longPauseMinMs: 30000,
            longPauseMaxMs: 60000,
            stopOnCaptcha: true
        },
        saleCollector: {
            runWindowMs: 20000,
            applyResponseTimeoutMs: 3500,
            maxConsecutiveFailures: 3,
            myCouponsUrl: "https://www.aliexpress.com/p/coupon-package/index.html",
            // Список по умолчанию; свой список задаётся в окне «Актуальные промокоды» и сохраняется.
            defaultCodes: ["UAD1103", "UAD1104", "UAD1106", "UAD1111", "UAD1119", "UAD1133", "UAD1155", "UAD1185", "UAD1190", "UAD11120"]
        }
    };

    // ---------------------------------------------------------------------------
    // Общие помощники
    // ---------------------------------------------------------------------------
    // Список промокодов общий для окна «Актуальные промокоды» и панели таймера.
    function loadCodes() {
        const saved = GM_getValue("saleCodes", null);
        return Array.isArray(saved) ? saved : CONFIG.saleCollector.defaultCodes;
    }

    function saveCodes(codes) {
        GM_setValue("saleCodes", codes);
    }

    function whenBodyReady(fn) {
        if (document.body) fn();
        else document.addEventListener("DOMContentLoaded", fn, { once: true });
    }

    function whenPageLoaded(fn) {
        if (document.readyState === "complete") return fn();
        let done = false;
        const run = () => {
            if (done) return;
            done = true;
            fn();
        };
        window.addEventListener("load", run, { once: true });
        // Страница AliExpress может долго догружать сторонние ресурсы; не ждём их бесконечно.
        whenBodyReady(() => setTimeout(run, 15000));
    }

    function isVisible(el) {
        if (!el || !el.isConnected) return false;
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    }

    const normalizeLabel = value => String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();

    function makeDraggable(host, handle) {
        handle.addEventListener("pointerdown", event => {
            if (event.target.closest("button")) return;
            const bounds = host.getBoundingClientRect();
            const dx = event.clientX - bounds.left;
            const dy = event.clientY - bounds.top;
            // Окно могло быть отцентровано через transform; фиксируем его текущее место в пикселях.
            Object.assign(host.style, { left: `${bounds.left}px`, top: `${bounds.top}px`, right: "auto", bottom: "auto", transform: "none" });
            handle.setPointerCapture(event.pointerId);
            handle.onpointermove = e => {
                host.style.left = `${Math.max(0, Math.min(innerWidth - host.offsetWidth, e.clientX - dx))}px`;
                host.style.top = `${Math.max(0, Math.min(innerHeight - host.offsetHeight, e.clientY - dy))}px`;
            };
            handle.onpointerup = handle.onpointercancel = () => { handle.onpointermove = null; };
        });
    }

    // ---------------------------------------------------------------------------
    // Оформление в стиле HTML Note: тёмные графитовые панели, один синий акцент, никаких скруглений
    // ---------------------------------------------------------------------------
    const THEME_CSS = `
      :host{all:initial}
      *{box-sizing:border-box;border-radius:0}
      .panel{display:flex;flex-direction:column;max-height:calc(100vh - 32px);font:400 14px/1.4 "Segoe UI",Arial,sans-serif;color:#e6e6e9;background:#26282d;border:1px solid #3a3c42;box-shadow:0 20px 60px #000000aa}
      .head{display:flex;align-items:center;gap:8px;flex:none;height:38px;padding:0 4px 0 10px;background:#18191c;border-bottom:1px solid #2c2e33;cursor:move;touch-action:none;user-select:none}
      .grip{color:#9a9ba3;font-size:13px}
      .title{flex:1;font-weight:700;letter-spacing:.02em}
      .x{width:30px;height:30px;border:0;background:transparent;color:#9a9ba3;font:14px "Segoe UI",Arial,sans-serif;cursor:pointer}
      .x:hover{background:#2a2c31;color:#e6e6e9}
      .body{padding:14px 16px 16px;overflow:auto;scrollbar-color:#34363c transparent}
      .label{margin:16px 0 6px;color:#9a9ba3;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}
      .label:first-child{margin-top:0}
      .hint{margin:6px 0 0;color:#9a9ba3;font-size:12px;line-height:1.5}
      .stack{display:grid;gap:8px}
      .btn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;height:32px;padding:0 12px;border:1px solid #44464d;background:#2a2c31;color:#e6e6e9;font:400 12.5px/1 "Segoe UI",Arial,sans-serif;cursor:pointer;text-decoration:none;white-space:nowrap}
      .btn:hover{background:#33353b}
      .btn.primary{border-color:#5aa9ff;background:#5aa9ff;color:#0b1320;font-weight:600}
      .btn.primary:hover{filter:brightness(1.08)}
      .btn:disabled{opacity:.45;cursor:default;filter:none}
      .btn svg{flex:none}
      input,textarea{width:100%;padding:0 10px;border:1px solid #3a3c42;background:#16171a;color:#e6e6e9;font:400 14px/1.4 "Segoe UI",Arial,sans-serif}
      input{height:34px}
      textarea{display:block;height:180px;padding:8px 10px;resize:vertical;font:13px/1.6 Consolas,"Cascadia Mono",monospace}
      input:focus,textarea:focus{outline:2px solid #5aa9ff;outline-offset:-1px;border-color:transparent}
      button:focus-visible,a:focus-visible,li:focus-visible{outline:2px solid #5aa9ff;outline-offset:-2px}
      input:disabled,textarea:disabled{opacity:.45}
      [hidden]{display:none!important}
    `;

    // Иконки Lucide 0.500.0: линия 2px, скруглённые концы, цвет текста.
    const ICONS = {
        ticket: '<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v2"/><path d="M13 17v2"/><path d="M13 11v2"/>',
        list: '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/>',
        timer: '<line x1="10" x2="14" y1="2" y2="2"/><line x1="12" x2="15" y1="14" y2="11"/><circle cx="12" cy="14" r="8"/>',
        copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
        pencil: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
        check: '<path d="M20 6 9 17l-5-5"/>',
        play: '<polygon points="6 3 20 12 6 21 6 3"/>',
        pause: '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
        square: '<rect width="18" height="18" x="3" y="3" rx="2"/>'
    };
    const icon = (name, size = 16) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

    // Кнопка с иконкой и подписью; подпись вставляется как текст.
    function setButton(button, iconName, label) {
        button.innerHTML = iconName ? icon(iconName) : "";
        const span = document.createElement("span");
        span.textContent = label;
        button.append(span);
    }

    // Плавающее окно: шапка с ручкой ⠿ для перетаскивания и ✕, содержимое — в body.
    function createWindow({ id, title, style, css = "", onClose }) {
        document.getElementById(id)?.remove();
        const host = document.createElement("div");
        host.id = id;
        host.style.cssText = `position:fixed;z-index:2147483647;max-width:calc(100vw - 24px);${style}`;
        const root = host.attachShadow({ mode: "closed" });
        root.innerHTML = `<style>${THEME_CSS}${css}</style><section class="panel"><div class="head"><span class="grip" aria-hidden="true">⠿</span><span class="title"></span><button class="x" type="button" aria-label="Закрыть">✕</button></div><div class="body"></div></section>`;
        root.querySelector(".title").textContent = title;
        root.querySelector(".x").addEventListener("click", () => (onClose ? onClose() : host.remove()));
        makeDraggable(host, root.querySelector(".head"));
        document.documentElement.append(host);
        return { host, root, body: root.querySelector(".body") };
    }

    // Короткое сообщение о том, что произошло; цвет полоски слева — его статус.
    function showToast(message, kind = "success") {
        const stripe = { success: "#51cf66", warning: "#fcc419", danger: "#ff6b6b" }[kind];
        const host = document.createElement("div");
        host.style.cssText = "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;max-width:calc(100vw - 32px)";
        const root = host.attachShadow({ mode: "closed" });
        root.innerHTML = `<style>:host{all:initial}div{padding:10px 14px;border:1px solid #3a3c42;border-left:3px solid ${stripe};background:#26282d;color:#e6e6e9;font:400 14px/1.4 "Segoe UI",Arial,sans-serif;box-shadow:0 6px 20px #00000088}</style><div role="status"></div>`;
        root.querySelector("div").textContent = message;
        document.documentElement.append(host);
        setTimeout(() => host.remove(), 2600);
    }

    // ---------------------------------------------------------------------------
    // Центры купонов
    // ---------------------------------------------------------------------------
    // У каждой кнопки свой центр купонов: центр 2 не должен совпадать с центром 1 и наоборот.
    function isCouponCenterPage(key) {
        const center = CONFIG.couponCenters[key];
        return Boolean(center) && location.pathname.startsWith(center.pathPrefix);
    }

    function startCollecting(key) {
        if (isCouponCenterPage(key)) {
            collectCoupons();
            return;
        }
        // Новая вкладка запустит сбор сама, когда загрузится центр купонов.
        GM_setValue("pendingCollect", { key, at: Date.now() });
        GM_openInTab(CONFIG.couponCenters[key].url, { active: true, insert: true, setParent: true });
    }

    let collectorRunning = false;

    async function collectCoupons() {
        if (collectorRunning) return;
        collectorRunning = true;

        const t = {
            stopBtn: "Остановить сбор",
            closeBtn: "Закрыть",
            stoppedBtn: "Сбор остановлен",
            statusStart: "Начинаю осторожный сбор...",
            statusFound: "Найдено купонов",
            statusClicked: "Собрано",
            statusPause: "Пауза перед следующим пакетом",
            statusScroll: "Ищу купоны ниже...",
            statusCollecting: "Собираю купон",
            statusRetry: "Купон не отреагировал, пробую ещё раз",
            statusSkip: "Купон не собирается, пропускаю его",
            statusBottom: "Конец страницы, жду, не подгрузятся ли ещё купоны...",
            statusFinalCheck: "Финальная проверка: просматриваю страницу с начала...",
            statusResumed: "Продолжаю сбор...",
            statsNextPause: "До длинной паузы",
            statusSecurity: "Обнаружена проверка безопасности. Сбор остановлен.",
            statusLongPause: "Длинная пауза, чтобы AliExpress не заблокировал",
            statusResumeIn: "продолжение через",
            secondsShort: "с",
            statusUserPaused: "Пауза. Нажмите «Продолжить», чтобы собирать дальше.",
            pauseBtn: "Пауза",
            resumeBtn: "Продолжить",
            statsTime: "Время работы",
            statsCollected: "Собрано",
            statsVisible: "На экране",
            alertDone: "Сбор купонов завершён!\nВсего собрано: ",
            alertNone: "Кнопки получения купонов не найдены. Проверьте, что вы вошли в аккаунт AliExpress. Если язык сайта необычный, переключите его на English или русский и запустите ещё раз.",
            alertSecurity: "AliExpress показал проверку безопасности или CAPTCHA. Завершите её вручную и запустите сбор ещё раз."
        };

        const collectorConfig = CONFIG.couponSettings;

        // AliExpress переводит кнопку купона на язык сайта, поэтому ищем по всем известным подписям.
        const DEFAULT_BUTTON_LABELS = [
            "collect", "claim",
            "отримати", "забрати",
            "получить", "забрать",
            "odbierz", "pobierz", "zbierz",
            "erhalten", "abholen", "abrufen", "sammeln", "einsammeln",
            "obtener", "recoger", "conseguir", "coger",
            "obter", "coletar", "receber", "pegar",
            "obtenir", "récupérer", "recuperer", "collecter",
            "ottieni", "ottenere", "ritira", "raccogli",
            "verkrijgen", "ophalen", "verzamelen",
            "získat", "získať", "вземи", "obține",
            "받기", "受け取る", "احصل"
        ];
        const buttonLabels = new Set(DEFAULT_BUTTON_LABELS.map(normalizeLabel));

        let isStopped = false;
        let isPaused = false;
        let totalCollected = 0;
        let visibleCount = 0;
        let emptyScrollsAtBottom = 0;
        let batchRemaining = randomInt(collectorConfig.batchSizeMin, collectorConfig.batchSizeMax);
        const longPauseGap = () => Math.max(5, randomInt(collectorConfig.longPauseEveryMin, collectorConfig.longPauseEveryMax));
        let nextLongPauseAt = longPauseGap();
        // Клик, после которого «Получить» не сменилось на «Использовать», повторяется один раз полным набором
        // событий мыши, потом кнопка пропускается; иначе одна «мёртвая» кнопка нажималась бы бесконечно.
        const clickAttempts = new WeakMap();
        const MAX_CLICK_ATTEMPTS = 2;
        const startedAt = Date.now();

        if (!document.body) await new Promise(resolve => whenBodyReady(resolve));

        const ui = createWindow({
            id: "oali-collector",
            title: "Сбор купонов",
            style: "top:20px;right:20px;width:290px",
            css: `.status{margin:0 0 12px;font-weight:600;white-space:pre-line}
              .stats{display:grid;grid-template-columns:1fr auto;gap:4px 12px;margin:0 0 14px;padding:10px 12px;border:1px solid #2c2e33;background:#18191c;font-size:12.5px}
              .stats dt{color:#9a9ba3}.stats dd{margin:0;text-align:right;font-variant-numeric:tabular-nums}`,
            onClose: () => {
                finish(false);
                panel.remove();
            }
        });
        const panel = ui.host;
        ui.body.innerHTML = `<p class="status" aria-live="polite"></p><dl class="stats"></dl>
            <div class="stack"><button class="btn pause" type="button"></button><button class="btn stop" type="button"></button></div>`;
        const statusText = ui.body.querySelector(".status");
        const counterText = ui.body.querySelector(".stats");
        const pauseBtn = ui.body.querySelector(".pause");
        const stopBtn = ui.body.querySelector(".stop");
        setButton(pauseBtn, "pause", t.pauseBtn);
        setButton(stopBtn, "square", t.stopBtn);

        stopBtn.addEventListener("click", () => {
            if (isStopped) panel.remove();
            else finish(false);
        });
        pauseBtn.addEventListener("click", () => {
            if (isStopped) return;
            isPaused = !isPaused;
            setButton(pauseBtn, isPaused ? "play" : "pause", isPaused ? t.resumeBtn : t.pauseBtn);
            pauseBtn.classList.toggle("primary", isPaused);
            updateStatus(isPaused ? t.statusUserPaused : t.statusResumed);
        });

        function renderStats() {
            const seconds = Math.floor((Date.now() - startedAt) / 1000);
            const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
            const remainder = (seconds % 60).toString().padStart(2, "0");
            const rows = [
                [t.statsTime, `${minutes}:${remainder}`],
                [t.statsCollected, String(totalCollected)],
                [t.statsVisible, String(visibleCount)],
                [t.statsNextPause, String(Math.max(0, nextLongPauseAt - totalCollected))]
            ];
            counterText.replaceChildren(...rows.flatMap(([label, value]) => {
                const term = document.createElement("dt");
                term.textContent = label;
                const detail = document.createElement("dd");
                detail.textContent = value;
                return [term, detail];
            }));
        }

        function updateStatus(message) {
            statusText.innerText = message;
            renderStats();
        }

        const statsTimer = setInterval(renderStats, 1000);

        // Любое ожидание идёт через эту функцию: прерывается по «Стоп» и замирает, пока стоит пауза.
        async function sleep(ms) {
            let left = ms;
            while (left > 0 && !isStopped) {
                await new Promise(resolve => setTimeout(resolve, Math.min(250, left)));
                if (!isPaused) left -= 250;
            }
            while (isPaused && !isStopped) await new Promise(resolve => setTimeout(resolve, 250));
        }

        async function countdown(ms, label) {
            for (let s = Math.ceil(ms / 1000); s > 0 && !isStopped; s--) {
                if (!isPaused) updateStatus(`${label} — ${t.statusResumeIn} ${s} ${t.secondsShort}`);
                await sleep(1000);
            }
        }

        function randomInt(min, max) {
            const safeMin = Number.isFinite(Number(min)) ? Number(min) : 0;
            const safeMax = Number.isFinite(Number(max)) ? Number(max) : safeMin;
            const low = Math.min(safeMin, safeMax);
            const high = Math.max(safeMin, safeMax);
            return Math.floor(Math.random() * (high - low + 1)) + low;
        }

        function randomFloat(min, max) {
            const low = Math.min(Number(min), Number(max));
            const high = Math.max(Number(min), Number(max));
            return Math.random() * (high - low) + low;
        }

        function isElementVisible(el) {
            if (!isVisible(el)) return false;
            const rect = el.getBoundingClientRect();
            return rect.bottom > 0 && rect.top < window.innerHeight;
        }

        function hasTargetText(el) {
            return buttonLabels.has(normalizeLabel(el.textContent));
        }

        function detectSecurityCheck() {
            const challengeSelectors = [
                'iframe[src*="captcha" i]',
                '[id*="captcha" i]',
                '[class*="captcha" i]',
                '[id*="security-check" i]',
                '[class*="security-check" i]',
                '[id*="slider-verify" i]',
                '[class*="slider-verify" i]',
                '[id*="nc_1_" i]'
            ];
            if (challengeSelectors.some(selector => [...document.querySelectorAll(selector)].some(isElementVisible))) return true;

            const dialogs = [...document.querySelectorAll('[role="dialog"], [aria-modal="true"], [class*="dialog" i], [class*="modal" i]')]
                .filter(isElementVisible);
            const challengeText = /(captcha|security check|slide to verify|unusual traffic|verify your identity|перевірк[ау]|підтвердіть,? що ви|провер(ка|ьте))/i;
            return dialogs.some(dialog => challengeText.test(dialog.innerText || ""));
        }

        function findCollectButtons() {
            const collectBtns = [];
            for (const el of document.querySelectorAll("button, a, div, span")) {
                if (panel.contains(el)) continue;
                // Кнопка купона — элемент без вложенных тегов, иначе совпали бы и её контейнеры.
                if (el.children.length === 0 && (clickAttempts.get(el) || 0) < MAX_CLICK_ATTEMPTS && hasTargetText(el) && isElementVisible(el)) {
                    collectBtns.push(el);
                }
            }
            return collectBtns;
        }

        // Обычно прокручивается окно, но в некоторых раскладках AliExpress прокручивается внутренний контейнер.
        function getScroller() {
            const root = document.scrollingElement || document.documentElement;
            if (root.scrollHeight - root.clientHeight > 50 && getComputedStyle(document.body).overflowY !== "hidden") return root;
            let best = null;
            for (const el of document.querySelectorAll("div, main, section")) {
                if (panel.contains(el) || el.scrollHeight - el.clientHeight <= 50 || el.clientHeight < window.innerHeight * 0.4) continue;
                if (!/(auto|scroll|overlay)/.test(getComputedStyle(el).overflowY)) continue;
                if (!best || el.clientHeight > best.clientHeight) best = el;
            }
            return best || root;
        }

        // В фоновой вкладке плавная прокрутка не идёт, поэтому если страница не сдвинулась — прыгаем сразу.
        function scrollPage(top, absolute = false) {
            const scroller = getScroller();
            const start = scroller.scrollTop;
            const target = Math.max(0, absolute ? top : start + top);
            scroller.scrollTo({ top: target, behavior: "smooth" });
            setTimeout(() => {
                if (scroller.scrollTop === start && Math.round(target) !== Math.round(start)) scroller.scrollTo({ top: target });
            }, 600);
        }

        function scrollState() {
            const scroller = getScroller();
            return {
                top: scroller.scrollTop,
                height: scroller.scrollHeight,
                atBottom: scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 60
            };
        }

        async function carefulScrollTo(el) {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
            await sleep(randomInt(collectorConfig.preClickMinMs, collectorConfig.preClickMaxMs));
            if (!isElementVisible(el) && el.isConnected) {
                el.scrollIntoView({ block: "center" });
                await sleep(200);
            }
        }

        function dispatchMouseClick(el) {
            const rect = el.getBoundingClientRect();
            const init = { bubbles: true, cancelable: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, button: 0 };
            for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
                const EventType = type.startsWith("pointer") && typeof PointerEvent === "function" ? PointerEvent : MouseEvent;
                el.dispatchEvent(new EventType(type, init));
            }
        }

        async function pauseBetweenClicks() {
            await sleep(randomInt(collectorConfig.clickPauseMinMs, collectorConfig.clickPauseMaxMs));
        }

        async function pauseBetweenBatches() {
            await countdown(randomInt(collectorConfig.batchPauseMinMs, collectorConfig.batchPauseMaxMs), t.statusPause);
            batchRemaining = randomInt(collectorConfig.batchSizeMin, collectorConfig.batchSizeMax);
        }

        function finish(completed, message) {
            if (isStopped) return;
            isStopped = true;
            collectorRunning = false;
            clearInterval(statsTimer);
            pauseBtn.remove();
            setButton(stopBtn, null, t.closeBtn);
            updateStatus(message || (completed ? (totalCollected === 0 ? t.alertNone : `${t.alertDone}${totalCollected}`) : t.stoppedBtn));
            setTimeout(() => panel.remove(), 5000);
            if (completed) alert(totalCollected === 0 ? t.alertNone : `${t.alertDone}${totalCollected}`);
        }

        function stopForSecurity() {
            if (isStopped) return;
            isStopped = true;
            collectorRunning = false;
            clearInterval(statsTimer);
            pauseBtn.remove();
            setButton(stopBtn, null, t.closeBtn);
            updateStatus(t.statusSecurity);
            alert(t.alertSecurity);
        }

        updateStatus(t.statusStart);
        scrollPage(0, true);
        await sleep(randomInt(1800, 3200));

        while (!isStopped) {
            if (collectorConfig.stopOnCaptcha && detectSecurityCheck()) {
                stopForSecurity();
                break;
            }

            const buttons = findCollectButtons();
            visibleCount = buttons.length;
            renderStats();

            if (buttons.length > 0) {
                emptyScrollsAtBottom = 0;
                updateStatus(`${t.statusFound}: ${buttons.length}`);

                for (const [index, btn] of buttons.entries()) {
                    if (isStopped) break;

                    if (collectorConfig.stopOnCaptcha && detectSecurityCheck()) {
                        stopForSecurity();
                        break;
                    }

                    if (!hasTargetText(btn) || !isElementVisible(btn)) continue;

                    await carefulScrollTo(btn);
                    if (isStopped) break;
                    if (!hasTargetText(btn) || !isElementVisible(btn)) continue;

                    const attempt = (clickAttempts.get(btn) || 0) + 1;
                    updateStatus(attempt === 1 ? `${t.statusCollecting} ${index + 1}/${buttons.length}` : t.statusRetry);
                    clickAttempts.set(btn, attempt);
                    if (attempt === 1) btn.click();
                    else dispatchMouseClick(btn);
                    batchRemaining--;

                    await pauseBetweenClicks();

                    // Засчитывается, только если кнопка действительно изменилась (стала «Использовать» или перерисовалась).
                    if (!btn.isConnected || !hasTargetText(btn)) {
                        totalCollected++;
                        visibleCount = Math.max(0, visibleCount - 1);
                        updateStatus(`${t.statusClicked}: ${totalCollected}`);
                    } else if (attempt >= MAX_CLICK_ATTEMPTS) {
                        updateStatus(t.statusSkip);
                    }

                    if (totalCollected >= nextLongPauseAt && !isStopped) {
                        nextLongPauseAt = totalCollected + longPauseGap();
                        await countdown(randomInt(collectorConfig.longPauseMinMs, collectorConfig.longPauseMaxMs), t.statusLongPause);
                        batchRemaining = randomInt(collectorConfig.batchSizeMin, collectorConfig.batchSizeMax);
                    } else if (batchRemaining <= 0 && !isStopped) {
                        await pauseBetweenBatches();
                    }
                }
            } else {
                updateStatus(t.statusScroll);
                const before = scrollState();
                scrollPage(window.innerHeight * randomFloat(collectorConfig.scrollStepMin, collectorConfig.scrollStepMax));
                await sleep(randomInt(collectorConfig.scrollPauseMinMs, collectorConfig.scrollPauseMaxMs));
                const after = scrollState();
                // Список растёт при прокрутке; если снизу подгрузились купоны, это ещё не конец.
                const isAtBottom = after.height <= before.height && (after.top === before.top || after.atBottom);

                if (!isAtBottom) {
                    emptyScrollsAtBottom = 0;
                    continue;
                }

                emptyScrollsAtBottom++;
                updateStatus(t.statusBottom);
                scrollPage(-randomInt(250, 520));
                await sleep(randomInt(700, 1400));
                scrollPage(randomInt(260, 560));
                await sleep(randomInt(1400, 2600));

                if (emptyScrollsAtBottom >= 4) {
                    updateStatus(t.statusFinalCheck);
                    scrollPage(0, true);
                    await sleep(randomInt(1800, 3000));

                    let foundDuringFinalCheck = false;

                    while (!isStopped) {
                        if (collectorConfig.stopOnCaptcha && detectSecurityCheck()) {
                            stopForSecurity();
                            break;
                        }

                        if (findCollectButtons().length > 0) {
                            foundDuringFinalCheck = true;
                            emptyScrollsAtBottom = 0;
                            break;
                        }

                        const current = scrollState();
                        scrollPage(window.innerHeight * randomFloat(0.8, 0.9));
                        await sleep(randomInt(700, 1100));

                        const next = scrollState();
                        if (next.top === current.top || (next.atBottom && next.height <= current.height)) break;
                    }

                    if (!foundDuringFinalCheck && !isStopped) {
                        finish(true);
                        break;
                    }
                }
            }
        }
    }

    // ---------------------------------------------------------------------------
    // Актуальные промокоды
    // ---------------------------------------------------------------------------
    function showActualCodes() {
        const { body } = createWindow({
            id: "oali-codes-window",
            title: "Актуальные промокоды",
            style: "left:50%;top:80px;transform:translateX(-50%);width:300px",
            css: `ul{list-style:none;margin:0;padding:0;max-height:min(360px,calc(100vh - 320px));overflow:auto;border:1px solid #2c2e33;background:#18191c;scrollbar-color:#34363c transparent}
              li{display:flex;align-items:center;justify-content:space-between;gap:8px;height:34px;padding:0 10px 0 12px;border-top:1px solid #2c2e33;cursor:pointer}
              li:first-child{border-top:0}li:hover{background:#2a2c31}
              li code{font:14px Consolas,"Cascadia Mono",monospace;letter-spacing:.02em}
              li span{display:flex;color:#9a9ba3}li:hover span{color:#e6e6e9}
              .view .stack,.editor .stack{margin-top:14px}`
        });
        body.innerHTML = `<div class="view"><p class="label">Промокоды</p><ul></ul>
            <p class="hint tip">Нажмите на код, чтобы скопировать его.</p>
            <p class="hint empty">Список пуст. Нажмите «Изменить список», чтобы добавить коды.</p>
            <div class="stack"><button class="btn primary copy-all" type="button"></button><button class="btn edit" type="button"></button></div></div>
            <div class="editor" hidden><p class="label">Список промокодов</p><textarea spellcheck="false" aria-label="Промокоды, по одному на строку"></textarea>
            <p class="hint">Один код на строку. Можно вставить пост целиком: останутся только коды.</p>
            <div class="stack"><button class="btn primary save" type="button"></button><button class="btn cancel" type="button">Как было</button></div></div>`;

        const view = body.querySelector(".view");
        const editor = body.querySelector(".editor");
        const list = body.querySelector("ul");
        const tip = body.querySelector(".tip");
        const empty = body.querySelector(".empty");
        const copyAll = body.querySelector(".copy-all");
        const textarea = body.querySelector("textarea");
        setButton(copyAll, "copy", "Скопировать все");
        setButton(body.querySelector(".edit"), "pencil", "Изменить список");
        setButton(body.querySelector(".save"), "check", "Сохранить");

        function renderList() {
            const codes = loadCodes();
            list.hidden = tip.hidden = !codes.length;
            empty.hidden = codes.length > 0;
            copyAll.disabled = !codes.length;
            list.replaceChildren(...codes.map(code => {
                const item = document.createElement("li");
                item.tabIndex = 0;
                item.title = "Скопировать";
                const codeEl = document.createElement("code");
                codeEl.textContent = code;
                const mark = document.createElement("span");
                mark.innerHTML = icon("copy", 14);
                item.append(codeEl, mark);
                const copy = () => {
                    GM_setClipboard(code, "text");
                    showToast(`Скопировано: ${code}`);
                };
                item.addEventListener("click", copy);
                item.addEventListener("keydown", event => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    copy();
                });
                return item;
            }));
        }
        renderList();

        copyAll.addEventListener("click", () => {
            const codes = loadCodes();
            GM_setClipboard(codes.join("\n"), "text");
            showToast(`Скопировано кодов: ${codes.length}`);
        });
        body.querySelector(".edit").addEventListener("click", () => {
            textarea.value = loadCodes().join("\n");
            view.hidden = true;
            editor.hidden = false;
            textarea.focus();
        });
        attachCodePaste(textarea);
        body.querySelector(".save").addEventListener("click", () => {
            const codes = splitCodes(textarea.value);
            saveCodes(codes);
            showToast(`Сохранено кодов: ${codes.length}`);
            editor.hidden = true;
            view.hidden = false;
            renderList();
        });
        body.querySelector(".cancel").addEventListener("click", () => {
            editor.hidden = true;
            view.hidden = false;
        });
    }

    // ---------------------------------------------------------------------------
    // Промокоды по таймеру: перехват ответа оформления заказа
    // ---------------------------------------------------------------------------
    const RESULT_EVENT = "oali-sale-api-result";
    const isAdjustOrderUrl = url => String(url || "").toLowerCase().includes("mtop.aliexpress.checkout.adjustorder");

    // Выполняется в контексте страницы: передаёт текст ответа adjustOrder в userscript через событие.
    function pageObserver(eventName) {
        if (window.__oaliSaleResponseObserverInstalled) return;
        window.__oaliSaleResponseObserverInstalled = true;
        const isAdjust = url => String(url || "").toLowerCase().includes("mtop.aliexpress.checkout.adjustorder");
        const publish = text => window.dispatchEvent(new CustomEvent(eventName, { detail: String(text ?? "") }));

        const originalFetch = window.fetch;
        window.fetch = async function (...args) {
            const response = await originalFetch.apply(this, args);
            if (isAdjust(args[0] instanceof Request ? args[0].url : args[0])) {
                response.clone().text().then(publish).catch(() => {});
            }
            return response;
        };
        const originalOpen = XMLHttpRequest.prototype.open;
        const originalSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function (method, url, ...rest) {
            this.__oaliSaleAdjustOrder = isAdjust(url);
            return originalOpen.call(this, method, url, ...rest);
        };
        XMLHttpRequest.prototype.send = function (...args) {
            if (this.__oaliSaleAdjustOrder) this.addEventListener("loadend", () => publish(this.responseText), { once: true });
            return originalSend.apply(this, args);
        };
    }

    // Запасной путь, если политика безопасности страницы не дала выполнить встроенный <script>.
    function patchPageDirectly() {
        const w = unsafeWindow;
        const expose = fn => (typeof exportFunction === "function" ? exportFunction(fn, w) : fn);
        const publish = text => window.dispatchEvent(new CustomEvent(RESULT_EVENT, { detail: String(text ?? "") }));
        try {
            const proto = w.XMLHttpRequest.prototype;
            const originalOpen = proto.open;
            const originalSend = proto.send;
            proto.open = expose(function (method, url, ...rest) {
                this.__oaliSaleAdjustOrder = isAdjustOrderUrl(url);
                return originalOpen.call(this, method, url, ...rest);
            });
            proto.send = expose(function (...args) {
                if (this.__oaliSaleAdjustOrder) {
                    const xhr = this;
                    xhr.addEventListener("loadend", expose(() => publish(xhr.responseText)), { once: true });
                }
                return originalSend.apply(this, args);
            });
            const originalFetch = w.fetch;
            w.fetch = expose(function (...args) {
                const promise = originalFetch.apply(this, args);
                const input = args[0];
                const url = typeof input === "string" ? input : (input && input.url) || String(input || "");
                if (isAdjustOrderUrl(url)) promise.then(response => response.clone().text()).then(publish, () => {});
                return promise;
            });
            w.__oaliSaleResponseObserverInstalled = true;
        } catch (error) {
            console.warn("[O Aliexpress] Не удалось перехватить ответы оформления заказа", error);
        }
    }

    function installPageObserver() {
        try {
            const script = document.createElement("script");
            script.textContent = `(${pageObserver})(${JSON.stringify(RESULT_EVENT)});`;
            (document.head || document.documentElement).appendChild(script);
            script.remove();
        } catch (_) {}
        let installed = false;
        try { installed = Boolean(unsafeWindow.__oaliSaleResponseObserverInstalled); } catch (_) {}
        if (!installed) patchPageDirectly();
    }

    function findCouponOutcome(value) {
        if (!value || typeof value !== "object") return null;
        if (value.promoCodeApplyRetVO && typeof value.promoCodeApplyRetVO === "object") return value.promoCodeApplyRetVO;
        for (const child of Object.values(value)) {
            const found = findCouponOutcome(child);
            if (found) return found;
        }
        return null;
    }

    const RESULT_LABELS = {
        applied: "Промокод применён",
        already_applied: "Уже применено",
        exhausted: "Лимит купонов исчерпан",
        unavailable: "Промокод сейчас недоступен",
        rejected: "Промокод не применён",
        token_expired: "Срок сессии истёк",
        request_failed: "Запрос не выполнен",
        cancelled: "Остановлено",
        captcha: "Нужна CAPTCHA",
        no_response: "Нет ответа от страницы",
        unreadable: "Не удалось прочитать ответ",
        unknown: "Результат требует проверки"
    };

    // Разбирает ответ adjustOrder; данные заказа и сессии нигде не сохраняются.
    function parseSaleResult(rawText) {
        let payload;
        try {
            payload = JSON.parse(rawText);
        } catch (_) {
            return { state: "unreadable" };
        }
        const ret = Array.isArray(payload?.ret) ? payload.ret : [];
        if (ret.some(value => /^FAIL_SYS_TOKEN_EX(?:OIRED|PIRED)(?:::|$)/.test(String(value)))) return { state: "token_expired" };
        // Антибот mtop: проверка слайдером и страница «слишком много запросов».
        if (ret.some(value => /^(?:FAIL_SYS_USER_VALIDATE|RGV587_ERROR)(?:::|$)/.test(String(value)))) return { state: "captcha" };
        if (!ret.some(value => String(value).startsWith("SUCCESS::")) || ret.some(value => String(value).startsWith("FAIL"))) {
            return { state: "request_failed" };
        }
        const result = findCouponOutcome(payload);
        if (!result) return { state: "unknown" };
        const tip = typeof result.promoTip === "string" ? result.promoTip.trim() : "";
        if (result.usePromoCodeStatus === "Success") {
            return { state: /already applied this coupon code/i.test(tip) ? "already_applied" : "applied" };
        }
        if (result.usePromoCodeStatus === "Failed") {
            if (/used up by other shoppers/i.test(tip)) return { state: "exhausted" };
            if (/coupon code is now unavailable/i.test(tip)) return { state: "unavailable" };
            return { state: "rejected" };
        }
        return { state: "unknown" };
    }

    // Достаёт промокоды из вставленного поста канала: «$3/$15 (20.00%) → UAD1103» → UAD1103.
    const CODE_ARROWS = /→|➜|➔|➡️?|⇒|=>|->/;
    function looksLikeCode(token) {
        if (!/^[A-Za-z0-9]{4,40}$/.test(token)) return false;
        if (!/[A-Za-z]/.test(token)) return false;
        return /\d/.test(token) || (token.match(/[A-Z]/g) || []).length >= 2;
    }
    function extractPromoCodes(text) {
        const seen = new Set();
        const codes = [];
        for (const line of String(text ?? "").split(/\r?\n/)) {
            const segment = line.split(CODE_ARROWS).pop();
            for (const raw of segment.split(/[\s,;|]+/)) {
                const token = raw.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");
                if (!looksLikeCode(token) || seen.has(token)) continue;
                seen.add(token);
                codes.push(token);
            }
        }
        return codes;
    }
    function isPlainCodeList(text) {
        const lines = String(text ?? "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
        return lines.length > 0 && lines.every(line => /^[A-Za-z0-9]{3,40}$/.test(line));
    }

    const splitCodes = value => [...new Set(String(value ?? "").split(/\r?\n/).map(line => line.trim()).filter(Boolean))];

    // Вставка целого поста из канала оставляет только коды, по одному на строку.
    // Если вставляется уже готовый список или кодов не нашлось, вставка идёт как обычно.
    function attachCodePaste(field) {
        field.addEventListener("paste", event => {
            const pasted = event.clipboardData?.getData("text") || "";
            if (isPlainCodeList(pasted)) return;
            const codes = extractPromoCodes(pasted);
            if (!codes.length) return;
            event.preventDefault();
            const before = field.value.slice(0, field.selectionStart);
            const after = field.value.slice(field.selectionEnd);
            const lead = before && !before.endsWith("\n") ? "\n" : "";
            const trail = after && !after.startsWith("\n") ? "\n" : "";
            const insert = lead + codes.join("\n") + trail;
            // insertText сохраняет историю отмены и сам вызывает событие input.
            if (!document.execCommand("insertText", false, insert)) {
                field.setRangeText(insert, field.selectionStart, field.selectionEnd, "end");
                field.dispatchEvent(new Event("input", { bubbles: true }));
            }
        });
    }

    const SALE_TAB_FLAG = "oaliSalePanelOpen";
    const sessionFlag = {
        get: () => { try { return sessionStorage.getItem(SALE_TAB_FLAG) === "1"; } catch (_) { return false; } },
        set: on => { try { on ? sessionStorage.setItem(SALE_TAB_FLAG, "1") : sessionStorage.removeItem(SALE_TAB_FLAG); } catch (_) {} }
    };

    async function openSaleTimer() {
        const path = location.pathname;
        if (path === CHECKOUT_PATH) {
            openSalePanel();
            return;
        }
        if (path.startsWith("/item/")) {
            GM_setValue("saleOpenPanel", Date.now());
            clickBuyNow();
            return;
        }
        alert("Откройте страницу товара AliExpress или страницу оформления заказа.");
    }

    // На странице товара нажимает «Купить сейчас», чтобы попасть на оформление заказа.
    function clickBuyNow() {
        const isBuyNow = element => /^(buy now|купити зараз|купить сейчас|jetzt kaufen|kup teraz|koupit (?:ihned|nyní)|kúpiť teraz|cumpără acum|comprar ahora|comprar agora|acheter maintenant|acquista ora|nu kopen|купи сега|지금 구매|今すぐ購入|اشتر الآن)$/i.test(
            `${element.innerText || ""} ${element.getAttribute("aria-label") || ""}`.trim()
        );
        const tryNavigate = () => {
            const button = [...document.querySelectorAll("button, a, [role=button]")].find(element => isVisible(element) && isBuyNow(element));
            if (!button) return false;
            button.click();
            return true;
        };
        if (tryNavigate()) return;
        const deadline = Date.now() + 20000;
        const timer = setInterval(() => {
            if (tryNavigate()) {
                clearInterval(timer);
            } else if (Date.now() >= deadline) {
                clearInterval(timer);
                GM_deleteValue("saleOpenPanel");
                alert("Не найдена кнопка «Купить сейчас». Выберите вариант товара и попробуйте ещё раз или перейдите к оформлению заказа вручную.");
            }
        }, 400);
    }

    async function openSalePanel() {
        if (document.getElementById("oali-sale-panel")) return;
        const config = CONFIG.saleCollector;
        sessionFlag.set(true);

        const text = {
            hours: "Часы", minutes: "Минуты", seconds: "Секунды", start: "Запланировать старт", stop: "Остановить", startNow: "Запустить сейчас",
            untilStart: "До старта", currentTime: "Текущее время", syncingTime: "Сверяю время с сервером AliExpress…",
            timeSynced: "Время сверено с сервером AliExpress", timeFallback: "Сверить время не удалось; используется время компьютера",
            codeHint: "Один код на строку. Список общий с окном «Актуальные промокоды».",
            captchaWarning: "Не вводите слишком много промокодов: AliExpress может показать CAPTCHA, которую нужно будет пройти вручную.",
            tabHint: "Не сворачивайте и не уводите эту вкладку в фон до старта: в фоне браузер замедляет таймеры.",
            ready: "Готово к запуску.", myCoupons: "Мои купоны", running: "Запуск выполняется",
            lookingForField: "Ищу поле промокода…", noCodes: "Введите хотя бы один промокод.", applying: "Применяю",
            noControls: "Не найдено поле промокода или кнопка «Применить». Откройте раздел промокодов и повторите.",
            completed: "Попытки завершены. Проверьте «Мои купоны» на странице AliExpress.", stopped: "Сбор остановлен.",
            captchaStop: "Запросы не выполняются: скорее всего, AliExpress просит пройти CAPTCHA. Пройдите её на странице и нажмите «Продолжить»: запуск пойдёт дальше с кода, на котором остановился.",
            resume: "Продолжить", resuming: "Продолжаю с кода",
            sessionExpired: "Сессия страницы устарела. Обновите страницу и запустите снова.",
            invalidTime: "Укажите часы от 0 до 23, минуты и секунды от 0 до 59.",
            scheduleHint: "Укажите время запуска.", scheduled: "Старт запланирован на"
        };

        const { host, root, body } = createWindow({
            id: "oali-sale-panel",
            title: "Промокоды по таймеру",
            style: "right:12px;top:120px;width:300px",
            css: `.row{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
              .row label{display:block;color:#9a9ba3;font-size:12.5px}
              .row input{margin-top:4px;text-align:center;font-variant-numeric:tabular-nums}
              .times{margin-top:10px}
              .clock{margin-top:12px;padding:10px 12px;border:1px solid #2c2e33;background:#18191c;font-variant-numeric:tabular-nums}
              #countdown{display:block;margin-top:2px;font-size:17px;font-weight:600}
              .results{list-style:none;margin:0;padding:0;max-height:170px;overflow-y:auto;overscroll-behavior:contain;border:1px solid #2c2e33;background:#18191c;font-size:12.5px;line-height:1.45}
              .results:empty{display:none}
              .results li{padding:6px 10px;border-top:1px solid #2c2e33;border-left:3px solid #3a3c42}
              .results li:first-child{border-top:0}
              .results .success{border-left-color:#51cf66}.results .warning{border-left-color:#fcc419}.results .error{border-left-color:#ff6b6b}
              #status{margin:8px 0 0;color:#c9cad1;font-size:12.5px;line-height:1.5}
              #my-coupons{margin-top:14px}`,
            onClose: () => closePanel()
        });
        body.innerHTML = `<p class="label">Время старта</p>
        <div class="row"><label><span data-t="hours"></span><input id="hours" type="number" min="0" max="23" value="0"></label><label><span data-t="minutes"></span><input id="minutes" type="number" min="0" max="59" value="0"></label><label><span data-t="seconds"></span><input id="seconds" type="number" min="0" max="59" value="0"></label></div>
        <div class="stack times"><button id="start" class="btn primary" type="button"></button><button id="start-now" class="btn" type="button"></button></div>
        <div class="clock"><div id="clock"></div><strong id="countdown"></strong><p id="zone" class="hint"></p></div>
        <p class="label">Промокоды</p><textarea spellcheck="false"></textarea>
        <p class="hint" data-t="codeHint"></p><p class="hint" data-t="captchaWarning"></p><p class="hint" data-t="tabHint"></p>
        <p class="label">Результаты</p><ul id="results" class="results" aria-live="polite"></ul><p id="status" data-t="ready"></p>
        <a id="my-coupons" class="btn" target="_blank" rel="noopener noreferrer"></a>`;
        for (const el of root.querySelectorAll("[data-t]")) el.textContent = text[el.dataset.t];
        root.getElementById("countdown").textContent = `${text.untilStart}: —`;

        const get = id => root.getElementById(id);
        setButton(get("start"), "timer", text.start);
        setButton(get("start-now"), "play", text.startNow);
        setButton(get("my-coupons"), null, `${text.myCoupons} ↗`);
        const codesField = root.querySelector("textarea");
        codesField.setAttribute("aria-label", text.codeHint);
        codesField.value = loadCodes().join("\n");
        get("my-coupons").href = config.myCouponsUrl;

        // Правки списка в панели сохраняются в тот же общий список, что и в окне «Актуальные промокоды».
        let saveCodesTimer = null;
        const currentCodes = () => codesField.value.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
        const persistUserCodes = () => saveCodes(currentCodes());
        codesField.addEventListener("input", () => {
            clearTimeout(saveCodesTimer);
            saveCodesTimer = setTimeout(persistUserCodes, 400);
            // После правки списка сохранённая точка остановки теряет смысл.
            if (resume && resume.key !== currentCodes().join(",")) setResume(null);
        });

        attachCodePaste(codesField);

        const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        get("zone").textContent = `${timeZone} · ${text.syncingTime}`;
        const responseTimeoutMs = Math.min(8000, Math.max(1000, Number(config.applyResponseTimeoutMs) || 3500));
        const runWindowMs = Math.min(60000, Math.max(5000, Number(config.runWindowMs) || 20000));
        let scheduledAt = null;
        let preciseTimer = null;
        let running = false;
        let cancelled = false;
        let pendingResponse = null;
        let runId = 0;
        let serverOffsetMs = 0;
        let timeSyncInFlight = null;

        const nowMs = () => Date.now() + serverOffsetMs;

        // Часы сверяются по заголовку Date в ответах самого AliExpress. В нём только целые секунды, поэтому
        // делается несколько запросов с шагом ~140 мс: каждый сужает окно, в котором может лежать поправка,
        // и пересечение этих окон даёт точность порядка задержки сети. Отдельный замер может выбиться
        // (сервер иногда отдаёт Date с запаздыванием), поэтому берётся участок, где сходится большинство окон.
        async function measureServerOffset() {
            const windows = [];
            for (let i = 0; i < 8; i++) {
                const sentAt = Date.now();
                const response = await fetch(`${location.origin}/?oali_time=${sentAt}`, { method: "HEAD", cache: "no-store", credentials: "omit" });
                const receivedAt = Date.now();
                const serverSecond = Date.parse(response.headers.get("date") || "");
                // Ответ из кэша (Age > 0) показывает время, когда его создали, а не текущее.
                if (Number.isFinite(serverSecond) && !Number(response.headers.get("age"))) {
                    windows.push([serverSecond - receivedAt, serverSecond + 1000 - sentAt]);
                }
                await new Promise(resolve => setTimeout(resolve, 140));
            }
            // Ищем участок, который покрывает больше всего окон: начало окна +1, конец −1.
            const points = windows.flatMap(([low, high]) => [[low, 1], [high, -1]])
                .sort((a, b) => a[0] - b[0] || b[1] - a[1]);
            let depth = 0, best = 0, bestLow = 0, bestHigh = 0;
            points.forEach(([value, step], i) => {
                depth += step;
                if (step === 1 && depth > best) {
                    best = depth;
                    bestLow = value;
                    bestHigh = points[i + 1][0];
                }
            });
            if (best < 3 || best * 2 <= windows.length) throw new Error("Не удалось сверить время");
            return Math.round((bestLow + bestHigh) / 2);
        }

        async function syncTime() {
            if (timeSyncInFlight) return timeSyncInFlight;
            timeSyncInFlight = (async () => {
                try {
                    serverOffsetMs = await measureServerOffset();
                    get("zone").textContent = `${timeZone} · ${text.timeSynced}`;
                } catch (_) {
                    get("zone").textContent = `${timeZone} · ${text.timeFallback}`;
                } finally {
                    timeSyncInFlight = null;
                    tick();
                }
            })();
            return timeSyncInFlight;
        }

        const addLine = (message, className) => {
            const item = document.createElement("li");
            item.className = className;
            item.textContent = message;
            const results = get("results");
            results.appendChild(item);
            results.scrollTop = results.scrollHeight;
        };
        const addResult = (code, result) => {
            const state = result?.state || "unknown";
            const className = ["applied", "already_applied"].includes(state) ? "success" : ["unavailable", "exhausted"].includes(state) ? "warning" : "error";
            addLine(`${code}: ${RESULT_LABELS[state] || RESULT_LABELS.unknown}`, className);
        };
        const addNote = (message, className = "error") => addLine(message, className);

        // Где запуск остановился на CAPTCHA, чтобы «Продолжить» пошло с этого кода. Хранится 30 минут
        // и только для того же списка кодов; запуск по расписанию всегда начинается сначала.
        let resume = null;
        const setResume = (next, persist = true) => {
            resume = next;
            if (persist) {
                if (next) GM_setValue("saleResume", next);
                else GM_deleteValue("saleResume");
            }
            if (!codesField.disabled) setButton(get("start-now"), "play", next ? text.resume : text.startNow);
        };
        const setControlsDisabled = value => {
            for (const field of [get("hours"), get("minutes"), get("seconds"), codesField, get("start-now")]) field.disabled = value;
            setButton(get("start"), value ? "square" : "timer", value ? text.stop : text.start);
            setButton(get("start-now"), "play", resume && !value ? text.resume : text.startNow);
        };

        const CAPTCHA_SELECTOR = 'iframe[src*="captcha" i], [id*="captcha" i]:not(.grecaptcha-badge), [class*="captcha" i]:not(.grecaptcha-badge), [id*="slider-verify" i], [class*="slider-verify" i], [id*="nc_1_" i]';
        const securityCheckVisible = () => [...document.querySelectorAll(CAPTCHA_SELECTOR)].some(isVisible);
        const FAILURE_STATES = ["request_failed", "no_response", "captcha"];
        const failureLimit = Math.min(5, Math.max(2, Math.round(Number(config.maxConsecutiveFailures)) || 3));

        const clearSchedule = () => {
            scheduledAt = null;
            clearTimeout(preciseTimer);
            preciseTimer = null;
        };
        const reset = message => {
            clearSchedule();
            running = false;
            if (pendingResponse) pendingResponse({ state: "cancelled" });
            pendingResponse = null;
            setControlsDisabled(false);
            if (message) get("status").textContent = message;
        };

        function tick() {
            get("clock").textContent = `${text.currentTime}: ${new Date(nowMs()).toLocaleTimeString("ru-RU")}`;
            if (scheduledAt === null || running) return;
            const left = scheduledAt - nowMs();
            get("countdown").textContent = `${text.untilStart}: ${Math.max(0, Math.ceil(left / 1000))} с`;
            if (left <= 0) {
                runCodes(true);
            } else if (left <= 1500 && !preciseTimer) {
                // Последние полторы секунды — точный таймер, а не опрос каждые 200 мс.
                preciseTimer = setTimeout(() => {
                    preciseTimer = null;
                    if (scheduledAt !== null && !running) runCodes(true);
                }, left);
            }
        }
        const statsTimer = setInterval(tick, 200);
        const timeSyncTimer = setInterval(() => { if (!running) syncTime(); }, 10 * 60000);
        tick();
        syncTime();

        // AliExpress показывает подписи на языке сайта, поэтому ищем по известным переводам.
        const buildLabelSet = labels => new Set(labels.map(normalizeLabel));
        const matchesLabel = (set, value) => set.has(normalizeLabel(value));
        const APPLY_LABEL_SET = buildLabelSet([
            "apply", "застосувати", "применить",
            "anwenden", "zastosuj", "použít", "použiť", "aplică", "aplicar",
            "appliquer", "confirmer", "applica", "toepassen", "приложи",
            "적용", "適用", "تطبيق"
        ]);
        const PROMO_LABEL_SET = buildLabelSet([
            "promo code", "promo codes", "промокод", "промокоди", "промо-код", "промокоды",
            "aktions-codes", "aktionscode", "aktionscodes",
            "promo-code", "promo-codes", "gutscheincode", "gutscheincodes",
            "kod promocyjny", "kody promocyjne", "promo kód", "promo kódy",
            "cod promoțional", "coduri promoționale", "código promocional", "códigos promocionales",
            "códigos promocionais", "code promo", "codes promo",
            "codice promozionale", "codici promozionali", "promotiecode", "promotiecodes",
            "промо код", "промо кодове",
            "프로모 코드", "프로모코드", "プロモコード", "الرموز الترويجية", "كود الخصم"
        ]);
        const ENTER_LABEL_SET = buildLabelSet([
            "enter", "ввести", "вказати", "указать",
            "hier code eingeben", "введіть код", "введите код",
            "eingeben", "wprowadź", "zadat", "zadať", "introdu",
            "introducir", "ingresar", "inserir", "saisir", "entrer le code ici", "inserisci", "invoeren", "въведи",
            "입력", "入力", "إدخال"
        ]);

        // Классы и aria-label поля промокода на странице оформления всегда английские, поэтому сначала ищем по ним.
        function findPromoControlsBySelector() {
            const input = [...document.querySelectorAll('input[aria-label="coupon code input"], input.pl-promoCode-input')].find(isVisible);
            const applyButton = [...document.querySelectorAll('button.pl-promoCode-input-button, [class*="promoCode-input-button"]')].find(isVisible);
            if (!input || !applyButton) return null;
            return { input, applyButton };
        }
        function findPromoControls() {
            const bySelector = findPromoControlsBySelector();
            if (bySelector) return bySelector;
            const inputs = [...document.querySelectorAll("input")].filter(input => isVisible(input) && !["checkbox", "radio", "hidden", "number"].includes(input.type));
            const applyButton = [...document.querySelectorAll("button, [role=button]")].find(button => isVisible(button) && matchesLabel(APPLY_LABEL_SET, `${button.innerText || ""} ${button.getAttribute("aria-label") || ""}`));
            if (!applyButton || !inputs.length) return null;
            const buttonRect = applyButton.getBoundingClientRect();
            const input = inputs.sort((a, b) => {
                const first = a.getBoundingClientRect(), second = b.getBoundingClientRect();
                const firstDistance = Math.abs(first.top - buttonRect.top) + Math.abs(first.right - buttonRect.left);
                const secondDistance = Math.abs(second.top - buttonRect.top) + Math.abs(second.right - buttonRect.left);
                return firstDistance - secondDistance;
            })[0];
            return { input, applyButton };
        }
        function openPromoCodes() {
            const promoLabel = [...document.querySelectorAll("div, span, p, h1, h2, h3, h4")]
                .find(element => isVisible(element) && matchesLabel(PROMO_LABEL_SET, element.innerText || ""));
            if (!promoLabel) return false;
            const labelRect = promoLabel.getBoundingClientRect();
            const enterControl = [...document.querySelectorAll("button, [role=button], a, div, span")]
                .filter(element => isVisible(element) && matchesLabel(ENTER_LABEL_SET, element.innerText || ""))
                .sort((first, second) => {
                    const firstRect = first.getBoundingClientRect(), secondRect = second.getBoundingClientRect();
                    return Math.abs(firstRect.top - labelRect.top) + Math.abs(firstRect.left - labelRect.right)
                        - Math.abs(secondRect.top - labelRect.top) - Math.abs(secondRect.left - labelRect.right);
                })[0];
            if (!enterControl) return false;
            enterControl.click();
            return true;
        }
        async function waitForPromoControls(deadline) {
            while (!cancelled && Date.now() < deadline) {
                const controls = findPromoControls();
                if (controls) return controls;
                openPromoCodes();
                await new Promise(resolve => setTimeout(resolve, 250));
            }
            return null;
        }
        // React следит за value через нативный сеттер, поэтому пишем значение через него.
        function fillInput(input, code) {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
            if (setter) setter.call(input, code);
            else input.value = code;
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
        }
        function waitForResult(timeoutMs) {
            return new Promise(resolve => {
                const timer = setTimeout(() => {
                    if (pendingResponse === complete) pendingResponse = null;
                    resolve({ state: "no_response" });
                }, timeoutMs);
                const complete = result => {
                    clearTimeout(timer);
                    if (pendingResponse === complete) pendingResponse = null;
                    resolve(result);
                };
                pendingResponse = complete;
            });
        }
        const onApiResult = event => {
            if (pendingResponse) pendingResponse(parseSaleResult(event.detail));
        };
        window.addEventListener(RESULT_EVENT, onApiResult);

        async function runCodes(fromSchedule = false) {
            if (running) return;
            const currentRun = ++runId;
            const codes = currentCodes();
            if (!codes.length) return reset(text.noCodes);
            clearTimeout(saveCodesTimer);
            persistUserCodes();
            const key = codes.join(",");
            const startIndex = !fromSchedule && resume && resume.key === key && resume.index < codes.length
                && Date.now() - resume.at < RESUME_TTL_MS ? resume.index : 0;
            setResume(null);
            running = true;
            clearSchedule();
            cancelled = false;
            if (startIndex === 0) get("results").replaceChildren();
            else addNote(`${text.resuming} ${codes[startIndex]} (${startIndex + 1}/${codes.length})`, "warning");
            get("countdown").textContent = text.running;
            get("status").textContent = text.lookingForField;
            const deadline = Date.now() + runWindowMs;
            let completionMessage = text.completed;
            let failedInRow = 0;
            let streakStart = startIndex;
            const stopForCaptcha = from => {
                addNote(text.captchaStop);
                completionMessage = text.captchaStop;
                if (from < codes.length) setResume({ key, index: from, at: Date.now() });
            };
            for (let index = startIndex; index < codes.length; index++) {
                const code = codes[index];
                if (cancelled || currentRun !== runId || Date.now() >= deadline) break;
                if (securityCheckVisible()) {
                    stopForCaptcha(failedInRow ? streakStart : index);
                    break;
                }
                let result = null, noControls = false;
                // Истёкший токен повторяется один раз для текущего кода: страница сама подпишет новый запрос.
                for (let attempt = 0; attempt < 2; attempt++) {
                    const controls = await waitForPromoControls(Math.min(deadline, Date.now() + 5000));
                    if (!controls) {
                        noControls = true;
                        break;
                    }
                    fillInput(controls.input, code);
                    get("status").textContent = `${text.applying} ${code}…`;
                    const response = waitForResult(Math.min(responseTimeoutMs, Math.max(1000, deadline - Date.now())));
                    controls.applyButton.click();
                    result = await response;
                    if (cancelled || currentRun !== runId) return;
                    if (result.state !== "token_expired" || Date.now() >= deadline) break;
                }
                if (noControls) {
                    completionMessage = text.noControls;
                    break;
                }
                addResult(code, result);
                if (result.state === "token_expired") {
                    completionMessage = text.sessionExpired;
                    break;
                }
                // CAPTCHA останавливает сразу; обычные ошибки — после нескольких подряд, чтобы не долбить сервер.
                if (FAILURE_STATES.includes(result.state)) {
                    if (!failedInRow) streakStart = index;
                    failedInRow++;
                } else {
                    failedInRow = 0;
                }
                if (result.state === "captcha" || failedInRow >= failureLimit) {
                    stopForCaptcha(streakStart);
                    break;
                }
                if (securityCheckVisible()) {
                    stopForCaptcha(failedInRow ? streakStart : index + 1);
                    break;
                }
            }
            if (currentRun !== runId) return;
            reset(cancelled ? text.stopped : completionMessage);
            cancelled = false;
        }

        get("start").onclick = () => {
            if (running || scheduledAt !== null) {
                cancelled = true;
                runId++;
                reset(text.stopped);
                return;
            }
            // Любое время, включая 00:00:00, — это запуск по расписанию; «Запустить сейчас» — отдельная кнопка.
            const fields = [get("hours"), get("minutes"), get("seconds")];
            if (fields.some(field => !field.validity.valid)) return reset(text.invalidTime);
            if (fields.some(field => field.value === "")) return reset(text.scheduleHint);
            const [hours, minutes, seconds] = fields.map(field => Number(field.value));
            const date = new Date(nowMs());
            date.setHours(hours, minutes, seconds, 0);
            if (date.getTime() <= nowMs()) date.setDate(date.getDate() + 1);
            scheduledAt = date.getTime();
            cancelled = false;
            setControlsDisabled(true);
            get("status").textContent = `${text.scheduled} ${date.toLocaleString("ru-RU")}.`;
            tick();
        };
        // Запускает сразу; после остановки на CAPTCHA называется «Продолжить» и идёт с того же кода.
        get("start-now").onclick = () => {
            if (running || scheduledAt !== null) return;
            cancelled = false;
            setControlsDisabled(true);
            runCodes();
        };
        function closePanel() {
            cancelled = true;
            runId++;
            reset();
            clearInterval(statsTimer);
            clearInterval(timeSyncTimer);
            window.removeEventListener(RESULT_EVENT, onApiResult);
            sessionFlag.set(false);
            host.remove();
        }

        // После CAPTCHA страница может перезагрузиться, поэтому точка остановки восстанавливается.
        const saved = GM_getValue("saleResume", null);
        if (saved) {
            const usable = Date.now() - saved.at < RESUME_TTL_MS && saved.key === currentCodes().join(",");
            if (usable && !running) setResume(saved, false);
            else GM_deleteValue("saleResume");
        }
    }

    // ---------------------------------------------------------------------------
    // Меню: плавающая кнопка и команды Tampermonkey
    // ---------------------------------------------------------------------------
    const ACTIONS = {
        btn1: { label: "Сбор купонов (центр купонов)", group: "Сбор купонов", icon: "ticket", run: () => startCollecting("btn1") },
        btn2: { label: "Сбор купонов 2", group: "Сбор купонов", icon: "ticket", run: () => startCollecting("btn2") },
        codes: { label: "Актуальные промокоды", group: "Промокоды", icon: "list", run: showActualCodes },
        sale: { label: "Промокоды по таймеру", group: "Промокоды", icon: "timer", run: openSaleTimer }
    };

    let launcherHost = null;

    function renderLauncher() {
        if (launcherHost) {
            launcherHost.remove();
            launcherHost = null;
        }
        if (GM_getValue("launcherHidden", false)) return;

        launcherHost = document.createElement("div");
        launcherHost.id = "oali-launcher";
        launcherHost.style.cssText = "position:fixed;left:16px;bottom:16px;z-index:2147483646";
        const root = launcherHost.attachShadow({ mode: "closed" });
        root.innerHTML = `<style>${THEME_CSS}
          .fab{display:flex;align-items:center;justify-content:center;width:40px;height:40px;border:1px solid #3a3c42;background:#26282d;color:#e6e6e9;cursor:pointer;box-shadow:0 6px 20px #00000088}
          .fab:hover{background:#2a2c31}
          .fab[aria-expanded="true"]{background:#2b3b52;color:#cfe4ff}
          .menu{position:absolute;left:0;bottom:48px;width:270px}
          .head{cursor:default}
          .brand{flex:1;color:#5aa9ff;font-weight:700;letter-spacing:.02em}
          .item{justify-content:flex-start}
        </style><section class="panel menu" hidden><div class="head"><span class="brand">O Aliexpress</span><button class="x" type="button" aria-label="Закрыть меню">✕</button></div><div class="body"></div></section>
        <button class="fab" type="button" title="O Aliexpress" aria-label="Меню O Aliexpress" aria-expanded="false"></button>`;

        const menu = root.querySelector(".menu");
        const fab = root.querySelector(".fab");
        fab.innerHTML = icon("ticket", 20);
        const setOpen = open => {
            menu.hidden = !open;
            fab.setAttribute("aria-expanded", String(open));
        };

        // Пункты собраны в разделы с подписью, как панели HTML Note.
        const body = root.querySelector(".body");
        let group = null;
        let stack = null;
        for (const action of Object.values(ACTIONS)) {
            if (action.group !== group) {
                group = action.group;
                const label = document.createElement("p");
                label.className = "label";
                label.textContent = group;
                stack = document.createElement("div");
                stack.className = "stack";
                body.append(label, stack);
            }
            const button = document.createElement("button");
            button.type = "button";
            button.className = "btn item";
            setButton(button, action.icon, action.label);
            button.addEventListener("click", () => {
                setOpen(false);
                action.run();
            });
            stack.append(button);
        }
        fab.addEventListener("click", () => setOpen(menu.hidden));
        root.querySelector(".x").addEventListener("click", () => setOpen(false));
        menu.addEventListener("keydown", event => {
            if (event.key === "Escape") setOpen(false);
        });
        document.documentElement.append(launcherHost);
    }

    for (const action of Object.values(ACTIONS)) GM_registerMenuCommand(action.label, action.run);
    GM_registerMenuCommand("Показать / скрыть плавающую кнопку", () => {
        GM_setValue("launcherHidden", !GM_getValue("launcherHidden", false));
        renderLauncher();
    });

    // ---------------------------------------------------------------------------
    // Запуск на странице
    // ---------------------------------------------------------------------------
    const isCheckout = location.pathname === CHECKOUT_PATH;

    // Перехват нужен до того, как страница оформления начнёт свои запросы.
    if (isCheckout) installPageObserver();

    whenBodyReady(() => {
        renderLauncher();

        // Сбор, запрошенный из другой вкладки, стартует, когда загрузится нужный центр купонов.
        const pending = GM_getValue("pendingCollect", null);
        if (pending && Date.now() - pending.at < PENDING_TTL_MS && isCouponCenterPage(pending.key)) {
            GM_deleteValue("pendingCollect");
            whenPageLoaded(collectCoupons);
        }

        if (isCheckout) {
            const requestedAt = Number(GM_getValue("saleOpenPanel", 0));
            const requested = requestedAt && Date.now() - requestedAt < PENDING_TTL_MS;
            if (requested) GM_deleteValue("saleOpenPanel");
            // Панель возвращается и после перезагрузки страницы оформления в этой же вкладке (например, после CAPTCHA).
            if (requested || sessionFlag.get()) openSalePanel();
        }
    });
})();
