'use strict';
const $ = id => document.getElementById(id);
let active = false, token = '', geoWatch = null, syncTimer = null, heartbeatTimer = null, lastSent = 0, inFlight = false;
async function post(route, data, keepalive=false) {
  const res = await fetch(route,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify(data),cache:'no-store',keepalive});
  const out=await res.json().catch(()=>({}));if(!res.ok)throw new Error(out.error||`HTTP ${res.status}`);return out;
}
function status(msg,error=false){$('status').textContent=msg;$('status').className=error?'error':'muted';}
async function oneSample(force=false){
 if(!active||inFlight||document.visibilityState!=='visible')return;
 if(!force && Date.now()-lastSent<170000)return;
 inFlight=true;status('正在向 iPhone 请求当前位置…');
 try{
   const position=await new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:true,maximumAge:10000,timeout:25000}));
   if(!active||document.visibilityState!=='visible')return;
   const c=position.coords;
   const point={id:crypto.randomUUID(),latitude:c.latitude,longitude:c.longitude,accuracyMeters:c.accuracy,recordedAt:new Date(position.timestamp).toISOString()};
   $('coords').textContent=c.latitude.toFixed(6)+', '+c.longitude.toFixed(6);
   $('accuracy').textContent='±'+Math.round(c.accuracy)+'米';$('time').textContent=new Date(position.timestamp).toLocaleString();
   await post('/api/device/locations',{points:[point]});lastSent=Date.now();
   $('upload').textContent='成功';status('正在共享位置 · 页面需要保持打开');
 }catch(err){$('upload').textContent='失败';status('定位或上传失败：'+err.message,true);}finally{inFlight=false;}
}
function cleanup(){
 if(syncTimer){clearInterval(syncTimer);syncTimer=null;}
 if(heartbeatTimer){clearInterval(heartbeatTimer);heartbeatTimer=null;}
 if(geoWatch!==null){navigator.geolocation.clearWatch(geoWatch);geoWatch=null;}
 active=false;$('start').disabled=false;$('stop').disabled=true;
}
$('start').onclick=async()=>{
 if(!window.isSecureContext||!navigator.geolocation){status('请通过HTTPS打开此网页，并允许Safari使用定位。',true);return;}
 if(!$('consent').checked){status('请先阅读并勾选明确同意共享。',true);return;}
 if($('token').value.trim().length<24){status('请输入管理员设置的A端设备密钥（不少于24位）。',true);return;}
 token=$('token').value.trim();$('start').disabled=true;
 try{
   await post('/api/device/sharing',{enabled:true,mode:'web'});
   active=true;$('stop').disabled=false;
   $('token').value=''; // avoid leaving the device key in the visible form
   status('已经开启共享，正在获取首次定位…');
   await oneSample(true);
   heartbeatTimer=setInterval(()=>{if(active&&document.visibilityState==='visible')post('/api/device/heartbeat',{}).catch(()=>status('心跳发送失败，请检查网络。',true));},25000);
   syncTimer=setInterval(()=>oneSample(),180000);
 }catch(err){cleanup();status('无法启动：'+err.message,true);}
};
$('stop').onclick=async()=>{
 if(!active)return;cleanup();status('正在停止共享…');
 try{await post('/api/device/sharing',{enabled:false});status('共享已停止，B端无法继续查看位置。');}
 catch(err){status('手机已停止采集，但服务器停止指令发送失败，请检查网络后重新操作：'+err.message,true);}
};
// Browsers can pause in background. Stop collecting immediately when the page is hidden.
document.addEventListener('visibilitychange',()=>{
 if(document.visibilityState==='hidden'&&active){
    cleanup();post('/api/device/sharing',{enabled:false},true).catch(()=>{});
    status('页面已离开前台，已停止浏览器位置采集。如需再次共享，请重新开启。');
 }
});
window.addEventListener('pagehide',()=>{
 if(active){cleanup();post('/api/device/sharing',{enabled:false},true).catch(()=>{});}
});
