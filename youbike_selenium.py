"""Automated Selenium smoke test for the Bicycle Safety Map.

It loads the page and reports problems it finds, covering two areas:

  1. Page health   - map initializes, the map-control buttons exist and are
                     clickable, YouBike data loads, and the YouBike layer toggle
                     actually flips the layer's visibility.
  2. Report flows  - the "騎乘回饋" feedback modal (star rating + submit) and the
                     "回報問題" report form (validation wiring).

It also collects browser console errors and failed network requests and lists
them as problems.

Safe by default: it never writes to production Firestore. The feedback modal is
opened directly with no active route, so submitting produces no road votes
(script.js only calls submitVotes when the route has road names). The report form
is exercised only up to its validation guards, which return before the Firestore
write. Pass --submit-report to actually send one real report (writes to prod).

Usage:
    npx http-server -p 8080          # or: python -m http.server 8080
    pip install selenium             # 4.6+ auto-manages the driver

    python youbike_selenium.py                       # headed, full report
    python youbike_selenium.py --headless
    python youbike_selenium.py --strict              # console/network issues fail too
    python youbike_selenium.py --submit-report       # also send a real report

Exit code is non-zero if any functional check fails (or, with --strict, if any
console error / failed request is seen).
"""

import argparse
import datetime
import json
import random
import sys

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import Select, WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import (
    ElementClickInterceptedException,
    NoAlertPresentException,
    TimeoutException,
)

# Bounding box for Taipei City — a real report is placed at a random point inside
# this box so it shows on the map but stays within Taipei only.
TAIPEI_LAT = (24.96, 25.21)
TAIPEI_LNG = (121.45, 121.66)

# A live handle to the app, exposed by main.js once Google Maps has initialized.
LAYER_JS = "window._routePlannerRef && window._routePlannerRef.youbikeLayer"

# Map-control buttons: element id -> human label used in the report.
CONTROL_BUTTONS = {
    "toggle-youbike-btn": "YouBike 圖層",
    "toggle-youbike-route-btn": "單車模式",
    "toggle-bikelane-btn": "自行車道",
}


class Report:
    """Collects check results and problems, then prints/serializes them."""

    def __init__(self):
        self.checks = []      # (area, name, status, detail) ; status in PASS/FAIL/WARN
        self.problems = []    # (severity, source, message)

    def ok(self, area, name, detail=""):
        self.checks.append((area, name, "PASS", detail))
        print(f"  [PASS] {name}" + (f" — {detail}" if detail else ""))

    def fail(self, area, name, detail=""):
        self.checks.append((area, name, "FAIL", detail))
        self.problems.append(("FAIL", f"{area}/{name}", detail))
        print(f"  [FAIL] {name}" + (f" — {detail}" if detail else ""))

    def warn(self, area, name, detail=""):
        self.checks.append((area, name, "WARN", detail))
        self.problems.append(("WARN", f"{area}/{name}", detail))
        print(f"  [WARN] {name}" + (f" — {detail}" if detail else ""))

    def counts(self):
        c = {"PASS": 0, "FAIL": 0, "WARN": 0}
        for _, _, status, _ in self.checks:
            c[status] += 1
        return c

    def render_text(self):
        c = self.counts()
        lines = [
            "Bicycle Safety Map — Selenium test report",
            "Generated: " + datetime.datetime.now().isoformat(timespec="seconds"),
            f"Summary: {c['PASS']} passed, {c['FAIL']} failed, {c['WARN']} warnings",
            "",
            "Checks:",
        ]
        for area, name, status, detail in self.checks:
            lines.append(f"  [{status}] {area} / {name}" + (f" — {detail}" if detail else ""))
        lines.append("")
        if self.problems:
            lines.append("Problems found:")
            for severity, source, message in self.problems:
                lines.append(f"  ({severity}) {source}: {message}")
        else:
            lines.append("Problems found: none")
        return "\n".join(lines) + "\n"


def js(driver, script):
    return driver.execute_script(f"return ({script});")


def accept_alert(driver, timeout):
    """Wait for an alert, return its text, and accept it. None if no alert."""
    try:
        WebDriverWait(driver, timeout).until(EC.alert_is_present())
    except TimeoutException:
        return None
    alert = driver.switch_to.alert
    text = alert.text
    alert.accept()
    return text


def dismiss_stray_alert(driver):
    try:
        driver.switch_to.alert.accept()
    except NoAlertPresentException:
        pass


def clear_toasts(driver):
    """Remove any lingering feedback toast so it can't intercept later clicks."""
    driver.execute_script(
        "document.querySelectorAll('.feedback-toast').forEach(function(t){t.remove();});"
    )


def safe_click(driver, el):
    """Scroll an element into view and click it, retrying once past a toast overlay."""
    driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", el)
    try:
        el.click()
    except ElementClickInterceptedException:
        clear_toasts(driver)
        el.click()


