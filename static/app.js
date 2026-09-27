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
const STATIC_MERCHANTS = !MOBILE_SAMPLE_MODE && Array.isArray(window.DONGGURANG_MERCHANTS)
  ? window.DONGGURANG_MERCHANTS
  : SAMPLE_MERCHANTS;
const CATEGORY_GROUP_ORDER = ["음식점·카페", "식품·마트", "패션·뷰티", "의료·건강", "교육·문화", "생활·주거", "스포츠·여가", "기타"];
const LIST_RENDER_LIMIT = 100;

function categoryGroup(category) {
  const value = String(category || "").replace(/\s+/g, "");
  if (/한식|서양음식|일식|중국음식|스넥|주점|칵테일|제과점/.test(value)) return "음식점·카페";
  if (/농축|수산|정육|슈퍼|편의점|음료식품|미곡|주류판매|인삼|홍삼|건강식/.test(value)) return "식품·마트";
  if (/미용|화장품|정장|복점|의류|신발|제화|가방|귀금속|악세|안경|시계|직물|옷감|침구|수예|양품|내의|카페트|커텐/.test(value)) return "패션·뷰티";
  if (/약국|의원|병원|한의|의료|제약|동물병원|안마|마사지|헬스/.test(value)) return "의료·건강";
  if (/학원|독서실|서적|문구|문화|취미|화랑|화방|음반|영상|악기|티켓|출판|사진관|완구|공예/.test(value)) return "교육·문화";
  if (/세탁|자동차|주차|수리|용역|부동산|인테리어|보일러|펌프|샷시|목재|석재|철물|건축|가구|주방|전기|가전|조명|유리|페인트|통신|컴퓨터|소프트웨어|기계|유류|가스/.test(value)) return "생활·주거";
  if (/스포츠|레져|골프|당구|볼링|노래방|수영|사우나|여행|숙박|렌트|애완|이륜/.test(value)) return "스포츠·여가";
  return "기타";
}

function prepareMerchants(items) {
  return items.map((merchant) => ({ ...merchant, group: categoryGroup(merchant.category) }));
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
  staticMode: false,
  filterBounds: null
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const DEFAULT_CENTER = [35.1461, 126.9231];

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
  state.staticMode = Boolean(state.config.demo && STATIC_MERCHANTS.length);
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
    attribution: "© VWorld"
  }).addTo(state.map);
  L.control.zoom({ position: "bottomright" }).addTo(state.map);
  state.markerLayer = typeof L.markerClusterGroup === "function"
    ? L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 46, spiderfyOnMaxZoom: true })
    : L.layerGroup();
  state.map.addLayer(state.markerLayer);
  state.map.on("moveend", () => $("#researchButton").classList.add("ready"));
}

async function fetchMerchants({ useMapCenter = false } = {}) {
  if (state.staticMode) {
    if (!state.merchants.length) state.merchants = prepareMerchants(STATIC_MERCHANTS);
    state.filterBounds = useMapCenter ? state.map.getBounds() : null;
    applyClientFilters();
    return;
  }
  const params = new URLSearchParams({ limit: "5000" });
  if (state.query) params.set("q", state.query);
  const point = useMapCenter ? state.map.getCenter() : state.userLocation;
  if (point && state.tab === "nearby") {
    params.set("lat", point.lat);
    params.set("lng", point.lng);
    params.set("radius", state.radius);
  } else if (useMapCenter) {
    const bounds = state.map.getBounds();
    params.set("south", bounds.getSouth());
    params.set("west", bounds.getWest());
    params.set("north", bounds.getNorth());
    params.set("east", bounds.getEast());
  }
  try {
    const response = await fetch(`/api/merchants?${params}`);
    if (!response.ok) throw new Error("Merchant API error");
    const payload = await response.json();
    state.merchants = prepareMerchants(payload.items);
    state.filterBounds = null;
    applyClientFilters(false);
  } catch {
    state.staticMode = true;
    state.merchants = prepareMerchants(STATIC_MERCHANTS);
    state.filterBounds = useMapCenter ? state.map.getBounds() : null;
    showToast("제공된 가맹점 자료로 미리보기 중입니다.");
    applyClientFilters();
  }
}

function applyClientFilters(useMapCenter = false) {
  const normalizedQuery = state.query.trim().toLocaleLowerCase("ko-KR");
  const origin = useMapCenter ? state.map.getCenter() : state.userLocation;
  let items = state.merchants.filter((merchant) => {
    const searchable = `${merchant.name} ${merchant.address} ${merchant.category} ${merchant.locality || ""}`.toLocaleLowerCase("ko-KR");
    const queryMatches = !normalizedQuery || searchable.includes(normalizedQuery);
    const categoryMatches = state.category === "all" || merchant.group === state.category;
    const boundsMatch = !state.filterBounds || state.filterBounds.contains([merchant.lat, merchant.lng]);
    const distance = origin ? distanceMeters(origin, merchant) : null;
    merchant.distance = distance;
    const radiusMatches = state.tab !== "nearby" || !origin || distance <= state.radius;
    return queryMatches && categoryMatches && radiusMatches && boundsMatch;
  });
  if (state.sortAscending && origin) items = items.sort((a, b) => a.distance - b.distance);
  if (!state.sortAscending) items = items.sort((a, b) => a.name.localeCompare(b.name, "ko-KR"));
  state.filtered = items;
  renderResults();
}

