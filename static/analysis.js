/* Analysis is independent of map search and never changes source merchant records. */
(() => {
  const UNKNOWN = "미분류";
  const GROUPS = ["음식점·카페", "식품·마트", "패션·뷰티", "의료·건강", "교육·문화", "생활·주거", "스포츠·여가", "기타"];
  const COMPARISON_COLORS = ["#367fe8", "#32894b", "#a363d9", "#c76c13"];
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

  // Each merchant contributes once through its primary industry; denominators are per dong.
  function compareDongs(merchants, names) {
    const regions = [...new Set(names)].map((name) => {
      const items = merchants.filter((m) => m.analysisDong === name);
      return { name, total: items.length, groups: new Map(counts(items, "group")) };
    });
    const rows = GROUPS.map((group) => ({ group, values: regions.map((region) => {
      const count = region.groups.get(group) || 0;
      return { count, share: region.total ? 100 * count / region.total : 0 };
    }) }));
    rows.forEach((row) => row.values.forEach((value, index) => {
      value.gap = regions[0]?.total && regions[index]?.total ? value.share - row.values[0].share : null;
    }));
    return { regions: regions.map(({ name, total }) => ({ name, total })), rows };
  }

  function lqLevel(value) {
    if (value === null) return { key: "unavailable", label: "계산 불가" };
    if (Math.abs(value - 1) < 1e-10) return { key: "average", label: "동구 평균" };
    return value > 1 ? { key: "high", label: "상대적 집중" } : { key: "low", label: "상대적 낮음" };
  }

  function locationQuotients(merchants, name) {
    const local = merchants.filter((m) => m.analysisDong === name);
    const districtCounts = new Map(counts(merchants, "group"));
    const localCounts = new Map(counts(local, "group"));
    const rows = GROUPS.map((group) => {
      const count = localCounts.get(group) || 0, districtCount = districtCounts.get(group) || 0;
      const share = local.length ? count / local.length : null;
      const districtShare = merchants.length ? districtCount / merchants.length : null;
      const lq = share !== null && districtShare > 0 ? share / districtShare : null;
      return { group, count, districtCount, share, districtShare, lq, level: lqLevel(lq) };
    }).sort((a, b) => (b.lq ?? -1) - (a.lq ?? -1));
    return { name, total: local.length, districtTotal: merchants.length, rows };
  }

  function init({ state, prepareMerchants, loadStaticMerchants, invalidateMapSize }) {
    const $ = (id) => document.getElementById(id);
    if (!$("analysisTab")) return;
    const boundaries = window.DONGGURANG_BOUNDARIES;
    const groups = GROUPS;
    let map, overlay, heat, boundaryLayer, merchants, loading, mode = "heat", selected = [];
    const category = $("analysisCategory"), dong = $("analysisDong");
    groups.forEach((g) => category.add(new Option(g, g)));
    boundaries?.features.forEach((f) => dong.add(new Option(f.properties.name, f.properties.name)));
    dong.add(new Option(UNKNOWN, UNKNOWN));
    const dongNames = boundaries?.features.map((f) => f.properties.name) || [];
    const lqDong = $("lqDong");
    dongNames.forEach((name) => lqDong.add(new Option(name, name)));
    if (dongNames.includes("충장동")) lqDong.value = "충장동";
    function renderLq() {
      if (!merchants) return;
      const result = locationQuotients(merchants, lqDong.value);
      const top = result.rows.find((row) => row.level.key === "high");
      $("lqStatus").textContent = `${result.name} ${number(result.total)}곳 · 동구 전체 ${number(result.districtTotal)}곳 기준${top ? ` · 가장 특화된 업종: ${top.group}` : ""}${!result.total ? " · 해당 동에 가맹점이 없어 LQ를 계산할 수 없습니다." : ""}`;
      const shareText = (value) => value === null ? "—" : `${(100 * value).toFixed(1)}%`;
      $("lqResults").innerHTML = result.rows.map((row) => {
        // Avoid showing 1.00 beside a higher/lower classification after rounding.
        const value = row.lq === null ? "—" : row.level.key === "average" ? "1.00" : row.lq.toFixed(2) === "1.00" ? row.lq > 1 ? "1 초과" : "1 미만" : row.lq.toFixed(2);
        return `<article class="lq-result lq-${row.level.key}"><h3>${html(row.group)}</h3><div class="lq-value"><strong>${value}</strong><span>${row.level.label}</span></div><dl><div><dt>${html(result.name)}</dt><dd>${number(row.count)}곳 · ${shareText(row.share)}</dd></div><div><dt>동구 전체</dt><dd>${number(row.districtCount)}곳 · ${shareText(row.districtShare)}</dd></div></dl>${row.lq === null ? `<p>${result.total ? "동구 전체에 해당 업종이 없습니다." : "해당 동에 가맹점이 없습니다."}</p>` : ""}</article>`;
      }).join("");
    }
    lqDong.addEventListener("change", renderLq);
    let comparisonNames = ["계림2동", "충장동"].filter((name) => dongNames.includes(name));
    if (comparisonNames.length < 2) comparisonNames = dongNames.slice(0, 2);
    let comparisonMetric = "share";

    function renderComparisonSelectors() {
      $("comparisonSelectors").innerHTML = comparisonNames.map((name, index) => `<div class="comparison-selector"><label for="comparisonDong${index}"><span class="comparison-dot" style="background:${COMPARISON_COLORS[index]}"></span>비교 지역 ${String.fromCharCode(65 + index)}</label><div><select id="comparisonDong${index}" data-comparison-index="${index}">${dongNames.map((n) => `<option value="${html(n)}"${name === n ? " selected" : ""}${name !== n && comparisonNames.includes(n) ? " disabled" : ""}>${html(n)}</option>`).join("")}</select>${index > 1 ? `<button type="button" data-remove-comparison="${index}" aria-label="비교 지역 ${String.fromCharCode(65 + index)} 삭제">삭제</button>` : ""}</div></div>`).join("");
      $("comparisonAdd").disabled = comparisonNames.length >= Math.min(4, dongNames.length);
    }
    function renderComparison() {
      if (!merchants) return;
      const { regions, rows } = compareDongs(merchants, comparisonNames);
      const metric = comparisonMetric, share = metric === "share";
      const gap = (value) => value === null ? "비교 불가" : Math.abs(value) < .05 ? "0.0%p" : `${value > 0 ? "+" : ""}${value.toFixed(1)}%p`;
      $("comparisonSummary").innerHTML = regions.map((region, i) => `<div style="border-top-color:${COMPARISON_COLORS[i]}"><span>${String.fromCharCode(65 + i)} · ${html(region.name)}</span><strong>${number(region.total)}곳</strong>${region.total ? "" : '<small>등록 가맹점 없음 · 구성비 비교 불가</small>'}</div>`).join("");
      $("comparisonLegend").innerHTML = regions.map((region, i) => `<span><span class="comparison-dot" style="background:${COMPARISON_COLORS[i]}"></span>${String.fromCharCode(65 + i)} · ${html(region.name)}</span>`).join("");
      const width = regions.length > 2 ? 960 : 760, height = 350;
      const left = 48, top = 24, bottom = 60, plotWidth = width - left - 16, plotHeight = height - top - bottom;
      const max = Math.max(1, ...rows.flatMap((row) => row.values.map((v) => v[metric])));
      const step = share ? Math.max(5, Math.ceil(max / 25) * 5) : Math.max(1, Math.ceil(max / 5 / (10 ** Math.floor(Math.log10(max / 5)))) * (10 ** Math.floor(Math.log10(max / 5))));
      const ceiling = Math.ceil(max / step) * step;
      const ticks = Array.from({ length: Math.round(ceiling / step) + 1 }, (_, i) => i * step);
      const columnWidth = plotWidth / rows.length, barGap = 3, barWidth = Math.min(30, (columnWidth - 20) / regions.length - barGap);
      const grid = ticks.map((value) => {
        const y = top + plotHeight * (1 - value / ceiling);
        return `<line x1="${left}" x2="${width - 16}" y1="${y}" y2="${y}" stroke="#dce4ed" stroke-dasharray="4 4"/><text x="${left - 9}" y="${y + 4}" text-anchor="end" class="comparison-axis">${number(value)}${share ? "%" : ""}</text>`;
      }).join("");
      const columns = rows.map((row, rowIndex) => {
        const center = left + columnWidth * (rowIndex + .5);
        const bars = row.values.map((value, i) => {
          const barHeight = plotHeight * value[metric] / ceiling;
          const x = center - (regions.length * (barWidth + barGap) - barGap) / 2 + i * (barWidth + barGap);
          const y = top + plotHeight - barHeight;
          return `<g><title>${html(regions[i].name)} · ${html(row.group)}: ${number(value.count)}곳, ${value.share.toFixed(1)}%${i ? ` (A 대비 ${gap(value.gap)})` : ""}</title><rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="4" fill="${COMPARISON_COLORS[i]}"/><text x="${x + barWidth / 2}" y="${y - 5}" text-anchor="middle" class="comparison-value">${share ? value.share.toFixed(1) : number(value.count)}</text></g>`;
        }).join("");
        const parts = row.group.split("·");
        return bars + `<text x="${center}" y="${height - 36}" text-anchor="middle" class="comparison-axis">${parts.map((part, i) => `<tspan x="${center}" dy="${i ? 17 : 0}">${html(part)}</tspan>`).join("")}</text>`;
      }).join("");
      $("comparisonChart").innerHTML = `<svg viewBox="0 0 ${width} ${height}" style="min-width:${width}px" role="img" aria-labelledby="comparisonChartTitle comparisonChartDescription"><title id="comparisonChartTitle">${html(regions.map((r) => r.name).join(" · "))} 업종별 ${share ? "구성비" : "가맹점 수"} 비교</title><desc id="comparisonChartDescription">각 업종에서 A부터 순서대로 동별 막대를 표시합니다. ${rows.map((row) => `${html(row.group)}: ${row.values.map((value, i) => `${html(regions[i].name)} ${number(value.count)}곳, ${value.share.toFixed(1)}%`).join("; ")}`).join(". ")}</desc>${grid}${columns}</svg>`;
      $("comparisonInsights").innerHTML = regions.slice(1).map((region, index) => {
        const i = index + 1;
        if (!region.total || !regions[0].total) return `<p>${html(regions[0].name)} · ${html(region.name)}: 가맹점이 없는 동이 있어 구성비 차이를 계산하지 않습니다.</p>`;
        const ordered = [...rows].sort((a, b) => b.values[i].gap - a.values[i].gap);
        const higher = ordered.find((row) => row.values[i].gap >= .05);
        const lower = [...ordered].reverse().find((row) => row.values[i].gap <= -.05);
        if (!higher && !lower) return `<p>${html(region.name)}과 ${html(regions[0].name)}의 업종 구성비가 같습니다.</p>`;
        return `<p><strong>${html(region.name)}</strong>은 ${html(regions[0].name)}보다 ${higher ? `<strong>${html(higher.group)}</strong> 비중이 ${higher.values[i].gap.toFixed(1)}%p 높고` : ""}${higher && lower ? ", " : ""}${lower ? `<strong>${html(lower.group)}</strong> 비중이 ${Math.abs(lower.values[i].gap).toFixed(1)}%p 낮습니다` : ""}.</p>`;
      }).join("");
      $("comparisonChart").setAttribute("aria-label", share ? "업종 구성비 비교 차트, 가로로 스크롤할 수 있습니다" : "업종별 가맹점 수 비교 차트, 가로로 스크롤할 수 있습니다");
    }
    renderComparisonSelectors();
    $("comparisonSelectors").addEventListener("change", (event) => {
      if (!event.target.matches("[data-comparison-index]")) return;
      const index = Number(event.target.dataset.comparisonIndex), name = event.target.value;
      if (!dongNames.includes(name) || comparisonNames.some((n, i) => i !== index && n === name)) return;
      comparisonNames[index] = name;
      renderComparisonSelectors(); renderComparison();
      $(`comparisonDong${index}`).focus();
    });
    $("comparisonSelectors").addEventListener("click", (event) => {
      const button = event.target.closest("[data-remove-comparison]");
      if (!button) return;
      comparisonNames.splice(Number(button.dataset.removeComparison), 1);
      renderComparisonSelectors(); renderComparison(); $("comparisonAdd").focus();
    });
    $("comparisonAdd").addEventListener("click", () => {
      if (comparisonNames.length >= 4) return;
      const name = dongNames.find((n) => !comparisonNames.includes(n));
      if (!name) return;
      comparisonNames.push(name); renderComparisonSelectors(); renderComparison();
      $(`comparisonDong${comparisonNames.length - 1}`).focus();
    });
    document.querySelectorAll("[data-comparison-metric]").forEach((button) => button.addEventListener("click", () => {
      comparisonMetric = button.dataset.comparisonMetric;
      document.querySelectorAll("[data-comparison-metric]").forEach((b) => b.setAttribute("aria-pressed", b === button));
      renderComparison();
    }));

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
          initMap(); map.invalidateSize(); render(true); renderLq(); renderComparison();
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
  window.DonggurangAnalysis = { init, inGeometry, assignDongs, counts, gridCells, validPoint, compareDongs, locationQuotients, lqLevel };
})();
