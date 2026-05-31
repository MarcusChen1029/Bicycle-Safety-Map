class BikeMapApp {
  constructor() {
    this.mapInitializer = null;
    this.map = null;
    this.bikeLaneLayer = null;
    this.accidentLayer = null;
    this.youbikeLayer = null;

    // GPS 即時追蹤相關
    this.watchId = null;           // watchPosition 的 ID
    this.userMarker = null;        // 使用者位置標記
    this.userAccuracyCircle = null; // GPS 精度圈
    this.currentPosition = null;   // 最新的位置資料 { lat, lng, speed, heading, accuracy }
    
    // In-App Navigation State
    this.isNavigating = false;
    this.currentNavStepIndex = 0;
  }

  /**
   * 初始化應用程式
   */
  async init() {
    console.log('🚀 初始化城市騎行安全地圖...');

    try {
      this.mapInitializer = new MapInitializer();
      this.map = this.mapInitializer.init();

      // Create a shared InfoWindow for all layers
      this.sharedInfoWindow = new google.maps.InfoWindow();

      this.bikeLaneLayer = new BikeLaneLayer(this.map, this.sharedInfoWindow);
      await this.bikeLaneLayer.loadData();
      this.bikeLaneLayer.drawLanes();

      this.accidentLayer = new AccidentLayer(this.map);
      await this.accidentLayer.loadData();
      this.accidentLayer.createHeatmap();

      this.youbikeLayer = new YoubikeLayer(this.map, this.sharedInfoWindow);
      // Not awaiting here to not block the rest of initialization
      this.youbikeLayer.loadData();

      // Initialize Route Planner
      this.routePlanner = new RoutePlanner(this.map, this.accidentLayer, this.youbikeLayer, this.bikeLaneLayer);

      // Expose routePlanner globally for feedback modal access
      window._routePlannerRef = this.routePlanner;

      this.bindEvents();

      // 啟動 GPS 即時追蹤
      this.startLocationTracking();

      console.log('✅ 應用程式初始化完成！');
    } catch (error) {
      console.error('❌ 初始化失敗:', error);
      alert('應用程式初始化失敗，請檢查控制台');
    }
  }
  bindEvents() {
    // this.bikeLaneLayer.toggle(); // Prevent auto-hiding

    // Route Planning Events
    const planBtn = document.getElementById('plan-route');
    const clearBtn = document.getElementById('clear-route');

    if (planBtn) {
      planBtn.addEventListener('click', () => {
        const startIdx = document.getElementById('start-point').value;
        const endIdx = document.getElementById('end-point').value;
        this.routePlanner.planRoute(startIdx, endIdx);
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        this.routePlanner.clearRoute();
      });
    }

    // Start Navigation Event
    const startNavBtn = document.getElementById('start-navigation-btn');
    if (startNavBtn) {
      startNavBtn.addEventListener('click', () => {
        if (this.routePlanner && this.routePlanner.lastRoute) {
          // 啟動 App 內建導航模式
          this.isNavigating = true;
          this.currentNavStepIndex = 0;
          this._minDistanceToTurn = null;
          
          document.body.classList.add('nav-mode-active');
          document.getElementById('nav-banner').style.display = 'flex';
          
          if (this.currentPosition && this.map) {
            this.map.setCenter(this.currentPosition);
            this.map.setZoom(18);
          }
          
          this._updateNavBanner();
        }
      });
    }

    const endNavBtn = document.getElementById('end-navigation-btn');
    if (endNavBtn) {
      endNavBtn.addEventListener('click', () => {
        this.isNavigating = false;
        document.body.classList.remove('nav-mode-active');
        document.getElementById('nav-banner').style.display = 'none';
        
        // 將地圖視角拉回可看見整條路線
        if (this.routePlanner && this.routePlanner.lastRoute && this.map) {
           this.map.fitBounds(this.routePlanner.lastRoute.bounds);
        }
      });
    }

    // Spoofer Toggle
    const toggleSpooferBtn = document.getElementById('toggle-spoofer-btn');
    const virtualJoystick = document.getElementById('virtual-joystick');
    
    // WASD Smooth Movement State
    this.keysPressed = { w: false, a: false, s: false, d: false };
    this.isSpooferActive = false;
    
    const smoothSpoofSpeed = 0.00003;
    const smoothSpoofLoop = () => {
      if (!this.isSpooferActive) return;
      
      let dLat = 0;
      let dLng = 0;
      if (this.keysPressed.w) dLat += smoothSpoofSpeed;
      if (this.keysPressed.s) dLat -= smoothSpoofSpeed;
      if (this.keysPressed.a) dLng -= smoothSpoofSpeed;
      if (this.keysPressed.d) dLng += smoothSpoofSpeed;

      if (dLat !== 0 || dLng !== 0) {
        if (!this.currentPosition) {
          this.currentPosition = { lat: 25.0478, lng: 121.5170, accuracy: 10, heading: 0, speed: 0 };
        }
        // Calculate heading
        const heading = Math.atan2(dLng, dLat) * 180 / Math.PI;
        this.handlePositionUpdate({
          coords: {
            latitude: this.currentPosition.lat + dLat,
            longitude: this.currentPosition.lng + dLng,
            accuracy: 10,
            heading: heading >= 0 ? heading : heading + 360,
            speed: 15
          }
        });
      }
      requestAnimationFrame(smoothSpoofLoop);
    };

    if (toggleSpooferBtn && virtualJoystick) {
      toggleSpooferBtn.addEventListener('click', () => {
        if (virtualJoystick.style.display === 'none') {
          virtualJoystick.style.display = 'flex';
          toggleSpooferBtn.style.background = '#ffeeba';
          this.isSpooferActive = true;
          if (this.watchId !== null) {
            navigator.geolocation.clearWatch(this.watchId);
            this.watchId = null;
          }
          // Start WASD animation loop
          requestAnimationFrame(smoothSpoofLoop);
        } else {
          virtualJoystick.style.display = 'none';
          toggleSpooferBtn.style.background = '#fff3cd';
          this.isSpooferActive = false;
          // Reset keys
          this.keysPressed = { w: false, a: false, s: false, d: false };
          this.startLocationTracking();
        }
      });
    }

    // Keyboard Listeners
    window.addEventListener('keydown', (e) => {
      const key = e.key.toLowerCase();
      if (this.isSpooferActive && this.keysPressed.hasOwnProperty(key)) {
        this.keysPressed[key] = true;
      }
    });

    window.addEventListener('keyup', (e) => {
      const key = e.key.toLowerCase();
      if (this.isSpooferActive && this.keysPressed.hasOwnProperty(key)) {
        this.keysPressed[key] = false;
      }
    });

    const moveStep = 0.0001; // 約 11 公尺
    const moveFake = (dLat, dLng) => {
      if (!this.currentPosition) {
        this.currentPosition = { lat: 25.0478, lng: 121.5170, accuracy: 10, heading: 0, speed: 0 };
      }
      this.handlePositionUpdate({
        coords: {
          latitude: this.currentPosition.lat + dLat,
          longitude: this.currentPosition.lng + dLng,
          accuracy: 10,
          heading: 0,
          speed: 5
        }
      });
    };

    // Keep UI buttons working smoothly too
    let holdInterval;
    const startHold = (dLat, dLng) => {
      moveFake(dLat, dLng);
      holdInterval = setInterval(() => moveFake(dLat, dLng), 50);
    };
    const stopHold = () => clearInterval(holdInterval);

    ['up', 'down', 'left', 'right'].forEach(dir => {
      const btn = document.getElementById(`joy-${dir}`);
      if (!btn) return;
      const offsets = {
        'up': [smoothSpoofSpeed*2, 0], 'down': [-smoothSpoofSpeed*2, 0],
        'left': [0, -smoothSpoofSpeed*2], 'right': [0, smoothSpoofSpeed*2]
      };
      btn.addEventListener('mousedown', () => startHold(offsets[dir][0], offsets[dir][1]));
      btn.addEventListener('mouseup', stopHold);
      btn.addEventListener('mouseleave', stopHold);
      btn.addEventListener('touchstart', (e) => { e.preventDefault(); startHold(offsets[dir][0], offsets[dir][1]); });
      btn.addEventListener('touchend', (e) => { e.preventDefault(); stopHold(); });
    });
    
    document.getElementById('joy-teleport')?.addEventListener('click', () => {
      if (this.routePlanner && this.routePlanner.lastRoute) {
        const startLoc = this.routePlanner.lastRoute.legs[0].start_location;
        this.handlePositionUpdate({
          coords: {
            latitude: startLoc.lat(),
            longitude: startLoc.lng(),
            accuracy: 10,
            heading: 0,
            speed: 0
          }
        });
      } else {
        alert('請先規劃路線！');
      }
    });

    // Swap Origin and Destination
    const swapBtn = document.getElementById('swap-route-btn');
    if (swapBtn) {
      swapBtn.addEventListener('click', () => {
        const startInput = document.getElementById('start-point');
        const endInput = document.getElementById('end-point');

        if (startInput && endInput) {
          const temp = startInput.value;
          startInput.value = endInput.value;
          endInput.value = temp;
        }
      });
    }

    // YouBike toggle
    const youbikeToggleBtn = document.getElementById('toggle-youbike-btn');
    if (youbikeToggleBtn && this.youbikeLayer) {
      youbikeToggleBtn.addEventListener('click', () => {
        this.youbikeLayer.toggle();
        if (this.youbikeLayer.visible) {
          youbikeToggleBtn.style.background = '#e6f4ea';
        } else {
          youbikeToggleBtn.style.background = 'white';
        }
      });
    }

    // Bike Lane toggle
    const bikeLaneToggleBtn = document.getElementById('toggle-bikelane-btn');
    if (bikeLaneToggleBtn && this.bikeLaneLayer) {
      bikeLaneToggleBtn.addEventListener('click', () => {
        this.bikeLaneLayer.toggle();
        if (this.bikeLaneLayer.visible) {
          bikeLaneToggleBtn.style.background = '#e6f4ea';
        } else {
          bikeLaneToggleBtn.style.background = 'white';
        }
      });
    }

    // Map Click Event for Route Planning
    if (this.map) {
      this.map.addListener('click', (e) => {
        // Show details panel
        const details = document.querySelector('.details');
        if (details) {
          details.classList.add('active');
        }

        // Check if route planner is initialized
        if (this.routePlanner) {
          this.routePlanner.open();
          this.routePlanner.setDestination(e.latLng);
        }
      });
    }

    // Close Details Panel
    const closeDetailsBtn = document.getElementById('close-details');
    if (closeDetailsBtn) {
      closeDetailsBtn.addEventListener('click', () => {
        const details = document.querySelector('.details');
        if (details) {
          details.classList.remove('active');
        }
      });
    }

    // 「使用目前位置」按鈕 → 自動填入起點
    const useMyLocBtn = document.getElementById('use-my-location-btn');
    if (useMyLocBtn) {
      useMyLocBtn.addEventListener('click', () => {
        if (this.currentPosition) {
          const startInput = document.getElementById('start-point');
          if (startInput) {
            startInput.value = `${this.currentPosition.lat.toFixed(6)}, ${this.currentPosition.lng.toFixed(6)}`;
            console.log('📍 已自動填入目前位置為起點');
          }
        } else {
          alert('尚未取得 GPS 位置，請允許定位權限並稍候。');
        }
      });
    }

    // 回報頁面的定位按鈕 → 使用真實 GPS
    const getLocBtn = document.getElementById('get-location-btn');
    if (getLocBtn) {
      // 移除 script.js 中的 mock handler，改用真實 GPS
      getLocBtn.replaceWith(getLocBtn.cloneNode(true));
      const newGetLocBtn = document.getElementById('get-location-btn');
      newGetLocBtn.addEventListener('click', () => {
        if (this.currentPosition) {
          const reportLocInput = document.getElementById('report-location');
          if (reportLocInput) {
            reportLocInput.value = `${this.currentPosition.lat.toFixed(6)}, ${this.currentPosition.lng.toFixed(6)}`;
            // 嘗試反向地理編碼取得地址
            const geocoder = new google.maps.Geocoder();
            geocoder.geocode({
              location: { lat: this.currentPosition.lat, lng: this.currentPosition.lng }
            }, (results, status) => {
              if (status === 'OK' && results[0]) {
                reportLocInput.value = results[0].formatted_address;
              }
            });
          }
        } else {
          alert('尚未取得 GPS 位置，請允許定位權限並稍候。');
        }
      });
    }
  }

  // ================================================================
  // GPS 即時追蹤 (Real-time Location Tracking)
  // ================================================================

  /**
   * 啟動 GPS 即時追蹤
   * 先嘗試高精度 (GPS)，失敗則自動降級為 Wi-Fi/IP 定位
   * 然後用 watchPosition 持續追蹤
   */
  startLocationTracking() {
    if (!navigator.geolocation) {
      console.warn('⚠️ 此瀏覽器不支援 Geolocation API');
      return;
    }

    // 檢查是否為安全環境 (HTTPS 或 localhost)
    if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
      console.warn('⚠️ Geolocation API 需要安全環境 (HTTPS 或 localhost)');
      console.warn('   目前協定：' + location.protocol + '，主機：' + location.hostname);
      console.warn('   💡 請用 Live Server 或 http-server 開啟此頁面');
      return;
    }

    console.log('📡 啟動 GPS 定位...');

    // 位置更新的共用 callback
    const onPositionUpdate = (position) => {
      this.handlePositionUpdate(position);
    };

    // 錯誤處理的共用 callback
    const onPositionError = (error, context) => {
      const codeMap = { 1: 'PERMISSION_DENIED', 2: 'POSITION_UNAVAILABLE', 3: 'TIMEOUT' };
      console.warn(`⚠️ [${context}] 定位失敗 - code: ${error.code} (${codeMap[error.code] || 'UNKNOWN'}), message: ${error.message}`);
    };

    // 啟動持續追蹤（使用低精度，相容性最好）
    const startWatch = (highAccuracy) => {
      const mode = highAccuracy ? '高精度 GPS' : '一般定位 (Wi-Fi/IP)';
      console.log(`📡 啟動 watchPosition（${mode}）...`);

      this.watchId = navigator.geolocation.watchPosition(
        onPositionUpdate,
        (error) => {
          onPositionError(error, `watchPosition ${mode}`);

          // 如果高精度模式失敗，自動降級重試
          if (highAccuracy && (error.code === 2 || error.code === 3)) {
            console.log('🔄 高精度定位失敗，自動切換為一般定位...');
            navigator.geolocation.clearWatch(this.watchId);
            startWatch(false);
          }
        },
        {
          enableHighAccuracy: highAccuracy,
          timeout: highAccuracy ? 10000 : 30000,  // 一般定位給更長時間
          maximumAge: highAccuracy ? 0 : 60000     // 一般定位可用 1 分鐘內快取
        }
      );
    };

    // 先用一次性 getCurrentPosition 快速取得位置
    navigator.geolocation.getCurrentPosition(
      (position) => {
        console.log('✅ 初始定位成功！');
        onPositionUpdate(position);
        // 初始定位成功後，啟動持續追蹤（嘗試高精度）
        startWatch(true);
      },
      (error) => {
        onPositionError(error, 'getCurrentPosition 初始定位');

        // 初始高精度失敗 → 改用一般定位再試一次
        if (error.code === 2 || error.code === 3) {
          console.log('🔄 高精度初始定位失敗，改用一般定位...');
          navigator.geolocation.getCurrentPosition(
            (position) => {
              console.log('✅ 一般定位成功！');
              onPositionUpdate(position);
              startWatch(false);
            },
            (error2) => {
              onPositionError(error2, 'getCurrentPosition 一般定位');
              // 即使 getCurrentPosition 都失敗，仍啟動 watchPosition 試試看
              console.log('📡 getCurrentPosition 皆失敗，仍啟動 watchPosition 持續嘗試...');
              startWatch(false);
            },
            { enableHighAccuracy: false, timeout: 30000, maximumAge: 60000 }
          );
        } else {
          // PERMISSION_DENIED → 不再重試
          console.warn('🚫 使用者拒絕了定位權限，無法追蹤位置');
        }
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
    );
  }

  /**
   * 停止 GPS 追蹤
   */
  stopLocationTracking() {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
      console.log('🛑 GPS 追蹤已停止');
    }

    // 移除地圖上的使用者標記
    if (this.userMarker) {
      this.userMarker.setMap(null);
      this.userMarker = null;
    }
    if (this.userAccuracyCircle) {
      this.userAccuracyCircle.setMap(null);
      this.userAccuracyCircle = null;
    }
  }

  /**
   * 更新地圖上的使用者位置標記（藍色圓點 + 精度圈）
   */
  _updateUserMarker(lat, lng, accuracy) {
    if (!this.map) return;

    const position = { lat, lng };

    if (!this.userMarker) {
      // 首次建立標記 — 藍色圓點
      this.userMarker = new google.maps.Marker({
        position: position,
        map: this.map,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: '#4285F4',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 2
        },
        title: '你的位置',
        zIndex: 999
      });

      // 精度圈
      this.userAccuracyCircle = new google.maps.Circle({
        map: this.map,
        center: position,
        radius: accuracy || 50,
        fillColor: '#4285F4',
        fillOpacity: 0.1,
        strokeColor: '#4285F4',
        strokeOpacity: 0.3,
        strokeWeight: 1,
        clickable: false
      });

      // 第一次定位到使用者位置時，將地圖中心移過去
      this.map.setCenter(position);
      this.map.setZoom(16);
      console.log('🎯 已定位到使用者位置');
    } else {
      // 更新既有標記位置
      this.userMarker.setPosition(position);
      this.userAccuracyCircle.setCenter(position);
      this.userAccuracyCircle.setRadius(accuracy || 50);
    }
  }

  /**
   * 取得目前位置的地址（反向地理編碼）
   * @returns {Promise<string>} 地址文字
   */
  async getCurrentLocationAddress() {
    if (!this.currentPosition) return null;

    const geocoder = new google.maps.Geocoder();
    return new Promise((resolve, reject) => {
      geocoder.geocode({
        location: { lat: this.currentPosition.lat, lng: this.currentPosition.lng }
      }, (results, status) => {
        if (status === 'OK' && results[0]) {
          resolve(results[0].formatted_address);
        } else {
          resolve(`${this.currentPosition.lat.toFixed(6)}, ${this.currentPosition.lng.toFixed(6)}`);
        }
      });
    });
  }

  async handleRoutePlanning() {

  }

  handlePositionUpdate(position) {
    const latitude = position.coords.latitude;    // 緯度
    const longitude = position.coords.longitude;  // 經度
    const speed = position.coords.speed;           // 速度 (公尺/秒)
    const heading = position.coords.heading;       // 移動方向 (角度)
    const accuracy = position.coords.accuracy;     // 精度 (公尺)

    // 儲存最新位置
    this.currentPosition = {
      lat: latitude,
      lng: longitude,
      speed: speed,
      heading: heading,
      accuracy: accuracy
    };

    console.log(`📍 目前位置：${latitude.toFixed(5)}, ${longitude.toFixed(5)}，精度：${accuracy?.toFixed(0)}m，方向：${heading}，速度：${speed} m/s`);

    // 更新地圖上的使用者位置標記
    this._updateUserMarker(latitude, longitude, accuracy);

    // 如果處於導航模式，持續更新視角與導航提示
    if (this.isNavigating) {
      this.map.setCenter({ lat: latitude, lng: longitude });
      this._checkNavProgress(this.currentPosition);
    }
  }

  // ================================================================
  // 導航邏輯 (In-App Navigation)
  // ================================================================

  _updateNavBanner() {
    if (!this.routePlanner || !this.routePlanner.lastRoute) return;
    
    const steps = this.routePlanner.lastRoute.legs[0].steps;
    if (this.currentNavStepIndex < steps.length) {
      const step = steps[this.currentNavStepIndex];
      const instructionEl = document.getElementById('nav-instruction');
      const distanceEl = document.getElementById('nav-distance');
      
      if (instructionEl) instructionEl.innerHTML = step.instructions;
      if (distanceEl) distanceEl.textContent = step.distance.text;
    } else {
      const instructionEl = document.getElementById('nav-instruction');
      if (instructionEl) instructionEl.innerHTML = '已到達目的地附近！';
      const distanceEl = document.getElementById('nav-distance');
      if (distanceEl) distanceEl.textContent = '0 m';
    }
  }

  _checkNavProgress(position) {
    if (!this.routePlanner || !this.routePlanner.lastRoute) return;
    
    const steps = this.routePlanner.lastRoute.legs[0].steps;
    if (this.currentNavStepIndex >= steps.length) return;
    
    const currentStep = steps[this.currentNavStepIndex];
    const endLoc = currentStep.end_location;
    const currentLoc = new google.maps.LatLng(position.lat, position.lng);
    
    // 計算與目前路段終點的距離
    const distanceToTurn = google.maps.geometry.spherical.computeDistanceBetween(currentLoc, endLoc);
    
    // 防呆機制：追蹤距離是否開始變大 (錯過轉彎點)
    if (!this._minDistanceToTurn || this._lastNavStepIndex !== this.currentNavStepIndex) {
      this._minDistanceToTurn = distanceToTurn;
      this._lastNavStepIndex = this.currentNavStepIndex;
    } else {
      this._minDistanceToTurn = Math.min(this._minDistanceToTurn, distanceToTurn);
    }
    
    // 如果距離小於 40 公尺，或者距離開始變大超過 15 公尺 (代表已經經過終點)，切換到下一步驟
    if (distanceToTurn < 40 || (distanceToTurn > this._minDistanceToTurn + 15 && this._minDistanceToTurn < 80)) {
      this.currentNavStepIndex++;
      this._updateNavBanner();
    } else {
      // 即時更新剩餘距離顯示
      const distanceEl = document.getElementById('nav-distance');
      if (distanceEl) {
        if (distanceToTurn < 1000) {
          distanceEl.textContent = Math.round(distanceToTurn) + ' m';
        } else {
          distanceEl.textContent = (distanceToTurn / 1000).toFixed(1) + ' km';
        }
      }
    }
  }
}


// Expose initialization function for Google Maps callback
window.initMapApp = () => {
  const app = new BikeMapApp();
  app.init();
};

/*
window.addEventListener('load', () => {
  const app = new BikeMapApp();
  app.init();
});
*/