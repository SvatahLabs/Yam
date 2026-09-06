// Run from repository root: node docs/spec/surface-first/evidence/dogfood.mjs
// Provisioning uses Playwright; every UI observation and interaction uses Yam MCP.
import {spawn, spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,cpSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,extname} from 'node:path';
import {createServer,request as proxyRequest} from 'node:http';
import {chromium} from 'playwright';
import {createPlaywrightSurface} from '@svatah/yam-adapter-playwright';

const root=process.cwd(), out=join(root,'docs/spec/surface-first/evidence');
const require=createRequire(join(root,'packages/cli/package.json'));
const {Client}=await import(require.resolve('@modelcontextprotocol/sdk/client/index.js'));
const {StdioClientTransport}=await import(require.resolve('@modelcontextprotocol/sdk/client/stdio.js'));
const scratch=mkdtempSync(join(tmpdir(),'yam-mission-'));
const project=join(scratch,'project');mkdirSync(project);
for(const part of ['flows','steps','api','bindings','data.yaml','yam.config.yaml']) if(existsSync(join(root,'evals/fixtures',part))) cpSync(join(root,'evals/fixtures',part),join(project,part),{recursive:true});
const cli=join(root,'packages/cli/dist/bin.js');
writeFileSync(join(out,'trajectory.jsonl'),'');
const records=[];
const record=(label,data)=>{records.push({label,data});writeFileSync(join(out,'dogfood.json'),JSON.stringify(records,null,2)+'\n');console.log(label);};
for(const args of [['--help'],['surface','snapshot','--json'],['surface','act','--json']]) {const r=spawnSync(process.execPath,[cli,...args],{encoding:'utf8'});record(args.join(' '),{exit:r.status,stdout:r.stdout,stderr:r.stderr});}
let service,browser,web,client,transport,shot;
try {
 service=spawn(process.execPath,[cli,'serve',project,'--port','0'],{stdio:['ignore','pipe','pipe']});
 const info=await new Promise((res,rej)=>{let s='';const t=setTimeout(()=>rej(Error('service startup timeout')),20000); service.stdout.on('data',b=>{s+=b;const m=/url=(\S+) token=(\S+)/.exec(s);if(m){clearTimeout(t);res({url:m[1],token:m[2],project,adopted:false});}});service.on('exit',c=>rej(Error('service exit '+c)));});
 const assets=join(root,'apps/desktop/.vite/renderer/main_window');
 const serviceUrl=info.url;
 web=createServer((req,res)=>{if(req.url.startsWith('/service/')){const p=proxyRequest(serviceUrl+req.url.slice(8),{method:req.method,headers:req.headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});req.pipe(p);return;}if(req.url==='/target'){res.setHeader('Content-Type','text/html');res.end('<title>Yam audit target</title><button>Audit button</button>');return;}try{const path=join(assets,new URL(req.url,'http://localhost').pathname==='/'?'index.html':new URL(req.url,'http://localhost').pathname);res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2'})[extname(path)]||'application/octet-stream');res.end(readFileSync(path));}catch{res.writeHead(404);res.end();}});
 await new Promise(r=>web.listen(0,'127.0.0.1',r));
 info.url='http://127.0.0.1:'+web.address().port+'/service';
 writeFileSync(join(project,'yam.config.yaml'),readFileSync(join(project,'yam.config.yaml'),'utf8').replace('http://127.0.0.1:4173','http://127.0.0.1:'+web.address().port+'/target'));
 browser=await chromium.launch({headless:true,args:['--remote-debugging-port=9471']});
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 await context.addInitScript(info=>{window.yam={serviceInfo:async()=>info,openProject:async()=>info,pickFile:async()=>null,preferences:async()=>({theme:'light',window:{width:1440,height:1000},recentProjects:[]}),onServiceLog:()=>()=>{},onServiceOpened:()=>()=>{}};},info);
 const page=await context.newPage();await page.goto('http://127.0.0.1:'+web.address().port);
 const driver=join(scratch,'driver');mkdirSync(driver);writeFileSync(join(driver,'yam.config.yaml'),'schemaVersion: "1.0.0"\nproject: mission-audit\nadapter: playwright\napp:\n  attach:\n    cdpUrl: http://127.0.0.1:9471\n');
 transport=new StdioClientTransport({command:process.execPath,args:[cli,'mcp',driver,'--trajectory',join(out,'trajectory.jsonl')],stderr:'pipe'});
 client=new Client({name:'yam-mission-audit',version:'1.0.0'});await client.connect(transport);
 record('MCP tools/list',await client.listTools());
 const call=async(name,args)=>{const result=await client.callTool({name,arguments:args});record(name+' '+JSON.stringify(args),result);return result;};
 const snap=async(label)=>{const r=await call('surface_snapshot',{intent:label,maxNodes:200});return JSON.parse(r.content[0].text).text;};
 let text='';for(let i=0;i<10;i++){text=await snap('inspect Yam landing');if(text.includes('Flows'))break;await new Promise(r=>setTimeout(r,300));}
 const {loadConfig}=await import(join(root,'packages/bindings-cli/dist/index.js'));shot=createPlaywrightSurface(loadConfig(driver).config);await shot.open({});await shot.screenshot(join(out,'yam-landing.png'));
 const refFor=(tree,name)=>{const line=tree.split('\n').find(x=>x.includes('"'+name+'"'));if(!line)throw Error('Missing '+name); const m=/\[ref=([^\]]+)\]/.exec(line);if(!m)throw Error('No ref: '+line);return m[1];};
 await call('surface_snapshot',{});
 await call('surface_read',{intent:'read Yam title',kind:'title'});
 await call('surface_act',{intent:'open Yam command palette',action:'click',ref:refFor(text,'Search or run a command')});
 text=await snap('find surface explorer in navigation');
 await call('surface_act',{intent:'open Yam surface explorer',action:'click',ref:refFor(text,'Go to Surface explorer')});
 for(let i=0;i<15;i++){text=await snap('inspect direct surface control form');if(text.includes('Open a session'))break;await new Promise(r=>setTimeout(r,200));}
 await shot.screenshot(join(out,'yam-explorer.png'));
 await call('surface_act',{intent:'try direct action in Yam',action:'click',ref:refFor(text,'Open a session')});
 for(let i=0;i<15;i++){text=await snap('inspect opened explorer');if(text.split('\n').some(l=>l.includes('Act on the element')&&!l.includes('[disabled]')))break;await new Promise(r=>setTimeout(r,200));}
 await call('surface_act',{intent:'provide exploration intent',action:'type',ref:refFor(text,'Intent'),args:{value:'Click the audit button'}});
 text=await snap('inspect action controls after intent');
 await call('surface_act',{intent:'try Yam action button',action:'click',ref:refFor(text,'Act on the element')});
 await call('surface_read',{intent:'read Explorer feedback',kind:'text',ref:'e3'});await snap('read action failure');
 await call('surface_check',{intent:'verify missing action feedback',predicate:{kind:'textContains',value:{kind:'literal',value:'Choose an action.'}},subject:'ref',ref:'e3'});
 await shot.screenshot(join(out,'yam-explorer-action.png'));
 await call('surface_trajectory',{});
 // Service parity probes are against the same disposable Yam project.
 const request=async(path,body)=>{const response=await fetch(serviceUrl+path,{method:'POST',headers:{Authorization:'Bearer '+info.token,'Content-Type':'application/json'},body:JSON.stringify(body)});record('HTTP '+path,{status:response.status,body:await response.json()});};
 await request('/surface/probe/open',{adapter:'does-not-exist'});
 await request('/surface/probe/snapshot',{});
 await request('/surface/probe/read',{kind:'title'});
 await request('/surface/probe/close',{});
} catch(e){record('harness failure',{message:String(e),stack:e.stack});process.exitCode=1;}
finally{await shot?.close().catch(()=>{});await client?.close().catch(()=>{});await browser?.close().catch(()=>{});web?.close();service?.kill('SIGTERM');}
