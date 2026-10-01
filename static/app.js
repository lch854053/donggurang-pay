const SAMPLE_MERCHANTS = [
  { id: 1, name: "동명정육점", address: "전남광주통합특별시 동구 동명로 18", category: "축산물", lat: 35.14935, lng: 126.92355 },
  { id: 2, name: "푸른길 카페", address: "전남광주통합특별시 동구 동계천로 137", category: "카페·디저트", lat: 35.14996, lng: 126.92512 },
  { id: 3, name: "산수우리약국", address: "전남광주통합특별시 동구 필문대로 184", category: "의료·약국", lat: 35.15472, lng: 126.93042 },
  { id: 4, name: "대인시장 반찬가게", address: "전남광주통합특별시 동구 제봉로194번길 7", category: "식품", lat: 35.15468, lng: 126.91338 },
  { id: 5, name: "충장서림", address: "전남광주통합특별시 동구 충장로 87", category: "도서·문구", lat: 35.14821, lng: 126.91485 },
  { id: 6, name: "무등세탁소", address: "전남광주통합특별시 동구 경양로 342", category: "생활서비스", lat: 35.15916, lng: 126.92317 },
  { id: 7, name: "계림떡방앗간", address: "전남광주통합특별시 동구 무등로 321", category: "식품", lat: 35.16028, lng: 126.91832 },
  { id: 8, name: "학동우리분식", address: "전남광주통합특별시 동구 남문로 689", category: "음식점", lat: 35.13388, lng: 126.92735 },
  { id: 9, name: "조대안경원", address: "전남광주통합특별시 동구 필문대로 309", category: "안경", lat: 35.14285, lng: 126.92992 },
  { id: 10, name: "금남로 꽃집", address: "전남광주통합특별시 동구 금남로 203", category: "화훼", lat: 35.14776, lng: 126.91873 },
  { id: 11, name: "동구청앞 편의점", address: "전남광주통합특별시 동구 서남로 1", category: "편의점", lat: 35.14591, lng: 126.92316 },
  { id: 12, name: "문화전당 공방", address: "전남광주통합특별시 동구 문화전당로 38", category: "공예·잡화", lat: 35.14639, lng: 126.91991 }
];

