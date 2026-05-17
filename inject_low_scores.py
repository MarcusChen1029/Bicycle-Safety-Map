"""
測試用腳本：在 Firestore 中注入低分數據
目標路段：忠孝東路（國父紀念館 → 台北車站方向）
用途：測試 routePlanner 是否會避開低分路段
測試路線：國父紀念館 → 台北車站（正常會走忠孝東路，注入後應改走市民大道或仁愛路）
"""

import requests
import json
import random
from datetime import datetime, timezone

# Firebase 設定
PROJECT_ID = "mapcomment-8f128"
API_KEY = "AIzaSyARsnFTWt2MSbQc2mL8_5iIXqIoPcg2f70"
FIRESTORE_URL = f"https://firestore.googleapis.com/v1/projects/{PROJECT_ID}/databases/(default)/documents/bike_map_opinions"

# 忠孝東路座標點（國父紀念館 → 台北車站）
# 這是這段路線最直接的路徑
ZHONGXIAO_ROAD_POINTS = [
    # 忠孝東路四段（國父紀念館附近）
    {"lat": 25.0400, "lng": 121.5575},
    {"lat": 25.0403, "lng": 121.5555},
    {"lat": 25.0405, "lng": 121.5535},
    {"lat": 25.0408, "lng": 121.5515},
    {"lat": 25.0410, "lng": 121.5495},
    {"lat": 25.0412, "lng": 121.5475},
    {"lat": 25.0415, "lng": 121.5455},
    # 忠孝東路三段（忠孝復興站附近）
    {"lat": 25.0418, "lng": 121.5436},
    {"lat": 25.0419, "lng": 121.5415},
    {"lat": 25.0420, "lng": 121.5395},
    {"lat": 25.0420, "lng": 121.5375},
    {"lat": 25.0420, "lng": 121.5355},
    # 忠孝東路二段（忠孝新生站附近）
    {"lat": 25.0420, "lng": 121.5329},
    {"lat": 25.0425, "lng": 121.5310},
    {"lat": 25.0430, "lng": 121.5290},
    # 忠孝東路一段（善導寺站附近）
    {"lat": 25.0435, "lng": 121.5270},
    {"lat": 25.0438, "lng": 121.5250},
    {"lat": 25.0442, "lng": 121.5230},
    {"lat": 25.0448, "lng": 121.5210},
    {"lat": 25.0455, "lng": 121.5190},
]


def make_firestore_doc(safety_score, smoothness_score, points):
    """將 Python dict 轉換為 Firestore REST API 格式"""
    avg = (safety_score + smoothness_score) / 2
    now = datetime.now(timezone.utc).isoformat()

    steps_array = []
    for p in points:
        steps_array.append({
            "mapValue": {
                "fields": {
                    "lat": {"doubleValue": p["lat"]},
                    "lng": {"doubleValue": p["lng"]}
                }
            }
        })

    return {
        "fields": {
            "safetyScore": {"integerValue": str(safety_score)},
            "smoothnessScore": {"integerValue": str(smoothness_score)},
            "averageScore": {"doubleValue": avg},
            "routeSummary": {"stringValue": "忠孝東路（測試低分路段）"},
            "distance": {"stringValue": "4.0 km"},
            "duration": {"stringValue": "15 mins"},
            "createdAt": {"stringValue": now},
            "steps": {"arrayValue": {"values": steps_array}},
            "overviewPath": {"arrayValue": {"values": steps_array}},
            "_testData": {"booleanValue": True}
        }
    }


def inject_feedback(count=30):
    """注入 N 筆低分回饋到 Firestore"""
    print(f"🚀 準備注入 {count} 筆低分數據到 Firestore...")
    print(f"📍 目標路段：忠孝東路（國父紀念館 → 台北車站）")
    print(f"🔗 Firestore: {FIRESTORE_URL}")
    print()

    success = 0
    fail = 0

    for i in range(count):
        # 隨機低分：safety 1-2, smoothness 1-2
        safety = random.choice([1, 1, 1, 2])
        smoothness = random.choice([1, 1, 2, 2])

        doc = make_firestore_doc(safety, smoothness, ZHONGXIAO_ROAD_POINTS)

        try:
            response = requests.post(
                f"{FIRESTORE_URL}?key={API_KEY}",
                json=doc,
                headers={"Content-Type": "application/json"}
            )

            if response.status_code == 200:
                doc_id = response.json().get("name", "").split("/")[-1]
                print(f"  ✅ [{i+1}/{count}] safety={safety}, smooth={smoothness} → {doc_id}")
                success += 1
            else:
                print(f"  ❌ [{i+1}/{count}] HTTP {response.status_code}: {response.text[:100]}")
                fail += 1
        except Exception as e:
            print(f"  ❌ [{i+1}/{count}] Error: {e}")
            fail += 1

    print()
    print(f"📊 完成！成功 {success} 筆，失敗 {fail} 筆")
    print()
    print("🧪 測試方法：")
    print("   1. 重新整理網頁 (F5)")
    print("   2. 勾選「🛡️ 避開危險區域」")
    print("   3. 規劃路線：國父紀念館 → 台北車站")
    print("   4. 觀察路線是否避開忠孝東路（應改走市民大道或仁愛路）")
    print("   5. Console 應出現 'Hidden Danger Zone' 及 'Public Opinion W=-X.XX' 的 log")


if __name__ == "__main__":
    inject_feedback(30)
