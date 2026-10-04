/* Credentials are entered by the operator and exchanged for an HttpOnly session. */
(() => {
  const $ = (selector) => document.querySelector(selector);
  const kinds = { keep: "유지", change: "정보 변경", add: "신규 후보", remove: "삭제 검토 후보", closed: "폐업으로 등록 제외", review: "확인 필요" };
  const requestKinds = { closed: "폐업 신고", unavailable: "동구랑페이 사용불가", name: "상호명 오류", address: "주소 오류", phone: "전화번호 오류", category: "업종 오류", other: "기타" };
  let batch, page = 0, requests = [], merchants = [], history = [], editing;
  const selected = new Set();
  const notice = (text, error = false) => { $("#notice").textContent = text; $("#notice").className = error ? "error" : ""; };
  async function api(path, options = {}) {
    const response = await fetch(`/api/admin${path}`, { ...options, headers: { "X-Requested-With": "donggurang-admin", ...(options.body && !(options.body instanceof FormData) ? { "Content-Type": "application/json" } : {}), ...options.headers }, credentials: "same-origin" });
    const payload = await response.json();
    if (!response.ok) throw new Error(typeof payload.detail === "string" ? payload.detail : "입력값을 확인하세요.");
    return payload;
  }
  function cell(tr, value) { const td = document.createElement("td"); td.textContent = value ?? ""; tr.appendChild(td); return td; }
  function action(td, label, handler) { const b = document.createElement("button"); b.type = "button"; b.textContent = label; b.addEventListener("click", () => run(handler)); td.appendChild(b); return b; }
  async function run(handler) { try { await handler(); } catch (e) { notice(e.message, true); } }
  function info(m) { return m ? `${m.id ? `ID ${m.id}\n` : ""}${m.name}\n${m.address}\n${m.category}` : "—"; }
  function matches(item, query) { return JSON.stringify(item).toLocaleLowerCase("ko-KR").includes(query.trim().toLocaleLowerCase("ko-KR")); }
  function showConsole() { $("#login").hidden = true; $("#console").hidden = false; $("#logout").hidden = false; }
  async function dashboard() {
    const d = await api("/dashboard");
    const select = $("#batches"); select.replaceChildren(new Option("업로드 선택", ""));
    d.batches.forEach(b => select.add(new Option(`#${b.id} ${b.filename} · ${b.created_at}`, b.id)));
    if (batch) select.value = batch.id;
    $("#publicationRows").replaceChildren();
    d.publications.forEach(p => {
      const tr = document.createElement("tr"); cell(tr, `#${p.id}\n${p.created_at}`); cell(tr, p.revision); cell(tr, p.state);
      const td = cell(tr, "");
      action(td, "파일 다운로드", async () => {
        const response = await fetch(`/api/admin/publications/${p.id}/download`, { credentials: "same-origin" });
        if (!response.ok) throw new Error("다운로드 실패");
        const url = URL.createObjectURL(await response.blob()), a = document.createElement("a"); a.href = url; a.download = "merchant-data.js"; a.click(); URL.revokeObjectURL(url);
      });
      if (p.pr_url) { const a = document.createElement("a"); a.href = p.pr_url; a.textContent = "GitHub 배포 PR 확인"; a.target = "_blank"; a.rel = "noopener"; td.appendChild(a); }
      else action(td, "배포 PR 생성", async () => { if (!confirm(`배포 파일 #${p.id}로 GitHub PR을 생성할까요? 병합 후 주민 지도에 반영됩니다.`)) return; notice("배포 PR 생성 중…"); const r = await api(`/publications/${p.id}/publish`, { method: "POST" }); notice(`배포 PR을 만들었습니다: ${r.url}\nGitHub 검증 성공 후 병합하고 Pages 결과를 확인하세요.`); await dashboard(); });
      $("#publicationRows").appendChild(tr);
    });
    return d;
  }
  async function loadBatch(id) { batch = await api(`/batches/${id}`); selected.clear(); page = 0; renderBatch(); }
  function filteredCandidates() { return (batch?.items || []).filter(r => (!$("#candidateKind").value || r.kind === $("#candidateKind").value) && matches(r, $("#candidateSearch").value)); }
  function renderBatch() {
    $("#summary").replaceChildren();
    const labels = { uploaded: "총 업로드", unique_businesses: "사업자 수", duplicates: "동일 사업자 추가 행", ...kinds, removed_closed: "삭제 후보 중 폐업", coordinate_needed: "좌표 확인 필요" };
    Object.entries(batch?.summary || {}).forEach(([key, value]) => { const span = document.createElement("span"); span.textContent = `${labels[key] || key}: ${value}개`; $("#summary").appendChild(span); });
    $("#stale").textContent = batch?.stale ? "다른 승인·수정으로 데이터가 변경되었습니다. 최신 명단을 다시 비교하세요." : "";
    $("#approve").disabled = !batch || batch.stale;
    $("#retry").disabled = !batch || batch.stale;
    const filtered = filteredCandidates(), shown = filtered.slice(page * 100, (page + 1) * 100);
    $("#candidates").replaceChildren();
    const readyShown = shown.filter(r => r.ready);
    $("#selectAll").checked = readyShown.length > 0 && readyShown.every(r => selected.has(r.id));
    $("#selectAll").disabled = !readyShown.length || batch?.stale;
    shown.forEach(r => {
      const tr = document.createElement("tr"), td = cell(tr, ""), check = document.createElement("input"); check.type = "checkbox"; check.dataset.id = r.id; check.disabled = r.decision !== "pending" || batch.stale; check.checked = selected.has(r.id); check.setAttribute("aria-label", `${(r.after || r.before)?.name || "가맹점"} 선택`); check.addEventListener("change", () => { if (check.checked) selected.add(r.id); else selected.delete(r.id); $("#selectedCount").textContent = `${selected.size}개 선택`; }); td.appendChild(check);
      const decision = { pending: "미처리", approved: "승인 완료", rejected: "반영하지 않음" }[r.decision] || r.decision;
      cell(tr, `${kinds[r.kind]}\n${decision}\n${r.decision !== "pending" ? "처리 완료" : r.ready ? "승인 가능" : "승인 불가 / 확인 필요"}`);
      cell(tr, info(r.before)); cell(tr, r.options?.length ? r.options.map(info).join("\n────────\n") : info(r.after)); const status = cell(tr, `${r.status}${r.source_status ? `\n원본: ${r.source_status}` : ""}`); if (r.status.includes("폐업") || r.source_status) status.className = "warning";
      cell(tr, `${r.exists_in_upload ? "최신 명단 포함" : "최신 명단 미포함"}\n${r.currently_registered ? "지도 등록" : "지도 미등록"}`);
      const m = r.after || r.before; cell(tr, `${m?.lat != null ? "좌표 확인됨" : "좌표 확인 필요"}\n${m?.phones?.length || m?.phone ? "전화번호 있음" : "전화번호 없음"}`);
      $("#candidates").appendChild(tr);
    });
    $("#pageInfo").textContent = `${filtered.length}개 · ${page + 1}/${Math.max(1, Math.ceil(filtered.length / 100))}페이지`;
    $("#previous").disabled = page === 0; $("#next").disabled = (page + 1) * 100 >= filtered.length;
    $("#selectedCount").textContent = `${selected.size}개 선택`;
  }
  $("#login").addEventListener("submit", e => { e.preventDefault(); run(async () => { await api("/login", { method: "POST", body: JSON.stringify({ key: $("#key").value }) }); $("#key").value = ""; showConsole(); const d = await dashboard(); notice(`로그인 완료 · 현재 등록 ${d.registered}개 · 데이터 버전 ${d.revision}`); }); });
  $("#logout").addEventListener("click", () => run(async () => { await api("/logout", { method: "POST" }); location.reload(); }));
  for (const [formId, path] of [["upload", "/batches"], ["bootstrap", "/bootstrap"]]) $("#" + formId).addEventListener("submit", e => { e.preventDefault(); run(async () => { if (formId === "bootstrap" && !confirm("현재 지도 작성에 사용한 원본 명단으로 최초 연결할까요?")) return; const button = e.target.querySelector("button"); button.disabled = true; notice("파일 검증·비교·국세청 조회·좌표 확인 중…"); try { const result = await api(path, { method: "POST", body: new FormData(e.target) }); if (result.id) await loadBatch(result.id); await dashboard(); notice(formId === "bootstrap" ? `${result.connected}개 원본 연결 완료. 월별 명단을 비교할 수 있습니다.` : "비교 완료. 업로드만으로 지도는 변경되지 않았습니다."); } finally { button.disabled = false; } }); });
  $("#batches").addEventListener("change", e => { if (e.target.value) run(() => loadBatch(e.target.value)); });
  ["candidateKind", "candidateSearch"].forEach(id => $("#" + id).addEventListener("input", () => { page = 0; renderBatch(); }));
  $("#previous").addEventListener("click", () => { page--; renderBatch(); }); $("#next").addEventListener("click", () => { page++; renderBatch(); });
  $("#selectAll").addEventListener("change", e => { const select = e.target.checked; filteredCandidates().slice(page * 100, (page + 1) * 100).filter(r => r.ready).forEach(r => { if (select) selected.add(r.id); else selected.delete(r.id); }); renderBatch(); });
  for (const name of ["approve", "reject"]) $("#" + name).addEventListener("click", () => run(async () => {
    if (!selected.size || !$("#approvalReason").value.trim()) throw new Error("항목을 선택하고 처리 사유를 입력하세요.");
    const rows = batch.items.filter(r => selected.has(r.id)), counts = {};
    rows.forEach(r => counts[kinds[r.kind]] = (counts[kinds[r.kind]] || 0) + 1);
    if (name === "approve" && rows.some(r => !r.ready)) throw new Error("승인 불가 항목이 있습니다. 상태·좌표를 확인하거나 반영하지 않음으로 처리하세요.");
    if (!confirm(`${JSON.stringify(counts)}\n${name === "approve" ? "선택한 변경분을 DB에 반영할까요? 공개 지도 배포는 별도 단계입니다." : "선택 항목을 반영하지 않을까요?"}\n사유: ${$("#approvalReason").value}`)) return;
    const button = $("#" + name); button.disabled = true;
    try { const result = await api(`/batches/${batch.id}/${name}`, { method: "POST", body: JSON.stringify({ ids: [...selected], reason: $("#approvalReason").value }) }); await loadBatch(batch.id); await dashboard(); notice(`${result.approved || result.rejected}개 처리 완료. 지도 배포 탭에서 최종 반영하세요.`); } finally { button.disabled = false; }
  }));
  $("#retry").addEventListener("click", () => run(async () => { const button = $("#retry"); button.disabled = true; try { notice("재검증 중…"); await api(`/batches/${batch.id}/retry`, { method: "POST" }); await loadBatch(batch.id); notice("재검증 완료. 현재 표의 상태를 확인하세요. 상단 요약은 최초 업로드 시점 기준입니다."); } finally { button.disabled = false; } }));
  async function loadRequests() { requests = (await api("/requests")).items; renderRequests(); }
  Object.entries(requestKinds).forEach(([key, label]) => $("#requestKind").add(new Option(label, key)));
  function renderRequests() {
    $("#requestRows").replaceChildren();
    requests.filter(r => (!$("#requestStatus").value || r.status === $("#requestStatus").value) && (!$("#requestKind").value || r.kind === $("#requestKind").value) && matches(r, $("#requestSearch").value)).forEach(r => {
      const tr = document.createElement("tr"); cell(tr, `#${r.id}\n${r.created_at}`); cell(tr, `${info(r.merchant)}\n현재: ${info(r.current)}\n${r.registered ? "지도 등록" : "지도 제외"}`); cell(tr, `${requestKinds[r.kind]}\n같은 가맹점·유형 ${r.group_count}건`); cell(tr, r.message); const td = cell(tr, `${r.status}\n${r.resolution}\n`);
      const select = document.createElement("select"); ["미처리", "확인 중", "반영 완료", "반영하지 않음"].forEach(s => select.add(new Option(s, s))); select.value = r.status; select.setAttribute("aria-label", `요청 ${r.id} 처리 상태`); td.appendChild(select);
      action(td, "상태 저장", async () => { const reason = prompt("확인 내용·처리 사유를 입력하세요."); if (!reason?.trim()) return; await api(`/requests/${r.id}`, { method: "PATCH", body: JSON.stringify({ status: select.value, reason }) }); await loadRequests(); notice("요청 처리 상태를 저장했습니다. 가맹점 변경은 별도 승인 작업입니다."); });
      action(td, "가맹점 확인·수정", async () => { await loadMerchants(); openEdit(r.merchant_id, r.id); });
      $("#requestRows").appendChild(tr);
    });
  }
  ["requestStatus", "requestKind", "requestSearch"].forEach(id => $("#" + id).addEventListener("input", renderRequests));
  $("#refreshRequests").addEventListener("click", () => run(loadRequests));
  async function loadMerchants() { merchants = (await api("/merchants")).items; renderMerchants(); }
  function renderMerchants() { $("#merchantRows").replaceChildren(); merchants.filter(m => matches(m, $("#merchantSearch").value)).slice(0, 300).forEach(m => { const tr = document.createElement("tr"); cell(tr, m.merchant.id); cell(tr, info(m.merchant)); cell(tr, m.active ? "등록" : "제외"); action(cell(tr, ""), "확인·수정", () => openEdit(m.merchant.id)); $("#merchantRows").appendChild(tr); }); }
  $("#merchantSearch").addEventListener("input", renderMerchants);
  function openEdit(id, requestId) {
    editing = merchants.find(m => m.merchant.id === id); if (!editing) throw new Error("가맹점을 찾을 수 없습니다.");
    $("#editBefore").textContent = `변경 전\n${info(editing.merchant)}\n전화: ${(editing.merchant.phones || []).join(", ")}\n등록: ${editing.active}`;
    const form = $("#editForm"); form.reset(); for (const key of ["name", "address", "category"]) form.elements[key].value = editing.merchant[key];
    form.elements.phones.value = (editing.merchant.phones || (editing.merchant.phone ? [editing.merchant.phone] : [])).join(", "); form.elements.request_id.value = requestId || ""; $("#editDialog").showModal();
  }
  $("#closeEdit").addEventListener("click", () => $("#editDialog").close());
  $("#editForm [name=address]").addEventListener("input", (event) => {
    if (editing && event.target.value !== editing.merchant.address) $("#editForm [name=phones]").value = "";
  });
  $("#editForm").addEventListener("submit", e => { e.preventDefault(); run(async () => {
    const f = new FormData(e.target), body = Object.fromEntries(f); body.revision = editing.revision; body.phones = body.phones.split(",").map(p => p.trim()).filter(Boolean); body.request_id = body.request_id ? Number(body.request_id) : null;
    if (!confirm(`변경 전: ${info(editing.merchant)}\n변경 후: ${body.name}\n${body.address}\n${body.category}\n전화: ${body.phones.join(", ")}\n작업: ${body.action}\n사유: ${body.reason}\n승인할까요?`)) return;
    await api(`/merchants/${editing.merchant.id}`, { method: "PATCH", body: JSON.stringify(body) }); $("#editDialog").close(); await loadMerchants(); await dashboard(); notice("가맹점 변경 승인 완료. 공개 지도는 지도 배포 단계에서 반영됩니다.");
  }); });
  async function loadHistory() { history = (await api("/history")).items; renderHistory(); }
  function renderHistory() { $("#historyRows").replaceChildren(); history.filter(r => matches(r, $("#historySearch").value)).forEach(r => { const tr = document.createElement("tr"); cell(tr, `${r.created_at}\n${r.actor}`); cell(tr, `${r.action}\n가맹점 ${r.merchant_id || "—"}\n요청 ${r.request_id || "—"}`); cell(tr, JSON.stringify(r.before, null, 2)); cell(tr, JSON.stringify(r.after, null, 2)); cell(tr, r.reason); $("#historyRows").appendChild(tr); }); }
  $("#historySearch").addEventListener("input", renderHistory);
  $("#createPublication").addEventListener("click", () => run(async () => { const p = await api("/publications", { method: "POST" }); await dashboard(); notice(`공개 파일 #${p.id} 생성 완료. 다운로드 또는 배포 PR 생성으로 진행하세요.`); }));
  document.querySelectorAll("[data-tab]").forEach(button => button.addEventListener("click", () => run(async () => { document.querySelectorAll("main > section").forEach(section => section.hidden = section.id !== button.dataset.tab); document.querySelectorAll("[data-tab]").forEach(b => b.setAttribute("aria-current", String(b === button))); if (button.dataset.tab === "requests") await loadRequests(); if (button.dataset.tab === "merchants") await loadMerchants(); if (button.dataset.tab === "history") await loadHistory(); if (button.dataset.tab === "publications") await dashboard(); })));
  run(async () => { try { await dashboard(); showConsole(); notice("관리자 세션을 복원했습니다."); } catch { /* Login form remains visible. */ } });
})();
