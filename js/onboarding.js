/**
 * 新手教學 (onboarding tour) — a lightweight spotlight+tooltip walkthrough of
 * the app's main tabs/controls. Steps only target elements that are always
 * present in the DOM (no live map-click / route-planned / feedback-modal
 * state), so the tour never depends on network calls or user data existing.
 */
(function () {
    const STEPS = [
        {
            tab: 0,
            target: null,
            title: '歡迎使用自行車安全地圖 🚴',
            text: '這個導覽會帶你快速認識主要功能，隨時可以按「跳過」離開。'
        },
        {
            tab: 0,
            before: () => document.getElementById('close-route-dropdown')?.click(),
            target: '#search-input',
            title: '搜尋地點',
            text: '輸入地點或地址後搜尋，會直接顯示那裡的友善等級評分。'
        },
        {
            tab: 0,
            target: '.avoid-toggle-row',
            title: '🛡️ 避開危險區域',
            text: '預設開啟：規劃路線時會自動避開事故熱點與低評分路段。'
        },
        {
            tab: 0,
            before: () => document.getElementById('search-input')?.click(),
            target: '#route-dropdown',
            title: '規劃路線',
            text: '點一下搜尋列會展開這裡：輸入起點／終點後按「規劃路線」。'
        },
        {
            tab: 0,
            before: () => document.getElementById('close-route-dropdown')?.click(),
            target: '#map-controls-container',
            title: '地圖圖層',
            text: '右上角可切換 YouBike 模式、YouBike 站點與自行車道圖層。'
        },
        {
            tab: 0,
            target: '#map',
            title: '點擊地圖評分',
            text: '在地圖上點一下任一位置，就能看到那條路的友善等級。'
        },
        {
            tab: 1,
            target: '#view-route .favorites-section',
            title: '⭐ 我的最愛',
            text: '在這裡管理常用地址；路線起訖點的輸入其實在最上方的搜尋列。'
        },
        {
            tab: 2,
            target: '#view-report .report-page h3',
            title: '🚩 回報問題',
            text: '發現路況異常嗎？在這裡回報，會即時顯示在地圖上給大家看到。'
        },
        {
            tab: 3,
            target: '#view-more .report-page h3',
            title: '更多設定',
            text: '這裡有友善等級圖例、清除快取，還有關於本 App 的說明——之後也可以隨時從這裡重新開始這個導覽。'
        },
        {
            tab: 3,
            target: null,
            title: '準備出發！',
            text: '教學結束了，祝你騎乘愉快 🚴‍♂️ 現在就去地圖上找一條友善的路線吧。'
        }
    ];

    let overlay = null;
    let stepIndex = 0;

    function switchTab(index) {
        const navItems = document.querySelectorAll('.nav-item');
        if (navItems[index] && !navItems[index].classList.contains('active')) {
            navItems[index].click();
        }
    }

    function build() {
        overlay = document.createElement('div');
        overlay.className = 'tour-overlay';
        overlay.innerHTML = `
            <div class="tour-spotlight" id="tour-spotlight"></div>
            <div class="tour-tooltip" id="tour-tooltip">
                <div class="tour-tooltip-title" id="tour-title"></div>
                <div class="tour-tooltip-text" id="tour-text"></div>
                <div class="tour-progress" id="tour-progress"></div>
                <div class="tour-tooltip-actions">
                    <button id="tour-skip" class="tour-btn tour-btn-ghost">跳過</button>
                    <div class="tour-tooltip-actions-right">
                        <button id="tour-prev" class="tour-btn tour-btn-ghost">上一步</button>
                        <button id="tour-next" class="tour-btn tour-btn-primary">下一步</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        overlay.querySelector('#tour-skip').addEventListener('click', endTour);
        overlay.querySelector('#tour-prev').addEventListener('click', () => goTo(stepIndex - 1));
        overlay.querySelector('#tour-next').addEventListener('click', () => {
            if (stepIndex >= STEPS.length - 1) {
                endTour();
            } else {
                goTo(stepIndex + 1);
            }
        });

        document.addEventListener('keydown', onKeydown);
    }

    function onKeydown(e) {
        if (e.key === 'Escape') endTour();
    }

    function goTo(index) {
        if (index < 0 || index >= STEPS.length) return;
        stepIndex = index;
        const step = STEPS[stepIndex];

        switchTab(step.tab);
        if (step.before) step.before();

        // Wait a tick so tab-switch / dropdown-toggle DOM changes are
        // reflected before measuring the target's position. setTimeout
        // (not requestAnimationFrame) so this still fires if the tab is
        // backgrounded/not compositing.
        setTimeout(() => render(step), 0);
    }

    function render(step) {
        if (!overlay) return; // tour was skipped/ended before this deferred render ran
        const spotlight = overlay.querySelector('#tour-spotlight');
        const tooltip = overlay.querySelector('#tour-tooltip');
        const titleEl = overlay.querySelector('#tour-title');
        const textEl = overlay.querySelector('#tour-text');
        const progressEl = overlay.querySelector('#tour-progress');
        const prevBtn = overlay.querySelector('#tour-prev');
        const nextBtn = overlay.querySelector('#tour-next');

        titleEl.textContent = step.title;
        textEl.textContent = step.text;
        progressEl.textContent = `${stepIndex + 1} / ${STEPS.length}`;
        prevBtn.style.visibility = stepIndex === 0 ? 'hidden' : 'visible';
        nextBtn.textContent = stepIndex === STEPS.length - 1 ? '完成' : '下一步';

        const targetEl = step.target ? document.querySelector(step.target) : null;

        if (targetEl) {
            const rect = targetEl.getBoundingClientRect();
            const pad = 6;
            spotlight.style.display = 'block';
            spotlight.style.top = (rect.top - pad) + 'px';
            spotlight.style.left = (rect.left - pad) + 'px';
            spotlight.style.width = (rect.width + pad * 2) + 'px';
            spotlight.style.height = (rect.height + pad * 2) + 'px';

            tooltip.classList.remove('tour-tooltip-center');
            tooltip.style.transform = 'none';

            const tooltipRect = tooltip.getBoundingClientRect();
            const spaceBelow = window.innerHeight - rect.bottom;
            let top;
            if (spaceBelow > tooltipRect.height + 24) {
                top = rect.bottom + 14;
            } else if (rect.top > tooltipRect.height + 24) {
                top = rect.top - tooltipRect.height - 14;
            } else {
                top = Math.max(12, (window.innerHeight - tooltipRect.height) / 2);
            }
            let left = rect.left + rect.width / 2 - tooltipRect.width / 2;
            left = Math.max(12, Math.min(left, window.innerWidth - tooltipRect.width - 12));

            tooltip.style.top = top + 'px';
            tooltip.style.left = left + 'px';
        } else {
            spotlight.style.display = 'none';
            tooltip.classList.add('tour-tooltip-center');
        }

        tooltip.classList.add('tour-visible');
    }

    function endTour() {
        document.removeEventListener('keydown', onKeydown);
        if (overlay) overlay.remove();
        overlay = null;
    }

    function startTour() {
        stepIndex = 0;
        build();
        goTo(0);
    }

    document.addEventListener('DOMContentLoaded', () => {
        const btn = document.getElementById('start-tour-btn');
        if (btn) btn.addEventListener('click', startTour);
    });
})();
