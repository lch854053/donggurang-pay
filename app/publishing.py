"""Server-side GitHub publication. main is never directly overwritten."""
import base64
import os

import httpx


async def create_deployment_pr(publication_id: int, content: str, digest: str) -> str:
    token = os.environ["GITHUB_PUBLISH_TOKEN"]
    repository = os.getenv("GITHUB_REPOSITORY", "lch854053/donggurang-pay")
    branch = f"admin-publication/{publication_id}-{digest[:12]}"
    base = f"https://api.github.com/repos/{repository}"
    async with httpx.AsyncClient(timeout=30, headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}) as client:
        async def call(method, path, **kwargs):
            response = await client.request(method, base + path, **kwargs)
            response.raise_for_status()
            return response.json()
        prs = await call("GET", "/pulls", params={"state": "all", "head": repository.split('/')[0] + ':' + branch})
        if prs:
            return prs[0]["html_url"]
        ref = await call("GET", "/git/ref/heads/main")
        response = await client.get(base + "/git/ref/heads/" + branch)
        if response.status_code == 404:
            await call("POST", "/git/refs", json={"ref": "refs/heads/" + branch, "sha": ref["object"]["sha"]})
        else:
            response.raise_for_status()
        file = await call("GET", "/contents/static/merchant-data.js", params={"ref": branch})
        encoded = base64.b64encode(content.encode()).decode()
        if base64.b64decode(file["content"]).decode() != content:
            await call("PUT", "/contents/static/merchant-data.js", json={"message": f"data: approved merchant publication {publication_id}", "branch": branch, "sha": file["sha"], "content": encoded})
        pr = await call("POST", "/pulls", json={"title": f"승인된 가맹점 데이터 배포 #{publication_id}", "head": branch, "base": "main", "body": f"관리자 승인 데이터만 포함합니다. SHA-256: `{digest}`\n\n자동 검증 성공 후 병합하면 GitHub Pages에 배포됩니다."})
        return pr["html_url"]