const MOBILE_SAMPLE_MODE = new URLSearchParams(window.location.search).has("mobile-test");
const CATEGORY_GROUP_ORDER = ["음식점·카페", "식품·마트", "패션·뷰티", "의료·건강", "교육·문화", "생활·주거", "스포츠·여가", "기타"];
// Card-company industry codes are retained in the source data; show familiar labels instead.
const CATEGORY_LABELS = {
  일반한식: "한식", 서양음식: "양식·카페", 일식회집: "일식·초밥", 중국음식: "중식",
  스넥: "분식", 제과점: "빵집·디저트", 주점: "술집", 칵테일바: "바",
  슈퍼마켓: "마트", 편의점: "편의점", 농축수산품: "농수축산물", 정육점: "정육점",
  기타음료식품: "식품·음료", 미곡상: "쌀가게", 주류판매점: "주류", 인삼제품: "인삼·건강식품",
  홍삼제품: "홍삼·건강식품", 기타건강식: "건강식품", "비료/농약/사료/종자": "농업용품", 화원: "꽃집",
  정장: "의류", 맞춤복점: "맞춤 의류", 기타의류: "의류", 캐쥬얼의류: "의류",
  아동의류: "아동복", 스포츠의류: "스포츠 의류", 단체복: "단체복", 내의판매점: "속옷",
  양품점: "의류·잡화", 신발: "신발", 제화점: "신발", 가방: "가방",
  귀금속: "주얼리", 악세사리: "액세서리", 시계: "시계", 옷감직물: "원단",
  기타직물: "원단", 침구수예점: "침구·수예", "카페트,커텐,천막,지물": "커튼·카펫",
  미용원: "미용실", 이용원: "이발소", 피부미용실: "피부관리", 화장품: "화장품",
  미용재료: "미용용품", 안경: "안경", 약국: "약국", 한약방: "한약방",
  의원: "의원", 치과의원: "치과", 한의원: "한의원", 한방병원: "한방병원",
  병원: "병원", 동물병원: "동물병원", 의료용품: "의료용품",
  기타의료기관및기타의료기기: "의료·건강", "안마/스포츠마사지": "마사지",
  헬스크럽: "헬스장", 보습학원: "학원", 예체능학원: "예체능 학원",
  외국어학원: "어학원", 기능학원: "기술학원", 컴퓨터학원: "컴퓨터 학원",
  "학원(회원제형태)": "학원", 기타교육: "교육", 독서실: "독서실",
  일반서적: "서점", 전문서적: "서점", 기타서적문구: "서점·문구",
  문구용품: "문구점", 기타사무용품: "사무용품", 출판인쇄물: "인쇄·출판",
  악기점: "악기", 피아노대리점: "악기", "음반,영상물": "음반·영상",
  화방표구점: "미술용품", 화랑: "갤러리", 문화취미기타: "문화·취미",
  민예공예품: "공예품", 기념품점: "기념품", 완구점: "장난감",
  사진관: "사진관", 티켓: "공연·티켓", 스포츠레져용품: "스포츠용품",
  골프용품: "골프용품", 골프연습장: "골프연습장", 스크린골프: "스크린골프",
  당구장: "당구장", 볼링장: "볼링장", 수영장: "수영장", 노래방: "노래방",
  사우나: "사우나", 기타레져업: "여가시설", "레져업소(회원제형태)": "여가시설",
  관광여행: "여행사", 기타숙박업: "숙박", 애완동물: "반려동물",
  자동차정비: "자동차 정비", 자동차부품: "자동차 부품", "자동차시트/타이어": "타이어·자동차용품",
  카인테리어: "자동차용품", 세차장: "세차장", 주차장: "주차장",
  이륜차판매: "오토바이", 렌트카: "렌터카", 유류판매: "주유소",
  현대정유오일뱅크: "주유소", LPG: "가스충전소", SK가스충전소: "가스충전소",
  세탁소: "세탁소", 신변잡화수리: "잡화 수리", 기타수리서비스: "수리점",
  가정용품수리: "가전 수리", 사무통신기기수리: "기기 수리", 레져용품수리: "스포츠용품 수리",
  가전제품: "가전제품", 기타전기제품: "전기제품", 냉열기기: "냉난방기기",
  컴퓨터: "컴퓨터", 소프트웨어: "소프트웨어", 통신기기: "휴대폰·통신",
  조명기구: "조명", 주방용식기: "주방용품", 주방용구: "주방용품",
  정수기: "정수기", 일반가구: "가구", 기타가구: "가구", 인테리어: "인테리어",
  보일러펌프샷시: "설비·창호", "목재,석재,철물": "건축자재", 기타건축자재: "건축자재",
  건축요업품: "건축자재", 유리: "유리", 페인트: "페인트", 기계공구: "공구",
  "부동산중개/임대": "부동산", 혼례서비스: "웨딩", "법률회계서비스(개인)": "법률·회계",
  사무서비스: "사무 서비스", 종합용역: "생활 서비스", 기타용역서비스: "생활 서비스",
  기타대인서비스: "생활 서비스", 기타전문점: "전문점", 기타유통업: "유통·판매",
  연쇄점: "마트", 기타잡화: "생활잡화", 기타회원제형태업소1: "회원제 서비스",
  기타회원제형태업소4: "회원제 서비스"
};
function displayCategory(category, name = "") {
  const key = String(category || "").replace(/\s+/g, "");
  if (key === "서양음식" && /카페|까페|커피|coffee|cafe|스타벅스|투썸|이디야|컴포즈|빽다방|메가엠지씨|폴바셋|할리스|더벤티/i.test(name)) return "카페";
  return CATEGORY_LABELS[key] || String(category || "").trim();
}
const LIST_RENDER_LIMIT = 100;
const visibleMarkers = new Map();
let markerUpdateTimer;
let sizeFrame;
let lastMapSize = "";
let forceSizeUpdate = false;
let merchantRequestVersion = 0;

