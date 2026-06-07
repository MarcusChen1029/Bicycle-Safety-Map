// Function to update progress bars and scores based on an array of values
function updateStats(stats) {
    // Select all stats items
    const statItems = document.querySelectorAll('.stats-item');

    // Loop through each stat item
    statItems.forEach((item, index) => {
        // Ensure we have data for this item
        if (index < stats.length) {
            const scoreElement = item.querySelector('.score');
            const progressFill = item.querySelector('.progress-fill');
            const value = stats[index];

            // Update text score
            if (scoreElement) {
                scoreElement.textContent = value;
            }

            // Update progress bar width
            if (progressFill) {
                // Ensure value is between 0 and 100
                const widthValue = Math.min(Math.max(value, 0), 100);
                progressFill.style.width = widthValue + '%';

                // Optional: Change color based on score (low score = red, high = green)
                if (widthValue < 60) {
                    progressFill.style.backgroundColor = '#dc3545'; // Red
                } else if (widthValue < 80) {
                    progressFill.style.backgroundColor = '#ffc107'; // Yellow
                } else {
                    progressFill.style.backgroundColor = '#28a745'; // Green
                }
            }
        }
    });
}

function updateLevel(array) {
    let sum = 0;
    array.forEach(item => {
        sum += item;
    });
    if (array.length > 0) {
        const average = sum / array.length;
        if (average > 85) {
            document.querySelector('.level').textContent = "A";
            document.querySelector('.safety-level').style.backgroundColor = "#28a745";
        } else if (average > 70) {
            document.querySelector('.level').textContent = "B";
            document.querySelector('.safety-level').style.backgroundColor = "#daff07ff";
        } else if (average > 55) {
            document.querySelector('.level').textContent = "C";
            document.querySelector('.safety-level').style.backgroundColor = "#dc8e35ff";
        } else if (average > 40) {
            document.querySelector('.level').textContent = "D";
            document.querySelector('.safety-level').style.backgroundColor = "#ff0000ff";
        } else {
            document.querySelector('.level').textContent = "E";
            document.querySelector('.safety-level').style.backgroundColor = "#000000ff";
        }
    }
}
// Example: Initialize with some sample data when page loads
document.addEventListener('DOMContentLoaded', () => {
    // Sample scores: [Infrastructure, Risk, Accidents, Opinions]
    const sampleScores = [100, 100, 90, 90];

    // Call the function
    updateStats(sampleScores);
    updateLevel(sampleScores);
    // Also set the header info for demo
    document.querySelector('.header').textContent = "Taipei Main Station";

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

    // "Get Location" Button Logic (Mock feature)
    const getLocBtn = document.getElementById('get-location-btn');
    if (getLocBtn) {
        getLocBtn.addEventListener('click', () => {
            document.getElementById('report-location').value = '台北市羅斯福路四段1號 (自動定位)';
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

// Initialize and add the map
function initMap() {
    // The location of Taipei
    const taipei = { lat: 25.0330, lng: 121.5654 };
    // The map, centered at Taipei
    const map = new google.maps.Map(document.getElementById("map"), {
        zoom: 14,
        center: taipei,
    });
}

// ================================================================
// 騎乘回饋 Modal - UI Logic (Feedback Modal)
// ================================================================

// Current ratings state
let _feedbackRatings = { safety: 0, smoothness: 0 };

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
    _feedbackRatings = { safety: 0, smoothness: 0 };
    _resetStars();

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

    const safetyText = document.getElementById('safety-score-text');
    const smoothnessText = document.getElementById('smoothness-score-text');

    if (safetyText) {
        safetyText.textContent = _scoreLabels[0];
        safetyText.classList.remove('scored');
    }
    if (smoothnessText) {
        smoothnessText.textContent = _scoreLabels[0];
        smoothnessText.classList.remove('scored');
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
 * Update the "民眾意見" (Public Opinion) progress bar
 * This targets the 4th stats-item (index 3) in each .stats container
 * @param {number} score - 0-100 scale
 */
function updatePublicOpinionStat(score) {
    const statsContainers = document.querySelectorAll('.stats');

    statsContainers.forEach(container => {
        const statItems = container.querySelectorAll('.stats-item');
        // The 4th item (index 3) is "民眾意見"
        if (statItems.length >= 4) {
            const opinionItem = statItems[3];
            const scoreEl = opinionItem.querySelector('.score');
            const progressFill = opinionItem.querySelector('.progress-fill');

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
        }
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
            if (_feedbackRatings.safety === 0 || _feedbackRatings.smoothness === 0) {
                alert('請為安全性和順暢度都進行評分！');
                return;
            }

            // Disable button to prevent double-submit
            submitBtn.disabled = true;
            submitBtn.textContent = '送出中...';

            try {
                // Access the global app's routePlanner to save feedback
                if (window.initMapApp && window.initMapApp._appInstance) {
                    await window.initMapApp._appInstance.routePlanner.saveFeedbackToFirebase(
                        _feedbackRatings.safety,
                        _feedbackRatings.smoothness
                    );
                } else {
                    // Fallback: try to find routePlanner from global scope
                    // The planRoute button handler in main.js creates the instance
                    // We need a reference - store it on window when created
                    if (window._routePlannerRef) {
                        await window._routePlannerRef.saveFeedbackToFirebase(
                            _feedbackRatings.safety,
                            _feedbackRatings.smoothness
                        );
                    } else {
                        console.warn('No routePlanner reference found, saving directly to Firebase');
                        await feedbackDB.saveFeedback({
                            safetyScore: _feedbackRatings.safety,
                            smoothnessScore: _feedbackRatings.smoothness,
                            averageScore: (_feedbackRatings.safety + _feedbackRatings.smoothness) / 2,
                            steps: [],
                            overviewPath: []
                        });
                    }
                }

                hideFeedbackModal();
                showFeedbackToast('✅ 感謝您的回饋！');
            } catch (error) {
                console.error('Failed to save feedback:', error);
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

    // Initialize public opinion bar with default score (70 = B grade)
    updatePublicOpinionStat(70);
});
