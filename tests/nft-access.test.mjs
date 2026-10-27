import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

const background = readFileSync(new URL('../src/background.ts', import.meta.url), 'utf8');
const source = background.slice(background.indexOf('const nftRequest ='), background.indexOf('const dexRequest ='));
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const accessSource = readFileSync(new URL('../src/dapp-api/privacy-access.ts', import.meta.url), 'utf8');
const accessCompiled = ts.transpileModule(accessSource, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const accessExports = {};
new Function('exports',accessCompiled)(accessExports);
const {createPrivacyAccess,readScopes} = accessExports;
const origin='https://network.example', account='0x'+'12'.repeat(20), privacy='0x'+'34'.repeat(43);
function fixture() {
  const state={scopes:['address','notes'],calls:[],changed:false,grant:undefined,approvals:0};
  const context=()=>({origin,account,chainId:'0x1',privacyAddress:privacy,expiresAt:Date.now()+60000,permissionEpoch:0,revision:0});
  const bound=context();
  state.grant={...bound,scopes:state.scopes};
  const access=createPrivacyAccess({context:async()=>({...bound,revision:state.changed?1:0}),load:async()=>state.grant,save:async(_origin,value)=>{state.grant=value;},approve:async()=>{state.approvals++;return true;}});
  const scope={
    RpcError:class extends Error{},
    requireApprovedOrigin:async value=>assert.equal(value,origin),requireUnlocked:()=>({address:account}),
    requirePrivacyUnlocked:async()=>{},selectedChainId:async()=>1,privacyAccountState:async()=>({privacyAddress:privacy}),
    privacySessionSecret:{seedHex:'synthetic-unused'},permissionEpoch:new Map(),operationEpoch:0,privacyAccess:access,
    checkNftBinding:async()=>{if(state.changed)throw new Error('context changed');},
    callPrivacyEngine:async(action,params)=>{state.calls.push({action,params}); if(state.revokeDuringRead) state.grant=undefined;if(state.changeDuringRead)state.changed=true;return {chainId:1,items:[{tokenId:'3'}]};},
    queueTransaction:()=>{throw new Error('Read must not enter transaction queue');},
    transactionSettings:()=>{throw new Error('Read must not enable writes');},
  };
  return {state,access,request:new Function('scope',`with(scope){${compiled};return nftRequest;}`)(scope)};
}
test('address and notes grants never disclose NFT holdings without separate NFT consent',async()=>{
  const f=fixture();await assert.rejects(f.request(origin,'plabs_getNftAssets',{}));assert.equal(f.state.calls.length,0);
  await f.access.request(origin,{scopes:['nfts']});assert.equal(f.state.approvals,1);
  assert.deepEqual(await f.request(origin,'plabs_getNftAssets',{}),{chainId:1,items:[{tokenId:'3'}]});
  assert.equal(f.state.calls[0].action,'PRIVACY_NFT_ASSETS');
  assert.equal(f.state.calls[0].params.account,account);assert.equal(f.state.calls[0].params.origin,origin);
});
test('explicit NFT sync uses only the bound read engine and accepts no foreign account or keys',async()=>{
  const f=fixture();f.state.scopes.push('nfts');
  await f.request(origin,'plabs_getNftAssets',{sync:true});assert.equal(f.state.calls[0].action,'PRIVACY_NFT_SYNC');
  for(const input of [{sync:'true'},{account:'foreign'},{seedHex:'secret'},[]])await assert.rejects(f.request(origin,'plabs_getNftAssets',input));
  assert.equal(f.state.calls.length,1);
});
test('revocation and wallet changes during NFT reads discard the result',async()=>{
  for(const mode of ['revokeDuringRead','changeDuringRead']){const f=fixture();f.state.scopes.push('nfts');f.state[mode]=true;await assert.rejects(f.request(origin,'plabs_getNftAssets',{}));}
  assert.deepEqual(readScopes({scopes:['address','balances','history','notes','dexOrders','nfts']}).sort(),['address','balances','history','notes','dexOrders','nfts'].sort());
});
