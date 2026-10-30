var e=Object.create,t=Object.defineProperty,n=Object.getOwnPropertyDescriptor,r=Object.getOwnPropertyNames,i=Object.getPrototypeOf,a=Object.prototype.hasOwnProperty,o=(e,i,o,s)=>{if(i&&typeof i==`object`||typeof i==`function`)for(var c=r(i),l=0,u=c.length,d;l<u;l++)d=c[l],!a.call(e,d)&&d!==o&&t(e,d,{get:(e=>i[e]).bind(null,d),enumerable:!(s=n(i,d))||s.enumerable});return e},s=(n,r,s)=>(s=n==null?{}:e(i(n)),o(r||!n||!n.__esModule||!a.call(n,`default`)?t(s,`default`,{value:n,enumerable:!0}):s,n));let c=require("electron"),l=require("path");l=s(l,1);let u=require("fs");u=s(u,1);let d=require("http");d=s(d,1);let f=require("pg");function p(){let e=c.app.getPath(`userData`);return l.join(e,`tracksim_db_config.json`)}function m(){let e=p(),t={host:`192.168.153.2`,port:5496,database:`landerlocaldb`,user:`administrator`,password:`landeraccess`};if(u.existsSync(e))try{let n=JSON.parse(u.readFileSync(e,`utf-8`));return{...t,...n}}catch{return t}return t}function h(e){let t=p(),n={...m(),...e};return u.writeFileSync(t,JSON.stringify(n,null,2),`utf-8`),n}function g(e){if(e==null||isNaN(e))return`00:00:00`;let t=Math.floor(e),n=Math.floor(t/3600),r=Math.floor(t%3600/60),i=t%60;return`${String(n).padStart(2,`0`)}:${String(r).padStart(2,`0`)}:${String(i).padStart(2,`0`)}`}function _(e){return(e||``).normalize(`NFD`).replace(/[\u0300-\u036f]/g,``).replace(/[^a-zA-Z0-9 _]/g,``).trim().replace(/\s+/g,`_`)}async function v(){let e=m(),t=new f.Client({host:e.host,port:Number(e.port)||5496,database:e.database||`landerlocaldb`,user:e.user||`administrator`,password:String(e.password||``),connectionTimeoutMillis:4e3});return await t.connect(),t}async function y(e,t){let n=t.id,r=t.sstudentname||`-`,i=t.dtcreation?new Date(t.dtcreation):new Date,a=t.sinstructorname||`-`,o=Number(t.duration)||0,s=t.idaula,c=[],l=(...e)=>c.push(e.join(`;`));l(`Informe de sesión`,``),l();let u=`N/A`,d=`N/A`,f=`N/A`;try{let t=await e.query(`
      SELECT edunits.sname AS edunit, lessons.sname AS lesson, exercises.sname AS exercise
      FROM sessions, exercises, lessons, idxexerciseslessons, edunits, idxlessonsedunits
      WHERE sessions.id = $1
        AND sessions.idexercise = exercises.id
        AND idxexerciseslessons.idexercise = exercises.id
        AND idxexerciseslessons.idlesson = lessons.id
        AND idxlessonsedunits.idlesson = lessons.id
        AND idxlessonsedunits.idedunit = edunits.id
    `,[n]);if(t.rows.length>0)u=t.rows[0].edunit||`N/A`,d=t.rows[0].lesson||`N/A`,f=t.rows[0].exercise||`N/A`;else{let t=await e.query(`SELECT sname FROM sessions WHERE id = $1`,[n]);if(t.rows.length&&t.rows[0].sname){let e=t.rows[0].sname.split(`
`).map(e=>e.trim()).filter(Boolean);e.length>=3?[u,d,f]=e:e.length===2?[u,d]=e:e.length===1&&(u=e[0])}}}catch{}l(`Lección`,`Unidad`,`Ejercicio`),l(u,d,f),l();let p=i.toISOString().split(`T`)[0];l(`FECHA`,`CONDUCTOR`,`INSTRUCTOR`,`DURACIÓN`),l(p,a,r,g(o)),l(),l(),l(`Condiciones iniciales`,``),l();try{let t=await e.query(`
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
    `,[n]);t.rows.length&&t.rows[0].stags&&(h=t.rows[0].stags)}catch{}l(`Palabras clave del ejercicio`,``),l(h),l();let v=``;try{let t=await e.query(`SELECT instructornotes FROM sessions WHERE id = $1`,[n]);t.rows.length&&t.rows[0].instructornotes&&(v=t.rows[0].instructornotes)}catch{}l(`Notas del instructor`,``),l(v),l(),l(),l(`Marcas`,``),l();try{let t=await e.query(`
      SELECT marks.ncicle*sessions.dcicleperiod/1000.0 AS tiempo,
             marks.stipo,
             marks.scomment
      FROM sessions, marks, idxmarkssessions
      WHERE sessions.id = $1
        AND sessions.IdAula = $2
        AND idxmarkssessions.idsession = sessions.id
        AND idxmarkssessions.idmark = marks.id
      ORDER BY marks.ncicle ASC
    `,[n,s]);for(let e of t.rows)l(g(Number(e.tiempo)),e.stipo||``,e.scomment||``)}catch{}l(),l(),l(`Resumen de marcas`,``),l();try{let t=await e.query(`
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
    `,[n]);for(let e of t.rows)l(e.sdescription||``,e.val||``,e.unit||``)}catch{}return{filename:`ID${n}_${_(r)}_${p}.csv`,csv:c.join(`\r
`)}}var b=null;function x(){return new Promise((e,t)=>{let n=l.join(__dirname,`../dist`),r=d.createServer((e,t)=>{let r=new URL(e.url||`/`,`http://localhost`),i=decodeURIComponent(r.pathname);i===`/`&&(i=`/index.html`);let a=l.join(n,i);if((!u.existsSync(a)||u.statSync(a).isDirectory())&&(a=l.join(n,`index.html`)),u.existsSync(a)){let e=l.extname(a).toLowerCase();t.writeHead(200,{"Content-Type":{".html":`text/html; charset=utf-8`,".js":`text/javascript; charset=utf-8`,".css":`text/css; charset=utf-8`,".json":`application/json; charset=utf-8`,".png":`image/png`,".jpg":`image/jpeg`,".jpeg":`image/jpeg`,".svg":`image/svg+xml`,".ico":`image/x-icon`}[e]||`application/octet-stream`}),u.createReadStream(a).pipe(t)}else t.writeHead(404),t.end(`Not found`)});r.listen(0,`127.0.0.1`,()=>{let n=r.address();n&&typeof n==`object`?(b=r,e(n.port)):t(Error(`Could not bind static server`))}),r.on(`error`,t)})}var S=null;async function C(){if(S=new c.BrowserWindow({width:1280,height:840,minWidth:1024,minHeight:700,title:`TrackSIM ZERO`,webPreferences:{preload:l.join(__dirname,`preload.cjs`),nodeIntegration:!1,contextIsolation:!0,webSecurity:!0}}),process.env.NODE_ENV===`development`||!c.app.isPackaged)try{await S.loadURL(`http://localhost:5173`)}catch{let e=await x();await S.loadURL(`http://localhost:${e}`)}else{let e=await x();await S.loadURL(`http://localhost:${e}`)}S.webContents.setWindowOpenHandler(()=>({action:`allow`,overrideBrowserWindowOptions:{width:600,height:700,autoHideMenuBar:!0}})),S.on(`closed`,()=>{S=null})}c.ipcMain.handle(`lander:checkStatus`,async()=>{let e=m(),t={host:e.host,port:e.port,database:e.database,user:e.user};try{return await(await v()).end(),{service:`running`,db_connected:!0,config:t}}catch(e){return{service:`running`,db_connected:!1,config:t,error:e.message}}}),c.ipcMain.handle(`lander:saveConfig`,async(e,t)=>{try{return h(t),{ok:!0}}catch(e){return{ok:!1,error:e.message}}}),c.ipcMain.handle(`lander:countSessions`,async(e,{inicio:t,fin:n,anon:r})=>{let i=null;try{i=await v();let e=`
      SELECT COUNT(*) as total
      FROM sessions 
      WHERE ncicles > 0 AND CAST(dtcreation AS DATE) BETWEEN $1 AND $2
    `;r||(e+=` AND LOWER(sstudentname) NOT IN ('anonymous', 'anónimo')`);let a=await i.query(e,[t,n]),o=Number(a.rows[0]?.total)||0,s=null,c=null;if(o>0){let e=`
        SELECT MIN(CAST(dtcreation AS DATE)) as min_d, MAX(CAST(dtcreation AS DATE)) as max_d
        FROM sessions 
        WHERE ncicles > 0 AND CAST(dtcreation AS DATE) BETWEEN $1 AND $2
      `;r||(e+=` AND LOWER(sstudentname) NOT IN ('anonymous', 'anónimo')`);let a=await i.query(e,[t,n]);a.rows.length&&(s=a.rows[0].min_d?new Date(a.rows[0].min_d).toISOString().split(`T`)[0]:null,c=a.rows[0].max_d?new Date(a.rows[0].max_d).toISOString().split(`T`)[0]:null)}return{ok:!0,total:o,min_date:s,max_date:c}}catch(e){return{ok:!1,error:e.message}}finally{i&&await i.end().catch(()=>{})}}),c.ipcMain.handle(`lander:extractSessions`,async(e,{inicio:t,fin:n,anon:r,limit:i})=>{let a=null;try{a=await v();let e=Number(i)||200,o=`
      SELECT id, sstudentname, dtcreation, 
             sinstructorname, (ncicles * dcicleperiod / 1000.0) as duration,
             idexercise, idaula
      FROM sessions 
      WHERE ncicles > 0 AND CAST(dtcreation AS DATE) BETWEEN $1 AND $2
    `;r||(o+=` AND LOWER(sstudentname) NOT IN ('anonymous', 'anónimo')`),o+=` ORDER BY dtcreation DESC LIMIT ${e};`;let s=await a.query(o,[t,n]),c=[];for(let e of s.rows)try{let{filename:t,csv:n}=await y(a,e);c.push({id:e.id,driver:e.sstudentname,date:e.dtcreation?new Date(e.dtcreation).toISOString().split(`T`)[0]:``,filename:t,csv:n})}catch(t){c.push({id:e.id,driver:e.sstudentname,error:t.message})}return{ok:!0,extracted:c.length,sessions:c}}catch(e){return{ok:!1,error:e.message}}finally{a&&await a.end().catch(()=>{})}}),c.app.whenReady().then(()=>{C(),c.app.on(`activate`,()=>{c.BrowserWindow.getAllWindows().length===0&&C()})}),c.app.on(`window-all-closed`,()=>{b&&b.close(),process.platform!==`darwin`&&c.app.quit()});