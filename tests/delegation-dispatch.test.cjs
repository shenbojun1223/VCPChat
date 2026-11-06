'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createDelegationDispatch}=require('../modules/services/delegationDispatch.cjs');
const crypto=require('node:crypto');
const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{resolve,promise};};
test('main bridge rejects foreign frame, serializes requests and only exact token can settle',async()=>{
    const sent=[], started=defer();let calls=0;
    const wc={mainFrame:{},isDestroyed:()=>false,send:(channel,payload)=>{sent.push([channel,payload]);started.resolve();}};
    const event={sender:wc,senderFrame:wc.mainFrame};
    const host={isAutoResumeEnabled:async()=>true,consumeOne:async(scope,adapter)=>{
        calls++;const lease=adapter.tryAcquire();assert.equal(lease.valid(),true);
        return adapter.send({content:'fixed template',attachments:[],scope});
    }};
    const bridge=createDelegationDispatch({host,webContents:wc});
    assert.equal((await bridge.status({...event,senderFrame:{}})).enabled,false);
    const request={scope:{agentId:'a',topicId:'t'},requestId:crypto.randomUUID()};
    assert.equal((await bridge.consume({...event,senderFrame:{}},request)).skipped,true);
    const work=bridge.consume(event,request);await started.promise;
    assert.equal((await bridge.consume(event,request)).skipped,true);
    const payload=sent[0][1];
    assert.equal(bridge.settle(event,{...payload,token:'wrong'}).accepted,false);
    assert.equal(bridge.settle({...event,senderFrame:{}},payload).accepted,false);
    assert.equal(bridge.settle(event,{...payload,outcome:{type:'completed',persisted:true}}).accepted,true);
    assert.deepEqual(await work,{type:'completed',persisted:true});
    assert.equal(calls,1);bridge.close();
});
test('main bridge timeout returns uncertain, late ACK cannot revive it',async()=>{
    let timeout,payload;const started=defer();
    const wc={mainFrame:{},isDestroyed:()=>false,send:(_,p)=>{payload=p;started.resolve();}};
    const event={sender:wc,senderFrame:wc.mainFrame};
    const bridge=createDelegationDispatch({webContents:wc,schedule:cb=>{timeout=cb;return 1;},unschedule(){},
        host:{consumeOne:async(scope,a)=>a.send({scope,content:'fixed',attachments:[]})}});
    const work=bridge.consume(event,{requestId:crypto.randomUUID(),scope:{agentId:'a',topicId:'t'}});
    await started.promise;timeout();assert.deepEqual(await work,{type:'uncertain'});
    assert.equal(bridge.settle(event,{...payload,outcome:{type:'completed',persisted:true}}).accepted,false);
    bridge.close();
});
test('disabled renderer has no timer or consumer subscription',async()=>{
    const {createDelegationResumeOwner}=await import('../modules/renderer/delegationResumeOwner.js');
    let effects=0;
    const owner=createDelegationResumeOwner({api:{getDelegationStatus:async()=>({enabled:false}),
        onDelegationDispatch:()=>effects++,consumeDelegationInbox:()=>effects++,settleDelegationDispatch:()=>effects++},
        schedule:()=>effects++});
    assert.equal(await owner.ready,false);assert.equal(effects,0);owner.dispose();
});
test('real bridge+renderer owner keeps lease until committed terminal; duplicate dispatch sends once',async()=>{
    const {createDelegationResumeOwner}=await import('../modules/renderer/delegationResumeOwner.js');
    let listener,sendCalls=0,held=false,releaseCount=0,payload;
    const terminal=defer(),began=defer();
    const wc={mainFrame:{},isDestroyed:()=>false,send:(_,p)=>{payload=p;listener(p);listener(p);}};
    const event={sender:wc,senderFrame:wc.mainFrame};
    const bridge=createDelegationDispatch({webContents:wc,host:{isAutoResumeEnabled:async()=>true,
        consumeOne:async(scope,adapter)=>adapter.send({scope,content:'fixed review',attachments:[]})}});
    const owner=createDelegationResumeOwner({
        api:{getDelegationStatus:()=>bridge.status(event),onDelegationDispatch:fn=>{listener=fn;return()=>{};},
            consumeDelegationInbox:req=>bridge.consume(event,req),settleDelegationDispatch:r=>bridge.settle(event,r)},
        getSelection:()=>({id:'a',type:'agent'}),getTopicId:()=>'t',schedule:()=>1,unschedule(){},
        chatManager:{tryAcquireDelegationLease:()=>{if(held)return null;held=true;return{
            valid:()=>held,release:()=>{held=false;releaseCount++;}}},
            handleSendMessage:async r=>{sendCalls++;assert.equal(r.awaitTerminal,true);
                assert.equal(r.attachments.length,0);began.resolve();return terminal.promise;}}
    });
    await owner.ready;const tick=owner.tick();await began.promise;
    assert.equal(held,true);assert.equal(sendCalls,1);await owner.tick();
    assert.equal(sendCalls,1);assert.ok(payload.token);
    terminal.resolve({terminal:{event:{type:'completed',outcome:{persistence:{value:{id:'saved'}}}}}});
    await tick;assert.equal(held,false);assert.equal(releaseCount,1);
    owner.dispose();bridge.close();
});
test('renderer rejects a revoked lease without sending and acknowledges uncertainty',async()=>{
    const {createDelegationResumeOwner}=await import('../modules/renderer/delegationResumeOwner.js');
    let listener,valid=true,ack;const finish=defer();
    const owner=createDelegationResumeOwner({
        api:{getDelegationStatus:async()=>({enabled:true}),onDelegationDispatch:fn=>{listener=fn;return()=>{};},
            consumeDelegationInbox:async r=>{valid=false;listener({...r,token:'token',content:'fixed'});await finish.promise;},
            settleDelegationDispatch:async r=>{ack=r.outcome;finish.resolve();}},
        chatManager:{tryAcquireDelegationLease:()=>({valid:()=>valid,release(){}}),
            handleSendMessage:()=>{throw Error('must not send');}},
        getSelection:()=>({id:'a',type:'agent'}),getTopicId:()=>'t',schedule:()=>1,unschedule(){},
    });
    await owner.ready;await owner.tick();assert.deepEqual(ack,{type:'uncertain'});owner.dispose();
});