function renderResults() {
  state.markerLayer.clearLayers();
  const list = $("#merchantList");
  list.replaceChildren();
  $("#resultCount").textContent = state.filtered.length.toLocaleString("ko-KR");

  if (!state.filtered.length) {
    list.innerHTML = '<div class="empty-state"><span>⌕</span><strong>조건에 맞는 가맹점이 없어요</strong>검색어나 범위를 바꿔 다시 찾아보세요.</div>';
    return;
  }

  const template = $("#merchantTemplate");
  const markers = [];
  const listLimit = window.matchMedia("(max-width: 760px)").matches ? 24 : LIST_RENDER_LIMIT;
  state.filtered.forEach((merchant, index) => {
    const marker = L.marker([merchant.lat, merchant.lng], {
      icon: L.divIcon({ className: "merchant-marker", html: "<span>동</span>", iconSize: [34, 34], iconAnchor: [17, 34] })
    });
    const locationNote = merchant.approximate ? '<p class="popup-note">행정동 기준 임시 위치 · 주소를 확인해 주세요</p>' : "";
    marker.bindPopup(`<div class="popup-category">${escapeHtml(merchant.category)}</div><h3 class="popup-title">${escapeHtml(merchant.name)}</h3><p class="popup-address">${escapeHtml(merchant.address)}</p>${locationNote}`, { className: "merchant-popup", offset: [0, -24] });
    markers.push(marker);

    if (index >= listLimit) return;

    const fragment = template.content.cloneNode(true);
    fragment.querySelector("strong").textContent = merchant.name;
    fragment.querySelector("em").textContent = "동구랑페이";
    fragment.querySelector(".category").textContent = merchant.category;
    fragment.querySelector(".address").textContent = merchant.address;
    fragment.querySelector(".distance").textContent = formatDistance(merchant.distance);
    fragment.querySelector("button").addEventListener("click", () => {
      state.map.flyTo([merchant.lat, merchant.lng], 18, { duration: .7 });
      setTimeout(() => marker.openPopup(), 720);
    });
    list.appendChild(fragment);
  });

  if (typeof state.markerLayer.addLayers === "function") state.markerLayer.addLayers(markers);
  else markers.forEach((marker) => state.markerLayer.addLayer(marker));

  if (state.filtered.length > listLimit) {
    const more = document.createElement("p");
    more.className = "list-limit-note";
    more.textContent = `목록은 ${listLimit.toLocaleString("ko-KR")}개까지 표시됩니다. 검색어와 업종을 선택해 좁혀 보세요.`;
    list.appendChild(more);
  }
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

function openSearchSheet() {
  const sheet = $("#mobileSheet");
  const mount = $("#mobileSearchMount");
  const panel = $(".search-panel");
  [$(".search-tabs"), $(".search-form"), $(".filter-row")].forEach((element) => mount.appendChild(element));
  sheet.classList.add("open");
  sheet.setAttribute("aria-hidden", "false");
  setTimeout(() => $("#searchInput").focus(), 100);
  sheet.dataset.originalPanel = panel.className;
}

function closeSearchSheet() {
  const panel = $(".search-panel");
  [$(".search-tabs"), $(".search-form"), $(".filter-row")].forEach((element) => panel.insertBefore(element, $(".panel-status")));
  const sheet = $("#mobileSheet");
  sheet.classList.remove("open");
  sheet.setAttribute("aria-hidden", "true");
}

function openSelectSheet(type) {
  const isCategory = type === "category";
  const options = isCategory
    ? ["all", ...CATEGORY_GROUP_ORDER.filter((group) => state.merchants.some((item) => item.group === group))].map((value) => ({ value, label: value === "all" ? "전체 업종" : value }))
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
      } else {
        state.radius = Number(option.value);
        $("#radiusLabel").textContent = option.label;
      }
      $("#selectSheet").classList.remove("open");
      applyClientFilters();
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
  $$(".tab").forEach((button) => button.addEventListener("click", () => setActiveTab(button.dataset.tab)));
  $("#searchForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    state.query = $("#searchInput").value.trim();
    state.filterBounds = null;
    $("#mobileSearchText").textContent = state.query || "가맹점명 또는 주소 검색";
    if (state.query) {
      setActiveTab("search");
      await searchAddress(state.query);
    }
    await fetchMerchants();
    closeSearchSheet();
  });
  $$(".filter-chip").forEach((button) => button.addEventListener("click", () => openSelectSheet(button.dataset.filter)));
  $("#locationButton").addEventListener("click", () => locateUser());
  $("#researchButton").addEventListener("click", () => fetchMerchants({ useMapCenter: true }));
  $("#mobileSearchTrigger").addEventListener("click", openSearchSheet);
  $$('[data-close-sheet]').forEach((button) => button.addEventListener("click", closeSearchSheet));
  $$('[data-close-select]').forEach((button) => button.addEventListener("click", () => $("#selectSheet").classList.remove("open")));
  $("#sortButton").addEventListener("click", () => {
    state.sortAscending = !state.sortAscending;
    $("#sortButton").firstChild.textContent = state.sortAscending ? "가까운 순 " : "가맹점명 순 ";
    applyClientFilters();
  });
  $("#helpButton").addEventListener("click", () => showToast("가맹점을 선택하면 상세 위치를 확인할 수 있어요."));
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeSearchSheet();
      $("#selectSheet").classList.remove("open");
    }
  });
}

async function main() {
  await loadConfig();
  initMap();
  bindEvents();
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
