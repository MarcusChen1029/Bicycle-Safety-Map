class BikeMapApp {
  constructor() {
    this.mapInitializer = null;
    this.map = null;
    this.map = null;
    this.bikeLaneLayer = null;
    this.accidentLayer = null;
    this.youbikeLayer = null;
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

      this.bindEvents();

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
  }

  async handleRoutePlanning() {

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