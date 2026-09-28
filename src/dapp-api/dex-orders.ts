import type { DexOrderSummary } from '@plabs-wallet/sdk';
import { readJsonResponse } from '../shared/network-response';
const record=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const id=(value:unknown)=>typeof value==='string'&&/^(0x)?[0-9a-f]{32}$/i.test(value)?value.replace(/^0x/i,'').toLowerCase():null;
const numeric=(value:unknown):string|null=>typeof value==='string'&&/^\d+$/.test(value)&&value.length<79?value:typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?String(value):null;
export interface DexReference { id:string;side:'buy'|'sell';type:'market'|'limit';quantityRaw:string;priceTicks:string;createdAt:number;epoch:string }
/** Import only display references. Order capabilities, view keys and proof openings stay in the legacy wallet. */
export function parseDexReferences(value:unknown):DexReference[]{
 if(!Array.isArray(value)||value.length>200)throw new Error('官网订单引用格式无效或过多');
 return value.map(input=>{
  const row=record(input),orderId=id(row.orderId),quantity=numeric(row.qty),price=numeric(row.price);
  if(!orderId||!quantity||!price||!['buy','sell'].includes(String(row.side))||!['limit','market'].includes(String(row.type))||typeof row.epoch!=='string'||row.epoch.length>160||!Number.isSafeInteger(row.ts)||Number(row.ts)<0)throw new Error('官网订单引用不完整；请在原官网检查订单恢复状态');
  return {id:orderId,side:row.side as 'buy'|'sell',type:row.type as 'limit'|'market',quantityRaw:quantity,priceTicks:price,createdAt:Number(row.ts),epoch:row.epoch};
 });
}
const MATCHER='https://app.plabs.online/dex-matcher';
async function matcher(path:string,body?:unknown){return readJsonResponse(await fetch(`${MATCHER}${path}`,{method:body?'POST':'GET',credentials:'omit',redirect:'error',signal:AbortSignal.timeout(15000),headers:{Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}),1_000_000);}
export async function fetchDexOrders(references:DexReference[]):Promise<DexOrderSummary[]>{
 if(!references.length)return [];
 const health=record(await matcher('/healthz'));
 if(typeof health.matches_epoch!=='string'||health.chain_id!==143)throw new Error('官网 Matcher 网络或轮次配置无效');
 const active=references.filter(row=>row.epoch===health.matches_epoch);
 const statuses:Record<string,unknown>[]=[];
 for(let i=0;i<active.length;i+=50){const response=record(await matcher('/orders/status',{order_ids:active.slice(i,i+50).map(row=>row.id)}));if(!Array.isArray(response.orders))throw new Error('官网订单状态响应无效');statuses.push(...response.orders.map(record));}
 return references.map(row=>{
  const status=statuses.find(item=>id(item.order_id)===row.id);
  const matchedRaw=status?numeric(status.matched_qty):null,pendingRaw=status?numeric(status.pending_qty):null,remainingRaw=status?numeric(status.remaining_qty):null;
  return {...row,status:row.epoch!==health.matches_epoch?'previous-epoch':!status?'not-found':pendingRaw!==null&&BigInt(pendingRaw)>0n?'pending':remainingRaw!==null&&BigInt(remainingRaw)>0n?'open':matchedRaw!==null&&BigInt(matchedRaw)>=BigInt(row.quantityRaw)?'filled':'not-found',matchedRaw,pendingRaw,remainingRaw};
 });
}
