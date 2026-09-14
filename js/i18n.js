/**
 * UI language (zh / en). Browser global + Node-requirable.
 * Static markup: data-i18n (text), data-i18n-html, data-i18n-placeholder,
 * data-i18n-title, data-i18n-aria-label (+ optional data-i18n-params JSON).
 * Dynamic text: I18N.setText(el, key, params) so a later switch re-translates it.
 * Google Maps stays zh-TW; only our own UI text lives here.
 */
const I18N = (() => {
  const STORAGE_KEY = 'bike_map_lang';
  const LANGS = ['zh', 'en'];
  const HTML_LANG = { zh: 'zh-Hant', en: 'en' };

  const STRINGS = {
    zh: {
      // Language toggle — the label names the language you switch TO
      'lang.toggle': 'EN',
      'lang.toggleAria': '切換為英文',
      // App shell
      'app.title': '自行車安全地圖',
      'app.toggleYoubikeLayer': 'YouBike層',
      'app.toggleYoubikeMode': 'Youbike模式',
      'app.toggleBikelane': '自行車道',
      // Common words
      'common.search': '搜尋',
      'common.clear': '清除',
      'common.close': '關閉',
      'common.skip': '跳過',
      'common.end': '結束',
      // Bottom tabs
      'tabs.map': '地圖',
      'tabs.favorites': '常用',
      'tabs.report': '回報',
      'tabs.more': '更多',
      // Search bar
      'search.placeholder': '搜尋地點或地址（例：台北101、忠孝東路）',
      'avoid.label': '🛡️ 避開危險區域',
      // Route planner
      'route.startPlaceholder': '起點地址',
      'route.endPlaceholder': '終點地址',
      'route.useMyLocation': '使用目前位置',
      'route.swap': '對調起終點',
      'route.plan': '規劃路線',
      'route.clearRoute': '清除路線',
      'route.planning': '規劃路線中…',
      'route.setOrigin': '設為起點',
      'route.setDest': '設為終點',
      'route.hint': '起點／終點的輸入已移到上方搜尋列——點一下搜尋列即可展開規劃面板。',
      // Navigation
      'nav.preparing': '準備導航中...',
      'nav.start': '開始導航',
      // Inspect panel & stats
      'fav.add': '加入常用地址',
      'stats.friendlinessLabel': '友善等級:',
      'stats.infrastructure': '基礎設施',
      'stats.trafficRisk': '交通環境風險',
      'stats.accidentHistory': '歷史事故',
      'stats.publicFeedback': '民眾意見',
      'report.flagButton': '🚩 舉報',
      // Favorites tab
      'fav.heading': '常用地址',
      'fav.subheading': '⭐ 常用地址',
      'fav.namePlaceholder': '名稱 (例如: 家、公司)',
      'fav.addrPlaceholder': '完整地址',
      // Report form
      'report.heading': '回報問題',
      'report.desc': '協助改善騎乘環境，請填寫下方資訊以回報道路狀況：',
      'report.typeLabel': '問題類型',
      'report.selectTypeOption': '請選擇問題類型',
      'report.type.pothole': '路面坑洞',
      'report.type.illegalParking': '違規停車',
      'report.type.illegalParkingOption': '違規停車 (佔用自行車道)',
      'report.type.obstacle': '道路障礙物',
      'report.type.fadedLines': '標線模糊或毀損',
      'report.type.accident': '事故發生',
      'report.type.other': '其他',
      'report.locationLabel': '發生地點',
      'report.locationPlaceholder': '點擊右側按鈕取得目前位置或自行輸入',
      'report.getLocation': '取得目前位置',
      'report.descLabel': '問題描述',
      'report.descPlaceholder': '請簡短描述現場狀況...',
      'report.photoLabel': '上傳照片 (選填)',
      'report.submit': '送出回報',
      // More tab
      'tour.start': '▶️ 新手教學',
      'legend.heading': '友善等級圖例',
      'legend.desc': '路線與道路的評分依 基礎設施、交通環境風險、歷史事故、民眾意見 四項加權計算，對應下列等級：',
      'legend.gradeA': '<b>A</b>（分數 &gt; 72）— 非常友善',
      'legend.gradeB': '<b>B</b>（分數 &gt; 60）— 友善',
      'legend.gradeC': '<b>C</b>（分數 &gt; 48）— 普通',
      'legend.gradeD': '<b>D</b>（分數 &gt; 36）— 欠佳',
      'legend.gradeE': '<b>E</b>（分數 &le; 36）— 不友善',
      'cache.heading': '資料快取',
      'cache.desc': '道路統計與評分資料會快取在本機瀏覽器中以加快載入速度。若資料顯示異常，可清除快取重新抓取最新資料。',
      'cache.clear': '清除快取資料',
      'about.heading': '關於',
      'about.desc': 'Bicycle Safety Map 協助騎士規劃更安全的自行車路線，結合道路基礎設施、事故熱點與社群回饋，標示每段路的友善等級。歡迎透過「回報問題」與「騎乘回饋」持續改善資料品質。',
      // Feedback modal
      'feedback.heading': '騎乘回饋',
      'feedback.subtitle': '請根據您的實際騎乘體驗評分',
      'feedback.overallLabel': '🚴 整體騎乘體驗',
      'feedback.score0': '尚未評分',
      'feedback.roadChecklistLabel': '哪幾條路不好？（勾選後送出）',
      'feedback.submit': '送出回饋',
      // Report submit & cache
      'common.submitting': '送出中...',
      'report.alertSelectType': '請選擇問題類型！',
      'report.alertFillDescription': '請填寫問題描述！',
      'report.locateFailed': '無法定位回報地點，請點擊 📍 取得目前位置，或輸入正確的地址。',
      'report.submitSuccess': '回報已成功送出！感謝您協助改善騎乘環境。',
      'report.submitFailed': '回報送出失敗，請稍後再試。',
      'cache.cleared': '快取已清除，重新整理頁面後將重新載入最新資料。',
      // Feedback modal (dynamic)
      'feedback.score1': '1★ 很差',
      'feedback.score2': '2★ 不佳',
      'feedback.score3': '3★ 普通',
      'feedback.score4': '4★ 良好',
      'feedback.score5': '5★ 非常好',
      'feedback.confirmSubmit': '確認送出',
      'feedback.selectStars': '請先點選星數！',
      'feedback.thanks': '✅ 感謝您的回饋！',
      'feedback.submitFailed': '回饋送出失敗，請稍後再試。',
      'nav.autoOrigin': '📍 已自動以目前位置作為起點',
    },
    en: {
      // Language toggle — the label names the language you switch TO
      'lang.toggle': '中文',
      'lang.toggleAria': 'Switch to Chinese',
      // App shell
      'app.title': 'Bicycle Safety Map',
      'app.toggleYoubikeLayer': 'YouBike stations',
      'app.toggleYoubikeMode': 'YouBike mode',
      'app.toggleBikelane': 'Bike lanes',
      // Common words
      'common.search': 'Search',
      'common.clear': 'Clear',
      'common.close': 'Close',
      'common.skip': 'Skip',
      'common.end': 'End',
      // Bottom tabs
      'tabs.map': 'Map',
      'tabs.favorites': 'Favorites',
      'tabs.report': 'Report',
      'tabs.more': 'More',
      // Search bar
      'search.placeholder': 'Search a place or address (e.g. Taipei 101, Zhongxiao E. Rd.)',
      'avoid.label': '🛡️ Avoid danger zones',
      // Route planner
      'route.startPlaceholder': 'Start address',
      'route.endPlaceholder': 'Destination address',
      'route.useMyLocation': 'Use current location',
      'route.swap': 'Swap start and destination',
      'route.plan': 'Plan route',
      'route.clearRoute': 'Clear route',
      'route.planning': 'Planning route…',
      'route.setOrigin': 'Set as start',
      'route.setDest': 'Set as destination',
      'route.hint': 'Start and destination inputs are now in the search bar above — tap it to open the route planner.',
      // Navigation
      'nav.preparing': 'Preparing navigation...',
      'nav.start': 'Start navigation',
      // Inspect panel & stats
      'fav.add': 'Add to saved places',
      'stats.friendlinessLabel': 'Friendliness grade:',
      'stats.infrastructure': 'Infrastructure',
      'stats.trafficRisk': 'Traffic risk',
      'stats.accidentHistory': 'Accident history',
      'stats.publicFeedback': 'Community feedback',
      'report.flagButton': '🚩 Report',
      // Favorites tab
      'fav.heading': 'Saved places',
      'fav.subheading': '⭐ Saved places',
      'fav.namePlaceholder': 'Name (e.g. Home, Work)',
      'fav.addrPlaceholder': 'Full address',
      // Report form
      'report.heading': 'Report an issue',
      'report.desc': 'Help improve riding conditions — fill in the details below to report a road problem:',
      'report.typeLabel': 'Issue type',
      'report.selectTypeOption': 'Select an issue type',
      'report.type.pothole': 'Pothole',
      'report.type.illegalParking': 'Illegal parking',
      'report.type.illegalParkingOption': 'Illegal parking (blocking the bike lane)',
      'report.type.obstacle': 'Road obstacle',
      'report.type.fadedLines': 'Faded or damaged road markings',
      'report.type.accident': 'Accident',
      'report.type.other': 'Other',
      'report.locationLabel': 'Location',
      'report.locationPlaceholder': 'Tap the button on the right for your current location, or type an address',
      'report.getLocation': 'Get current location',
      'report.descLabel': 'Description',
      'report.descPlaceholder': 'Briefly describe the situation...',
      'report.photoLabel': 'Upload a photo (optional)',
      'report.submit': 'Submit report',
      // More tab
      'tour.start': '▶️ Tutorial',
      'legend.heading': 'Friendliness grade legend',
      'legend.desc': 'Route and road scores are a weighted mix of infrastructure, traffic risk, accident history, and community feedback, mapped to these grades:',
      'legend.gradeA': '<b>A</b> (score &gt; 72) — Very friendly',
      'legend.gradeB': '<b>B</b> (score &gt; 60) — Friendly',
      'legend.gradeC': '<b>C</b> (score &gt; 48) — Average',
      'legend.gradeD': '<b>D</b> (score &gt; 36) — Poor',
      'legend.gradeE': '<b>E</b> (score &le; 36) — Unfriendly',
      'cache.heading': 'Data cache',
      'cache.desc': 'Road statistics and scores are cached in your browser so the map loads faster. If the data looks wrong, clear the cache to fetch the latest data.',
      'cache.clear': 'Clear cached data',
      'about.heading': 'About',
      'about.desc': 'Bicycle Safety Map helps riders plan safer bike routes by combining road infrastructure, accident hotspots, and community feedback to grade how friendly each road is. Use "Report an issue" and "Ride feedback" to help keep the data accurate.',
      // Feedback modal
      'feedback.heading': 'Ride feedback',
      'feedback.subtitle': 'Rate your actual riding experience',
      'feedback.overallLabel': '🚴 Overall ride',
      'feedback.score0': 'Not rated yet',
      'feedback.roadChecklistLabel': 'Which roads were bad? (Check them, then submit)',
      'feedback.submit': 'Submit feedback',
      // Report submit & cache
      'common.submitting': 'Submitting...',
      'report.alertSelectType': 'Please choose an issue type!',
      'report.alertFillDescription': 'Please add a description!',
      'report.locateFailed': 'Couldn\'t locate the report. Tap 📍 to use your current location, or enter a valid address.',
      'report.submitSuccess': 'Report submitted! Thanks for helping improve riding conditions.',
      'report.submitFailed': 'Couldn\'t submit the report. Please try again later.',
      'cache.cleared': 'Cache cleared. Refresh the page to load the latest data.',
      // Feedback modal (dynamic)
      'feedback.score1': '1★ Very poor',
      'feedback.score2': '2★ Poor',
      'feedback.score3': '3★ Average',
      'feedback.score4': '4★ Good',
      'feedback.score5': '5★ Excellent',
      'feedback.confirmSubmit': 'Confirm',
      'feedback.selectStars': 'Please pick a star rating first!',
      'feedback.thanks': '✅ Thanks for your feedback!',
      'feedback.submitFailed': 'Couldn\'t submit feedback. Please try again later.',
      'nav.autoOrigin': '📍 Using your current location as the start',
    }
  };

  const ATTR_WRITERS = [
    ['data-i18n', (el, s) => { el.textContent = s; }],
    ['data-i18n-html', (el, s) => { el.innerHTML = s; }],
    ['data-i18n-placeholder', (el, s) => { el.placeholder = s; }],
    ['data-i18n-title', (el, s) => { el.title = s; }],
    ['data-i18n-aria-label', (el, s) => { el.setAttribute('aria-label', s); }]
  ];

  let lang = 'zh';
  const warned = new Set();

  function t(key, params) {
    let s = STRINGS[lang][key];
    if (s === undefined) s = STRINGS.zh[key];
    if (s === undefined) {
      if (!warned.has(key)) {
        warned.add(key);
        console.warn(`i18n: missing string "${key}"`);
      }
      return key;
    }
    if (params) {
      s = s.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
    }
    return s;
  }

  function getLang() {
    return lang;
  }

  function paramsOf(el) {
    const raw = el.getAttribute('data-i18n-params');
    if (!raw) return undefined;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return undefined;
    }
  }

  function apply(root) {
    if (!root || typeof root.querySelectorAll !== 'function') return;
    for (const [attr, write] of ATTR_WRITERS) {
      root.querySelectorAll(`[${attr}]`).forEach(el => write(el, t(el.getAttribute(attr), paramsOf(el))));
    }
  }

  function setText(el, key, params) {
    if (!el) return;
    el.setAttribute('data-i18n', key);
    if (params) {
      el.setAttribute('data-i18n-params', JSON.stringify(params));
    } else {
      el.removeAttribute('data-i18n-params');
    }
    el.textContent = t(key, params);
  }

  function syncDocument() {
    if (typeof document === 'undefined') return;
    document.documentElement.lang = HTML_LANG[lang];
    apply(document);
  }

  function setLang(next) {
    if (!LANGS.includes(next)) return false;
    lang = next;
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, next);
    } catch (e) {
      // Storage blocked (private mode etc.): still switch for this page view.
    }
    syncDocument();
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('langchange', { detail: { lang: next } }));
    }
    return true;
  }

  function init() {
    let saved = null;
    try {
      if (typeof localStorage !== 'undefined') saved = localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      saved = null;
    }
    lang = LANGS.includes(saved) ? saved : 'zh';
    if (typeof document === 'undefined') return;

    // Translate what is already parsed right away, then again once the rest
    // of the page (elements after this script tag) exists.
    syncDocument();
    const ready = () => {
      syncDocument();
      const toggleBtn = document.getElementById('lang-toggle-btn');
      if (toggleBtn) {
        toggleBtn.addEventListener('click', () => setLang(lang === 'zh' ? 'en' : 'zh'));
      }
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', ready);
    } else {
      ready();
    }
  }

  init();

  return { STRINGS, LANGS, t, getLang, setLang, apply, setText };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { I18N };
}
