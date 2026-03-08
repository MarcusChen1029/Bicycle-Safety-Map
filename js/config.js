const CONFIG = {
  // Google Maps 初始設定
  map: {
    center: { lat: 25.0330, lng: 121.5654 }, // 台北市中心
    zoom: 13,
    mapTypeId: 'roadmap',
    styles: [
      {
        featureType: 'poi',
        elementType: 'labels',
        stylers: [{ visibility: 'off' }]
      }
    ]
  },

  // 事故熱點設定
  accidents: {
    heatmapOptions: {
      radius: 20, // Reduced from 50 to 20 to improve rendering performance
      opacity: 0.8,
      gradient: [
        'rgba(0, 255, 255, 0)',
        'rgba(0, 255, 255, 1)',
        'rgba(0, 191, 255, 1)',
        'rgba(0, 127, 255, 1)',
        'rgba(0, 63, 255, 1)',
        'rgba(0, 0, 255, 1)',
        'rgba(0, 0, 223, 1)',
        'rgba(0, 0, 191, 1)',
        'rgba(0, 0, 159, 1)',
        'rgba(0, 0, 127, 1)',
        'rgba(63, 0, 91, 1)',
        'rgba(127, 0, 63, 1)',
        'rgba(191, 0, 31, 1)',
        'rgba(255, 0, 0, 1)'
      ]
    },
    markerIcon: {
      path: 'CIRCLE', // google.maps.SymbolPath.CIRCLE (Changed to string to avoid load order issue)
      scale: 8,
      fillColor: '#FF0000',
      fillOpacity: 0.7,
      strokeColor: '#FFFFFF',
      strokeWeight: 2
    }
  },

  // 自行車道設定
  bikeLanes: {
    strokeColor: '#00AA00',
    strokeOpacity: 0.8,
    strokeWeight: 4,
    colors: {
      'dedicated': '#28a745', // 專用道 - 綠色
      'shared': '#ffc107',    // 共用道 - 黃色
      'normal': '#28a745',    // 一般道路 - 藍色
      'default': '#6c757d'    // 預設 - 灰色
    }
  },

  // 路線規劃設定
  directions: {
    travelMode: 'BICYCLING',
    routeColor: '#4285f4',
    routeWeight: 6,
    routeOpacity: 0.8
  },

  // 座標系統定義 (TWD97 轉 WGS84)
  projection: {
    TWD97: '+proj=tmerc +lat_0=0 +lon_0=121 +k=0.9999 +x_0=250000 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
    WGS84: '+proj=longlat +datum=WGS84 +no_defs'
  }
};