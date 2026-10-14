// Isolated fixture benchmark in an already-open local DevTools runtime.
// Does not authenticate, touch MongoDB or submit an application mutation.
import { readFile, mkdir, writeFile } from "node:fs/promises";
const port = Number(process.argv[2] || 9223);
if (![9223, 9224].includes(port)) throw Error("Only owned local benchmark debug ports are allowed");
const mode = port === 9223 ? "browser" : "electron";
const source = (await Promise.all(["sales-index.js", "sales-cache-storage.js", "sales-cache.js"].map(name => readFile(`src/lib/${name}`, "utf8")))).map(text => text.replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "").replace("const salesCache = new SalesCache();", "")).join("\n");
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target = targets.find(t => t.url.startsWith("http://localhost:3000"));
if (!target) throw Error("Owned local runtime is unavailable");
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
try {
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("Native fixture timeout")), 60000);
    ws.onmessage = event => { const response = JSON.parse(event.data); if (response.id !== 1) return; clearTimeout(timer); if (response.error || response.result?.exceptionDetails) reject(Error(response.error?.message || response.result.exceptionDetails.exception?.description)); else resolve(response.result.result.value); };
    ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { awaitPromise: true, returnByValue: true, expression: `(async()=>{
      ${source}
      const rows=Array.from({length:10000},(_,i)=>indexRow({_id:i.toString(16).padStart(24,'0'),name:'Fixture Product '+String(i).padStart(5,'0'),sku:'SKU'+i,barcode:String(i).padStart(8,'0'),manufacturer:'Fixture',categoryId:{name:'Fixture Category'},updatedAt:'2026-10-14',allowPackageSale:true,packageSellingPrice:100}));
      let requests=0;
      const fetcher=async path=>{requests++;const url=new URL(path,location.origin);const ids=url.searchParams.get('ids');const data=ids?rows.filter(p=>ids.split(',').includes(p._id)).map(p=>({...p,stock:{hasStock:true,sealedPackages:10}})):rows;return Response.json({data},{headers:{'X-POS-Cache-Scope':'native-benchmark-fixture-v1',ETag:'"fixture"'}});};
      const storage=nativeSalesStorage();const cache=new SalesCache({storage,fetcher});cache.switchScope({scope:'native-benchmark-fixture-v1',persistent:true});
      const coldStart=performance.now();await cache.ensure();const coldMs=performance.now()-coldStart;await cache.sellingDetails(rows.slice(0,20).map(p=>p._id));await cache.writes;
      const restored=new SalesCache({storage,fetcher});restored.switchScope({scope:'native-benchmark-fixture-v1',persistent:true});const beforeRestore=requests;const restoreStart=performance.now();await restored.ensure();const restoreMs=performance.now()-restoreStart;
      const before=requests,samples=[];for(let cycle=0;cycle<5;cycle++){let start=performance.now();restored.search('product 000');const searchMs=performance.now()-start;start=performance.now();restored.search('');const clearMs=performance.now()-start;start=performance.now();const p=await restored.barcode('00000001');const barcodeMs=performance.now()-start;if(p._id!==rows[1]._id)throw Error('Exact barcode mismatch');samples.push({searchMs,clearMs,barcodeMs});}
      const result={fixture:true,rows:rows.length,indexBytes:new TextEncoder().encode(JSON.stringify(rows)).length,coldMs,restoreMs,source:restored.source,restoreRequests:requests-beforeRestore,operationRequests:requests-before,samples,persistenceError:cache.diskError};
      restored.clear();await restored.writes;return result;
    })()` } }));
  });
  await mkdir("performance-results", { recursive: true }); await writeFile(`performance-results/${mode}-fixture.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
} finally { ws.close(); }
