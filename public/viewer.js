'use strict';
const $ = id => document.getElementById(id);
let map, marker, accuracyCircle, historyLine;
// Store/transmit raw WGS84; convert only for mainland China map links.
const PI=Math.PI,A=6378245,EE=0.00669342162296594323;
const inChina=(lat,lon)=>lat>=18&&lat<=54&&lon>=73&&lon<=135;
function shiftLat(x,y){return -100+2*x+3*y+.2*y*y+.1*x*y+.2*Math.sqrt(Math.abs(x))+(20*Math.sin(6*x*PI)+20*Math.sin(2*x*PI))*2/3+(20*Math.sin(y*PI)+40*Math.sin(y/3*PI))*2/3+(160*Math.sin(y/12*PI)+320*Math.sin(y*PI/30))*2/3;}
function shiftLon(x,y){return 300+x+2*y+.1*x*x+.1*x*y+.1*Math.sqrt(Math.abs(x))+(20*Math.sin(6*x*PI)+20*Math.sin(2*x*PI))*2/3+(20*Math.sin(x*PI)+40*Math.sin(x/3*PI))*2/3+(150*Math.sin(x/12*PI)+300*Math.sin(x/30*PI))*2/3;}
function gcj02(lat,lon){if(!inChina(lat,lon))return[lat,lon];const x=lon-105,y=lat-35,rad=lat/180*PI;const magic=1-EE*Math.sin(rad)**2,sq=Math.sqrt(magic);return[lat+(shiftLat(x,y)*180)/((A*(1-EE))/(magic*sq)*PI),lon+(shiftLon(x,y)*180)/(A/sq*Math.cos(rad)*PI)];}
const inputDate = new Date();
$('date').value = [inputDate.getUTCFullYear(), String(inputDate.getUTCMonth()+1).padStart(2,'0'),String(inputDate.getUTCDate()).padStart(2,'0')].join('-');
function initMap() {
  if (map || typeof L === 'undefined') return;
  map = L.map('map').setView([20, 0], 2);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom:19, attribution:'© OpenStreetMap contributors'}).addTo(map);
}
function showViewer() { $('login').classList.add('hidden');$('viewer').classList.remove('hidden');initMap();setTimeout(()=>map?.invalidateSize(),40); }
function showLogin(msg) { $('login').classList.remove('hidden');$('viewer').classList.add('hidden');if(msg)$('loginError').textContent=msg; }
async function api(url, options={}) {
  const res=await fetch(url, {credentials:'same-origin',cache:'no-store', ...options});
  const out=await res.json().catch(()=>({}));if(!res.ok)throw new Error(out.error||`HTTP ${res.status}`);return out;
}
$('loginForm').addEventListener('submit',async(e)=>{
  e.preventDefault();$('loginError').textContent='';
  try {await api('/api/viewer/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:$('card').value})});$('card').value='';showViewer();await refresh();}catch(err){$('loginError').textContent=err.message;}
});
$('logout').onclick=async()=>{await api('/api/viewer/logout',{method:'POST'}).catch(()=>{});showLogin('');};
$('refresh').onclick=refresh;
async function refresh(){
  try{
    const d=await api('/api/viewer/latest');
    if(!d.sharing){$('status').className='pill warning';$('status').textContent='A端未共享 / 已暂停';$('notice').textContent='设备持有人尚未开启位置共享、已经停止共享，或者Safari已进入后台。';$('appleMap').classList.add('hidden');$('osmMap').classList.add('hidden');if(map&&marker){map.removeLayer(marker);marker=null;}if(map&&accuracyCircle){map.removeLayer(accuracyCircle);accuracyCircle=null;}return;}
    if(!d.latest){$('status').textContent='等待首次上传';$('notice').textContent='A端已授权，但尚未收到位置。可在A端点击立即同步。';return;}
    const p=d.latest;const age=(Date.now()-Date.parse(p.recordedAt))/60000;
    $('status').textContent=age<=40?'最近位置':age<=90?'更新延迟':'位置已过时';
    $('status').className='pill '+(age<=40?'good':age<=90?'warning':'bad');
    $('notice').textContent=`最近一次坐标记录于 ${Math.max(0,Math.round(age))} 分钟前，可能不是当前位置。`;
    $('time').textContent=new Date(p.recordedAt).toLocaleString();$('accuracy').textContent=`±${Math.round(p.accuracyMeters)} 米`;
    $('lat').textContent=p.latitude.toFixed(6);$('lng').textContent=p.longitude.toFixed(6);
    const [glat,glon]=gcj02(p.latitude,p.longitude);$('appleMap').href='https://maps.apple.com/?q='+encodeURIComponent('最近上传的位置')+'&ll='+glat.toFixed(7)+','+glon.toFixed(7);$('appleMap').classList.remove('hidden');
    $('osmMap').href='https://www.openstreetmap.org/?mlat='+p.latitude.toFixed(7)+'&mlon='+p.longitude.toFixed(7)+'#map=17/'+p.latitude.toFixed(7)+'/'+p.longitude.toFixed(7);$('osmMap').classList.remove('hidden');
    if (map) {const xy=[p.latitude,p.longitude];if(marker)marker.setLatLng(xy);else marker=L.marker(xy).addTo(map);if(accuracyCircle)accuracyCircle.setLatLng(xy).setRadius(p.accuracyMeters);else accuracyCircle=L.circle(xy,{radius:p.accuracyMeters,color:'#368bd7',fillOpacity:.1}).addTo(map);map.setView(xy,14);}
  }catch(err){if(err.message.includes('log in'))showLogin('卡密登录已过期，请重新输入。');else $('notice').textContent=err.message;}
}
$('historyButton').onclick=async()=>{
  try{const d=await api('/api/viewer/history?date='+encodeURIComponent($('date').value));if(historyLine&&map){map.removeLayer(historyLine);historyLine=null;}
  if(!d.sharing){$('historyResult').textContent='位置共享已停止';return;}
  $('historyResult').textContent=`此日期共有 ${d.points.length} 个上传的真实位置点。`;
  if(map&&d.points.length>1){historyLine=L.polyline(d.points.map(p=>[p.latitude,p.longitude]),{color:'#e18e25',weight:3}).addTo(map);map.fitBounds(historyLine.getBounds(),{padding:[25,25]});}
  }catch(err){$('historyResult').textContent=err.message;}
};
// Initial check: session is just in memory/cookie and might be valid on refresh.
refreshOnLoad();
async function refreshOnLoad(){try{await api('/api/viewer/latest');showViewer();await refresh();}catch{showLogin('');}}

// The B page refreshes only while visible. It cannot remotely start A's location permission.
setInterval(()=>{if(document.visibilityState==='visible'&&!$('viewer').classList.contains('hidden'))refresh();},10000);