test('host timeout keeps local renderer lease until real terminal, then late ACK stays rejected',async()=>{
    const {createDelegationResumeOwner}=await import('../modules/renderer/delegationResumeOwner.js');
    const began=defer(),terminal=defer();
    let listener,timeout,held=false,sends=0,ack;
    const wc={mainFrame:{},isDestroyed:()=>false,send:(_,p)=>listener(p)};
    const event={sender:wc,senderFrame:wc.mainFrame};
    const bridge=createDelegationDispatch({webContents:wc,schedule:cb=>{timeout=cb;return 1;},unschedule(){},
        host:{isAutoResumeEnabled:async()=>true,
            consumeOne:async(scope,a)=>a.send({scope,content:'fixed review',attachments:[]})}});
    const owner=createDelegationResumeOwner({
        api:{getDelegationStatus:()=>bridge.status(event),onDelegationDispatch:fn=>{listener=fn;return()=>{};},
            consumeDelegationInbox:r=>bridge.consume(event,r),
            settleDelegationDispatch:r=>{ack=bridge.settle(event,r);return ack;}},
        chatManager:{tryAcquireDelegationLease:()=>{held=true;return{valid:()=>held,release:()=>{held=false;}}},
            handleSendMessage:async()=>{sends++;began.resolve();return terminal.promise;}},
        getSelection:()=>({id:'a',type:'agent'}),getTopicId:()=>'t',schedule:()=>1,unschedule(){},
    });
    await owner.ready;
    let finished=false;const tick=owner.tick().then(()=>{finished=true;});
    await began.promise;timeout();
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(finished,false);assert.equal(held,true);
    await owner.tick();assert.equal(sends,1);
    terminal.resolve({terminal:{event:{type:'completed',outcome:{persistence:{value:{id:'saved'}}}}}});
    await tick;assert.equal(held,false);assert.equal(ack.accepted,false);
    owner.dispose();bridge.close();
});
test('completed text without committed persistence evidence is acknowledged uncertain',async()=>{
    const {createDelegationResumeOwner}=await import('../modules/renderer/delegationResumeOwner.js');
    let listener,outcome;const finish=defer();
    const owner=createDelegationResumeOwner({
        api:{getDelegationStatus:async()=>({enabled:true}),onDelegationDispatch:fn=>{listener=fn;return()=>{};},
            consumeDelegationInbox:async r=>{listener({...r,token:'token',content:'fixed'});await finish.promise;},
            settleDelegationDispatch:async r=>{outcome=r.outcome;finish.resolve();}},
        chatManager:{tryAcquireDelegationLease:()=>({valid:()=>true,release(){}}),
            handleSendMessage:async()=>({terminal:{event:{type:'completed'}}})},
        getSelection:()=>({id:'a',type:'agent'}),getTopicId:()=>'t',schedule:()=>1,unschedule(){},
    });
    await owner.ready;await owner.tick();
    assert.deepEqual(outcome,{type:'uncertain'});owner.dispose();
});