# --------------------------------------------------------------------------- #
# Checks
# --------------------------------------------------------------------------- #

def wait_ready(driver, timeout):
    WebDriverWait(driver, timeout).until(
        lambda d: d.execute_script(f"return !!({LAYER_JS});")
    )


def check_health(driver, rep, timeout):
    area = "health"
    print("Health checks:")

    # Map / app initialized (reached here only if wait_ready passed).
    rep.ok(area, "map-initialized", "window._routePlannerRef.youbikeLayer present")

    # Control buttons present, displayed, enabled.
    for btn_id, label in CONTROL_BUTTONS.items():
        els = driver.find_elements(By.ID, btn_id)
        if not els:
            rep.fail(area, f"button:{btn_id}", f"{label} 按鈕不存在")
            continue
        el = els[0]
        if el.is_displayed() and el.is_enabled():
            rep.ok(area, f"button:{btn_id}", f"{label} 可見且可點")
        else:
            rep.fail(area, f"button:{btn_id}",
                     f"{label} 存在但不可互動 (displayed={el.is_displayed()}, enabled={el.is_enabled()})")

    # YouBike station data loaded (external API — a warning, not a hard fail).
    try:
        WebDriverWait(driver, timeout).until(
            lambda d: d.execute_script(f"return (({LAYER_JS}).allStations || []).length > 0;")
        )
        n = js(driver, f"({LAYER_JS}).allStations.length")
        rep.ok(area, "youbike-data", f"載入 {n} 個站點")
    except TimeoutException:
        rep.warn(area, "youbike-data", "YouBike 站點資料未載入（外部 API，可能是網路/來源問題）")

    # YouBike layer toggle actually flips visibility.
    try:
        before = bool(js(driver, f"({LAYER_JS}).visible"))
        driver.find_element(By.ID, "toggle-youbike-btn").click()
        WebDriverWait(driver, timeout).until(
            lambda d: bool(d.execute_script(f"return ({LAYER_JS}).visible;")) != before
        )
        driver.find_element(By.ID, "toggle-youbike-btn").click()
        WebDriverWait(driver, timeout).until(
            lambda d: bool(d.execute_script(f"return ({LAYER_JS}).visible;")) == before
        )
        rep.ok(area, "youbike-toggle", f"visible {before}→{not before}→{before}")
    except TimeoutException:
        rep.fail(area, "youbike-toggle", "點擊 YouBike 按鈕後圖層 visible 狀態沒有翻轉")


def check_feedback(driver, rep, timeout):
    area = "feedback"
    print("Feedback modal checks:")

    if not js(driver, "typeof showFeedbackModal === 'function'"):
        rep.fail(area, "open-modal", "showFeedbackModal() 不存在，無法開啟回饋視窗")
        return

    driver.execute_script("showFeedbackModal();")
    try:
        WebDriverWait(driver, timeout).until(
            lambda d: d.execute_script(
                "var m=document.getElementById('feedback-modal');"
                "return m && getComputedStyle(m).display !== 'none';"
            )
        )
    except TimeoutException:
        rep.fail(area, "open-modal", "呼叫 showFeedbackModal() 後視窗沒有顯示")
        return

    stars = driver.find_elements(By.CSS_SELECTOR,
                                 ".feedback-stars[data-dimension='overall'] .feedback-star")
    if len(stars) == 5:
        rep.ok(area, "open-modal", "回饋視窗開啟，5 顆星就緒")
    else:
        rep.fail(area, "open-modal", f"預期 5 顆星，實際 {len(stars)}")
        return

    # Submitting with 0 stars must be blocked by a validation alert.
    driver.find_element(By.ID, "feedback-submit-btn").click()
    text = accept_alert(driver, timeout)
    if text and "星" in text:
        rep.ok(area, "zero-star-guard", f"未評分即送出被擋下：{text!r}")
    else:
        rep.fail(area, "zero-star-guard", f"未評分送出時未出現預期警告 (got {text!r})")

    # Selecting a star updates the visual state and score label.
    stars[3].click()  # 4th star
    active = js(driver,
                "document.querySelectorAll(\".feedback-stars[data-dimension='overall'] "
                ".feedback-star.active\").length")
    label = js(driver, "document.getElementById('overall-score-text').textContent")
    if active == 4 and "4" in (label or ""):
        rep.ok(area, "star-select", f"選 4 星 → {active} 顆點亮, 文字 {label!r}")
    else:
        rep.fail(area, "star-select", f"選 4 星後狀態不符 (active={active}, label={label!r})")

    # Submitting a valid rating: with no active route there are no road names, so
    # no Firestore write happens; the modal should close and a toast should show.
    driver.find_element(By.ID, "feedback-submit-btn").click()
    try:
        WebDriverWait(driver, timeout).until(
            lambda d: d.execute_script(
                "var m=document.getElementById('feedback-modal');"
                "return !m || getComputedStyle(m).display === 'none' "
                "|| document.getElementById('feedback-road-checklist').style.display !== 'none';"
            )
        )
        checklist_open = js(driver,
                            "document.getElementById('feedback-road-checklist').style.display !== 'none'")
        if checklist_open:
            rep.ok(area, "submit", "送出後進入第二階段路段勾選（有可辨識路名）")
            driver.execute_script("hideFeedbackModal();")
        else:
            toast = driver.find_elements(By.CSS_SELECTOR, ".feedback-toast")
            rep.ok(area, "submit",
                   "送出後視窗關閉" + ("，並出現感謝 toast" if toast else "（未偵測到 toast）"))
    except TimeoutException:
        stray = accept_alert(driver, 1)
        if stray:
            rep.fail(area, "submit", f"送出回饋失敗，出現錯誤警告：{stray!r}")
        else:
            rep.fail(area, "submit", "送出回饋後視窗既未關閉也未進入第二階段")
        driver.execute_script("hideFeedbackModal();")

    dismiss_stray_alert(driver)
    driver.execute_script("hideFeedbackModal();")
    clear_toasts(driver)  # keep the thank-you toast from intercepting later clicks


