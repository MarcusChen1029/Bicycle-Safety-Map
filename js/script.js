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
        submitReportBtn.addEventListener('click', () => {
            const reportType = document.getElementById('report-type').value;
            const reportDesc = document.getElementById('report-desc').value;

            if (!reportType) {
                alert('請選擇問題類型！');
                return;
            }
            if (!reportDesc.trim()) {
                alert('請填寫問題描述！');
                return;
            }

            alert('回報已成功送出！感謝您協助改善騎乘環境。');

            // Clear form
            document.getElementById('report-type').value = '';
            document.getElementById('report-location').value = '';
            document.getElementById('report-desc').value = '';
            document.getElementById('report-photo').value = '';

            // Switch back to Map tab by clicking the first nav item
            if (navItems[0]) navItems[0].click();
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
