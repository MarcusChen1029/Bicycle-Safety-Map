import csv
import json

# 設定你的輸入與輸出檔名
input_filename = 'data.csv'  # 請確認你的原始 CSV 檔名
output_filename = 'data/accidents.json'

results = []

try:
    with open(input_filename, 'r', encoding='big5') as f:
        # 使用 DictReader 讀取，自動將第一列作為標題
        reader = csv.DictReader(f)
        
        for row in reader:
            try:
                # 提取車種，條件: 只記錄有慢車(F開頭)、人(H開頭)和機車(C開頭)的資料
                vehicle_type = row.get('車種', '')
                if not (vehicle_type.startswith('C') or vehicle_type.startswith('F') or vehicle_type.startswith('H')):
                    continue
                
                # 受傷程度欄位
                injury_level = row.get('受傷程度', '')
                
                severity = '不明'
                if injury_level in ('1', '5'):
                    severity = '死亡'
                elif injury_level == '2':
                    severity = '輕傷'   # 依使用者需求，2 歸為輕傷
                elif injury_level == '3':
                    severity = '無傷'
                
                # 定位座標一定要有
                lat_str = row.get("座標-Y", "")
                lng_str = row.get("座標-X", "")
                if not lat_str or not lng_str:
                    continue
                    
                lat = float(lat_str)
                lng = float(lng_str)

                # Date construction (Taiwan year to AD)
                try:
                    year = int(row['發生年度']) + 1911
                    month = row['發生月'].zfill(2)
                    day = row['發生日'].zfill(2)
                    date_str = f"{year}-{month}-{day}"
                except:
                    date_str = ""

                # accidents.json format: lat, lng, severity, date, location, description
                item = {
                    "lat": lat,
                    "lng": lng,
                    "severity": severity,
                    "date": date_str,
                    "location": row.get("肇事地點", ""),
                    "description": row.get("事故類型及型態", "")
                }
                
                # Validation
                if not item["date"]:
                     pass

                results.append(item)
            except (ValueError, KeyError) as e:
                # 如果某一行資料有缺漏或格式錯誤，印出錯誤並跳過
                # print(f"Skipping a row due to error: {e}")
                continue

    # 寫入 JSON 檔案
    with open(output_filename, "w", encoding="utf-8") as json_file:
        json.dump(results, json_file, ensure_ascii=False, indent=4)

    print(f"轉換成功！已輸出至 {output_filename}，共 {len(results)} 筆資料。")

except FileNotFoundError:
    print(f"找不到檔案：{input_filename}，請確認檔名與路徑是否正確。")