def check_report_form(driver, rep, timeout, do_submit):
    area = "report"
    print("Report form checks:")

    clear_toasts(driver)

    # Switch to the Report tab (bottom nav index 2: Map, Route, Report, More).
    nav_items = driver.find_elements(By.CSS_SELECTOR, ".nav-item")
    if len(nav_items) < 3:
        rep.fail(area, "open-tab", f"找不到 Report 分頁（nav-item 只有 {len(nav_items)} 個）")
        return
    nav_items[2].click()
    try:
        WebDriverWait(driver, timeout).until(
            EC.visibility_of_element_located((By.ID, "submit-report-btn"))
        )
    except TimeoutException:
        rep.fail(area, "open-tab", "切換到回報分頁後表單未顯示")
        return
    rep.ok(area, "open-tab", "回報問題分頁開啟，表單可見")

    # Required fields present.
    missing = [fid for fid in ("report-type", "report-desc", "report-location", "submit-report-btn")
               if not driver.find_elements(By.ID, fid)]
    if missing:
        rep.fail(area, "fields", "缺少欄位：" + ", ".join(missing))
        return
    rep.ok(area, "fields", "類型/描述/地點/送出 欄位齊全")

    # Validation 1: no problem type selected -> blocked.
    driver.find_element(By.ID, "report-desc").clear()
    safe_click(driver, driver.find_element(By.ID, "submit-report-btn"))
    text = accept_alert(driver, timeout)
    if text and "類型" in text:
        rep.ok(area, "validate-type", f"未選類型被擋下：{text!r}")
    else:
        rep.warn(area, "validate-type", f"未選類型時未出現預期警告 (got {text!r})")

    # Validation 2: type chosen but empty description -> blocked.
    try:
        Select(driver.find_element(By.ID, "report-type")).select_by_value("pothole")
    except Exception as exc:  # noqa: BLE001 - surface any select problem as a finding
        rep.fail(area, "validate-desc", f"無法選擇問題類型：{exc}")
        return
    driver.find_element(By.ID, "report-desc").clear()
    safe_click(driver, driver.find_element(By.ID, "submit-report-btn"))
    text = accept_alert(driver, timeout)
    if text and "描述" in text:
        rep.ok(area, "validate-desc", f"空描述被擋下：{text!r}")
    else:
        rep.warn(area, "validate-desc", f"空描述時未出現預期警告 (got {text!r})")

    if not do_submit:
        rep.ok(area, "submit", "略過真實送出（預設不寫入正式 Firestore；--submit-report 可開啟）")
        return

    # Opt-in: perform a real submission (writes to production Firestore `reports`),
    # placed at a random point inside Taipei so it appears on the map (Taipei only).
    # The "lat, lng" text is parsed directly by the app — no Geocoder call needed.
    lat = round(random.uniform(*TAIPEI_LAT), 5)
    lng = round(random.uniform(*TAIPEI_LNG), 5)
    stamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    Select(driver.find_element(By.ID, "report-type")).select_by_value("other")
    driver.find_element(By.ID, "report-location").clear()
    driver.find_element(By.ID, "report-location").send_keys(f"{lat}, {lng}")
    driver.find_element(By.ID, "report-desc").clear()
    driver.find_element(By.ID, "report-desc").send_keys(f"[自動化測試] Selenium smoke test {stamp}")
    safe_click(driver, driver.find_element(By.ID, "submit-report-btn"))
    text = accept_alert(driver, max(timeout, 20))
    if text and "成功" in text:
        rep.ok(area, "submit", f"真實送出成功，已在台北 ({lat}, {lng}) 新增回報：{text!r}")
    else:
        rep.fail(area, "submit", f"真實送出未收到成功訊息 (got {text!r})")


