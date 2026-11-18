(()=>{
'use strict';
const API='https://mlqrphazmwsslyftwcco.supabase.co';
const KEY='sb_publishable_KP-FebSW9I3L78P2o0_35g_fNML_MsT';
const TABLE='closet_data';
const app=window.fatimaApp;
const panel=document.getElementById('cloudPanel');
const clone=x=>JSON.parse(JSON.stringify(x));
let db,user=null,rev=null,base=null,dirty=false,saving=false,seq=0,connecting=false,channel=null,retryTimer=null,refreshing=false;
let mode='login';
const setMessage=(t,color)=>{let el=document.getElementById('cloudStatus');if(el){el.textContent=t;el.style.color=color||'#544578';}};
const ui=(ready)=>{
  document.body.classList.toggle('cloud-gated',!ready);
  document.getElementById('authForm').style.display=user?'none':'flex';
  document.getElementById('accountControls').style.display=user?'flex':'none';
  document.getElementById('cloudEmail').textContent=user?.email||'';
  document.getElementById('startBlank').style.display=user&&rev===null?'inline-flex':'none';
};
function cacheBase(){
  if(!user||base===null)return;
  localStorage.setItem('closet_sync_base_'+user.id,JSON.stringify(base));
  if(!dirty)localStorage.removeItem('closet_sync_pending_'+user.id);
}
function markPending(){if(user)localStorage.setItem('closet_sync_pending_'+user.id,'1');}
function equals(a,b){return JSON.stringify(a)===JSON.stringify(b);}
function merge(baseData,local,remote){
  const merged=clone(remote),prior=baseData||{bags:[],closets:[]};
  for(const field of ['closets','bags']){
    const old=new Map((prior[field]||[]).map(x=>[x.id,x]));
    const loc=new Map((local[field]||[]).map(x=>[x.id,x]));
    const rem=new Map((remote[field]||[]).map(x=>[x.id,clone(x)]));
    for(const [id,item] of old){if(!loc.has(id))rem.delete(id);}
    for(const [id,item] of loc){if(!old.has(id)||!equals(old.get(id),item))rem.set(id,clone(item));}
    merged[field]=[...rem.values()];
  }
  merged.version=2;merged.lastUpdated=new Date().toISOString();
  return merged;
}
function scheduleWrite(){
  clearTimeout(retryTimer);
  retryTimer=setTimeout(()=>{void flush();},400);
}
async function readCloud(){
  const {data,error}=await db.from(TABLE).select('data,rev').eq('owner_id',user.id).maybeSingle();
  if(error)throw error;
  return data;
}
async function pull(){
  if(!user||rev===null||refreshing||saving)return;
  refreshing=true;
  try{
    const row=await readCloud();
    if(!row||row.rev<=rev)return;
    if(!row.data||!Array.isArray(row.data.bags)||!Array.isArray(row.data.closets))throw new Error('Formato remoto inválido');
    if(dirty){
      const united=merge(base,app.get(),row.data);
      base=clone(row.data);rev=row.rev;app.replace(united);cacheBase();scheduleWrite();
      setMessage('Actualizando cambios de ambos dispositivos…');
    }else{
      base=clone(row.data);rev=row.rev;app.replace(row.data);cacheBase();
      setMessage('✓ Sincronizado automáticamente · Los cambios se ven en todos tus dispositivos','#086f4f');
    }
  }catch(e){setMessage('No fue posible consultar la nube. Los datos locales se conservan: '+e.message,'#a44153');}
  finally{refreshing=false;}
}
async function flush(){
  if(!user||rev===null||!dirty||saving)return;
  saving=true;
  clearTimeout(retryTimer);
  let written=false;
  const startSeq=seq;
  let local=app.get();
  try{
    for(let tries=0;tries<4;tries++){
      const {data,error}=await db.from(TABLE).update({data:local}).eq('owner_id',user.id).eq('rev',rev).select('rev,data').maybeSingle();
      if(error)throw error;
      if(data){
        rev=data.rev;base=clone(local);written=true;
        if(seq===startSeq){dirty=false;localStorage.removeItem('closet_sync_pending_'+user.id);}else{dirty=true;markPending();}
        cacheBase();
        setMessage(dirty?'Guardando cambios recientes…':'✓ Guardado y sincronizado automáticamente','#086f4f');
        break;
      }
      const row=await readCloud();
      if(!row)throw new Error('No se encontró el inventario compartido');
      local=merge(base,app.get(),row.data);
      base=clone(row.data);rev=row.rev;
      app.replace(local);
      markPending();
    }
    if(!written)throw new Error('El inventario cambió muchas veces. Intenta de nuevo.');
  }catch(e){
    dirty=true;markPending();
    setMessage('⚠ Sin sincronizar: '+e.message+' · Tus cambios siguen guardados en este dispositivo.','#a44153');
  }finally{
    saving=false;
    if(dirty&&written)scheduleWrite();
  }
}
function subscribe(){
  if(channel)db.removeChannel(channel);
  channel=db.channel('closet-fatima-'+user.id)
    .on('postgres_changes',{event:'*',schema:'public',table:TABLE,filter:'owner_id=eq.'+user.id},()=>{void pull();})
    .subscribe();
}
async function connect(next){
  if(!next||connecting||user?.id===next.id&&rev!==null)return;
  connecting=true;user=next;ui(false);setMessage('Conectando con tu inventario privado…');
  try{
    const remote=await readCloud(),local=app.get(),pending=localStorage.getItem('closet_sync_pending_'+user.id)==='1';
    const oldBase=JSON.parse(localStorage.getItem('closet_sync_base_'+user.id)||'null');
    if(!remote){
      if(local.bags.length||local.closets.length){
        const agreed=confirm('Este es el primer dispositivo con esta cuenta. ¿Subir a la nube tus '+local.bags.length+' bolsas y '+local.closets.length+' clósets actuales? No se borrarán de tu computadora.');
        if(!agreed){setMessage('No se ha subido nada. Descarga primero un respaldo si lo necesitas.');ui(false);return;}
        const {data,error}=await db.from(TABLE).insert({owner_id:user.id,data:local}).select('rev,data').single();
        if(error)throw error;
        rev=data.rev;base=clone(data.data);dirty=false;cacheBase();
      }else{
        rev=null;base=null;
        setMessage('Esta cuenta aún no tiene inventario. Primero inicia sesión en la PC que tiene tus bolsas y súbelas; después pulsa «Consultar nube» aquí.');
        ui(false);return;
      }
    }else{
      rev=remote.rev;base=clone(remote.data);
      if(pending&&oldBase){
        const united=merge(oldBase,local,remote.data);
        app.replace(united);
        dirty=true;markPending();scheduleWrite();
      }else{
        if(local.bags.length&&!equals(local,remote.data)){
          const overwrite=confirm('Ya existe un inventario en la nube con '+remote.data.bags.length+' bolsas. ¿Usar la versión sincronizada en este dispositivo? Tu lista local será reemplazada. Antes puedes guardar un respaldo con «Respaldar».');
          if(!overwrite){rev=null;setMessage('Conservamos tu lista local. Descarga un respaldo y pulsa «Consultar nube» cuando quieras continuar.');ui(false);return;}
        }
        app.replace(remote.data);
        dirty=false;cacheBase();
      }
    }
    ui(true);subscribe();
    setMessage('✓ Conectada a la nube · Todos los dispositivos con esta cuenta compartirán las bolsas','#086f4f');
  }catch(e){rev=null;ui(false);setMessage('Error de conexión: '+e.message+' · Tu inventario local se conserva.','#a44153');}
  finally{connecting=false;}
}
async function startBlank(){
  if(!user||rev!==null)return;
  if(!confirm('¿Crear un inventario vacío en la nube? Hazlo solo si todavía NO tienes bolsas guardadas en otro equipo.'))return;
  try{
    const local=app.get();
    if(local.bags.length||local.closets.length)return connect(user);
    const {data,error}=await db.from(TABLE).insert({owner_id:user.id,data:local}).select('rev,data').single();
    if(error)throw error;
    rev=data.rev;base=clone(local);dirty=false;cacheBase();ui(true);subscribe();setMessage('✓ Inventario vacío creado. Ya puedes agregar bolsas.','#086f4f');
  }catch(e){setMessage('No se pudo crear inventario: '+e.message,'#a44153');}
}
async function auth(action){
  const email=document.getElementById('syncEmail').value.trim();
  const password=document.getElementById('syncPassword').value;
  if(!email||password.length<6){setMessage('Escribe tu correo y una contraseña de al menos 6 caracteres.','#a44153');return;}
  setMessage('Verificando acceso…');
  try{
    let out=action==='signup'?await db.auth.signUp({email,password}):await db.auth.signInWithPassword({email,password});
    if(out.error)throw out.error;
    if(action==='signup'&&!out.data.session){
      setMessage('Cuenta solicitada. Revisa tu correo y confirma el enlace de Supabase. Después entra con tu contraseña.','#086f4f');
      return;
    }
    if(out.data.user)await connect(out.data.user);
  }catch(e){setMessage('No se pudo iniciar sesión: '+e.message,'#a44153');}
}
function initializePanel(){
  panel.innerHTML='<div class="sync-heading"><strong>☁️ Sincronización de CLOSET SALE FÁTIMA</strong><span id="cloudStatus" role="status">Verificando acceso…</span></div>'
    +'<div id="authForm" class="sync-form"><label>Correo electrónico <input type="email" id="syncEmail" autocomplete="email" placeholder="Tu correo"></label>'
    +'<label>Contraseña <input type="password" id="syncPassword" autocomplete="current-password" placeholder="Mínimo 6 caracteres"></label>'
    +'<button id="loginCloud" class="btn primary" type="button">Entrar</button><button id="signupCloud" class="btn" type="button">Crear cuenta</button></div>'
    +'<div id="accountControls" class="sync-actions"><span id="cloudEmail"></span><button id="refreshCloud" class="btn small" type="button">Consultar nube</button>'
    +'<button id="startBlank" class="btn small" type="button">Crear inventario vacío</button><button id="logoutCloud" class="btn small" type="button">Cerrar sesión</button></div>';
  document.getElementById('loginCloud').onclick=()=>auth('login');
  document.getElementById('signupCloud').onclick=()=>auth('signup');
  document.getElementById('refreshCloud').onclick=async()=>{if(rev===null)await connect(user);else await pull();};
  document.getElementById('startBlank').onclick=startBlank;
  document.getElementById('logoutCloud').onclick=async()=>{
    if(dirty){alert('Aún tienes cambios pendientes de sincronizar. Revisa tu conexión antes de salir.');return;}
    const res=await db.auth.signOut();
    if(res.error){setMessage(res.error.message,'#a44153');return;}
    if(channel)db.removeChannel(channel);
    channel=null;user=null;rev=null;base=null;ui(false);setMessage('Sesión cerrada. Inicia sesión para ver el inventario.');
  };
}
window.fatimaSync={onLocalChange(){
  if(!user||rev===null)return;
  dirty=true;seq++;markPending();setMessage('Guardando cambios automáticamente…');scheduleWrite();
}};
async function main(){
  initializePanel();ui(false);
  if(!app||!window.supabase?.createClient){setMessage('No se pudo cargar el módulo de conexión. Revisa Internet y actualiza la página.','#a44153');return;}
  db=window.supabase.createClient(API,KEY,{auth:{persistSession:true,autoRefreshToken:true}});
  db.auth.onAuthStateChange((event,session)=>{
    if(event==='SIGNED_OUT'){user=null;rev=null;base=null;ui(false);setMessage('Sesión cerrada.');}
    if(event==='SIGNED_IN'&&session?.user&&(!user||user.id!==session.user.id)){setTimeout(()=>{void connect(session.user);},0);}
  });
  const {data,error}=await db.auth.getSession();
  if(error){setMessage('No fue posible recuperar la sesión: '+error.message,'#a44153');return;}
  if(data.session?.user)await connect(data.session.user);
  else{ui(false);setMessage('Primero inicia sesión en la PC con tus bolsas. En el celular entra después con el mismo correo y contraseña.');}
  window.addEventListener('online',()=>{if(dirty)scheduleWrite();else void pull();});
  window.addEventListener('focus',()=>{if(user){if(rev===null)void connect(user);else if(dirty)scheduleWrite();else void pull();}});
  setInterval(()=>{if(user&&rev!==null){if(dirty)scheduleWrite();else void pull();}},20000);
}
void main();
})();