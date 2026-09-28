import { describe,it,expect } from 'vitest';
import { privateBalances,publicBalances,historyEntries } from './read-models';
import type { PrivacyPoolSnapshot, PublicAssetBalance, PrivacyActivity } from '../shared/types';
const pool={address:`0x${'a'.repeat(40)}`,symbol:'sUSDC',decimals:6};
describe('website disclosure projection',()=>{
 it('does not invent zero balances before scanning',()=>{expect(privateBalances(143,[pool],[])[0]).toMatchObject({totalRaw:null,spendableRaw:null,syncState:'unavailable'});});
 it('uses exact units and drops all extraneous snapshot properties',()=>{const snapshot={chainId:143,poolAddress:pool.address,totalBalanceRaw:'9007199254740993000',spendableBalanceRaw:'9007199254740992999',totalNotes:2,spendableNotes:1,syncState:'partial',syncedAt:5,notes:[{seed:'never expose'}]} as unknown as PrivacyPoolSnapshot;const result=privateBalances(143,[pool],[snapshot])[0];expect(result?.pendingRaw).toBe('1');expect(JSON.stringify(result)).not.toContain('never expose');});
 it('whitelists public portfolio fields',()=>{const result=publicBalances([{chainId:143,type:'native',address:null,symbol:'MON',decimals:18,balanceRaw:'1',privateKey:'forbidden'} as unknown as PublicAssetBalance]);expect(JSON.stringify(result)).not.toContain('privateKey');});
 it('does not count outgoing change notes again as a receipt or leak nullifiers',()=>{const tx=`0x${'b'.repeat(64)}`;const activity={id:'op',chainId:143,kind:'send',status:'confirmed',symbol:'sUSDC',decimals:6,amountRaw:'10',createdAt:1,mainTxHash:tx,txHashes:[tx],rawNote:{secret:'bad'}} as unknown as PrivacyActivity;const note={id:'cmx',poolAddress:pool.address,symbol:'sUSDC',decimals:6,valueRaw:'20',confirmed:true,spent:false,txHash:tx,blockNumber:1};const result=historyEntries([activity],[note]);expect(result).toHaveLength(1);expect(JSON.stringify(result)).not.toContain('rawNote');});
});
