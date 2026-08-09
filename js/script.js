document.addEventListener('DOMContentLoaded', () => {
    // Navigation Tab Switching Logic
    const navItems = document.querySelectorAll('.nav-item');
    const viewPanes = document.querySelectorAll('.view-pane');

    // Add active class to the first nav item initially
    if (navItems.length > 0) {
        navItems[0].classList.add('active');
    }

    navItems.forEach((item, index) => {
        item.addEventListener('click', () => {
            // Remove active class from all nav items and panes
            navItems.forEach(nav => nav.classList.remove('active'));
            viewPanes.forEach(pane => pane.classList.remove('active'));

            // Add active class to clicked nav item
            item.classList.add('active');

            // Show corresponding pane (Map = 0, Route = 1)
            // Show corresponding pane (Map = 0, Route = 1, Report = 2)
            if (index === 0 && document.getElementById('view-map')) {
                document.getElementById('view-map').classList.add('active');
            } else if (index === 1 && document.getElementById('view-route')) {
                document.getElementById('view-route').classList.add('active');
            } else if (index === 2 && document.getElementById('view-report')) {
                document.getElementById('view-report').classList.add('active');
            }
        });
    });

    // Report Issue Logic
    const submitReportBtn = document.getElementById('submit-report-btn');
    if (submitReportBtn) {
        submitReportBtn.addEventListener('click', async () => {
            const reportType = document.getElementById('report-type').value;
            const reportDesc = document.getElementById('report-desc').value;
            const reportLocation = document.getElementById('report-location').value;

            if (!reportType) {
                alert('請選擇問題類型！');
                return;
            }
            if (!reportDesc.trim()) {
                alert('請填寫問題描述！');
                return;
            }

            submitReportBtn.disabled = true;
            submitReportBtn.textContent = '送出中...';

            // Convert the location text to coordinates so the report can be shown on the map.
            // Aborts the submit if it cannot be resolved, so every stored report is mappable.
            let coords;
            try {
                coords = await resolveReportLocation(reportLocation);
            } catch (geoError) {
                console.warn('Location could not be resolved:', geoError);
                alert('無法定位回報地點，請點擊 📍 取得目前位置，或輸入正確的地址。');
                submitReportBtn.disabled = false;
                submitReportBtn.textContent = '送出回報';
                return;
            }

            try {
                await db.collection('reports').add({
                    type: reportType,
                    description: reportDesc,
                    location: reportLocation,           // original text, kept for reference
                    address: coords.address || '',      // formatted address when geocoded
                    lat: coords.lat,
                    lng: coords.lng,
                    timestamp: firebase.firestore.FieldValue.serverTimestamp(),
                    status: 'pending'
                });

                alert('回報已成功送出！感謝您協助改善騎乘環境。');

                // Clear form
                document.getElementById('report-type').value = '';
                document.getElementById('report-location').value = '';
                document.getElementById('report-desc').value = '';
                document.getElementById('report-photo').value = '';

                // Switch back to Map tab by clicking the first nav item
                if (navItems[0]) navItems[0].click();
            } catch (error) {
                console.error("Error submitting report:", error);
                alert('回報送出失敗，請稍後再試。');
            } finally {
                submitReportBtn.disabled = false;
                submitReportBtn.textContent = '送出回報';
            }
        });
    }

});


/**
 * Resolve a report-location text into coordinates for map display.
 * - "lat, lng" text (e.g. from the 📍 GPS button) is parsed directly.
 * - Any other text is geocoded via Google Maps.
 * @param {string} text - The location field value.
 * @returns {Promise<{lat:number, lng:number, address?:string}>}
 * @throws {Error} if coordinates cannot be resolved.
 */
