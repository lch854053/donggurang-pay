(() => {
  const kinds = [
    ["closed", "폐업한 가게입니다"], ["unavailable", "동구랑페이 사용이 안 됩니다"],
    ["name", "상호명이 다릅니다"], ["address", "주소가 다릅니다"],
    ["phone", "전화번호가 다릅니다"], ["category", "업종이 다릅니다"], ["other", "기타"]
  ];
  const dialog = document.createElement("dialog");
  dialog.className = "correction-dialog";
  dialog.setAttribute("aria-labelledby", "correctionTitle");
  dialog.innerHTML = `<form><h2 id="correctionTitle">정보 수정 요청</h2><p class="correction-merchant"></p>
    <label>요청 유형<select name="kind" required></select></label>
    <label>추가 내용 (선택)<textarea name="message" maxlength="1000" rows="4" placeholder="이름·연락처 등 개인정보는 적지 마세요."></textarea></label>
    <label class="correction-trap" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label>
    <p class="correction-result" role="status"></p><div class="correction-actions"><button type="button" data-cancel>취소</button><button type="submit">수정 요청 보내기</button></div></form>`;
  kinds.forEach(([value, label]) => dialog.querySelector("select").add(new Option(label, value)));
  document.body.appendChild(dialog);
  let merchantId;
  const result = dialog.querySelector(".correction-result");
  const form = dialog.querySelector("form");
  const submit = dialog.querySelector('[type="submit"]');
  const cancel = dialog.querySelector("[data-cancel]");
  cancel.addEventListener("click", () => dialog.close());
  document.addEventListener("click", (event) => {
    const button = event.target.closest(".correction-button");
    if (!button) return;
    const card = button.closest(".merchant-card");
    merchantId = Number(button.dataset.merchantId);
    form.reset();
    dialog.querySelector(".correction-merchant").textContent = `${card.querySelector("strong").textContent} · ${card.querySelector(".address").textContent}`;
    result.textContent = "확인 후 담당자가 처리합니다. 요청만으로 지도 정보가 바뀌지 않습니다.";
    submit.disabled = false;
    cancel.textContent = "취소";
    dialog.showModal();
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const configured = window.DONGGURANG_PUBLIC_CONFIG?.apiBaseUrl || "";
    if (!configured && location.hostname.endsWith(".github.io")) {
      result.textContent = "수정 요청 서비스가 아직 연결되지 않았습니다. 잠시 후 다시 이용해 주세요.";
      return;
    }
    submit.disabled = true;
    result.textContent = "접수 중…";
    try {
      const data = new FormData(form);
      const response = await fetch(`${configured.replace(/\/$/, "")}/api/corrections`, {
        method: "POST", credentials: "omit", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ merchantId, kind: data.get("kind"), message: data.get("message"), website: data.get("website") }),
        signal: AbortSignal.timeout(12000)
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(typeof payload.detail === "string" ? payload.detail : "입력 내용이나 요청 빈도를 확인해 주세요.");
      result.textContent = `수정 요청을 접수했습니다. 접수번호 ${payload.id}`;
      cancel.textContent = "닫기";
    } catch (error) {
      result.textContent = error.name === "TypeError" || error.name === "TimeoutError" ? "서버에 연결하지 못했습니다. 잠시 후 다시 시도하세요." : error.message;
      submit.disabled = false;
    }
  });
})();