function loadStaticMerchants() {
  if (MOBILE_SAMPLE_MODE) return Promise.resolve(SAMPLE_MERCHANTS);
  if (Array.isArray(window.DONGGURANG_MERCHANTS)) return Promise.resolve(window.DONGGURANG_MERCHANTS);
  return new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = "./merchant-data.js";
    script.onload = () => resolve(window.DONGGURANG_MERCHANTS || SAMPLE_MERCHANTS);
    script.onerror = () => {
      showToast("가맹점 자료를 불러오지 못해 시범자료를 표시합니다.");
      resolve(SAMPLE_MERCHANTS);
    };
    document.head.appendChild(script);
  });
}

function categoryGroup(category) {
  const value = String(category || "").replace(/\s+/g, "");
  if (/한식|양식|카페|일식|중식|분식|술집|바$|빵집|디저트/.test(value)) return "음식점·카페";
  if (/농수|축산|정육|마트|편의점|식품|음료|쌀가게|주류|꽃집/.test(value)) return "식품·마트";
  if (/미용|화장품|의류|신발|가방|주얼리|액세서리|안경|시계|원단|침구|수예|속옷|이발|피부|커튼|카펫/.test(value)) return "패션·뷰티";
  if (/약국|의원|병원|한의|의료|건강|마사지|헬스/.test(value)) return "의료·건강";
  if (/학원|독서실|서점|문구|문화|취미|갤러리|미술|음반|영상|악기|티켓|출판|인쇄|사진|장난감|공예|교육/.test(value)) return "교육·문화";
  if (/세탁|자동차|주차|수리|부동산|인테리어|설비|건축|가구|주방|전기|가전|조명|유리|페인트|통신|휴대폰|컴퓨터|소프트웨어|공구|주유|가스/.test(value)) return "생활·주거";
  if (/스포츠|여가|골프|당구|볼링|노래방|수영|사우나|여행|숙박|렌터|반려동물|오토바이/.test(value)) return "스포츠·여가";
  return "기타";
}

function prepareMerchants(items) {
  return items.filter((merchant) => !String(merchant.business_status || "").includes("폐업"))
    .map((merchant) => {
      const category = displayCategory(merchant.category, merchant.name);
      return { ...merchant, category, group: categoryGroup(category) };
    });
}

const state = {
  map: null,
  markerLayer: null,
  userMarker: null,
  merchants: [],
  filtered: [],
  config: {},
  category: "all",
  radius: 1000,
  query: "",
  tab: "nearby",
  userLocation: null,
  sortAscending: true,
  staticMode: false
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const DEFAULT_CENTER = [35.1461, 126.9231];
const hasCoordinates = (merchant) => Number.isFinite(merchant.lat) && Number.isFinite(merchant.lng);

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

function distanceMeters(a, b) {
  const rad = (degree) => degree * Math.PI / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function formatDistance(meters) {
  if (!Number.isFinite(meters)) return "";
  return meters < 1000 ? `${Math.round(meters / 10) * 10}m` : `${(meters / 1000).toFixed(1)}km`;
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2600);
}

async function loadConfig() {
  if (MOBILE_SAMPLE_MODE || window.location.hostname.endsWith(".github.io")) {
    state.config = { tile_provider: "vworld_public", demo: true };
    state.staticMode = true;
    document.querySelector(".admin-link")?.remove();
    return;
  }
  try {
    const response = await fetch("/api/config", { signal: AbortSignal.timeout(2500) });
    if (!response.ok) throw new Error("Config unavailable");
    state.config = await response.json();
  } catch {
    state.config = { tile_provider: "vworld_public", demo: true };
  }
  state.staticMode = Boolean(state.config.demo);
  if (state.staticMode) document.querySelector(".admin-link")?.remove();
}

function initMap() {
  state.map = L.map("map", { center: DEFAULT_CENTER, zoom: 15, zoomControl: false, preferCanvas: true });
  const useAuthenticatedVworld = state.config.tile_provider === "vworld" && state.config.vworld_key;
  const tileUrl = useAuthenticatedVworld
    ? `https://api.vworld.kr/req/wmts/1.0.0/${state.config.vworld_key}/Base/{z}/{y}/{x}.png`
    : "https://xdworld.vworld.kr/2d/Base/service/{z}/{x}/{y}.png";
  L.tileLayer(tileUrl, {
    maxZoom: 19,
    keepBuffer: 3,
    updateWhenIdle: true,
    updateWhenZooming: false,
    attribution: "© VWorld"
  }).addTo(state.map);
  L.control.zoom({ position: "bottomright" }).addTo(state.map);
  state.markerLayer = typeof L.markerClusterGroup === "function"
    ? L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 46, spiderfyOnMaxZoom: true })
    : L.layerGroup();
  state.map.addLayer(state.markerLayer);
  state.map.on("moveend", () => {
    scheduleVisibleMarkers();
  });
  // The mobile viewport and the map container can settle after Leaflet's first measurement.
  requestAnimationFrame(() => requestAnimationFrame(() => invalidateMapSize(true)));
  window.addEventListener("resize", () => scheduleMapSize(true));
  window.addEventListener("orientationchange", () => {
    scheduleMapSize(true);
    setTimeout(() => scheduleMapSize(true), 300);
  });
  window.visualViewport?.addEventListener("resize", () => scheduleMapSize(true));
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => scheduleMapSize()).observe($("#map"));
}

