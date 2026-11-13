/* Analysis is independent of map search and never changes source merchant records. */
(() => {
  const UNKNOWN = "미분류";
  const validPoint = (m) => Number.isFinite(m.lat) && Number.isFinite(m.lng) && Math.abs(m.lat) <= 90 && Math.abs(m.lng) <= 180;
  const html = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const number = (n) => n.toLocaleString("ko-KR");
  const percent = (n, total) => total ? `${(100 * n / total).toFixed(1)}%` : "0.0%";

  // Inclusive edge check; holes are excluded. GeoJSON positions are [longitude, latitude].
  function inRing(point, ring) {
    const [x, y] = point;
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      const cross = (x - xi) * (yj - yi) - (y - yi) * (xj - xi);
      if (Math.abs(cross) < 1e-12 && x >= Math.min(xi, xj) && x <= Math.max(xi, xj) && y >= Math.min(yi, yj) && y <= Math.max(yi, yj)) return true;
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function inGeometry(point, geometry) {
    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.type === "MultiPolygon" ? geometry.coordinates : [];
    return polygons.some((rings) => inRing(point, rings[0]) && !rings.slice(1).some((ring) => inRing(point, ring)));
  }
  function assignDongs(merchants, boundaries) {
    return merchants.map((m) => ({ ...m, analysisDong: validPoint(m)
      ? boundaries.features.find((f) => inGeometry([m.lng, m.lat], f.geometry))?.properties.name || UNKNOWN : UNKNOWN }));
  }
  function counts(items, key) {
    const result = new Map();
    items.forEach((m) => { const name = m[key] || "기타"; result.set(name, (result.get(name) || 0) + 1); });
    return [...result].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko"));
  }
  function gridCells(items, size) {
    const latStep = size / 111320, lngStep = size / (111320 * Math.cos(35.1461 * Math.PI / 180));
    const cells = new Map();
    items.filter(validPoint).forEach((m) => {
      const y = Math.floor((m.lat - 35) / latStep), x = Math.floor((m.lng - 126) / lngStep);
      const key = `${x}:${y}`;
      if (!cells.has(key)) cells.set(key, { count: 0, bounds: [[35 + y * latStep, 126 + x * lngStep], [35 + (y + 1) * latStep, 126 + (x + 1) * lngStep]] });
      cells.get(key).count++;
    });
    return [...cells.values()];
  }

  function init({ state, prepareMerchants, loadStaticMerchants, invalidateMapSize }) {
    const $ = (id) => document.getElementById(id);
    if (!$("analysisTab")) return;
    const boundaries = window.DONGGURANG_BOUNDARIES;
    const groups = ["음식점·카페", "식품·마트", "패션·뷰티", "의료·건강", "교육·문화", "생활·주거", "스포츠·여가", "기타"];
    let map, overlay, heat, boundaryLayer, merchants, loading, mode = "heat", selected = [];
    const category = $("analysisCategory"), dong = $("analysisDong");
    groups.forEach((g) => category.add(new Option(g, g)));
    boundaries?.features.forEach((f) => dong.add(new Option(f.properties.name, f.properties.name)));
    dong.add(new Option(UNKNOWN, UNKNOWN));

    function makeHeatLayer() {
      return new (L.Layer.extend({
        onAdd(target) {
          this.canvas = L.DomUtil.create("canvas", "analysis-heat-canvas", target.getPanes().overlayPane);
          this.canvas.style.pointerEvents = "none";
          target.on("moveend resize zoomend", this.draw, this);
          this.draw();
        },
        onRemove(target) { target.off("moveend resize zoomend", this.draw, this); this.canvas.remove(); },
        draw() {
          const canvas = this.canvas, size = map.getSize();
          L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
          canvas.width = size.x; canvas.height = size.y;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          // Aggregate identical screen positions, then blur density kernels into an alpha field.
          const bins = new Map();
          selected.filter(validPoint).forEach((m) => {
            const p = map.latLngToContainerPoint([m.lat, m.lng]);
            if (p.x < -40 || p.y < -40 || p.x > size.x + 40 || p.y > size.y + 40) return;
            const key = `${Math.round(p.x / 4)}:${Math.round(p.y / 4)}`;
            const bin = bins.get(key) || { x: p.x, y: p.y, count: 0 }; bin.count++; bins.set(key, bin);
          });
          const max = Math.max(1, ...[...bins.values()].map((b) => b.count));
          bins.forEach((b) => {
            const gradient = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, 32);
            gradient.addColorStop(0, `rgba(0,0,0,${Math.min(.8, .12 + .5 * b.count / max)})`);
            gradient.addColorStop(1, "rgba(0,0,0,0)");
            ctx.fillStyle = gradient; ctx.fillRect(b.x - 32, b.y - 32, 64, 64);
          });
          if (!size.x || !size.y) return;
          const image = ctx.getImageData(0, 0, size.x, size.y);
          for (let i = 0; i < image.data.length; i += 4) {
            const a = image.data[i + 3] / 255;
            if (!a) continue;
            const t = Math.min(1, a * 1.3);
            image.data[i] = Math.round(255 * Math.min(1, t * 2));
            image.data[i + 1] = Math.round(220 * (1 - Math.abs(t * 2 - 1)));
            image.data[i + 2] = Math.round(255 * Math.max(0, 1 - t * 2));
            image.data[i + 3] = Math.round(Math.min(.8, a) * 255);
          }
          ctx.putImageData(image, 0, 0);
        }
      }))();
    }

    function initMap() {
      if (map) return;
      map = L.map("analysisMap", { center: [35.1461, 126.9231], zoom: 13, scrollWheelZoom: false, preferCanvas: true });
      const url = state.config.tile_provider === "vworld" && state.config.vworld_key
        ? `https://api.vworld.kr/req/wmts/1.0.0/${state.config.vworld_key}/Base/{z}/{y}/{x}.png`
        : "https://xdworld.vworld.kr/2d/Base/service/{z}/{x}/{y}.png";
      L.tileLayer(url, { maxZoom: 19, attribution: "© VWorld" }).addTo(map);
      L.control.scale({ imperial: false }).addTo(map);
      overlay = L.layerGroup().addTo(map);
      heat = makeHeatLayer();
      boundaryLayer = L.geoJSON(boundaries, { style: { color: "#0874be", weight: 1, fillOpacity: 0 }, onEachFeature(f, layer) {
        layer.bindTooltip(html(f.properties.name));
        layer.on("click", () => { dong.value = f.properties.name; render(true); });
      } }).addTo(map);
    }

    function bars(items) {
      const rows = counts(items, "group");
      return rows.length ? rows.map(([name, count]) => `<div class="stat-row"><div><span>${html(name)}</span><strong>${number(count)}곳 <small>${percent(count, items.length)}</small></strong></div><div class="stat-track"><span style="width:${100 * count / items.length}%"></span></div></div>`).join("") : '<p class="analysis-empty">해당 조건의 가맹점이 없습니다.</p>';
    }
    function render(fit = false) {
      if (!merchants || !map) return;
      const categoryItems = merchants.filter((m) => category.value === "all" || m.group === category.value);
      selected = categoryItems.filter((m) => dong.value === "all" || m.analysisDong === dong.value);
      const points = selected.filter(validPoint), industries = counts(selected, "category");
      $("analysisSummary").innerHTML = [["선택 가맹점", `${number(selected.length)}곳`], ["전체 대비", percent(selected.length, merchants.length)], ["세부 업종", `${number(industries.length)}개`], ["가장 많은 업종", industries[0]?.[0] || "—"]].map(([label, value]) => `<article><span>${html(label)}</span><strong>${html(value)}</strong></article>`).join("");
      $("analysisStatus").textContent = `${state.staticMode ? "공개 명단" : "서버 전체 명단"} ${number(merchants.length)}곳 기준 · 현재 ${number(selected.length)}곳 · 지도 표시 ${number(points.length)}곳 · 행정동 미분류 ${number(merchants.filter((m) => m.analysisDong === UNKNOWN).length)}곳${MOBILE_SAMPLE_MODE ? " · 시범자료 12개" : ""}`;
      $("industryStats").innerHTML = bars(selected) + (industries.length ? `<details class="detail-industries"><summary>세부 업종별 통계 보기</summary><ul>${industries.map(([name, n]) => `<li><span>${html(name)}</span><span>${number(n)}곳 · ${percent(n, selected.length)}</span></li>`).join("")}</ul></details>` : "");
      const names = [...boundaries.features.map((f) => f.properties.name), UNKNOWN];
      $("dongStats").innerHTML = names.map((name) => {
        const items = categoryItems.filter((m) => m.analysisDong === name);
        return { name, items };
      }).sort((a, b) => b.items.length - a.items.length).map(({ name, items }) => `<tr${dong.value === name ? ' class="selected"' : ""}><th scope="row"><button type="button" data-dong="${html(name)}" aria-pressed="${dong.value === name}">${html(name)}</button></th><td>${number(items.length)}</td><td>${percent(items.length, categoryItems.length)}</td><td>${html(counts(items, "category")[0]?.[0] || "—")}</td></tr>`).join("");
      boundaryLayer.setStyle((f) => ({ weight: dong.value === f.properties.name ? 3 : 1, fillOpacity: dong.value === f.properties.name ? .08 : 0 }));
      overlay.clearLayers();
      if (map.hasLayer(heat)) map.removeLayer(heat);
      if (fit) {
        if (points.length) map.fitBounds(L.latLngBounds(points.map((m) => [m.lat, m.lng])), { padding: [30, 30], maxZoom: 16 });
        else if (dong.value !== "all" && dong.value !== UNKNOWN) map.fitBounds(L.geoJSON(boundaries.features.find((f) => f.properties.name === dong.value)).getBounds());
      }
      if (mode === "heat") {
        heat.addTo(map);
        $("analysisLegend").textContent = "화면 내 상대 밀도 · 확대 수준에 따라 달라집니다";
      } else {
        const cells = gridCells(points, Number($("analysisGridSize").value));
        const max = Math.max(1, ...cells.map((c) => c.count));
        cells.forEach((cell) => L.rectangle(cell.bounds, { color: "#ffffff", weight: 1, fillColor: `hsl(${220 - 220 * cell.count / max}, 85%, 50%)`, fillOpacity: .6 }).bindTooltip(`${number(cell.count)}곳`).addTo(overlay));
        $("analysisLegend").textContent = `격자당 가맹점 수 · 1–${cells.length ? number(max) : 0}곳 · 빈 격자 생략`;
      }
    }

    async function showAnalysis() {
      if (loading) return loading;
      loading = (async () => {
        try {
          if (!boundaries?.features?.length) throw new Error("Boundary data unavailable");
          if (!merchants) {
            let items;
            if (state.staticMode) items = prepareMerchants(await loadStaticMerchants());
            else {
              const response = await fetch("/api/merchants?limit=5000", { signal: AbortSignal.timeout(10000) });
              if (!response.ok) throw new Error("Merchant data unavailable");
              const payload = await response.json();
              if (payload.total > payload.items.length) throw new Error("Incomplete merchant data");
              items = prepareMerchants(payload.items);
            }
            merchants = assignDongs(items, boundaries);
          }
          if ($("analysisPanel").hidden) return;
          initMap(); map.invalidateSize(); render(true);
        } catch (error) {
          console.error("Analysis unavailable", error);
          $("analysisStatus").textContent = "분석 자료를 불러오지 못했습니다. 분석 탭을 다시 눌러 재시도해 주세요.";
        }
      })().finally(() => { loading = null; });
      return loading;
    }
    function switchTab(analysis) {
      $("mapPanel").hidden = analysis; $("analysisPanel").hidden = !analysis;
      [$("mapTab"), $("analysisTab")].forEach((tab, i) => { const active = Boolean(i) === analysis; tab.setAttribute("aria-selected", active); tab.tabIndex = active ? 0 : -1; });
      if (analysis) showAnalysis();
      else requestAnimationFrame(() => invalidateMapSize(true));
    }
    [$("mapTab"), $("analysisTab")].forEach((tab, i) => {
      tab.addEventListener("click", () => switchTab(Boolean(i)));
      tab.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === "Home" ? false : event.key === "End" ? true : !Boolean(i);
        switchTab(next); $(next ? "analysisTab" : "mapTab").focus();
      });
    });
    category.addEventListener("change", () => render(true));
    dong.addEventListener("change", () => render(true));
    $("analysisGridSize").addEventListener("change", () => render());
    $("analysisReset").addEventListener("click", () => { category.value = dong.value = "all"; render(true); });
    $("dongStats").addEventListener("click", (event) => { const button = event.target.closest("[data-dong]"); if (button) { dong.value = button.dataset.dong; render(true); } });
    document.querySelectorAll("[data-analysis-mode]").forEach((button) => button.addEventListener("click", () => {
      mode = button.dataset.analysisMode;
      document.querySelectorAll("[data-analysis-mode]").forEach((b) => b.setAttribute("aria-pressed", b === button));
      $("gridSizeLabel").hidden = mode !== "grid"; render();
    }));
    window.addEventListener("resize", () => { if (map && !$("analysisPanel").hidden) map.invalidateSize(); });
  }
  window.DonggurangAnalysis = { init, inGeometry, assignDongs, counts, gridCells, validPoint };
})();
