import type { PrivacyHistoryEntry, PrivacyNote, PublicBalance, ShieldedBalance } from 'plabs-js-sdk';
import type { PrivacyActivity, PrivacyPoolSnapshot, PublicAssetBalance } from '../shared/types';
export function publicBalances(items: PublicAssetBalance[]): PublicBalance[] {
  return items.map(a => ({ chainId:a.chainId,type:a.type,address:a.address,symbol:a.symbol,decimals:a.decimals,balanceRaw:a.balanceRaw }));
}
export function privateBalances(chainId:number,pools:readonly {address:string;symbol:string;decimals:number}[],snapshots:PrivacyPoolSnapshot[]):ShieldedBalance[] {
  return pools.map(pool=>{
    const snapshot=snapshots.find(s=>s.chainId===chainId&&s.poolAddress.toLowerCase()===pool.address.toLowerCase());
    return {chainId,poolAddress:pool.address,symbol:pool.symbol,decimals:pool.decimals,totalRaw:snapshot?.totalBalanceRaw??null,spendableRaw:snapshot?.spendableBalanceRaw??null,pendingRaw:snapshot?(BigInt(snapshot.totalBalanceRaw)-BigInt(snapshot.spendableBalanceRaw)).toString():null,totalNotes:snapshot?.totalNotes??0,spendableNotes:snapshot?.spendableNotes??0,syncState:snapshot?.syncState??'unavailable',syncedAt:snapshot?.syncedAt??null};
  });
}
export function historyEntries(activities:PrivacyActivity[],notes:PrivacyNote[]):PrivacyHistoryEntry[] {
  const rows:PrivacyHistoryEntry[]=activities.map(a=>({id:a.id,chainId:a.chainId,kind:a.kind,status:a.status,symbol:a.symbol,decimals:a.decimals,amountRaw:a.amountRaw,recipient:a.recipient,poolAddress:a.poolAddress,txHash:a.mainTxHash,createdAt:a.createdAt,source:'wallet'}));
  const operationHashes=new Set(activities.flatMap(a=>a.txHashes).map(hash=>hash.toLowerCase()));
  const incoming=new Map<string,PrivacyHistoryEntry>();
  for(const note of notes){
    if(!note.txHash||/^0x0{64}$/.test(note.txHash)||operationHashes.has(note.txHash.toLowerCase()))continue;
    const key=`${note.poolAddress.toLowerCase()}:${note.txHash.toLowerCase()}`;
    const row=incoming.get(key);
    if(row){row.amountRaw=(BigInt(row.amountRaw??'0')+BigInt(note.valueRaw)).toString();if(!note.confirmed)row.status='pending';}
    else incoming.set(key,{id:`received:${key}`,chainId:0,kind:'receive',status:note.confirmed?'confirmed':'pending',symbol:note.symbol,decimals:note.decimals,amountRaw:note.valueRaw,poolAddress:note.poolAddress,txHash:note.txHash,createdAt:null,blockNumber:note.blockNumber,source:'received-note'});
  }
  return [...rows,...incoming.values()].sort((a,b)=>a.createdAt&&b.createdAt?b.createdAt-a.createdAt:(b.blockNumber??0)-(a.blockNumber??0));
}
