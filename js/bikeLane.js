class BikeLaneLayer {
  constructor(map, infoWindow) {
    this.map = map;
    this.infoWindow = infoWindow;
    this.polylines = [];
    this.data = [];
    this.visible = true;
  }


  async loadData(dataUrl = 'data/bike_data.json') {
    try {
      console.log('loading...');
      const response = await fetch(dataUrl);
      const jsonData = await response.json();

      this.data = this.parseBikeLaneData(jsonData);
      console.log(`laoded ${this.data.length} lanes`);

      return this.data;
    } catch (error) {
      console.error('error: ', error);
      // 使用示範資料
      this.data = this.getSampleData();
      console.log('ex');
      return this.data;
    }
  }

  parseBikeLaneData(jsonData) {
    const lanes = [];
    let features = [];

    // Handle GeoJSON FeatureCollection
    if (jsonData.type === 'FeatureCollection' && Array.isArray(jsonData.features)) {
      features = jsonData.features;
    } else if (Array.isArray(jsonData)) {
      // Handle direct array (legacy support)
      features = jsonData;
    }

    features.forEach(item => {
      let coordinates = [];
      const props = item.properties || item; // Handle GeoJSON properties or direct object

      // Handle GeoJSON geometry
      if (item.geometry) {
        coordinates = this.parseGeometry(item.geometry);
      }
      // Handle legacy formats
      else if (item.coordinates && Array.isArray(item.coordinates)) {
        coordinates = item.coordinates.map(coord => ({
          lat: parseFloat(coord.lat || coord[1]),
          lng: parseFloat(coord.lng || coord[0])
        }));
      }
      else if (item.twd97_coordinates) {
        coordinates = this.convertTWD97ToWGS84(item.twd97_coordinates);
      }

      if (coordinates.length > 0) {
        lanes.push({
          name: props.name || props.lane_name || 'unnamed',
          type: props.type || props.lane_type || 'normal',
          length: props.length || this.calculateLength(coordinates),
          coordinates: coordinates,
          description: props.description || ''
        });
      }
    });

    return lanes;
  }


  convertTWD97ToWGS84(twd97Coords) {
    if (typeof proj4 === 'undefined') {
      console.warn('Proj4js cant laod');
      return [];
    }

    return twd97Coords.map(coord => {
      const [lng, lat] = proj4(CONFIG.projection.TWD97, CONFIG.projection.WGS84, [
        parseFloat(coord.x || coord[0]),
        parseFloat(coord.y || coord[1])
      ]);
      return { lat, lng };
    });
  }

  parseGeometry(geometry) {

    if (geometry.type === 'LineString' && geometry.coordinates) {
      return geometry.coordinates.map(coord => ({
        lng: parseFloat(coord[0]),
        lat: parseFloat(coord[1])
      }));
    }

    if (geometry.type === 'MultiLineString' && geometry.coordinates) {

      return geometry.coordinates[0].map(coord => ({
        lng: parseFloat(coord[0]),
        lat: parseFloat(coord[1])
      }));
    }

    return [];
  }

  calculateLength(coordinates) {
    if (coordinates.length < 2) return 0;

    let totalLength = 0;
    for (let i = 0; i < coordinates.length - 1; i++) {
      const from = new google.maps.LatLng(coordinates[i].lat, coordinates[i].lng);
      const to = new google.maps.LatLng(coordinates[i + 1].lat, coordinates[i + 1].lng);
      totalLength += google.maps.geometry.spherical.computeDistanceBetween(from, to);
    }

    return Math.round(totalLength);
  }

  drawLanes() {
    this.data.forEach(lane => {
      const polyline = new google.maps.Polyline({
        path: lane.coordinates,
        strokeColor: this.getLaneColor(lane.type),
        strokeOpacity: CONFIG.bikeLanes.strokeOpacity,
        strokeWeight: CONFIG.bikeLanes.strokeWeight,
        map: this.map
      });

      polyline.addListener('click', (event) => {
        this.infoWindow.setContent(this.createInfoWindowContent(lane));
        this.infoWindow.setPosition(event.latLng);
        this.infoWindow.open(this.map);
      });

      this.polylines.push(polyline);
    });

    console.log(`✅ 已繪製 ${this.polylines.length} 條自行車道`);
  }

  createInfoWindowContent(lane) {
    return `
      <div style="padding: 4px; max-width: 200px; font-family: sans-serif;">
        <h4 style="color: #00AA00; margin: 0 0 6px 0; font-size: 15px;">🚴 ${lane.name}</h4>
        <p style="margin: 2px 0; font-size: 13px;"><strong>類型：</strong>${lane.type}</p>
        <p style="margin: 2px 0; font-size: 13px;"><strong>長度：</strong>${(lane.length / 1000).toFixed(2)} 公里</p>
        ${lane.description ? `<p style="margin: 2px 0; font-size: 12px; color: #666;">${lane.description}</p>` : ''}
      </div>
    `;
  }

  toggle() {
    this.visible = !this.visible;
    this.polylines.forEach(polyline => {
      polyline.setMap(this.visible ? this.map : null);
    });
    console.log(`Layer visibility: ${this.visible}`);
  }

  getLaneColor(type) {
    // Basic normalization of type string if needed
    if (!type) return CONFIG.bikeLanes.colors.default;

    // Check for keywords if types aren't exact matches
    const lowerType = type.toLowerCase();
    if (lowerType.includes('專用')) return CONFIG.bikeLanes.colors.dedicated;
    if (lowerType.includes('共用')) return CONFIG.bikeLanes.colors.shared;

    return CONFIG.bikeLanes.colors[type] || CONFIG.bikeLanes.colors.normal || CONFIG.bikeLanes.colors.default;
  }
}