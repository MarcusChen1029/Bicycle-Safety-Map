import xml.etree.ElementTree as ET
import json
import re

# 這裡放入你完整的 KML 內容字串
# 為了方便示範，我假設你已經將內容存成名為 "bike_data.kml" 的檔案
# 如果你是直接貼上字串，可以把 kml_source 換成字串變數
INPUT_FILE = '台灣本島自行車道.kml'
OUTPUT_FILE = 'bike_data.json'

def parse_description(desc_text):
    """
    將 KML 的 description 文字解析成字典
    例如: "編號：無\n縣市別：台東縣" -> {'編號': '無', '縣市別': '台東縣'}
    """
    if not desc_text:
        return {}
    
    data = {}
    # 移除 CDATA 標記 (如果有的話)
    clean_text = desc_text.replace('<![CDATA[', '').replace(']]>', '')
    
    lines = clean_text.split('\n')
    for line in lines:
        if '：' in line:
            key, value = line.split('：', 1)
            data[key.strip()] = value.strip()
    return data

def parse_coordinates(coords_text):
    """
    將 KML 座標字串轉換為 GeoJSON 格式的陣列 [lon, lat]
    """
    points = []
    # KML 座標格式: lon,lat,alt (空格分隔)
    raw_points = coords_text.strip().split()
    for p in raw_points:
        parts = p.split(',')
        if len(parts) >= 2:
            # 轉成浮點數，取前兩個 (經度, 緯度)
            points.append([float(parts[0]), float(parts[1])])
    return points

def kml_to_geojson(kml_file):
    tree = ET.parse(kml_file)
    root = tree.getroot()
    
    # 處理 KML namespace (通常是 {http://www.opengis.net/kml/2.2})
    ns = {'kml': root.tag.split('}')[0].strip('{')}
    
    geojson = {
        "type": "FeatureCollection",
        "features": []
    }

    # 搜尋所有的 Placemark
    for placemark in root.findall('.//kml:Placemark', ns):
        feature = {
            "type": "Feature",
            "properties": {},
            "geometry": {}
        }
        
        # 1. 處理名稱
        name = placemark.find('kml:name', ns)
        if name is not None:
            feature['properties']['name'] = name.text

        # 2. 處理描述 (將純文字轉為屬性)
        desc = placemark.find('kml:description', ns)
        if desc is not None:
            attrs = parse_description(desc.text)
            feature['properties'].update(attrs)

        # 3. 處理幾何形狀 (LineString 或 Point)
        line = placemark.find('kml:LineString', ns)
        point = placemark.find('kml:Point', ns)

        if line is not None:
            coords = line.find('kml:coordinates', ns).text
            feature['geometry'] = {
                "type": "LineString",
                "coordinates": parse_coordinates(coords)
            }
        elif point is not None:
            coords = point.find('kml:coordinates', ns).text
            # Point 的 coordinates 通常只有一點，但 parse_coordinates 回傳的是 list of lists
            parsed_coords = parse_coordinates(coords)
            if parsed_coords:
                feature['geometry'] = {
                    "type": "Point",
                    "coordinates": parsed_coords[0]
                }
        
        geojson['features'].append(feature)

    return geojson

# --- 執行轉換 ---
try:
    data = kml_to_geojson(INPUT_FILE)
    
    # 寫入 JSON 檔案
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        
    print(f"轉換成功！已儲存為 {OUTPUT_FILE}")
    
except FileNotFoundError:
    print(f"找不到檔案: {INPUT_FILE}，請確認檔名是否正確。")
except Exception as e:
    print(f"發生錯誤: {e}")