function resolveReportLocation(text) {
    const raw = (text || '').trim();
    if (!raw) {
        throw new Error('地點為空');
    }

    // "25.0478, 121.5170" → parse directly, no API call.
    const coordMatch = raw.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (coordMatch) {
        const lat = parseFloat(coordMatch[1]);
        const lng = parseFloat(coordMatch[2]);
        if (!isNaN(lat) && !isNaN(lng)) {
            return Promise.resolve({ lat, lng });
        }
    }

    // Otherwise geocode the address.
    if (typeof google === 'undefined' || !google.maps || !google.maps.Geocoder) {
        throw new Error('地圖尚未載入，無法解析地址');
    }
    const geocoder = new google.maps.Geocoder();
    return new Promise((resolve, reject) => {
        geocoder.geocode({ address: raw }, (results, status) => {
            if (status === 'OK' && results[0]) {
                const loc = results[0].geometry.location;
                resolve({
                    lat: loc.lat(),
                    lng: loc.lng(),
                    address: results[0].formatted_address
                });
            } else {
                reject(new Error('無法解析此地址 (' + status + ')'));
            }
        });
    });
}

// ================================================================
// 騎乘回饋 Modal - UI Logic (Feedback Modal)
// ================================================================

// Current ratings state
let _feedbackRatings = { overall: 0 };

const _scoreLabels = {
    0: '尚未評分',
    1: '1★ 很差',
    2: '2★ 不佳',
    3: '3★ 普通',
    4: '4★ 良好',
    5: '5★ 非常好'
};

/**
 * Show the feedback modal
 * Called from routePlanner.clearRoute()
 */
function showFeedbackModal() {
    const modal = document.getElementById('feedback-modal');
    if (!modal) return;

    // Reset ratings
    _feedbackRatings = { overall: 0 };
    _resetStars();
    _resetToStageOne();

    modal.style.display = 'flex';
    console.log('📋 Feedback modal shown');
}

/**
 * Hide the feedback modal
 */
function hideFeedbackModal() {
    const modal = document.getElementById('feedback-modal');
    if (!modal) return;

    modal.style.display = 'none';
    console.log('📋 Feedback modal hidden');
}

/**
 * Reset all star selections and score texts
 */
function _resetStars() {
    document.querySelectorAll('.feedback-star').forEach(star => {
        star.classList.remove('active', 'hover-preview');
    });

    const overallText = document.getElementById('overall-score-text');

    if (overallText) {
        overallText.textContent = _scoreLabels[0];
        overallText.classList.remove('scored');
    }
}

/**
 * Set stars visual state for a given dimension
 */
function _setStars(dimension, value) {
    const container = document.querySelector(`.feedback-stars[data-dimension="${dimension}"]`);
    if (!container) return;

    container.querySelectorAll('.feedback-star').forEach(star => {
        const starVal = parseInt(star.dataset.value);
        if (starVal <= value) {
            star.classList.add('active');
        } else {
            star.classList.remove('active');
        }
    });

    // Update score text
    const textEl = document.getElementById(`${dimension}-score-text`);
    if (textEl) {
        textEl.textContent = _scoreLabels[value] || _scoreLabels[0];
        if (value > 0) {
            textEl.classList.add('scored');
        } else {
            textEl.classList.remove('scored');
        }
    }
}

/**
 * Render the route's road names as a checkable "which were bad?" list.
 */
function _renderRoadChecklist(roadNames) {
  const list = document.getElementById('feedback-road-list');
  if (!list) return;
  list.innerHTML = '';
  roadNames.forEach((name, i) => {
    const id = `bad-road-${i}`;
    const label = document.createElement('label');
    label.className = 'feedback-road-item';
    label.innerHTML = `<input type="checkbox" value="${name}" id="${id}"><span>${name}</span>`;
    list.appendChild(label);
  });
}

function _getCheckedBadRoads() {
  return Array.from(document.querySelectorAll('#feedback-road-list input:checked'))
    .map(el => el.value);
}

function _showRoadChecklist(show) {
  const box = document.getElementById('feedback-road-checklist');
  if (box) box.style.display = show ? 'block' : 'none';
}

/**
 * Collapse the submit flow back to stage 1 (checklist hidden, button label
 * reset). Used both when the modal first opens and whenever a star rating
 * changes after the checklist was already shown for a stale rating.
 */
function _resetToStageOne() {
  _showRoadChecklist(false);
  const submitBtn = document.getElementById('feedback-submit-btn');
  if (submitBtn) submitBtn.textContent = '送出回饋';
}