test('dispatch send capability binds main frame, scope and one message; timeout revokes before finalizer',async()=>{
    let payload,timeout;
    const started=defer(),drain=defer(),scope={agentId:'a',topicId:'t'};
    const wc={mainFrame:{},isDestroyed:()=>false,send:(_,p)=>{payload=p;started.resolve();}};
    const event={sender:wc,senderFrame:wc.mainFrame};
    const bridge=createDelegationDispatch({webContents:wc,schedule:cb=>{timeout=cb;return 1;},unschedule(){},
        host:{consumeOne:async(s,a)=>{const result=await a.send({scope:s,content:'fixed'});await drain.promise;return result;}}});
    const work=bridge.consume(event,{scope,requestId:crypto.randomUUID()});
    await started.promise;
    assert.throws(()=>bridge.authorizeSend(event,{...payload,token:'wrong'},scope,'m'),/REVOKED/);
    assert.throws(()=>bridge.authorizeSend({...event,senderFrame:{}},payload,scope,'m'),/REVOKED/);
    assert.throws(()=>bridge.authorizeSend(event,payload,{...scope,topicId:'foreign'},'m'),/REVOKED/);
    assert.equal(bridge.authorizeSend(event,payload,scope,'m'),true);
    assert.throws(()=>bridge.authorizeSend(event,payload,scope,'other'),/REVOKED/);
    timeout();
    assert.throws(()=>bridge.authorizeSend(event,payload,scope,'m',true),/REVOKED/);
    drain.resolve();await work;
    bridge.close();
});
test('dispatch send capability is one-shot and renderer forwards proof only with the owned send',async()=>{
    const started=defer(),scope={agentId:'a',topicId:'t'};let payload;
    const wc={mainFrame:{},isDestroyed:()=>false,send:(_,p)=>{payload=p;started.resolve();}};
    const event={sender:wc,senderFrame:wc.mainFrame};
    const bridge=createDelegationDispatch({webContents:wc,
        host:{consumeOne:(s,a)=>a.send({scope:s,content:'fixed'})}});
    const work=bridge.consume(event,{scope,requestId:crypto.randomUUID()});await started.promise;
    assert.equal(bridge.authorizeSend(event,payload,scope,'m',true),true);
    assert.throws(()=>bridge.authorizeSend(event,payload,scope,'m',true),/REVOKED/);
    bridge.settle(event,{...payload,outcome:{type:'cancelled'}});await work;bridge.close();
});