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
            titleKey: 'tour.step0.title',
            textKey: 'tour.step0.text'
        },
        {
            tab: 0,
            before: () => document.getElementById('close-route-dropdown')?.click(),
            target: '#search-input',
            titleKey: 'tour.step1.title',
            textKey: 'tour.step1.text'
        },
        {
            tab: 0,
            target: '.avoid-toggle-row',
            titleKey: 'tour.step2.title',
            textKey: 'tour.step2.text'
        },
        {
            tab: 0,
            before: () => document.getElementById('search-input')?.click(),
            target: '#route-dropdown',
            titleKey: 'tour.step3.title',
            textKey: 'tour.step3.text'
        },
        {
            tab: 0,
            before: () => document.getElementById('close-route-dropdown')?.click(),
            target: '#map-controls-container',
            titleKey: 'tour.step4.title',
            textKey: 'tour.step4.text'
        },
        {
            tab: 0,
            target: '#map',
            titleKey: 'tour.step5.title',
            textKey: 'tour.step5.text'
        },
        {
            tab: 1,
            target: '#view-route .favorites-section',
            titleKey: 'tour.step6.title',
            textKey: 'tour.step6.text'
        },
        {
            tab: 2,
            target: '#view-report .report-page h3',
            titleKey: 'tour.step7.title',
            textKey: 'tour.step7.text'
        },
        {
            tab: 3,
            target: '#view-more .report-page h3',
            titleKey: 'tour.step8.title',
            textKey: 'tour.step8.text'
        },
        {
            tab: 3,
            target: null,
            titleKey: 'tour.step9.title',
            textKey: 'tour.step9.text'
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
                    <button id="tour-skip" class="tour-btn tour-btn-ghost" data-i18n="common.skip"></button>
                    <div class="tour-tooltip-actions-right">
                        <button id="tour-prev" class="tour-btn tour-btn-ghost" data-i18n="common.prev"></button>
                        <button id="tour-next" class="tour-btn tour-btn-primary" data-i18n="common.next"></button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        I18N.apply(overlay);

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

        I18N.setText(titleEl, step.titleKey);
        I18N.setText(textEl, step.textKey);
        progressEl.textContent = `${stepIndex + 1} / ${STEPS.length}`;
        prevBtn.style.visibility = stepIndex === 0 ? 'hidden' : 'visible';
        I18N.setText(nextBtn, stepIndex === STEPS.length - 1 ? 'common.done' : 'common.next');

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

    // Text is already swapped by I18N.apply; re-render so the tooltip is
    // re-measured and re-positioned for the new text length.
    window.addEventListener('langchange', () => {
        if (overlay) render(STEPS[stepIndex]);
    });
})();