function invalidateMapSize(force = false) {
  sizeFrame = null;
  const mapElement = $("#map");
  const size = `${mapElement.clientWidth}x${mapElement.clientHeight}`;
  if (!mapElement.clientWidth || !mapElement.clientHeight) return;
  if (force || size !== lastMapSize) {
    lastMapSize = size;
    state.map.invalidateSize({ pan: false, debounceMoveend: true });
    scheduleVisibleMarkers();
  }
}

function scheduleMapSize(force = false) {
  forceSizeUpdate ||= force;
  if (sizeFrame) cancelAnimationFrame(sizeFrame);
  sizeFrame = requestAnimationFrame(() => {
    const shouldForce = forceSizeUpdate;
    forceSizeUpdate = false;
    invalidateMapSize(shouldForce);
  });
}

function scheduleVisibleMarkers() {
  clearTimeout(markerUpdateTimer);
  markerUpdateTimer = setTimeout(renderVisibleMarkers, 100);
}

async function fetchMerchants() {
  const requestVersion = ++merchantRequestVersion;
  if (state.staticMode) {
    if (!state.merchants.length) {
      const loaded = await loadStaticMerchants();
      if (requestVersion !== merchantRequestVersion) return;
      state.merchants = prepareMerchants(loaded);
    }
    applyClientFilters();
    return;
  }
  const params = new URLSearchParams({ limit: "5000" });
  if (state.query) params.set("q", state.query);
  if (state.userLocation && state.tab === "nearby") {
    params.set("lat", state.userLocation.lat);
    params.set("lng", state.userLocation.lng);
    params.set("radius", state.radius);
  }
  try {
    const response = await fetch(`/api/merchants?${params}`);
    if (!response.ok) throw new Error("Merchant API error");
    const payload = await response.json();
    if (requestVersion !== merchantRequestVersion) return;
    state.merchants = prepareMerchants(payload.items);
    applyClientFilters();
  } catch {
    if (requestVersion !== merchantRequestVersion) return;
    state.staticMode = true;
    const loaded = await loadStaticMerchants();
    if (requestVersion !== merchantRequestVersion) return;
    state.merchants = prepareMerchants(loaded);
    showToast("제공된 가맹점 자료로 미리보기 중입니다.");
    applyClientFilters();
  }
}

function applyClientFilters() {
  const normalizedQuery = state.query.trim().toLocaleLowerCase("ko-KR");
  const origin = state.userLocation;
  let items = state.merchants.filter((merchant) => {
    const searchable = `${merchant.name} ${merchant.address} ${merchant.category} ${merchant.locality || ""}`.toLocaleLowerCase("ko-KR");
    const queryMatches = !normalizedQuery || searchable.includes(normalizedQuery);
    const categoryMatches = state.category === "all" || merchant.group === state.category;
    const distance = origin && hasCoordinates(merchant) ? distanceMeters(origin, merchant) : null;
    merchant.distance = distance;
    const radiusMatches = state.tab !== "nearby" || !origin || distance === null || distance <= state.radius;
    return queryMatches && categoryMatches && radiusMatches;
  });
  if (state.sortAscending && origin) items = items.sort((a, b) => a.distance - b.distance);
  if (!state.sortAscending) items = items.sort((a, b) => a.name.localeCompare(b.name, "ko-KR"));
  state.filtered = items;
  renderMerchantList();
  renderVisibleMarkers();
}

