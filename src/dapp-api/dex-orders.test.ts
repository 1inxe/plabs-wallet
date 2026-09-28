import { describe,it,expect,vi,afterEach } from 'vitest';
import { parseDexReferences,fetchDexOrders } from './dex-orders';
const id='a'.repeat(32);
const input={orderId:id,side:'sell',type:'limit',qty:120000000000,price:1400,ts:1,epoch:'epoch-1',matchSubscriptions:[{capability:'secret'}],vnote:{ivk:'secret'}};
afterEach(()=>vi.unstubAllGlobals());
describe('official PEX order references',()=>{
 it('imports no credentials or signing materials',()=>{const records=parseDexReferences([input]);expect(JSON.stringify(records)).not.toContain('secret');expect(records[0]).toMatchObject({id,quantityRaw:'120000000000',priceTicks:'1400'});});
 it('rejects malformed order identifiers',()=>expect(()=>parseDexReferences([{...input,orderId:'public-address'}])).toThrow());
 it('fetches official state by known id and never assumes an expired order was filled',async()=>{const fetcher=vi.fn(async(url:string,options?:RequestInit)=>new Response(JSON.stringify(url.endsWith('healthz')?{chain_id:143,matches_epoch:'epoch-1'}:{orders:[{order_id:id,matched_qty:0,pending_qty:0,remaining_qty:120000000000}]}),{headers:{'content-type':'application/json'}}));vi.stubGlobal('fetch',fetcher);const result=await fetchDexOrders(parseDexReferences([input,{...input,orderId:'b'.repeat(32),epoch:'old-epoch'}]));expect(result[0].status).toBe('open');expect(result[1].status).toBe('previous-epoch');const call=fetcher.mock.calls[1];expect(call[0]).toBe('https://app.plabs.online/dex-matcher/orders/status');expect(JSON.parse(String(call[1]?.body))).toEqual({order_ids:[id]});});
});