/**
 * Update a single stats-item's score text + progress-fill width/color.
 * Shared by updatePublicOpinionStat and updateFriendlinessBars so every
 * bar uses the same color banding (<60 red, <80 yellow, else green).
 * @param {number} index - 0=基礎設施, 1=交通環境風險, 2=歷史事故, 3=民眾意見
 * @param {number} score - 0-100 scale
 */
function _updateStatsBarAt(index, score) {
    const statsContainers = document.querySelectorAll('.stats');

    statsContainers.forEach(container => {
        const statItems = container.querySelectorAll('.stats-item');
        if (statItems.length <= index) return;

        const item = statItems[index];
        const scoreEl = item.querySelector('.score');
        const progressFill = item.querySelector('.progress-fill');

        if (scoreEl) {
            scoreEl.textContent = score;
        }

        if (progressFill) {
            const widthValue = Math.min(Math.max(score, 0), 100);
            progressFill.style.width = widthValue + '%';
            progressFill.style.transition = 'width 0.6s ease, background-color 0.6s ease';

            if (widthValue < 60) {
                progressFill.style.backgroundColor = '#dc3545';
            } else if (widthValue < 80) {
                progressFill.style.backgroundColor = '#ffc107';
            } else {
                progressFill.style.backgroundColor = '#28a745';
            }
        }
    });
}

/**
 * Update the "民眾意見" (Public Opinion) progress bar
 * This targets the 4th stats-item (index 3) in each .stats container
 * @param {number} score - 0-100 scale
 */
function updatePublicOpinionStat(score) {
    _updateStatsBarAt(3, score);
}

/**
 * Update 基礎設施 / 交通環境風險 / 歷史事故 / 民眾意見 together for the
 * currently selected route. Called once when a route is planned, and again
 * (risk + opinion held over, only risk changes) once the parallel
 * driving-mode traffic request resolves — see RoutePlanner._refineTrafficRisk.
 * @param {{infrastructure:number, risk:number, accident:number, opinion:number}} stats
 */
function updateFriendlinessBars(stats) {
    _updateStatsBarAt(0, stats.infrastructure);
    _updateStatsBarAt(1, stats.risk);
    _updateStatsBarAt(2, stats.accident);
    _updateStatsBarAt(3, stats.opinion);
}

/**
 * Set the ".header" destination label for the currently planned route.
 * @param {string} text
 */
function updateRouteHeader(text) {
    document.querySelectorAll('.header').forEach(el => {
        el.textContent = text || '';
    });
}

/**
 * Paint the 友善等級 (A-E) badge: letter into .level, background color onto
 * .safety-level. Thresholds/colors match the removed demo updateLevel().
 * @param {{letter:string, color:string}} grade
 */
function updateFriendlinessGrade(grade) {
    if (!grade) return;
    document.querySelectorAll('.level').forEach(el => {
        el.textContent = grade.letter;
    });
    document.querySelectorAll('.safety-level').forEach(el => {
        el.style.backgroundColor = grade.color;
    });
}

/**
 * Show a toast notification
 */
function showFeedbackToast(message) {
    // Remove any existing toast
    const existingToast = document.querySelector('.feedback-toast');
    if (existingToast) existingToast.remove();

    const toast = document.createElement('div');
    toast.className = 'feedback-toast';
    toast.textContent = message;
    document.body.appendChild(toast);

    // Auto-remove after animation
    setTimeout(() => {
        if (toast.parentNode) toast.remove();
    }, 2800);
}

