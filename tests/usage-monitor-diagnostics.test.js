const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
test('Claude quota diagnostics are scoped, allowlisted and preserve stale meaning', async () => {
    const mod = await import(pathToFileURL(path.join(__dirname, '../modules/ui-system/side-pane/usageMonitorSideProvider.js')).href);
    const base = {source:'claude-bridge',status:'error'};
    assert.match(mod.formatQuotaDiagnostic({...base,errorCode:'quota_cooldown'}), /冷却/);
    assert.match(mod.formatQuotaDiagnostic({...base,errorCode:'refresh_http_429'}), /凭据刷新.*429/);
    assert.match(mod.formatQuotaDiagnostic({...base,errorCode:'usage_http_429'}), /配额接口.*429/);
    assert.equal(mod.formatQuotaDiagnostic({...base,status:'ok',errorCode:'quota_cooldown'}), '');
    assert.equal(mod.formatQuotaDiagnostic({...base,source:'other',errorCode:'quota_cooldown'}), '');
    assert.equal(mod.formatQuotaDiagnostic({...base,errorCode:'<script>secret</script>'}).includes('secret'),false);
    assert.match(mod.formatQuotaDiagnostic({...base,status:'stale',errorCode:'quota_cooldown'}), /冷却/);
});
test('ordinary auth, unknown failure and rate limits never request manual login', async () => {
    const mod = await import(pathToFileURL(path.join(__dirname, '../modules/ui-system/side-pane/usageMonitorSideProvider.js')).href);
    const base = {id:'claude-test',source:'claude-bridge',status:'stale',errorStage:'auth',
        errorCode:'auth_required',lastErrorCode:null,observedAt:'2026-11-01T10:00:00Z',checkedAt:'2026-11-01T11:00:00Z'};
    let count=0;
    const send=mod.createQuotaLoginNotifier(()=>count++,null,new Map());
    for (const patch of [{}, {errorCode:'usage_http_429'}, {errorStage:'service'},
        {source:'other',lastErrorCode:'auth_required'}, {status:'ok',lastErrorCode:'auth_required'}]) {
        assert.equal(send({...base,...patch}),false);
    }
    assert.equal(count,0);
    assert.doesNotMatch(mod.formatQuotaDiagnostic(base),/需要重新登录/);
    assert.match(mod.formatQuotaDiagnostic({...base,lastErrorCode:'auth_required'}),/需要重新登录/);
});

test('explicit quota login alerts once across refresh and remount, and rearms after a new observation', async () => {
    const mod = await import(pathToFileURL(path.join(__dirname, '../modules/ui-system/side-pane/usageMonitorSideProvider.js')).href);
    const saved=new Map(), messages=[];
    const storage={getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v)};
    const mount=()=>mod.createQuotaLoginNotifier((m,t)=>messages.push([m,t]),storage,new Map());
    const a={id:'claude-test',source:'claude-bridge',status:'error',errorCode:'auth_required',
        errorStage:'auth',lastErrorCode:'auth_required',observedAt:null,checkedAt:'2026-11-01T11:00:00Z'};
    const first=mount();
    assert.equal(first(a),true);
    assert.equal(first({...a,checkedAt:'2026-11-01T11:05:00Z'}),false);
    assert.equal(mount()({...a,observedAt:'2026-11-01T10:55:00Z',checkedAt:'2026-11-01T11:15:00Z'}),false);
    assert.equal(mount()({...a,observedAt:'2026-11-01T12:00:00Z',checkedAt:'2026-11-02T08:00:00Z'}),true);
    assert.equal(messages.length,2);
    assert.equal(saved.size,1);
    assert.ok([...saved.values()].every(v=>/^\d+$/.test(v)));
});