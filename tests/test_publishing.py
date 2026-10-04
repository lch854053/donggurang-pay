import asyncio
import base64
import json

import httpx

from app import publishing


def test_publisher_only_writes_snapshot_to_review_branch_and_recovers_existing_pr(monkeypatch):
    monkeypatch.setenv('GITHUB_PUBLISH_TOKEN', 'test-server-github-token')
    monkeypatch.setenv('GITHUB_REPOSITORY', 'test-owner/test-repo')
    native_client = httpx.AsyncClient
    calls = []
    existing_pr = [False]
    content = 'approved-public-file'
    def handler(request):
        calls.append(request)
        assert request.headers['Authorization'] == 'Bearer test-server-github-token'
        path = request.url.path
        if path.endswith('/pulls') and request.method == 'GET':
            return httpx.Response(200, json=[{'html_url': 'https://github.com/test-owner/test-repo/pull/1'}] if existing_pr[0] else [])
        if path.endswith('/git/ref/heads/main'):
            return httpx.Response(200, json={'object': {'sha': 'base-commit'}})
        if '/git/ref/heads/admin-publication/' in path:
            return httpx.Response(404)
        if path.endswith('/git/refs'):
            body = json.loads(request.content)
            assert body['ref'].startswith('refs/heads/admin-publication/') and body['sha'] == 'base-commit'
            return httpx.Response(201, json={})
        if path.endswith('/contents/static/merchant-data.js') and request.method == 'GET':
            assert request.url.params['ref'].startswith('admin-publication/')
            return httpx.Response(200, json={'sha': 'old-file-sha', 'content': base64.b64encode(b'previous-public-file').decode()})
        if path.endswith('/contents/static/merchant-data.js') and request.method == 'PUT':
            body = json.loads(request.content)
            assert body['branch'].startswith('admin-publication/')
            assert base64.b64decode(body['content']).decode() == content
            assert 'test-server-github-token' not in request.content.decode()
            return httpx.Response(200, json={})
        if path.endswith('/pulls') and request.method == 'POST':
            body = json.loads(request.content)
            assert body['base'] == 'main' and body['head'].startswith('admin-publication/')
            return httpx.Response(201, json={'html_url': 'https://github.com/test-owner/test-repo/pull/1'})
        raise AssertionError(f'Unexpected GitHub operation: {request.method} {path}')
    monkeypatch.setattr(publishing.httpx, 'AsyncClient', lambda **kwargs: native_client(transport=httpx.MockTransport(handler), **kwargs))
    url = asyncio.run(publishing.create_deployment_pr(1, content, 'a' * 64))
    assert url.endswith('/pull/1')
    assert len([r for r in calls if r.method == 'PUT']) == 1
    existing_pr[0] = True
    calls.clear()
    assert asyncio.run(publishing.create_deployment_pr(1, content, 'a' * 64)) == url
    assert len(calls) == 1 and calls[0].method == 'GET'
