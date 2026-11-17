'use strict';
const $=id=>document.getElementById(id);
const date=new Date(Date.now()+30*86400000);date.setMinutes(date.getMinutes()-date.getTimezoneOffset());$('expires').value=date.toISOString().slice(0,16);
async function call(url, body, method='POST'){
 const resp=await fetch(url,{method,headers:{'Content-Type':'application/json','X-Admin-Password':$('secret').value},body:method==='POST'?JSON.stringify(body):undefined,cache:'no-store'});
 const result=await resp.json();if(!resp.ok)throw new Error(result.error||'request failed');return result;
}
$('create').onclick=async()=>{ $('newcode').textContent='';$('createMessage').textContent='';const expiry=new Date($('expires').value);try{const result=await call('/api/admin/cards',{expiresAt:expiry.toISOString()});$('newcode').textContent=result.code;$('createMessage').textContent=`卡密已生成，请安全保存；到期时间 ${new Date(result.expiresAt).toLocaleString()}。服务器只保存卡密哈希，不能再次显示。`;}catch(e){$('createMessage').textContent=e.message;}};
$('status').onclick=async()=>{try{const s=await call('/api/admin/status',null,'GET');$('statusText').textContent=JSON.stringify(s,null,2)}catch(e){$('statusText').textContent=e.message;}};
$('revoke').onclick=async()=>{if(!confirm('确定废止当前卡密并使B端会话失效吗？'))return;try{await call('/api/admin/revoke',{});$('statusText').textContent='卡密已撤销。'}catch(e){$('statusText').textContent=e.message;}};