function renderMerchantList() {
  const list = $("#merchantList");
  list.replaceChildren();
  $("#resultCount").textContent = state.filtered.length.toLocaleString("ko-KR");

  if (!state.filtered.length) {
    list.innerHTML = '<div class="empty-state"><span>⌕</span><strong>조건에 맞는 가맹점이 없어요</strong>검색어나 범위를 바꿔 다시 찾아보세요.</div>';
    return;
  }

  const template = $("#merchantTemplate");
  const listLimit = window.matchMedia("(max-width: 760px)").matches ? 24 : LIST_RENDER_LIMIT;
  state.filtered.forEach((merchant, index) => {
    if (index >= listLimit) return;

    const fragment = template.content.cloneNode(true);
    fragment.querySelector("strong").textContent = merchant.name;
    fragment.querySelector("em").textContent = "동구랑페이";
    fragment.querySelector(".category").textContent = merchant.category + (hasCoordinates(merchant) ? "" : " · 위치 확인 필요");
    fragment.querySelector(".address").textContent = merchant.address;
    fragment.querySelector(".distance").textContent = hasCoordinates(merchant) ? formatDistance(merchant.distance) : "위치 확인 필요";
    fragment.querySelector("button").addEventListener("click", () => {
      if (!hasCoordinates(merchant)) {
        showToast("이 가맹점의 정확한 위치를 확인 중입니다.");
        return;
      }
      state.map.once("moveend", () => {
        renderVisibleMarkers();
        const marker = visibleMarkers.get(merchant);
        if (marker) {
          if (typeof state.markerLayer.zoomToShowLayer === "function") state.markerLayer.zoomToShowLayer(marker, () => marker.openPopup());
          else marker.openPopup();
        }
      });
      state.map.flyTo([merchant.lat, merchant.lng], 18, { duration: .7 });
    });
    list.appendChild(fragment);
  });

  if (state.filtered.length > listLimit) {
    const more = document.createElement("p");
    more.className = "list-limit-note";
    more.textContent = `목록은 ${listLimit.toLocaleString("ko-KR")}개까지 표시됩니다. 검색어와 업종을 선택해 좁혀 보세요.`;
    list.appendChild(more);
  }
}

function renderVisibleMarkers() {
  clearTimeout(markerUpdateTimer);
  if (!state.map || !state.markerLayer) return;
  const bounds = state.map.getBounds().pad(0.2);
  const inView = state.filtered.filter((merchant) => hasCoordinates(merchant) && bounds.contains([merchant.lat, merchant.lng]));
  const wanted = new Set(inView);
  const removed = [];
  for (const [merchant, marker] of visibleMarkers) {
    if (!wanted.has(merchant)) {
      removed.push(marker);
      visibleMarkers.delete(merchant);
    }
  }
  if (typeof state.markerLayer.removeLayers === "function") state.markerLayer.removeLayers(removed);
  else removed.forEach((marker) => state.markerLayer.removeLayer(marker));

  const added = [];
  for (const merchant of inView) {
    if (visibleMarkers.has(merchant)) continue;
    const marker = L.marker([merchant.lat, merchant.lng], {
      icon: L.divIcon({ className: "merchant-marker", html: "<span>동</span>", iconSize: [34, 34], iconAnchor: [17, 34] })
    });
    const locationNote = merchant.approximate ? '<p class="popup-note">위치를 확인해 주세요</p>' : "";
    marker.bindPopup(`<div class="popup-category">${escapeHtml(merchant.category)}</div><h3 class="popup-title">${escapeHtml(merchant.name)}</h3><p class="popup-address">${escapeHtml(merchant.address)}</p>${locationNote}`, { className: "merchant-popup", offset: [0, -24] });
    visibleMarkers.set(merchant, marker);
    added.push(marker);
  }
  if (typeof state.markerLayer.addLayers === "function") state.markerLayer.addLayers(added);
  else added.forEach((marker) => state.markerLayer.addLayer(marker));
}

