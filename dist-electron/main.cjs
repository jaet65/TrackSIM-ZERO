var e=Object.create,t=Object.defineProperty,n=Object.getOwnPropertyDescriptor,r=Object.getOwnPropertyNames,i=Object.getPrototypeOf,a=Object.prototype.hasOwnProperty,o=(e,i,o,s)=>{if(i&&typeof i==`object`||typeof i==`function`)for(var c=r(i),l=0,u=c.length,d;l<u;l++)d=c[l],!a.call(e,d)&&d!==o&&t(e,d,{get:(e=>i[e]).bind(null,d),enumerable:!(s=n(i,d))||s.enumerable});return e},s=(n,r,s)=>(s=n==null?{}:e(i(n)),o(r||!n||!n.__esModule||!a.call(n,`default`)?t(s,`default`,{value:n,enumerable:!0}):s,n));let c=require("electron"),l=require("path");l=s(l,1);let u=require("fs");u=s(u,1);let d=require("http");d=s(d,1);let f=require("https");f=s(f,1);let p=require("child_process"),m=require("stream"),h=require("pg"),g=require("electron-updater");function _(){let e=null;return{run(t,n){if(e)return e.key===t?e.promise:Promise.reject(Error(`Ya hay otra actualización descargándose. Inténtalo cuando termine.`));let r=Promise.resolve().then(n).finally(()=>{e?.promise===r&&(e=null)});return e={key:t,promise:r},r},isDownloading(){return e!==null}}}function v(e,t){return e>0&&(t===void 0||e===t)}async function y(e,t,n){let r=await e();return await t(r),n(),r}var b=`jaet65`,x=`TrackSIM-ZERO`;function S(){let e=c.app.getPath(`userData`);return l.join(e,`tracksim_db_config.json`)}function C(){let e=S(),t={host:`192.168.153.2`,port:5496,database:`landerlocaldb`,user:`administrator`,password:`landeraccess`};if(u.existsSync(e))try{let n=JSON.parse(u.readFileSync(e,`utf-8`));return{...t,...n}}catch{return t}return t}function w(e){let t=S(),n={...C(),...e};return u.writeFileSync(t,JSON.stringify(n,null,2),`utf-8`),n}function T(e){if(e==null||isNaN(e))return`00:00:00`;let t=Math.floor(e),n=Math.floor(t/3600),r=Math.floor(t%3600/60),i=t%60;return`${String(n).padStart(2,`0`)}:${String(r).padStart(2,`0`)}:${String(i).padStart(2,`0`)}`}function E(e){return(e||``).normalize(`NFD`).replace(/[\u0300-\u036f]/g,``).replace(/[^a-zA-Z0-9 _]/g,``).trim().replace(/\s+/g,`_`)}async function D(){let e=C(),t=new h.Client({host:e.host,port:Number(e.port)||5496,database:e.database||`landerlocaldb`,user:e.user||`administrator`,password:String(e.password||``),connectionTimeoutMillis:4e3});return await t.connect(),t}async function O(e,t){let n=t.id,r=t.sstudentname||`-`,i=t.dtcreation?new Date(t.dtcreation):new Date,a=t.sinstructorname||`-`,o=Number(t.duration)||0,s=t.idaula,c=[],l=(...e)=>c.push(e.join(`;`));l(`Informe de sesión`,``),l();let u=`N/A`,d=`N/A`,f=`N/A`;try{let t=await e.query(`
      SELECT edunits.sname AS edunit, lessons.sname AS lesson, exercises.sname AS exercise
      FROM sessions, exercises, lessons, idxexerciseslessons, edunits, idxlessonsedunits
      WHERE sessions.id = $1
        AND sessions.idexercise = exercises.id
        AND idxexerciseslessons.idexercise = exercises.id
        AND idxexerciseslessons.idlesson = lessons.id
        AND idxlessonsedunits.idlesson = lessons.id
        AND idxlessonsedunits.idedunit = edunits.id
    `,[n]);if(t.rows.length>0)u=t.rows[0].edunit||`N/A`,d=t.rows[0].lesson||`N/A`,f=t.rows[0].exercise||`N/A`;else{let t=await e.query(`SELECT sname FROM sessions WHERE id = $1`,[n]);if(t.rows.length&&t.rows[0].sname){let e=t.rows[0].sname.split(`
`).map(e=>e.trim()).filter(Boolean);e.length>=3?[u,d,f]=e:e.length===2?[u,d]=e:e.length===1&&(u=e[0])}}}catch{}l(`Lección`,`Unidad`,`Ejercicio`),l(u,d,f),l();let p=i.toISOString().split(`T`)[0];l(`FECHA`,`CONDUCTOR`,`INSTRUCTOR`,`DURACIÓN`),l(p,a,r,T(o)),l(),l(),l(`Condiciones iniciales`,``),l();try{let t=await e.query(`
      SELECT
        substring(sessionsextradata.sdescription from '[^:]+'),
        sessionsextradata.svalue
      FROM idxsessionsextradatasessions, sessionsextradata
      WHERE idxsessionsextradatasessions.idsessionsextradata = sessionsextradata.id
        AND idxsessionsextradatasessions.idsession = $1
        AND idxsessionsextradatasessions.IdAulaSession = $2
    `,[n,s]);for(let e of t.rows)l((e.substring||``)+`:`,e.svalue||``)}catch{}l();let m=``;try{let t=await e.query(`
      SELECT exercises.scomments
      FROM sessions, exercises
      WHERE sessions.idexercise = exercises.id
        AND sessions.id = $1
    `,[n]);t.rows.length&&t.rows[0].scomments&&(m=t.rows[0].scomments)}catch{}l(`Comentarios`,``),l(m),l();let h=``;try{let t=await e.query(`
      SELECT exercises.stags
      FROM sessions, exercises
      WHERE sessions.idexercise = exercises.id
        AND sessions.id = $1
    `,[n]);t.rows.length&&t.rows[0].stags&&(h=t.rows[0].stags)}catch{}l(`Palabras clave del ejercicio`,``),l(h),l();let g=``;try{let t=await e.query(`SELECT instructornotes FROM sessions WHERE id = $1`,[n]);t.rows.length&&t.rows[0].instructornotes&&(g=t.rows[0].instructornotes)}catch{}l(`Notas del instructor`,``),l(g),l(),l(),l(`Marcas`,``),l();try{let t=await e.query(`
      SELECT marks.ncicle*sessions.dcicleperiod/1000.0 AS tiempo,
             marks.stipo,
             marks.scomment
      FROM sessions, marks, idxmarkssessions
      WHERE sessions.id = $1
        AND sessions.IdAula = $2
        AND idxmarkssessions.idsession = sessions.id
        AND idxmarkssessions.idmark = marks.id
      ORDER BY marks.ncicle ASC
    `,[n,s]);for(let e of t.rows)l(T(Number(e.tiempo)),e.stipo||``,e.scomment||``)}catch{}l(),l(),l(`Resumen de marcas`,``),l();try{let t=await e.query(`
      SELECT marks.stipo, marks.scomment, COUNT(marks.id) as cantidad
      FROM marks, idxmarkssessions, sessions
      WHERE idxmarkssessions.idsession = sessions.id
        AND idxmarkssessions.idmark = marks.id
        AND sessions.id = $1
        AND sessions.IdAula = $2
        AND sessions.ncicles*sessions.dcicleperiod > 0
      GROUP BY marks.stipo, marks.scomment
      ORDER BY marks.stipo, COUNT(marks.id) DESC
    `,[n,s]),r={};for(let e of t.rows)r[e.stipo]||(r[e.stipo]=[]),r[e.stipo].push({comment:e.scomment,count:Number(e.cantidad)});let i=[[`ERROR`,`Errores`],[`BREAKDOWN`,`Averias`],[`START EVENT`,`Incidencias`],[`MARK`,`Marcas`],[`WEATHER`,`Eventos de clima`],[`ILLUMINATION`,`Eventos de iluminacion`],[`TRAFFIC`,`Eventos de trafico`],[`START COMM`,`Comunicaciones`],[`ENDING`,`Desenlaces`],[`INFO`,`Mensajes de informacion`],[`STUDENT MARK`,`Marcas de alumno`],[`MESSAGE`,`Mensajes`],[`TRAIN_LOAD`,`Evento de carga de tren`],[`TRAFFIC_CONDS`,`Evento de condiciones de trafico`],[`PULSADOR`,`Pulsador`]],a=!1;for(let[e,t]of i)if(r[e]){a=!0,l(t,``);for(let t of r[e])l(t.comment,t.count);l()}a||(l(`La sesion no contiene marcas`),l())}catch{}l(),l(),l(`Indicadores genéricos`,``),l();try{let t=await e.query(`
      SELECT
        genericindics.sdescription,
        substring(genericindics.svalue from '[0-9.:]+') AS val,
        substring(genericindics.svalue from '[^0-9.:].*') AS unit
      FROM idxgenindicssessions, genericindics
      WHERE idxgenindicssessions.idgenindics = genericindics.id
        AND idxgenindicssessions.idsession = $1
    `,[n]);for(let e of t.rows)l(e.sdescription||``,e.val||``,e.unit||``)}catch{}return{filename:`ID${n}_${E(r)}_${p}.csv`,csv:c.join(`\r
`)}}var k=null;function A(){return new Promise((e,t)=>{let n=l.join(__dirname,`../dist`),r=d.createServer((e,t)=>{let r=new URL(e.url||`/`,`http://localhost`),i=decodeURIComponent(r.pathname);i===`/`&&(i=`/index.html`);let a=l.join(n,i);if((!u.existsSync(a)||u.statSync(a).isDirectory())&&(a=l.join(n,`index.html`)),u.existsSync(a)){let e=l.extname(a).toLowerCase();t.writeHead(200,{"Content-Type":{".html":`text/html; charset=utf-8`,".js":`text/javascript; charset=utf-8`,".css":`text/css; charset=utf-8`,".json":`application/json; charset=utf-8`,".webmanifest":`application/manifest+json; charset=utf-8`,".png":`image/png`,".jpg":`image/jpeg`,".jpeg":`image/jpeg`,".svg":`image/svg+xml`,".ico":`image/x-icon`,".woff":`font/woff`,".woff2":`font/woff2`,".ttf":`font/ttf`}[e]||`application/octet-stream`}),u.createReadStream(a).pipe(t)}else t.writeHead(404),t.end(`Not found`)}),i=[51799,51800,51801,0],a=0,o=()=>{let n=i[a]??0,s=e=>{(e.code===`EADDRINUSE`||e.code===`EACCES`)&&a<i.length-1?(a++,o()):t(e)};r.once(`error`,s),r.listen(n,`127.0.0.1`,()=>{r.removeListener(`error`,s);let n=r.address();n&&typeof n==`object`?(k=r,e(n.port)):t(Error(`Could not bind static server`))})};o()})}var j=null;async function M(){let e=l.join(__dirname,`../dist/favicon.png`),t=l.join(__dirname,`../public/favicon.png`),n=u.existsSync(e)?e:u.existsSync(t)?t:void 0;if(j=new c.BrowserWindow({width:1280,height:840,minWidth:1024,minHeight:700,show:!1,title:`TrackSIM PRO`,icon:n,autoHideMenuBar:!0,webPreferences:{preload:l.join(__dirname,`preload.cjs`),nodeIntegration:!1,contextIsolation:!0,webSecurity:!0}}),j.setMenuBarVisibility(!1),j.maximize(),j.show(),process.env.NODE_ENV===`development`||!c.app.isPackaged)try{await j.loadURL(`http://localhost:5173`)}catch{let e=await A();await j.loadURL(`http://localhost:${e}`)}else{let e=await A();await j.loadURL(`http://localhost:${e}`)}j.webContents.setWindowOpenHandler(()=>({action:`allow`,overrideBrowserWindowOptions:{width:600,height:700,icon:n,autoHideMenuBar:!0}})),j.on(`closed`,()=>{j=null})}c.ipcMain.handle(`lander:checkStatus`,async()=>{let e=C(),t={host:e.host,port:e.port,database:e.database,user:e.user};try{return await(await D()).end(),{service:`running`,db_connected:!0,config:t}}catch(e){return{service:`running`,db_connected:!1,config:t,error:e.message}}}),c.ipcMain.handle(`lander:saveConfig`,async(e,t)=>{try{return w(t),{ok:!0}}catch(e){return{ok:!1,error:e.message}}}),c.ipcMain.handle(`lander:countSessions`,async(e,{inicio:t,fin:n,anon:r})=>{let i=null;try{i=await D();let e=`
      SELECT COUNT(*) as total
      FROM sessions 
      WHERE ncicles > 0 AND CAST(dtcreation AS DATE) BETWEEN $1 AND $2
    `;r||(e+=` AND LOWER(sstudentname) NOT IN ('anonymous', 'anónimo')`);let a=await i.query(e,[t,n]),o=Number(a.rows[0]?.total)||0,s=null,c=null;if(o>0){let e=`
        SELECT MIN(CAST(dtcreation AS DATE)) as min_d, MAX(CAST(dtcreation AS DATE)) as max_d
        FROM sessions 
        WHERE ncicles > 0 AND CAST(dtcreation AS DATE) BETWEEN $1 AND $2
      `;r||(e+=` AND LOWER(sstudentname) NOT IN ('anonymous', 'anónimo')`);let a=await i.query(e,[t,n]);a.rows.length&&(s=a.rows[0].min_d?new Date(a.rows[0].min_d).toISOString().split(`T`)[0]:null,c=a.rows[0].max_d?new Date(a.rows[0].max_d).toISOString().split(`T`)[0]:null)}return{ok:!0,total:o,min_date:s,max_date:c}}catch(e){return{ok:!1,error:e.message}}finally{i&&await i.end().catch(()=>{})}}),c.ipcMain.handle(`lander:extractSessions`,async(e,{inicio:t,fin:n,anon:r,limit:i})=>{let a=null;try{a=await D();let e=Number(i)||200,o=`
      SELECT id, sstudentname, dtcreation, 
             sinstructorname, (ncicles * dcicleperiod / 1000.0) as duration,
             idexercise, idaula
      FROM sessions 
      WHERE ncicles > 0 AND CAST(dtcreation AS DATE) BETWEEN $1 AND $2
    `;r||(o+=` AND LOWER(sstudentname) NOT IN ('anonymous', 'anónimo')`),o+=` ORDER BY dtcreation DESC LIMIT ${e};`;let s=await a.query(o,[t,n]),c=[];for(let e of s.rows)try{let{filename:t,csv:n}=await O(a,e);c.push({id:e.id,driver:e.sstudentname,date:e.dtcreation?new Date(e.dtcreation).toISOString().split(`T`)[0]:``,filename:t,csv:n})}catch(t){c.push({id:e.id,driver:e.sstudentname,error:t.message})}return{ok:!0,extracted:c.length,sessions:c}}catch(e){return{ok:!1,error:e.message}}finally{a&&await a.end().catch(()=>{})}}),c.ipcMain.handle(`lander:getLatestSessionId`,async()=>{let e=null;try{e=await D();let t=await e.query(`
      SELECT MAX(id) as max_id 
      FROM sessions 
      WHERE ncicles > 0
    `);return{ok:!0,maxId:t.rows[0]?.max_id?Number(t.rows[0].max_id):0}}catch(e){return{ok:!1,error:e.message}}finally{e&&await e.end().catch(()=>{})}}),c.ipcMain.handle(`lander:extractNewSessions`,async(e,{afterId:t,anon:n,limit:r})=>{let i=null;try{i=await D();let e=Number(t)||0,a=Math.min(Number(r)||10,50),o=`
      SELECT id, sstudentname, dtcreation, 
             sinstructorname, (ncicles * dcicleperiod / 1000.0) as duration,
             idexercise, idaula
      FROM sessions 
      WHERE ncicles > 0 AND id > $1
    `;n||(o+=` AND LOWER(sstudentname) NOT IN ('anonymous', 'anónimo')`),o+=` ORDER BY id ASC LIMIT ${a};`;let s=await i.query(o,[e]),c=[];for(let e of s.rows)try{let{filename:t,csv:n}=await O(i,e);c.push({id:e.id,driver:e.sstudentname,date:e.dtcreation?new Date(e.dtcreation).toISOString().split(`T`)[0]:``,filename:t,csv:n})}catch(t){c.push({id:e.id,driver:e.sstudentname,error:t.message})}return{ok:!0,extracted:c.length,sessions:c}}catch(e){return{ok:!1,error:e.message}}finally{i&&await i.end().catch(()=>{})}}),c.ipcMain.handle(`lander:getActiveSession`,async()=>{let e=null;try{e=await D(),await e.query(`SET TRANSACTION READ ONLY`).catch(()=>{});let t=(await e.query(`
      SELECT 
        s.id, 
        s.sstudentname, 
        s.sinstructorname, 
        s.sname, 
        s.ncicles, 
        s.dcicleperiod, 
        s.dttimecreation, 
        EXTRACT(EPOCH FROM NOW())::bigint - s.dttimecreation AS wall_seconds,
        (SELECT COUNT(*)::int FROM idxmarkssessions m WHERE m.idsession = s.id) AS mark_count,
        (SELECT MAX(m.ncicle * 8.333 / 1000.0) FROM idxmarkssessions im JOIN marks m ON m.id = im.idmark WHERE im.idsession = s.id) AS latest_mark_sec
      FROM sessions s
      ORDER BY s.id DESC 
      LIMIT 1;
    `)).rows[0];if(!t)return{ok:!0,active:!1};let n=Number(t.ncicles)||0,r=Math.max(0,Number(t.wall_seconds)||0),i=n===0&&r>=0&&r<3600,a=t.latest_mark_sec==null?null:Number(t.latest_mark_sec),o=Math.max(0,r-14);return a!=null&&a>0&&a>o&&(o=Math.round(a)),{ok:!0,active:i,session:{id:t.id,driver:t.sstudentname||`Desconocido`,instructor:t.sinstructorname||``,exercise:t.sname||``,startTime:Number(t.dttimecreation),elapsedSeconds:o,ncicles:n,markCount:Number(t.mark_count)||0}}}catch(e){return{ok:!1,active:!1,error:e.message}}finally{e&&await e.end().catch(()=>{})}}),c.ipcMain.handle(`notify:showDesktop`,async(e,{title:t,body:n})=>{try{if(c.app.setAppUserModelId(`com.tracksim.zero`),c.Notification.isSupported()){let e=l.join(__dirname,`../public/favicon.png`),r=l.join(__dirname,`../dist/favicon.png`),i=u.existsSync(e)?e:u.existsSync(r)?r:void 0,a=new c.Notification({title:t||`TrackSIM PRO`,body:n||``,icon:i,silent:!1});return a.on(`click`,()=>{j&&(j.isMinimized()&&j.restore(),j.focus())}),a.show(),{ok:!0}}return{ok:!1,error:`Notificaciones no soportadas`}}catch(e){return{ok:!1,error:e.message}}});var N=_(),P=null,F=null,I=null,L=!1,R=null,z=!1,B=null;g.autoUpdater.autoDownload=!1,g.autoUpdater.autoInstallOnAppQuit=!1,g.autoUpdater.allowPrerelease=!1;function V(e,t){j&&!j.isDestroyed()&&j.webContents.send(e,t)}function H(){return z?Promise.resolve():R||(R=g.autoUpdater.downloadUpdate().then(()=>void 0).catch(e=>{throw R=null,V(`updater:downloadError`,{version:B,error:e instanceof Error?e.message:`No se pudo descargar la actualización.`}),e}),R)}g.autoUpdater.on(`update-available`,e=>{B=e.version,z=!1,I=null,H().catch(e=>{console.error(`Differential update download error:`,e)})}),g.autoUpdater.on(`update-not-available`,()=>{B=null,z=!1,R=null,I=null}),g.autoUpdater.on(`download-progress`,e=>{I={percent:Math.round(e.percent),transferredMB:Number((e.transferred/1048576).toFixed(1)),totalMB:Number((e.total/1048576).toFixed(1))},V(`updater:downloadProgress`,{...I,version:B})}),g.autoUpdater.on(`update-downloaded`,e=>{z=!0,R=null,B=e.version,I={percent:100,transferredMB:I?.totalMB||0,totalMB:I?.totalMB||0},V(`updater:downloaded`,{version:e.version,filePath:null})}),g.autoUpdater.on(`error`,e=>{console.error(`Auto-updater error:`,e),V(`updater:downloadError`,{version:B,error:e.message||`No se pudo verificar o descargar la actualización.`})});function U(){return l.join(c.app.getPath(`userData`),`pending-update.json`)}function W(e,t){u.writeFileSync(U(),JSON.stringify({installerPath:e,version:t}),`utf-8`)}async function G(){if(!c.app.isPackaged)return!1;let e=U();try{if(!u.existsSync(e))return!1;let{installerPath:t,version:n}=JSON.parse(u.readFileSync(e,`utf-8`));if(!t||!u.existsSync(t)||!q(c.app.getVersion(),n))return u.unlinkSync(e),!1;F=n,await Q(t,!0);try{u.unlinkSync(e)}catch(e){console.error(`No se pudo borrar la actualización pendiente:`,e)}return setTimeout(()=>c.app.exit(0),300),!0}catch(e){return console.error(`No se pudo iniciar la actualización pendiente:`,e),!1}}function K(e){return(e||``).trim().replace(/^[vV]/,``).split(`-`)[0].split(`.`).map(e=>parseInt(e,10)||0)}function q(e,t){let n=K(e),r=K(t),i=Math.max(n.length,r.length,3);for(let e=0;e<i;e++){let t=r[e]||0,i=n[e]||0;if(t>i)return!0;if(t<i)return!1}return!1}function J(e){return new Promise((t,n)=>{let r=f.get(`https://api.github.com${e}`,{headers:{"User-Agent":`TrackSIM-ZERO-Updater`,Accept:`application/vnd.github+json`},timeout:1e4},e=>{let r=``;e.on(`data`,e=>r+=e),e.on(`end`,()=>{try{let n=r?JSON.parse(r):{};t({status:e.statusCode||500,data:n})}catch(e){n(e)}})});r.on(`error`,n),r.on(`timeout`,()=>{r.destroy(Error(`Tiempo de espera agotado al consultar GitHub Releases`))})})}function Y(e,t,n,r=5){return new Promise((i,a)=>{if(r<=0)return a(Error(`Demasiadas redirecciones al descargar el instalador`));let o=!1,s=f.get(e,{headers:{"User-Agent":`TrackSIM-ZERO-Updater`,Accept:`application/octet-stream`}},e=>{o=!0;let c=e.statusCode||0;if([301,302,303,307,308].includes(c)&&e.headers.location){e.resume(),Y(e.headers.location,t,n,r-1).then(i).catch(a);return}if(c<200||c>=300)return e.resume(),a(Error(`Error HTTP ${c} al descargar la actualización`));let l=parseInt(e.headers[`content-length`]||`0`,10),d=0,f=u.createWriteStream(t);e.setTimeout(2e4,()=>{s.destroy(Error(`Tiempo de espera agotado por conexión inestable durante la descarga`))}),e.on(`data`,e=>{d+=e.length,l>0&&n({percent:Math.min(100,Math.round(d/l*100)),transferredMB:Number((d/1048576).toFixed(1)),totalMB:Number((l/1048576).toFixed(1))})}),(0,m.pipeline)(e,f,e=>{e?a(e):i()})});s.setTimeout(2e4,()=>{s.destroy(Error(`Tiempo de espera agotado al conectar para descargar la actualización`))}),s.on(`error`,e=>{o||a(e)})})}function X(e,t){let n=`TrackSIM-PRO-Setup-${t||`latest`}.exe`,r=(e||n).replace(/[^a-zA-Z0-9._ -]/g,`_`),i=(t||`latest`).replace(/[^a-zA-Z0-9._-]/g,`_`);return l.join(c.app.getPath(`temp`),`tracksim-update-${i}-${r}`)}function Z(e,t,n,r){let i=X(t,n),a=JSON.stringify([e,i,n,r]);return N.run(a,async()=>{if(u.existsSync(i)){let e=u.statSync(i);if(v(e.size,r)&&(r!==void 0||P===i&&F===n))return W(i,n),P=i,F=n,I={percent:100,transferredMB:Number((e.size/1048576).toFixed(1)),totalMB:Number((e.size/1048576).toFixed(1))},j&&!j.isDestroyed()&&j.webContents.send(`updater:downloaded`,{version:n,filePath:i}),i}let t=`${i}.part`;try{await Y(e,t,e=>{I=e,j&&!j.isDestroyed()&&j.webContents.send(`updater:downloadProgress`,{...e,version:n})});let a=u.statSync(t).size;if(!v(a,r))throw Error(`La descarga del instalador está incompleta. Inténtalo nuevamente.`);return u.existsSync(i)&&u.unlinkSync(i),u.renameSync(t,i),W(i,n),P=i,F=n,j&&!j.isDestroyed()&&j.webContents.send(`updater:downloaded`,{version:n,filePath:i}),i}catch(e){throw u.existsSync(t)&&u.unlinkSync(t),e}})}async function Q(e,t){if(!e||!u.existsSync(e))throw Error(`El instalador descargado no está disponible.`);if(L)throw Error(`Ya se está iniciando una actualización.`);L=!0;let n=e.replace(/'/g,`''`),r=c.app.getPath(`exe`).replace(/'/g,`''`),i=(F||``).replace(/[^0-9.a-zA-Z-]/g,``),a=t&&c.app.isPackaged?`$true`:`$false`,o=c.app.getPath(`temp`),s=l.join(o,`tracksim-apply-update.ps1`),d=l.join(o,`tracksim-update-launcher.vbs`),f=`\uFEFF$ErrorActionPreference = 'SilentlyContinue'
$installer = '${n}'
$appExe = '${r}'
$verText = if ('${i}') { 'v${i}' } else { 'Nueva versión' }
$restart = ${a}

# 1. Esperar a que todos los procesos de TrackSIM PRO terminen y liberen archivos
for ($i = 0; $i -lt 30; $i++) {
  $procs = Get-Process -Name 'TrackSIM PRO','TrackSIM ZERO' -ErrorAction SilentlyContinue
  if (-not $procs) { break }
  if ($i -ge 10) {
    $procs | Stop-Process -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Milliseconds 300
}

# 2. Mostrar tarjeta moderna WPF sin bordes redondeada mientras NSIS actualiza
$win = $null
$barTranslate = $null
if ($restart) {
  Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase
  $xamlStr = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="Actualizando TrackSIM PRO"
        Width="440" Height="185"
        WindowStartupLocation="CenterScreen"
        WindowStyle="None"
        AllowsTransparency="True"
        Background="Transparent"
        ResizeMode="NoResize"
        Topmost="True"
        ShowInTaskbar="True">
  <Border Margin="16" Background="#FFFFFF" CornerRadius="16" BorderBrush="#E2E8F0" BorderThickness="1">
    <Border.Effect>
      <DropShadowEffect BlurRadius="24" ShadowDepth="6" Opacity="0.18" Color="#0F172A"/>
    </Border.Effect>
    <Grid Margin="22,20,22,20">
      <Grid.RowDefinitions>
        <RowDefinition Height="Auto"/>
        <RowDefinition Height="*"/>
        <RowDefinition Height="Auto"/>
      </Grid.RowDefinitions>

      <!-- Encabezado con icono degradado y badge de versión -->
      <Grid Grid.Row="0">
        <Grid.ColumnDefinitions>
          <ColumnDefinition Width="Auto"/>
          <ColumnDefinition Width="*"/>
          <ColumnDefinition Width="Auto"/>
        </Grid.ColumnDefinitions>

        <Border Grid.Column="0" Width="44" Height="44" CornerRadius="12" Margin="0,0,14,0">
          <Border.Background>
            <LinearGradientBrush StartPoint="0,1" EndPoint="1,0">
              <GradientStop Color="#4F46E5" Offset="0"/>
              <GradientStop Color="#2563EB" Offset="1"/>
            </LinearGradientBrush>
          </Border.Background>
          <Canvas Width="24" Height="24" HorizontalAlignment="Center" VerticalAlignment="Center">
            <Path Data="M12,3 L12,15 M12,15 L8,11 M12,15 L16,11 M4,17 L4,19 C4,20.1 4.9,21 6,21 L18,21 C19.1,21 20,20.1 20,19 L20,17"
                  Stroke="#FFFFFF" StrokeThickness="2.2" StrokeStartLineCap="Round" StrokeEndLineCap="Round" StrokeLineJoin="Round"/>
          </Canvas>
        </Border>

        <StackPanel Grid.Column="1" VerticalAlignment="Center">
          <TextBlock Text="Actualizando TrackSIM PRO" FontFamily="Segoe UI" FontSize="15" FontWeight="Bold" Foreground="#0F172A"/>
          <TextBlock Text="Aplicando actualización en segundo plano..." FontFamily="Segoe UI" FontSize="12" Foreground="#64748B" Margin="0,2,0,0"/>
        </StackPanel>

        <Border Grid.Column="2" Background="#EEF2FF" BorderBrush="#C7D2FE" BorderThickness="1" CornerRadius="10" Padding="9,3" VerticalAlignment="Top">
          <TextBlock x:Name="VerBadge" Text="v1.0" FontFamily="Segoe UI" FontSize="11" FontWeight="Bold" Foreground="#4F46E5"/>
        </Border>
      </Grid>

      <!-- Texto informativo -->
      <TextBlock Grid.Row="1"
                 Text="Por favor espera unos segundos. La aplicación se abrirá automáticamente al finalizar."
                 FontFamily="Segoe UI" FontSize="11.5" Foreground="#475569"
                 VerticalAlignment="Center" TextWrapping="Wrap" Margin="0,8,0,6"/>

      <!-- Barra de progreso moderna -->
      <Border Grid.Row="2" Height="8" Background="#F1F5F9" CornerRadius="4" ClipToBounds="True">
        <Canvas HorizontalAlignment="Left" VerticalAlignment="Center" Height="8" Width="362">
          <Border x:Name="IndigoBar" Width="130" Height="8" CornerRadius="4">
            <Border.Background>
              <LinearGradientBrush StartPoint="0,0" EndPoint="1,0">
                <GradientStop Color="#4F46E5" Offset="0"/>
                <GradientStop Color="#3B82F6" Offset="0.5"/>
                <GradientStop Color="#4F46E5" Offset="1"/>
              </LinearGradientBrush>
            </Border.Background>
            <Border.RenderTransform>
              <TranslateTransform x:Name="BarTranslate" X="-130" Y="0"/>
            </Border.RenderTransform>
          </Border>
        </Canvas>
      </Border>
    </Grid>
  </Border>
</Window>
'@
  $win = [Windows.Markup.XamlReader]::Parse($xamlStr)
  $verNode = $win.FindName('VerBadge')
  if ($verNode) { $verNode.Text = $verText }
  $barTranslate = $win.FindName('BarTranslate')
  $win.Show()
}

# 3. Ejecutar el instalador NSIS en modo silencioso (/S) animando la barra suavemente
if (Test-Path -LiteralPath $installer) {
  $proc = Start-Process -FilePath $installer -ArgumentList '/S' -PassThru
  $pos = -130.0
  while ($proc -and -not $proc.HasExited) {
    if ($win) {
      $pos += 9.5
      if ($pos -gt 365) { $pos = -130.0 }
      if ($barTranslate) { $barTranslate.X = $pos }
      $win.Dispatcher.Invoke([Action]{}, [System.Windows.Threading.DispatcherPriority]::Background)
    }
    Start-Sleep -Milliseconds 25
  }
  Start-Sleep -Milliseconds 100
  Remove-Item -LiteralPath $installer -Force -ErrorAction SilentlyContinue
}

if ($win) {
  $win.Close()
}

# 4. Relanzar TrackSIM PRO de inmediato
if ($restart) {
  $logFile = Join-Path $env:TEMP 'tracksim-update.log'
  $candidates = @($appExe, (Join-Path $env:LOCALAPPDATA 'Programs\\TrackSIM PRO\\TrackSIM PRO.exe'), (Join-Path $env:ProgramFiles 'TrackSIM PRO\\TrackSIM PRO.exe'), (Join-Path $env:LOCALAPPDATA 'Programs\\TrackSIM ZERO\\TrackSIM ZERO.exe'), (Join-Path $env:ProgramFiles 'TrackSIM ZERO\\TrackSIM ZERO.exe')) | Where-Object { $_ }
  $launched = $false
  Start-Sleep -Milliseconds 200
  for ($attempt = 0; $attempt -lt 10 -and -not $launched; $attempt++) {
    foreach ($c in $candidates) {
      if (Test-Path -LiteralPath $c) {
        try {
          Start-Process -FilePath $c -WorkingDirectory (Split-Path -Parent $c) -ErrorAction Stop
          Start-Sleep -Milliseconds 500
          if (Get-Process -Name 'TrackSIM PRO','TrackSIM ZERO' -ErrorAction SilentlyContinue) { $launched = $true; break }
        } catch {
          Add-Content -LiteralPath $logFile -Value ("$(Get-Date -Format o) fallo al relanzar $c : $($_.Exception.Message)")
        }
      }
    }
    if (-not $launched) { Start-Sleep -Milliseconds 300 }
  }
  if (-not $launched) { Add-Content -LiteralPath $logFile -Value ("$(Get-Date -Format o) no se pudo relanzar la app") }
}
`;try{u.writeFileSync(s,f,`utf-8`),u.writeFileSync(d,`CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -Sta -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & WScript.Arguments(0) & """", 0, False\r
`,`utf-8`);let e=(0,p.spawn)(`wscript.exe`,[`//B`,`//NoLogo`,d,s],{detached:!0,stdio:`ignore`,windowsHide:!0});await new Promise((t,n)=>{e.once(`spawn`,t),e.once(`error`,n)}),e.unref()}catch(e){throw L=!1,console.error(`Failed to launch silent installer script:`,e),e}}c.ipcMain.handle(`updater:check`,async()=>{let e=c.app.getVersion();try{let{status:t,data:n}=await J(`/repos/${b}/${x}/releases/latest`);if(t===404){let r=await J(`/repos/${b}/${x}/releases`);if(r.status===200&&Array.isArray(r.data)&&r.data.length>0)t=200,n=r.data[0];else return{ok:!0,currentVersion:e,latestVersion:e,updateAvailable:!1,noReleasesYet:!0}}if(t!==200||!n||!n.tag_name)return{ok:!1,currentVersion:e,error:n?.message||`Respuesta inesperada de GitHub (HTTP ${t})`};if(!c.app.isPackaged)return{ok:!1,currentVersion:e,error:`El actualizador solo está disponible en la versión instalada de TrackSIM PRO.`};let r=String(n.tag_name).replace(/^[vV]/,``),i=await g.autoUpdater.checkForUpdates();if(!i)throw Error(`electron-updater no pudo comprobar la versión publicada.`);let a=i.updateInfo.version||r,o=i.isUpdateAvailable&&q(e,a),s=(Array.isArray(n.assets)?n.assets:[]).find(e=>typeof e.name==`string`&&e.name.toLowerCase().endsWith(`.exe`)&&!e.name.toLowerCase().endsWith(`.blockmap`));o&&!z&&!R&&(B=a,H().catch(e=>{console.error(`Differential update download error:`,e)}));let l=z&&B===a;return{ok:!0,currentVersion:e,latestVersion:a,updateAvailable:o,releaseName:n.name||`v${a}`,releaseNotes:n.body||``,releaseUrl:n.html_url||`https://github.com/${b}/${x}/releases/latest`,publishedAt:n.published_at||null,downloadUrl:s?.browser_download_url||null,fileName:s?.name||null,assetSizeMB:s?.size?Number((s.size/1048576).toFixed(1)):null,assetSizeBytes:s?.size?Number(s.size):void 0,downloadingInBackground:!!R,readyToInstall:l,progress:I}}catch(t){return{ok:!1,currentVersion:e,error:t.message||`No se pudo verificar actualizaciones en GitHub`}}}),c.ipcMain.handle(`updater:downloadAndInstall`,async(e,{downloadUrl:t,fileName:n,version:r,expectedBytes:i})=>{try{if(!c.app.isPackaged)throw Error(`El actualizador solo está disponible en la versión instalada.`);try{if(z||await H(),!z)throw Error(`La actualización todavía no está lista para instalarse.`)}catch(e){if(!t)throw e;return console.error(`Differential update failed; trying the full installer:`,e),await y(()=>Z(t,n,r||`latest`,i),e=>Q(e,!0),()=>setTimeout(()=>{k&&k.close(),c.app.exit(0)},300)),{ok:!0}}return setTimeout(()=>{k&&k.close(),g.autoUpdater.quitAndInstall(!0,!0)},100),{ok:!0}}catch(e){return{ok:!1,error:e.message||`Error al descargar o iniciar la actualización`}}}),c.ipcMain.handle(`updater:openExternal`,async(e,t)=>t&&/^https?:\/\//i.test(t)?(await c.shell.openExternal(t),{ok:!0}):{ok:!1,error:`URL no válida`}),process.defaultApp?process.argv.length>=2&&c.app.setAsDefaultProtocolClient(`tracksim`,process.execPath,[l.resolve(process.argv[1])]):c.app.setAsDefaultProtocolClient(`tracksim`),c.app.requestSingleInstanceLock()?(c.app.on(`second-instance`,()=>{j&&(j.isMinimized()&&j.restore(),j.focus())}),c.app.whenReady().then(async()=>{c.app.setAppUserModelId(`com.tracksim.zero`),!await G()&&(M(),c.app.on(`activate`,()=>{c.BrowserWindow.getAllWindows().length===0&&M()}))})):c.app.quit(),c.app.on(`window-all-closed`,()=>{k&&k.close(),process.platform!==`darwin`&&c.app.quit()});