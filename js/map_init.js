class MapInitializer {
  constructor() {
    this.map = null;
  }

  /**
   * 初始化 Google Map
   * @returns {google.maps.Map} 地圖實例
   */
  init() {
    const mapElement = document.getElementById('map');

    this.map = new google.maps.Map(mapElement, {
      center: CONFIG.map.center,
      zoom: CONFIG.map.zoom,
      mapTypeId: CONFIG.map.mapTypeId,
      styles: CONFIG.map.styles,
      disableDefaultUI: true,
      mapTypeControl: false,
      zoomControl: false,
      panControl: false,
      streetViewControl: false,
      streetViewControlOptions: {
        position: google.maps.ControlPosition.RIGHT_CENTER
      },
      fullscreenControl: true
    });

    console.log('✅ 地圖初始化完成');
    return this.map;
  }

  /**
   * 取得地圖實例
   * @returns {google.maps.Map}
   */
  getMap() {
    return this.map;
  }
  /**
 * 設定地圖中心點
 * @param {number} lat - 緯度
 * @param {number} lng - 經度
 */
  setCenter(lat, lng) {
    this.map.setCenter({ lat, lng });
  }

  /**
   * 設定縮放等級
   * @param {number} zoom - 縮放等級
   */
  setZoom(zoom) {
    this.map.setZoom(zoom);
  }

  /**
   * 自動調整視野以包含所有標記
   * @param {Array} bounds - 邊界陣列
   */
  fitBounds(bounds) {
    this.map.fitBounds(bounds);
  }
}