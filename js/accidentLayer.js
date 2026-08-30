class AccidentLayer {
    constructor(map) {
        this.map = map;
        this.heatmap = null;
        this.markers = [];
        this.data = [];
        this.visible = true;
    }

    /**
     * 載入事故資料 (從台北市資料平台)
     * @param {string} dataUrl - 資料來源 URL 或本地 JSON 檔案路徑
     */
    async loadData(dataUrl = 'data/accidents.json') {
        try {
            console.log('loading');
            const response = await fetch(dataUrl);
            const jsonData = await response.json();

            // 解析資料格式 (需根據實際 API 回應調整)
            this.data = this.parseAccidentData(jsonData);
            console.log(`laoded ${this.data.length}  datas`);

            return this.data;
        } catch (error) {
            console.error('load failed:', error);
            // 使用示範資料
            this.data = this.getSampleData();
            console.log('using sample data');
            return this.data;
        }
    }

    /**
     * 解析台北市開放資料格式
     * @param {Object} jsonData - 原始 JSON 資料
     * @returns {Array} 處理後的事故資料陣列
     */
    parseAccidentData(jsonData) {
        // 根據台北市資料平台的格式調整
        // 假設資料包含 lat, lng 或需要地址轉換
        const accidents = [];

        if (Array.isArray(jsonData)) {
            // 優化點：預先配置陣列大小，避免動態擴充 (如果能預知大小)
            // 這裡我們先用標準的 for 迴圈取代 forEach，在處理大量資料時通常效能較好
            for (let i = 0; i < jsonData.length; i++) {
                const item = jsonData[i];
                // 檢查是否有經緯度
                if (item.lat && item.lng) {
                    accidents.push({
                        position: { lat: parseFloat(item.lat), lng: parseFloat(item.lng) },
                        severity: item.severity || 'light',
                        // 省略不必要的字串操作，我們只要畫熱力圖，date, location, description 不重要
                        // date: item.date || 'unknown',
                        // location: item.location || 'unknown location',
                        // description: item.description || ''
                    });
                }
            }
        }
        return accidents;
    }

    createHeatmap() {
        // 使用 Google Maps 內建熱力圖以改善效能
        // Performance Optimization: Aggressive downsampling.
        // 如果還是會卡，我們需要進一步減少資料量
        // 只顯示死亡事故，維持熱點的代表性（避免大量輕傷把整個台北蓋滿、淡化每個熱點的意義）
        const severeAccidents = this.data.filter(accident => accident.severity === '死亡');

        const heatmapData = severeAccidents.map(accident => {
            return {
                location: new google.maps.LatLng(accident.position.lat, accident.position.lng),
                weight: 50
            };
        });

        this.heatmap = new google.maps.visualization.HeatmapLayer({
            data: heatmapData,
            map: this.map,
            // radius 隨縮放調整，見 radiusForZoom()。
            radius: this.radiusForZoom(this.map.getZoom()),
            opacity: 0.6,
            gradient: CONFIG.accidents.heatmapOptions.gradient || [
                'rgba(0, 255, 0, 0)',
                'rgba(255, 255, 0, 1)',
                'rgba(255, 165, 0, 1)',
                'rgba(255, 69, 0, 1)',
                'rgba(255, 0, 0, 1)',
                'rgba(139, 0, 0, 1)'
            ]
        });

        this.map.addListener('zoom_changed', () => {
            if (this.heatmap) {
                this.heatmap.set('radius', this.radiusForZoom(this.map.getZoom()));
            }
        });

        console.log(`✅ Google Maps 熱力圖建立完成 (顯示 ${severeAccidents.length} 件事故)`);
    }

    /**
     * HeatmapLayer 的 radius 是「螢幕像素」常數（dissipating 預設 true），跟縮放
     * 無關；放大時同樣的 30px 涵蓋的實際範圍越來越小，熱點就縮成一個點。
     *
     * 內建的 dissipating:false 會改用固定地理範圍，但本圖層的縮放範圍是 zoom
     * 13(預設總覽)~18(街道)，像素半徑相差 32 倍：要在 13 看得見就得放大到
     * zoom 18 破圖（超出 tile 尺寸會出現硬接縫，已實測），兩端無法兼顧。
     *
     * 因此改用介於兩者之間的曲線：以 zoom 15 = 30px 為基準，每級 ×1.5（比固定
     * 像素會長大、又比固定地理範圍溫和），並夾在 18~110px 之間 —— 下限保住總覽
     * 視圖的可見度，上限避開 tile 接縫。
     * @param {number} zoom
     * @returns {number} 像素半徑
     */
    radiusForZoom(zoom) {
        const radius = 30 * Math.pow(1.5, (zoom || 15) - 15);
        return Math.round(Math.min(110, Math.max(18, radius)));
    }

    getSampleData() {
        return [
            { position: { lat: 25.0330, lng: 121.5654 }, severity: 'light', date: '2023-01-01', location: '台北市', description: '示範事故' }
        ];
    }

}