function locateUser({ initial = false } = {}) {
  if (!navigator.geolocation) {
    if (!initial) showToast("이 기기에서는 위치 기능을 사용할 수 없습니다.");
    return;
  }
  const button = $("#locationButton");
  button.classList.add("loading");
  navigator.geolocation.getCurrentPosition((position) => {
    button.classList.remove("loading");
    state.userLocation = { lat: position.coords.latitude, lng: position.coords.longitude };
    if (state.userMarker) state.map.removeLayer(state.userMarker);
    state.userMarker = L.marker(state.userLocation, {
      icon: L.divIcon({ className: "user-marker", iconSize: [18, 18], iconAnchor: [9, 9] }),
      zIndexOffset: 1000
    }).addTo(state.map).bindTooltip("내 위치", { direction: "top", offset: [0, -10] });
    state.map.flyTo(state.userLocation, 16, { duration: .7 });
    state.tab = "nearby";
    setActiveTab("nearby");
    fetchMerchants();
    showToast("현재 위치 주변 가맹점을 찾았습니다.");
  }, (error) => {
    button.classList.remove("loading");
    if (!initial) showToast(error.code === 1 ? "위치 권한을 허용하면 내 주변을 찾을 수 있어요." : "현재 위치를 확인하지 못했습니다.");
  }, { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 });
}

