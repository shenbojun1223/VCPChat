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