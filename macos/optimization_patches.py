"""Exact audited app contracts. Fail closed on drift; never publish upstream bundles."""
import hashlib
SWITCH = 'globalThis.__codexCommunityLowMemory===true'

def _backend():
    call = 'e=await require(require(`node:path`).join(process.resourcesPath,`community/session-policy.cjs`)).prepareEphemeral(this,e),t?.();'
    return [(f'async {method}(e,t){{await this.ensureReady(),t?.();',
             f'async {method}(e,t){{await this.ensureReady(),t?.();if({SWITCH}){{{call}}}')
            for method in ('startThread', 'forkThread')]

def _sessions(retention, constructor):
    retention_after = retention.replace('108e5', f'({SWITCH}?60e3:108e5)').replace('=10', f'=({SWITCH}?2:10)')
    queue = f'getTextDeltaQueue(){{return this.frameTextDeltaQueue??=new {constructor}('
    guard = 'if(t?.resumeState!==`resumed`||!this.params.streamState.ownsConversationHistoryStream(e))'
    return [
        (retention, retention_after),
        (queue + '{scheduler:this.scheduler,onFlush:',
         queue + f'{{scheduler:{SWITCH}?{{schedule:(e,t)=>this.scheduler.schedule(e,t)}}:this.scheduler,fallbackIntervalMs:{SWITCH}?75:void 0,onFlush:'),
        ('delta:`${n}${e.delta}`}),this.scheduleFlush()}flushNow()',
         'delta:`${n}${e.delta}`}),' + SWITCH + '&&this.getBufferedDeltaLength()>=65536?this.flushNow():this.scheduleFlush()}flushNow()'),
        ('flushIntervalMs:50,onFlush:e=>this.applyOutputDeltas(e)',
         f'flushIntervalMs:{SWITCH}?100:50,onFlush:e=>this.applyOutputDeltas(e)'),
        (guard + '{', guard[:-1] + f'||({SWITCH}&&(this.hasActiveConversationView(e)||this.hasOwnedStreamFollowers(e)||this.shouldKeepConversationLoaded(t)))){{')]

SPECS = {
    '.vite/build/src-C3YaUE83.js': {
        'sha256': '14c8c23e8b8dfa874d3fb5a50d54fb28eccf55fb83232c3ab29cb7c0ef0a0472',
        'edits': _backend()},
    '.vite/build/main-DUHZj4_w.js': {
        'sha256': '9e8a3bd79c817064f28693ca26aa1378895e07ab2108c78c42d0ea20dac9d66e',
        'edits': _sessions('_b=108e5,Z_e=15e3,vb=10', 'ove')},
    'webview/assets/app-initial-a498f911edeb.js': {
        'sha256': '34a75db63c7137eb4caecdba1f36d631c10c7912487e532fd5e9dafb175bb9be',
        'edits': _sessions('NUt=108e5,PUt=15e3,FUt=10', 'rWt')},
    'webview/assets/shiki-highlight-provider-adb14c364832.js': {
        'sha256': 'f0ec8b16b76d3e9905a713aa9723b0aec36d131febb7f302d31fd45985987bf9',
        'edits': [('A=4,j=100,M=[', f'A={SWITCH}?2:4,j={SWITCH}?32:100,M=[')]},
    'webview/assets/virtualized-turn-list-8a3aa93570e5.js': {
        'sha256': 'd00f4d221c9576382898c64e7e9c62f32fcb0fe81e4cd997f79ed2aeb36341d3',
        'edits': [('Ue=12,We=800,Ge=2,Ke=10', f'Ue=12,We=800,Ge={SWITCH}?1:2,Ke=10')]}}

def replace_once(source, before, after):
    if source.count(before) != 1:
        raise ValueError('Optimization anchor must match exactly once')
    return source.replace(before, after, 1)

def transform(name, data):
    spec = SPECS[name]
    if hashlib.sha256(data).hexdigest() != spec['sha256']:
        raise ValueError('Unreviewed optimization input: ' + name)
    source = data.decode('utf-8')
    for before, after in spec['edits']:
        source = replace_once(source, before, after)
    return source.encode('utf-8')

def prepare(archive):
    overlays, report = {}, []
    for name, spec in SPECS.items():
        original = archive.read(name, 32 * 1024 * 1024)
        result = transform(name, original)
        overlays[name] = result
        report.append({'path': name, 'sourceSHA256': spec['sha256'],
                       'outputSHA256': hashlib.sha256(result).hexdigest(), 'edits': len(spec['edits'])})
    return overlays, report