function setActiveTab(tab) {
  state.tab = tab;
  $$(".tab").forEach((button) => {
    const active = button.dataset.tab === tab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  if (tab === "nearby" && !state.userLocation) locateUser();
}

function setPanelCollapsed(collapsed) {
  $(".search-panel").classList.toggle("collapsed", collapsed);
  $("#panelHandle").setAttribute("aria-expanded", String(!collapsed));
  $("#panelHandle").setAttribute("aria-label", collapsed ? "가맹점 목록 펼치기" : "가맹점 목록 접기");
}

function showFilteredMerchantsOnMap() {
  const located = state.filtered.filter(hasCoordinates);
  if (!located.length || located.some((item) => state.map.getBounds().contains([item.lat, item.lng]))) return;
  state.map.fitBounds(L.latLngBounds(located.map((item) => [item.lat, item.lng])), {
    padding: [32, 32], maxZoom: 15
  });
}

function bindPanelGestures() {
  const panel = $(".search-panel");
  let start = null;
  panel.addEventListener("touchstart", (event) => {
    start = { x: event.touches[0].clientX, y: event.touches[0].clientY };
  }, { passive: true });
  panel.addEventListener("touchend", (event) => {
    if (!start || !window.matchMedia("(max-width: 760px)").matches) return;
    const dx = event.changedTouches[0].clientX - start.x;
    const dy = event.changedTouches[0].clientY - start.y;
    start = null;
    if (Math.abs(dy) < 45 || Math.abs(dy) < Math.abs(dx) * 1.2) return;
    setPanelCollapsed(dy > 0);
    if (event.target.closest("#panelHandle")) event.preventDefault();
  });
  $("#panelHandle").addEventListener("click", () => setPanelCollapsed(!panel.classList.contains("collapsed")));
}

function openSelectSheet(type) {
  const isCategory = type === "category";
  const options = isCategory
    ? ["all", ...CATEGORY_GROUP_ORDER].map((value) => ({ value, label: value === "all" ? "전체 업종" : value }))
    : [{ value: 500, label: "500m 이내" }, { value: 1000, label: "1km 이내" }, { value: 3000, label: "3km 이내" }, { value: 5000, label: "5km 이내" }];
  $("#selectTitle").textContent = isCategory ? "업종 선택" : "검색 거리 선택";
  const container = $("#selectOptions");
  container.replaceChildren();
  options.forEach((option) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "select-option";
    button.textContent = option.label;
    const current = isCategory ? state.category : state.radius;
    button.classList.toggle("active", String(current) === String(option.value));
    button.addEventListener("click", () => {
      if (isCategory) {
        state.category = option.value;
        $("#categoryLabel").textContent = option.label;
        $("#mobileCategoryButton").classList.toggle("active", option.value !== "all");
        $("#mobileCategoryButton").setAttribute("aria-label", `업종 선택: ${option.label}`);
      } else {
        state.radius = Number(option.value);
        $("#radiusLabel").textContent = option.label;
      }
      $("#selectSheet").classList.remove("open");
      $("#selectSheet").setAttribute("aria-hidden", "true");
      if (isCategory && window.matchMedia("(max-width: 760px)").matches) {
        state.query = "";
        $("#searchInput").value = "";
        $("#mobileSearchInput").value = "";
        setActiveTab("search");
        fetchMerchants().then(showFilteredMerchantsOnMap);
      } else applyClientFilters();
    });
    container.appendChild(button);
  });
  $("#selectSheet").classList.add("open");
  $("#selectSheet").setAttribute("aria-hidden", "false");
}

async function searchAddress(query) {
  if (!query || state.staticMode) return false;
  try {
    const response = await fetch(`/api/geocode?query=${encodeURIComponent(query)}`);
    if (!response.ok) return false;
    const result = await response.json();
    if (!result.items?.length) return false;
    state.map.flyTo([result.items[0].lat, result.items[0].lng], 17, { duration: .7 });
    return true;
  } catch {
    return false;
  }
}

function bindEvents() {
  bindPanelGestures();
  $$(".tab").forEach((button) => button.addEventListener("click", () => setActiveTab(button.dataset.tab)));
  const submitSearch = async (event) => {
    event.preventDefault();
    state.query = (event.currentTarget.id === "mobileSearchForm" ? $("#mobileSearchInput") : $("#searchInput")).value.trim();
    $("#searchInput").value = state.query;
    $("#mobileSearchInput").value = state.query;
    setActiveTab("search");
    if (state.query) {
      await searchAddress(state.query);
    }
    await fetchMerchants();
    $("#mobileSearchInput").blur();
  };
  $("#searchForm").addEventListener("submit", submitSearch);
  $("#mobileSearchForm").addEventListener("submit", submitSearch);
  $$(".filter-chip").forEach((button) => button.addEventListener("click", () => openSelectSheet(button.dataset.filter)));
  $("#mobileCategoryButton").addEventListener("click", () => openSelectSheet("category"));
  $("#locationButton").addEventListener("click", () => locateUser());
  $$('[data-close-select]').forEach((button) => button.addEventListener("click", () => {
    $("#selectSheet").classList.remove("open");
    $("#selectSheet").setAttribute("aria-hidden", "true");
  }));
  $("#sortButton").addEventListener("click", () => {
    state.sortAscending = !state.sortAscending;
    $("#sortButton").firstChild.textContent = state.sortAscending ? "가까운 순 " : "가맹점명 순 ";
    applyClientFilters();
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      $("#selectSheet").classList.remove("open");
      $("#selectSheet").setAttribute("aria-hidden", "true");
    }
  });
}

async function main() {
  await loadConfig();
  initMap();
  bindEvents();
  // Let the browser paint and request the base tiles before parsing merchant data.
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 0))));
  await fetchMerchants();
  const total = MOBILE_SAMPLE_MODE
    ? state.merchants.length
    : state.staticMode ? (window.DONGGURANG_DATA_META?.count || state.merchants.length) : state.merchants.length;
  $("#totalMerchantCount").textContent = total.toLocaleString("ko-KR");
  if (MOBILE_SAMPLE_MODE) {
    $("#mapNotice").innerHTML = "<strong>모바일 시범자료</strong><span>테스트용 가맹점 12개입니다.</span>";
    showToast("모바일 테스트용 시범자료 12개를 불러왔습니다.");
  } else if (state.staticMode) {
    showToast(`${total.toLocaleString("ko-KR")}개 실제 가맹점 자료를 불러왔습니다.`);
  } else {
    $("#mapNotice").hidden = true;
    setTimeout(() => locateUser({ initial: true }), 500);
  }
}

main();