def collect_logs(driver, rep, strict):
    area = "logs"
    print("Collecting console + network problems:")
    reporter = rep.fail if strict else rep.warn

    # Browser console: SEVERE entries (favicon noise dropped, then de-duplicated).
    try:
        messages, seen = [], set()
        for e in driver.get_log("browser"):
            if e.get("level") != "SEVERE":
                continue
            msg = e.get("message", "")
            if "favicon.ico" in msg:
                continue
            if msg not in seen:
                seen.add(msg)
                messages.append(msg)
        if messages:
            for msg in messages[:25]:
                reporter(area, "console-error", msg[:300])
        else:
            rep.ok(area, "console-error", "沒有 SEVERE 主控台錯誤")
    except Exception as exc:  # noqa: BLE001
        rep.warn(area, "console-error", f"無法讀取主控台日誌：{exc}")

    # Network: failed requests via the performance log.
    try:
        failures = []
        for entry in driver.get_log("performance"):
            msg = json.loads(entry["message"])["message"]
            method = msg.get("method")
            if method == "Network.responseReceived":
                resp = msg["params"]["response"]
                if resp.get("status", 0) >= 400:
                    failures.append(f"HTTP {resp['status']} {resp.get('url', '')}")
            elif method == "Network.loadingFailed":
                params = msg["params"]
                if not params.get("canceled"):
                    failures.append(f"{params.get('errorText', 'failed')} {params.get('type', '')}")
        # Drop known-benign noise (a missing favicon is not a page problem).
        failures = [f for f in failures if "favicon.ico" not in f]
        # De-duplicate while preserving order.
        seen, unique = set(), []
        for f in failures:
            if f not in seen:
                seen.add(f)
                unique.append(f)
        if unique:
            for f in unique[:25]:
                reporter(area, "network-failure", f[:300])
        else:
            rep.ok(area, "network-failure", "沒有失敗的網路請求")
    except Exception as exc:  # noqa: BLE001
        rep.warn(area, "network-failure", f"無法讀取效能/網路日誌：{exc}")


# --------------------------------------------------------------------------- #

def build_driver(headless):
    options = webdriver.ChromeOptions()
    if headless:
        options.add_argument("--headless=new")
    options.add_argument("--window-size=1280,900")
    # Keep JS alerts around so we can read and accept them ourselves.
    options.set_capability("unhandledPromptBehavior", "ignore")
    # Capture console + network for problem reporting.
    options.set_capability("goog:loggingPrefs", {"browser": "ALL", "performance": "ALL"})
    options.add_experimental_option("perfLoggingPrefs", {"enableNetwork": True})
    return webdriver.Chrome(options=options)


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--url", default="http://127.0.0.1:8080",
                        help="URL the app is served at (default: %(default)s)")
    parser.add_argument("--timeout", type=float, default=30.0,
                        help="Max seconds for waits (default: %(default)s)")
    parser.add_argument("--headless", action="store_true", help="Run Chrome headless")
    parser.add_argument("--strict", action="store_true",
                        help="Treat console errors and failed requests as failures")
    parser.add_argument("--submit-report", action="store_true",
                        help="Actually submit one real report (writes to production Firestore)")
    parser.add_argument("--report", default="selenium_test_report.txt",
                        help="Path to write the text report (default: %(default)s)")
    args = parser.parse_args()

    # The console may be a legacy codepage (e.g. cp950 on zh-TW Windows) that
    # can't encode the emoji found in app console logs; force UTF-8 output so
    # printing the report never crashes. The report file is already UTF-8.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass

    rep = Report()
    driver = build_driver(args.headless)
    try:
        print(f"Opening {args.url} ...")
        driver.get(args.url)
        try:
            wait_ready(driver, args.timeout)
        except TimeoutException:
            rep.fail("health", "map-initialized",
                     "地圖未在時限內初始化（window._routePlannerRef 未出現）— "
                     "可能是伺服器未啟動、Google Maps API key 無效或網路問題")
            # Still try to collect console/network clues before giving up.
            collect_logs(driver, rep, args.strict)
        else:
            check_health(driver, rep, args.timeout)
            check_feedback(driver, rep, args.timeout)
            check_report_form(driver, rep, args.timeout, args.submit_report)
            collect_logs(driver, rep, args.strict)
    finally:
        driver.quit()

    report_text = rep.render_text()
    print("\n" + "=" * 60)
    print(report_text, end="")
    try:
        with open(args.report, "w", encoding="utf-8") as fh:
            fh.write(report_text)
        print(f"(report written to {args.report})")
    except OSError as exc:
        print(f"(could not write report file: {exc})")

    failures = rep.counts()["FAIL"]
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