// ================================================================
// Feedback Modal Event Bindings (runs on DOMContentLoaded)
// ================================================================
document.addEventListener('DOMContentLoaded', () => {

    // Star click and hover events
    document.querySelectorAll('.feedback-stars').forEach(container => {
        const dimension = container.dataset.dimension;
        const stars = container.querySelectorAll('.feedback-star');

        stars.forEach(star => {
            // Click to select
            star.addEventListener('click', () => {
                const value = parseInt(star.dataset.value);
                _feedbackRatings[dimension] = value;
                _setStars(dimension, value);
                // Changing the rating invalidates any checklist already shown for
                // the previous rating (stage 2) — collapse back to stage 1 so the
                // next submit click re-evaluates the new star count from scratch.
                _resetToStageOne();
            });

            // Hover preview
            star.addEventListener('mouseenter', () => {
                const value = parseInt(star.dataset.value);
                stars.forEach(s => {
                    const sVal = parseInt(s.dataset.value);
                    if (sVal <= value) {
                        s.classList.add('hover-preview');
                    } else {
                        s.classList.remove('hover-preview');
                    }
                });
            });

            star.addEventListener('mouseleave', () => {
                stars.forEach(s => s.classList.remove('hover-preview'));
            });
        });
    });

    // Submit button
    const submitBtn = document.getElementById('feedback-submit-btn');
    if (submitBtn) {
        submitBtn.addEventListener('click', async () => {
            const planner = window._routePlannerRef;
            // Full-marks gate: 5 stars = whole route is "all good" (every road
            // votes 1); fewer stars opens the checklist to flag the bad roads.
            const stars = _feedbackRatings.overall;
            // 第一次按：未滿星且尚未顯示清單 → 展開「哪幾條路不好」
            const checklistVisible =
                document.getElementById('feedback-road-checklist').style.display !== 'none';

            if (stars === 0) {
                alert('請先點選星數！');
                return;
            }

            if (stars < 5 && !checklistVisible) {
                const roads = planner ? planner.getRouteRoadNames() : [];
                if (roads.length === 0) {
                    // 無可辨識路名 → 無法逐路投票，直接結束
                    hideFeedbackModal();
                    if (planner) await planner.refreshRoadScores();
                    showFeedbackToast('✅ 感謝您的回饋！');
                    return;
                }
                _renderRoadChecklist(roads);
                _showRoadChecklist(true);
                submitBtn.textContent = '確認送出';
                return;
            }

            submitBtn.disabled = true;
            submitBtn.textContent = '送出中...';
            try {
                const roads = planner ? planner.getRouteRoadNames() : [];
                const bad = stars < 5 ? new Set(_getCheckedBadRoads()) : new Set();
                const votes = {};
                roads.forEach(name => { votes[name] = bad.has(name) ? 0 : 1; });

                if (Object.keys(votes).length > 0) {
                    await roadScoreDB.submitVotes(votes);
                }
                if (planner) await planner.refreshRoadScores();

                hideFeedbackModal();
                showFeedbackToast('✅ 感謝您的回饋！');
            } catch (error) {
                console.error('Failed to save road votes:', error);
                alert('回饋送出失敗，請稍後再試。');
            } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = '送出回饋';
            }
        });
    }

    // Skip button
    const skipBtn = document.getElementById('feedback-skip-btn');
    if (skipBtn) {
        skipBtn.addEventListener('click', () => {
            hideFeedbackModal();
            // Clear lastRoute reference so it won't trigger again
            if (window._routePlannerRef) {
                window._routePlannerRef.lastRoute = null;
                window._routePlannerRef.lastFinalResult = null;
            }
        });
    }

    // Click outside modal to close
    const modalOverlay = document.getElementById('feedback-modal');
    if (modalOverlay) {
        modalOverlay.addEventListener('click', (e) => {
            if (e.target === modalOverlay) {
                hideFeedbackModal();
            }
        });
    }

});

/**
 * Toggle the top-level loading overlay (spinner + label). Called around
 * multi-second operations (route planning) so the user gets a visible
 * "something is happening" cue instead of a frozen-looking map.
 */
function showLoadingSpinner(text) {
    const overlay = document.getElementById('loading-overlay');
    if (!overlay) return;
    if (text) {
        const label = overlay.querySelector('.loading-text');
        if (label) label.textContent = text;
    }
    overlay.classList.add('visible');
    overlay.setAttribute('aria-hidden', 'false');
}

function hideLoadingSpinner() {
    const overlay = document.getElementById('loading-overlay');
    if (!overlay) return;
    overlay.classList.remove('visible');
    overlay.setAttribute('aria-hidden', 'true');
}
