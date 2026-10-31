var e=Object.create,t=Object.defineProperty,n=Object.getOwnPropertyDescriptor,r=Object.getOwnPropertyNames,i=Object.getPrototypeOf,a=Object.prototype.hasOwnProperty,o=(e,i,o,s)=>{if(i&&typeof i==`object`||typeof i==`function`)for(var c=r(i),l=0,u=c.length,d;l<u;l++)d=c[l],!a.call(e,d)&&d!==o&&t(e,d,{get:(e=>i[e]).bind(null,d),enumerable:!(s=n(i,d))||s.enumerable});return e},s=(n,r,s)=>(s=n==null?{}:e(i(n)),o(r||!n||!n.__esModule||!a.call(n,`default`)?t(s,`default`,{value:n,enumerable:!0}):s,n));let c=require("electron"),l=require("path");l=s(l,1);let u=require("fs");u=s(u,1);let d=require("http");d=s(d,1);let f=require("https");f=s(f,1);let p=require("child_process"),m=require("pg");var h=`jaet65`,g=`TrackSIM-ZERO`;function _(){let e=c.app.getPath(`userData`);return l.join(e,`tracksim_db_config.json`)}function v(){let e=_(),t={host:`192.168.153.2`,port:5496,database:`landerlocaldb`,user:`administrator`,password:`landeraccess`};if(u.existsSync(e))try{let n=JSON.parse(u.readFileSync(e,`utf-8`));return{...t,...n}}catch{return t}return t}function y(e){let t=_(),n={...v(),...e};return u.writeFileSync(t,JSON.stringify(n,null,2),`utf-8`),n}function b(e){if(e==null||isNaN(e))return`00:00:00`;let t=Math.floor(e),n=Math.floor(t/3600),r=Math.floor(t%3600/60),i=t%60;return`${String(n).padStart(2,`0`)}:${String(r).padStart(2,`0`)}:${String(i).padStart(2,`0`)}`}function x(e){return(e||``).normalize(`NFD`).replace(/[\u0300-\u036f]/g,``).replace(/[^a-zA-Z0-9 _]/g,``).trim().replace(/\s+/g,`_`)}async function S(){let e=v(),t=new m.Client({host:e.host,port:Number(e.port)||5496,database:e.database||`landerlocaldb`,user:e.user||`administrator`,password:String(e.password||``),connectionTimeoutMillis:4e3});return await t.connect(),t}async function C(e,t){let n=t.id,r=t.sstudentname||`-`,i=t.dtcreation?new Date(t.dtcreation):new Date,a=t.sinstructorname||`-`,o=Number(t.duration)||0,s=t.idaula,c=[],l=(...e)=>c.push(e.join(`;`));l(`Informe de sesión`,``),l();let u=`N/A`,d=`N/A`,f=`N/A`;try{let t=await e.query(`
      SELECT edunits.sname AS edunit, lessons.sname AS lesson, exercises.sname AS exercise
      FROM sessions, exercises, lessons, idxexerciseslessons, edunits, idxlessonsedunits
      WHERE sessions.id = $1
        AND sessions.idexercise = exercises.id
        AND idxexerciseslessons.idexercise = exercises.id
        AND idxexerciseslessons.idlesson = lessons.id
        AND idxlessonsedunits.idlesson = lessons.id
        AND idxlessonsedunits.idedunit = edunits.id
    `,[n]);if(t.rows.length>0)u=t.rows[0].edunit||`N/A`,d=t.rows[0].lesson||`N/A`,f=t.rows[0].exercise||`N/A`;else{let t=await e.query(`SELECT sname FROM sessions WHERE id = $1`,[n]);if(t.rows.length&&t.rows[0].sname){let e=t.rows[0].sname.split(`
`).map(e=>e.trim()).filter(Boolean);e.length>=3?[u,d,f]=e:e.length===2?[u,d]=e:e.length===1&&(u=e[0])}}}catch{}l(`Lección`,`Unidad`,`Ejercicio`),l(u,d,f),l();let p=i.toISOString().split(`T`)[0];l(`FECHA`,`CONDUCTOR`,`INSTRUCTOR`,`DURACIÓN`),l(p,a,r,b(o)),l(),l(),l(`Condiciones iniciales`,``),l();try{let t=await e.query(`
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
    `,[n,s]);for(let e of t.rows)l(b(Number(e.tiempo)),e.stipo||``,e.scomment||``)}catch{}l(),l(),l(`Resumen de marcas`,``),l();try{let t=await e.query(`
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
    `,[n]);for(let e of t.rows)l(e.sdescription||``,e.val||``,e.unit||``)}catch{}return{filename:`ID${n}_${x(r)}_${p}.csv`,csv:c.join(`\r
`)}}var w=null;function T(){return new Promise((e,t)=>{let n=l.join(__dirname,`../dist`),r=d.createServer((e,t)=>{let r=new URL(e.url||`/`,`http://localhost`),i=decodeURIComponent(r.pathname);i===`/`&&(i=`/index.html`);let a=l.join(n,i);if((!u.existsSync(a)||u.statSync(a).isDirectory())&&(a=l.join(n,`index.html`)),u.existsSync(a)){let e=l.extname(a).toLowerCase();t.writeHead(200,{"Content-Type":{".html":`text/html; charset=utf-8`,".js":`text/javascript; charset=utf-8`,".css":`text/css; charset=utf-8`,".json":`application/json; charset=utf-8`,".webmanifest":`application/manifest+json; charset=utf-8`,".png":`image/png`,".jpg":`image/jpeg`,".jpeg":`image/jpeg`,".svg":`image/svg+xml`,".ico":`image/x-icon`,".woff":`font/woff`,".woff2":`font/woff2`,".ttf":`font/ttf`}[e]||`application/octet-stream`}),u.createReadStream(a).pipe(t)}else t.writeHead(404),t.end(`Not found`)}),i=[51799,51800,51801,0],a=0,o=()=>{let n=i[a]??0,s=e=>{(e.code===`EADDRINUSE`||e.code===`EACCES`)&&a<i.length-1?(a++,o()):t(e)};r.once(`error`,s),r.listen(n,`127.0.0.1`,()=>{r.removeListener(`error`,s);let n=r.address();n&&typeof n==`object`?(w=r,e(n.port)):t(Error(`Could not bind static server`))})};o()})}var E=null;async function D(){let e=l.join(__dirname,`../dist/favicon.ico`),t=l.join(__dirname,`../public/favicon.ico`),n=u.existsSync(e)?e:u.existsSync(t)?t:void 0;if(E=new c.BrowserWindow({width:1280,height:840,minWidth:1024,minHeight:700,show:!1,title:`TrackSIM ZERO`,icon:n,webPreferences:{preload:l.join(__dirname,`preload.cjs`),nodeIntegration:!1,contextIsolation:!0,webSecurity:!0}}),E.maximize(),E.show(),process.env.NODE_ENV===`development`||!c.app.isPackaged)try{await E.loadURL(`http://localhost:5173`)}catch{let e=await T();await E.loadURL(`http://localhost:${e}`)}else{let e=await T();await E.loadURL(`http://localhost:${e}`)}E.webContents.setWindowOpenHandler(()=>({action:`allow`,overrideBrowserWindowOptions:{width:600,height:700,autoHideMenuBar:!0}})),E.on(`closed`,()=>{E=null})}c.ipcMain.handle(`lander:checkStatus`,async()=>{let e=v(),t={host:e.host,port:e.port,database:e.database,user:e.user};try{return await(await S()).end(),{service:`running`,db_connected:!0,config:t}}catch(e){return{service:`running`,db_connected:!1,config:t,error:e.message}}}),c.ipcMain.handle(`lander:saveConfig`,async(e,t)=>{try{return y(t),{ok:!0}}catch(e){return{ok:!1,error:e.message}}}),c.ipcMain.handle(`lander:countSessions`,async(e,{inicio:t,fin:n,anon:r})=>{let i=null;try{i=await S();let e=`
      SELECT COUNT(*) as total
      FROM sessions 
      WHERE ncicles > 0 AND CAST(dtcreation AS DATE) BETWEEN $1 AND $2
    `;r||(e+=` AND LOWER(sstudentname) NOT IN ('anonymous', 'anónimo')`);let a=await i.query(e,[t,n]),o=Number(a.rows[0]?.total)||0,s=null,c=null;if(o>0){let e=`
        SELECT MIN(CAST(dtcreation AS DATE)) as min_d, MAX(CAST(dtcreation AS DATE)) as max_d
        FROM sessions 
        WHERE ncicles > 0 AND CAST(dtcreation AS DATE) BETWEEN $1 AND $2
      `;r||(e+=` AND LOWER(sstudentname) NOT IN ('anonymous', 'anónimo')`);let a=await i.query(e,[t,n]);a.rows.length&&(s=a.rows[0].min_d?new Date(a.rows[0].min_d).toISOString().split(`T`)[0]:null,c=a.rows[0].max_d?new Date(a.rows[0].max_d).toISOString().split(`T`)[0]:null)}return{ok:!0,total:o,min_date:s,max_date:c}}catch(e){return{ok:!1,error:e.message}}finally{i&&await i.end().catch(()=>{})}}),c.ipcMain.handle(`lander:extractSessions`,async(e,{inicio:t,fin:n,anon:r,limit:i})=>{let a=null;try{a=await S();let e=Number(i)||200,o=`
      SELECT id, sstudentname, dtcreation, 
             sinstructorname, (ncicles * dcicleperiod / 1000.0) as duration,
             idexercise, idaula
      FROM sessions 
      WHERE ncicles > 0 AND CAST(dtcreation AS DATE) BETWEEN $1 AND $2
    `;r||(o+=` AND LOWER(sstudentname) NOT IN ('anonymous', 'anónimo')`),o+=` ORDER BY dtcreation DESC LIMIT ${e};`;let s=await a.query(o,[t,n]),c=[];for(let e of s.rows)try{let{filename:t,csv:n}=await C(a,e);c.push({id:e.id,driver:e.sstudentname,date:e.dtcreation?new Date(e.dtcreation).toISOString().split(`T`)[0]:``,filename:t,csv:n})}catch(t){c.push({id:e.id,driver:e.sstudentname,error:t.message})}return{ok:!0,extracted:c.length,sessions:c}}catch(e){return{ok:!1,error:e.message}}finally{a&&await a.end().catch(()=>{})}});var O=!1,k=null,A=null,j=null,M=!1;function N(e){return(e||``).trim().replace(/^[vV]/,``).split(`-`)[0].split(`.`).map(e=>parseInt(e,10)||0)}function P(e,t){let n=N(e),r=N(t),i=Math.max(n.length,r.length,3);for(let e=0;e<i;e++){let t=r[e]||0,i=n[e]||0;if(t>i)return!0;if(t<i)return!1}return!1}function F(e){return new Promise((t,n)=>{let r=f.get(`https://api.github.com${e}`,{headers:{"User-Agent":`TrackSIM-ZERO-Updater`,Accept:`application/vnd.github+json`},timeout:1e4},e=>{let r=``;e.on(`data`,e=>r+=e),e.on(`end`,()=>{try{let n=r?JSON.parse(r):{};t({status:e.statusCode||500,data:n})}catch(e){n(e)}})});r.on(`error`,n),r.on(`timeout`,()=>{r.destroy(Error(`Tiempo de espera agotado al consultar GitHub Releases`))})})}function I(e,t,n,r=5){return new Promise((i,a)=>{if(r<=0)return a(Error(`Demasiadas redirecciones al descargar el instalador`));let o=f.get(e,{headers:{"User-Agent":`TrackSIM-ZERO-Updater`,Accept:`application/octet-stream`}},e=>{let s=e.statusCode||0;if([301,302,303,307,308].includes(s)&&e.headers.location){e.resume(),I(e.headers.location,t,n,r-1).then(i).catch(a);return}if(s<200||s>=300)return e.resume(),a(Error(`Error HTTP ${s} al descargar la actualización`));let c=parseInt(e.headers[`content-length`]||`0`,10),l=0,d=u.createWriteStream(t);e.setTimeout(2e4,()=>{o.destroy(Error(`Tiempo de espera agotado por conexión inestable durante la descarga`))}),e.on(`data`,e=>{l+=e.length,c>0&&n({percent:Math.min(100,Math.round(l/c*100)),transferredMB:Number((l/1048576).toFixed(1)),totalMB:Number((c/1048576).toFixed(1))})}),e.pipe(d),d.on(`finish`,()=>{d.close(()=>i())}),d.on(`error`,e=>{u.unlink(t,()=>{}),a(e)})});o.setTimeout(2e4,()=>{o.destroy(Error(`Tiempo de espera agotado al conectar para descargar la actualización`))}),o.on(`error`,e=>{u.unlink(t,()=>{}),a(e)})})}function L(e,t){let n=`TrackSIM-ZERO-Setup-${t||`latest`}.exe`,r=(e||n).replace(/[^a-zA-Z0-9._ -]/g,`_`);return l.join(c.app.getPath(`temp`),r)}async function R(e,t,n,r){let i=L(t,n);if(u.existsSync(i))try{let e=u.statSync(i);if(!r||e.size===r||e.size>10485760)return k=i,A=n,j={percent:100,transferredMB:Number((e.size/1048576).toFixed(1)),totalMB:Number((e.size/1048576).toFixed(1))},E&&!E.isDestroyed()&&E.webContents.send(`updater:downloaded`,{version:n,filePath:i}),i}catch{}if(O)return i;O=!0;let a=`${i}.part`;try{if(await I(e,a,e=>{j=e,E&&!E.isDestroyed()&&E.webContents.send(`updater:downloadProgress`,{...e,version:n})}),u.existsSync(i))try{u.unlinkSync(i)}catch{}return u.renameSync(a,i),k=i,A=n,E&&!E.isDestroyed()&&E.webContents.send(`updater:downloaded`,{version:n,filePath:i}),i}finally{O=!1}}function z(e,t){if(!e||!u.existsSync(e)||M)return;M=!0;let n=e.replace(/'/g,`''`),r=c.app.getPath(`exe`).replace(/'/g,`''`),i=(A||``).replace(/[^0-9.a-zA-Z-]/g,``),a=t&&c.app.isPackaged?`$true`:`$false`,o=c.app.getPath(`temp`),s=l.join(o,`tracksim-apply-update.ps1`),d=l.join(o,`tracksim-update-launcher.vbs`),f=`\uFEFF$ErrorActionPreference = 'SilentlyContinue'
$installer = '${n}'
$appExe = '${r}'
$verText = if ('${i}') { 'v${i}' } else { 'Nueva versión' }
$restart = ${a}

# 1. Esperar a que todos los procesos de TrackSIM ZERO terminen y liberen archivos
for ($i = 0; $i -lt 30; $i++) {
  $procs = Get-Process -Name 'TrackSIM ZERO' -ErrorAction SilentlyContinue
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
        Title="Actualizando TrackSIM ZERO"
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
          <TextBlock Text="Actualizando TrackSIM ZERO" FontFamily="Segoe UI" FontSize="15" FontWeight="Bold" Foreground="#0F172A"/>
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
  Start-Sleep -Milliseconds 800
  Remove-Item -LiteralPath $installer -Force -ErrorAction SilentlyContinue
}

if ($win) {
  $win.Close()
}

# 4. Relanzar TrackSIM ZERO si corresponde
if ($restart -and (Test-Path -LiteralPath $appExe)) {
  Start-Process -FilePath $appExe
}
`;try{u.writeFileSync(s,f,`utf-8`),u.writeFileSync(d,`CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -Sta -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & WScript.Arguments(0) & """", 0, False\r
`,`utf-8`),(0,p.spawn)(`wscript.exe`,[`//B`,`//NoLogo`,d,s],{detached:!0,stdio:`ignore`,windowsHide:!0}).unref()}catch(e){console.error(`Failed to launch silent installer script:`,e)}}c.ipcMain.handle(`updater:check`,async()=>{let e=c.app.getVersion();try{let{status:t,data:n}=await F(`/repos/${h}/${g}/releases/latest`);if(t===404){let r=await F(`/repos/${h}/${g}/releases`);if(r.status===200&&Array.isArray(r.data)&&r.data.length>0)t=200,n=r.data[0];else return{ok:!0,currentVersion:e,latestVersion:e,updateAvailable:!1,noReleasesYet:!0}}if(t!==200||!n||!n.tag_name)return{ok:!1,currentVersion:e,error:n?.message||`Respuesta inesperada de GitHub (HTTP ${t})`};let r=String(n.tag_name).replace(/^[vV]/,``),i=P(e,r),a=(Array.isArray(n.assets)?n.assets:[]).find(e=>typeof e.name==`string`&&e.name.toLowerCase().endsWith(`.exe`)&&!e.name.toLowerCase().endsWith(`.blockmap`))||null,o=a?a.browser_download_url:null,s=a?a.name:`TrackSIM-ZERO-Setup-${r}.exe`,c=a?.size?Number(a.size):void 0;i&&o&&R(o,s,r,c).catch(e=>{console.error(`Background update download error:`,e)});let l=!!(k&&u.existsSync(k))&&A===r;return{ok:!0,currentVersion:e,latestVersion:r,updateAvailable:i,releaseName:n.name||`v${r}`,releaseNotes:n.body||``,releaseUrl:n.html_url||`https://github.com/${h}/${g}/releases/latest`,publishedAt:n.published_at||null,downloadUrl:o,fileName:s,assetSizeMB:a?.size?Number((a.size/1048576).toFixed(1)):null,downloadingInBackground:O,readyToInstall:l,progress:j}}catch(t){return{ok:!1,currentVersion:e,error:t.message||`No se pudo verificar actualizaciones en GitHub`}}}),c.ipcMain.handle(`updater:downloadAndInstall`,async(e,{downloadUrl:t,fileName:n,version:r})=>{try{let e=r||A||`latest`;if(k&&u.existsSync(k))return z(k,!0),setTimeout(()=>{if(w)try{w.close()}catch{}c.app.exit(0)},300),{ok:!0,filePath:k};if(!t)throw Error(`No se encontró el archivo instalador (.exe) en el Release de GitHub.`);let i=await R(t,n,e);return z(i,!0),setTimeout(()=>{if(w)try{w.close()}catch{}c.app.exit(0)},300),{ok:!0,filePath:i}}catch(e){return{ok:!1,error:e.message||`Error al descargar o iniciar el instalador`}}}),c.ipcMain.handle(`updater:openExternal`,async(e,t)=>t&&/^https?:\/\//i.test(t)?(await c.shell.openExternal(t),{ok:!0}):{ok:!1,error:`URL no válida`}),process.defaultApp?process.argv.length>=2&&c.app.setAsDefaultProtocolClient(`tracksim`,process.execPath,[l.resolve(process.argv[1])]):c.app.setAsDefaultProtocolClient(`tracksim`),c.app.requestSingleInstanceLock()?(c.app.on(`second-instance`,()=>{E&&(E.isMinimized()&&E.restore(),E.focus())}),c.app.whenReady().then(()=>{D(),c.app.on(`activate`,()=>{c.BrowserWindow.getAllWindows().length===0&&D()})})):c.app.quit(),c.app.on(`will-quit`,()=>{!M&&k&&u.existsSync(k)&&z(k,!1)}),c.app.on(`window-all-closed`,()=>{w&&w.close(),process.platform!==`darwin`&&c.app.quit()});