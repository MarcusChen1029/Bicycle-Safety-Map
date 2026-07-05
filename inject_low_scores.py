"""
測試用腳本：在 Firestore 中注入低分數據
目標路段：忠孝東路（國父紀念館 → 台北車站方向）
用途：測試 routePlanner 是否會避開低分路段
測試路線：國父紀念館 → 台北車站（正常會走忠孝東路，注入後應改走市民大道或仁愛路）

⚠️ 危險：本腳本會對「正式」 Firebase 專案寫入假資料。
預設為 dry-run（只印出將會寫入的內容，不會呼叫 Firestore）。
真的要寫入請加 --apply，並在提示時輸入 yes 確認（或加 --yes 跳過提示）。
"""

import argparse
import random
import sys
from datetime import datetime, timezone

import requests

# Windows 主控台預設編碼（cp950）印不出 emoji，這裡強制用 UTF-8 輸出避免炸掉
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

# Firebase 設定 (must match js/firebaseConfig.js)
DEFAULT_PROJECT_ID = "bycyclesafetymap"
API_KEY = "AIzaSyCe3E6azBZ2NGXTnROpt1gsUKUtKuq6L1Q"

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


def inject_feedback(count=30, project_id=DEFAULT_PROJECT_ID, apply=False, skip_confirm=False):
    """注入 N 筆低分回饋到 Firestore（預設 dry-run，不會真的寫入）"""
    firestore_url = (
        f"https://firestore.googleapis.com/v1/projects/{project_id}"
        f"/databases/(default)/documents/bike_map_opinions"
    )

    # 先產生這次會寫入的所有文件內容，dry-run 與 apply 共用同一份資料
    docs = []
    for i in range(count):
        # 隨機低分：safety 1-2, smoothness 1-2
        safety = random.choice([1, 1, 1, 2])
        smoothness = random.choice([1, 1, 2, 2])
        docs.append((safety, smoothness, make_firestore_doc(safety, smoothness, ZHONGXIAO_ROAD_POINTS)))

    if not apply:
        print("🧪 DRY-RUN（預設模式，不會寫入 Firestore，也不會發出任何網路請求）")
        print(f"🎯 目標專案：{project_id}")
        print(f"🔗 Firestore collection: bike_map_opinions")
        print(f"📍 目標路段：忠孝東路（國父紀念館 → 台北車站）")
        print(f"📦 將會寫入 {count} 筆文件（尚未寫入）：")
        for i, (safety, smoothness, doc) in enumerate(docs):
            avg = doc["fields"]["averageScore"]["doubleValue"]
            print(f"  [{i+1}/{count}] safety={safety}, smooth={smoothness}, avg={avg}")
        print()
        print("👉 這只是預覽。真的要寫入請加上 --apply（會要求輸入 yes 確認）。")
        return

    print(f"🚀 準備注入 {count} 筆低分數據到 Firestore...")
    print(f"⚠️  這會對「正式」 Firebase 專案寫入資料：{project_id}")
    print(f"📍 目標路段：忠孝東路（國父紀念館 → 台北車站）")
    print(f"🔗 Firestore: {firestore_url}")
    print()

    if not skip_confirm:
        answer = input(f"確定要對專案 \"{project_id}\" 寫入 {count} 筆假資料嗎？輸入 yes 以繼續：")
        if answer.strip().lower() != "yes":
            print("已取消，未寫入任何資料。")
            return

    success = 0
    fail = 0

    for i, (safety, smoothness, doc) in enumerate(docs):
        try:
            response = requests.post(
                f"{firestore_url}?key={API_KEY}",
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


def main():
    parser = argparse.ArgumentParser(
        description="測試用腳本：在 Firestore 注入低分數據（預設 dry-run，不會寫入）"
    )
    parser.add_argument(
        "--project", default=DEFAULT_PROJECT_ID,
        help=f"目標 Firebase 專案 ID（預設：{DEFAULT_PROJECT_ID}）"
    )
    parser.add_argument(
        "--apply", action="store_true",
        help="真的執行寫入。不加這個參數只會 dry-run 預覽。"
    )
    parser.add_argument(
        "--yes", action="store_true",
        help="搭配 --apply 使用，跳過互動式 yes 確認（供自動化腳本使用）"
    )
    parser.add_argument(
        "--count", type=int, default=30,
        help="要注入的文件數量（預設 30）"
    )
    args = parser.parse_args()

    if args.yes and not args.apply:
        print("錯誤：--yes 必須搭配 --apply 使用。", file=sys.stderr)
        sys.exit(1)

    inject_feedback(
        count=args.count,
        project_id=args.project,
        apply=args.apply,
        skip_confirm=args.yes,
    )


if __name__ == "__main__":
    main()
