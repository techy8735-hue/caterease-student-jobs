import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { db, jobRoles, inTransaction } from './db.mjs';
import { hashPassword, verifyPassword, currentUser, issueSession, revokeSession, ageOn } from './auth.mjs';

const PORT=Number(process.env.PORT||3030);
const payloadLimit=128*1024;
const fiveHours=5*3600*1000;
const eventSelect=`SELECT e.*, (SELECT MIN(er.pay) FROM event_roles er WHERE er.event_id=e.id) AS min_pay,
 (SELECT COALESCE(SUM(er.slots),0) FROM event_roles er WHERE er.event_id=e.id) AS total_slots,
 (SELECT COUNT(*) FROM applications a WHERE a.event_id=e.id AND a.status='approved') AS approved_count
 FROM events e`;

class HttpError extends Error { constructor(code,message){super(message);this.code=code} }
const bad=(message,code=400)=>{throw new HttpError(code,message)};
function json(res,status,body){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(body));}
function assertText(value,label,max=200){const x=String(value??'').trim();if(!x||x.length>max)bad(`${label} must contain 1–${max} characters.`);return x;}
function optionalText(value,max=800){return String(value??'').trim().slice(0,max);}
const requireUser=u=>{if(!u)bad('Please sign in first.',401);return u};
const requireAdmin=u=>{requireUser(u);if(u.role!=='admin')bad('Administrator access required.',403);return u};
const future=t=>new Date(t).getTime()>Date.now();
const isValidIso=x=>typeof x==='string'&&!Number.isNaN(Date.parse(x))&&/Z$/.test(x);
const row=id=>db.prepare(eventSelect+' WHERE e.id=?').get(id);
function positions(eventId){return db.prepare(`SELECT er.*,
 (SELECT COUNT(*) FROM applications a WHERE a.role_id=er.id AND a.status='approved') as filled,
 (SELECT COUNT(*) FROM applications a WHERE a.role_id=er.id AND a.status='waitlisted') as waitlisted
 FROM event_roles er WHERE er.event_id=? ORDER BY er.id`).all(eventId).map(r=>({...r,available:Math.max(0,r.slots-r.filled)}));}
function eventDetail(id){const e=row(id);return e?{...e,positions:positions(e.id),report_at:new Date(new Date(e.start_at).getTime()-3600000).toISOString()}:null}
const notify=(userId,title,body)=>db.prepare('INSERT INTO notifications(user_id,title,body) VALUES (?,?,?)').run(userId,title,body);
function appHistory(id,previous,next,userId){db.prepare('INSERT INTO application_history(application_id,previous_status,next_status,actor_id) VALUES (?,?,?,?)').run(id,previous,next,userId)}
const formatLocal=iso=>new Date(iso).toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Kolkata'});
function assignmentNotice(event,role,pay,status){return `${status} for ${event.title} at ${event.venue}, ${event.city}. Role: ${role}; pay: ₹${pay}. Event: ${formatLocal(event.start_at)}. Report: ${formatLocal(new Date(new Date(event.start_at).getTime()-3600000).toISOString())}. Dress code: formal black; bring a valid physical ID. Cancellation online closes five hours before the event.`}
function readBody(req){return new Promise((resolve,reject)=>{let s='';req.on('data',c=>{s+=c;if(s.length>payloadLimit){reject(new HttpError(413,'Request too large.'));req.destroy();}});req.on('end',()=>{try{resolve(s?JSON.parse(s):{})}catch{reject(new HttpError(400,'Invalid JSON body.'))}});req.on('error',reject)})}
function checkOrigin(req){
 const origin=req.headers.origin;
 if(!origin)return;
 try {const o=new URL(origin);const h=String(req.headers['x-forwarded-host']||req.headers.host||'').split(',')[0].trim();
  if(o.host===h || (process.env.NODE_ENV!=='production'&&['localhost:5173','127.0.0.1:5173'].includes(o.host)))return;
 }catch{}bad('Cross-origin request not allowed.',403);
}
function serveStatic(req,res,url){
 const dist=path.resolve('dist');if(!fs.existsSync(dist))return false;
 const raw=decodeURIComponent(url.pathname);
 const rel=raw==='/'?'index.html':raw.replace(/^\/+/, '');
 const full=path.resolve(dist,rel);
 if(!(full===dist||full.startsWith(dist+path.sep)))return false;
 let chosen=full;
 if(!fs.existsSync(chosen)||!fs.statSync(chosen).isFile())chosen=path.resolve(dist,'index.html');
 const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.ico':'image/x-icon'};
 res.writeHead(200,{'Content-Type':mime[path.extname(chosen)]||'application/octet-stream','X-Content-Type-Options':'nosniff'});
 fs.createReadStream(chosen).pipe(res);return true;
}
async function handle(req,res){
 const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);const method=req.method;
 if(!url.pathname.startsWith('/api')){if(serveStatic(req,res,url))return;res.writeHead(404);res.end('Run npm run dev and open http://localhost:5173');return;}
 if(!['GET','POST','PATCH','PUT','DELETE'].includes(method))bad('Unsupported method',405);
 if(method!=='GET')checkOrigin(req);
 const body=method==='GET'?{}:await readBody(req);
 const u=currentUser(req);
 const secure=process.env.NODE_ENV==='production';
 if(method==='GET'&&url.pathname==='/api/health')return json(res,200,{ok:true,service:'caterease'});
 if(method==='GET'&&url.pathname==='/api/config')return json(res,200,{emailConfigured:false,timezone:'Asia/Kolkata',roles:jobRoles,mode:'local'});
 if(method==='GET'&&url.pathname==='/api/me')return json(res,200,{user:u});
 if(method==='POST'&&url.pathname==='/api/auth/register'){
  const name=assertText(body.name,'Name',90),email=assertText(body.email,'Email',160).toLowerCase(),phone=assertText(body.phone,'Phone',20),dob=assertText(body.dob,'Date of birth',10),password=String(body.password||''),city=optionalText(body.city,100);
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))bad('Enter a valid email address.');
  if(!/^\+?[0-9\s-]{8,18}$/.test(phone))bad('Enter a valid phone number.');
  if(ageOn(dob)<18)bad('You must be at least 18 to register.');
  if(password.length<10||password.length>120)bad('Password must have at least 10 characters.');
  if(db.prepare('SELECT id FROM users WHERE email=?').get(email))bad('This email is already registered.',409);
  const passwordHash=hashPassword(password);
  const id=Number(db.prepare('INSERT INTO users(name,email,phone,password_hash,dob,city) VALUES(?,?,?,?,?,?)').run(name,email,phone,passwordHash,dob,city).lastInsertRowid);
  issueSession(res,id,secure);return json(res,201,{user:currentUser({headers:{cookie:undefined}})||db.prepare('SELECT id,name,email,phone,dob,city,role FROM users WHERE id=?').get(id)});
 }
 if(method==='POST'&&url.pathname==='/api/auth/login'){
  const email=String(body.email||'').trim().toLowerCase();const password=String(body.password||'');
  const a=db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if(!a||!verifyPassword(password,a.password_hash))bad('Incorrect email or password.',401);
  issueSession(res,a.id,secure);return json(res,200,{user:{id:a.id,name:a.name,email:a.email,phone:a.phone,dob:a.dob,city:a.city,role:a.role,preferred_roles:JSON.parse(a.preferred_roles||'[]')}});
 }
 if(method==='POST'&&url.pathname==='/api/auth/logout'){revokeSession(req,res);return json(res,200,{ok:true});}
 if(method==='GET'&&url.pathname==='/api/events'){
  const search=String(url.searchParams.get('search')||'').trim().toLowerCase();
  const city=String(url.searchParams.get('city')||'').trim().toLowerCase();
  const role=String(url.searchParams.get('role')||'').trim().toLowerCase();
  const ev=db.prepare(eventSelect+' WHERE e.status=? AND e.start_at>? ORDER BY e.start_at ASC').all('open',new Date().toISOString()).map(x=>({...x,positions:positions(x.id)}));
  return json(res,200,{events:ev.filter(e=>(!search||`${e.title} ${e.venue} ${e.city} ${e.description}`.toLowerCase().includes(search))&&(!city||e.city.toLowerCase().includes(city))&&(!role||e.positions.some(r=>r.role.toLowerCase()===role)))});
 }
 const eMatch=url.pathname.match(/^\/api\/events\/(\d+)$/);
 if(method==='GET'&&eMatch){const event=eventDetail(Number(eMatch[1]));if(!event)bad('Event not found.',404);return json(res,200,{event});}
 const apply=url.pathname.match(/^\/api\/events\/(\d+)\/apply$/);
 if(method==='POST'&&apply){requireUser(u);if(u.role!=='student')bad('Only students can apply.',403);if(ageOn(u.dob)<18)bad('You must be 18 or older to apply.',403);
  const id=Number(apply[1]),roleId=Number(body.roleId);
  const result=inTransaction(()=>{
   const e=eventDetail(id);if(!e||e.status!=='open'||!future(e.start_at))bad('This event is no longer accepting applications.');
   const position=e.positions.find(x=>x.id===roleId);if(!position)bad('This role is not available.');
   if(db.prepare('SELECT id FROM applications WHERE student_id=? AND event_id=?').get(u.id,id))bad('You already have an application for this event.',409);
   const appId=Number(db.prepare('INSERT INTO applications(event_id,role_id,student_id) VALUES(?,?,?)').run(id,roleId,u.id).lastInsertRowid);
   appHistory(appId,null,'pending',u.id);
   notify(u.id,'Application received',assignmentNotice(e,position.role,position.pay,'Application pending review'));
   return appId;
  });return json(res,201,{id:result,status:'pending'});
 }
 if(method==='GET'&&url.pathname==='/api/my/applications'){
  requireUser(u);
  const apps=db.prepare(`SELECT a.*,e.title,e.venue,e.city,e.start_at,e.end_at,e.is_demo,er.role AS role_name,er.pay
   FROM applications a JOIN events e ON e.id=a.event_id JOIN event_roles er ON er.id=a.role_id
   WHERE a.student_id=? ORDER BY a.submitted_at DESC,a.id DESC`).all(u.id);
  return json(res,200,{applications:apps});
 }
 const cancel=url.pathname.match(/^\/api\/my\/applications\/(\d+)\/cancel$/);
 if(method==='POST'&&cancel){requireUser(u);
  inTransaction(()=>{const a=db.prepare(`SELECT a.*, e.start_at,e.title,e.venue,e.city,er.role AS role_name,er.pay
   FROM applications a JOIN events e ON e.id=a.event_id JOIN event_roles er ON er.id=a.role_id WHERE a.id=? AND a.student_id=?`).get(Number(cancel[1]),u.id);
   if(!a)bad('Application not found.',404);
   if(!['approved','pending','waitlisted'].includes(a.status))bad('This application cannot be cancelled.');
   if(new Date(a.start_at).getTime()-Date.now()<fiveHours)bad('Online cancellation closes five hours before the event. Please contact the organiser.');
   db.prepare("UPDATE applications SET status='cancelled',updated_at=datetime('now') WHERE id=?").run(a.id);
   appHistory(a.id,a.status,'cancelled',u.id);notify(u.id,'Application cancelled',`${a.title}: your application was cancelled.`);
  });return json(res,200,{ok:true});
 }
 if(method==='PATCH'&&url.pathname==='/api/my/profile'){
  requireUser(u);const name=assertText(body.name,'Name',90),phone=assertText(body.phone,'Phone',20),city=optionalText(body.city,100),roles=Array.isArray(body.roles)?body.roles.filter(x=>jobRoles.includes(x)):[];
  if(!/^\+?[0-9\s-]{8,18}$/.test(phone))bad('Enter a valid phone number.');
  db.prepare('UPDATE users SET name=?,phone=?,city=?,preferred_roles=? WHERE id=?').run(name,phone,city,JSON.stringify(roles),u.id);return json(res,200,{ok:true});
 }
 if(method==='GET'&&url.pathname==='/api/my/notifications'){requireUser(u);const notifications=db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 100').all(u.id);return json(res,200,{notifications});}
 if(method==='POST'&&url.pathname==='/api/my/notifications/read'){requireUser(u);db.prepare("UPDATE notifications SET read_at=datetime('now') WHERE user_id=? AND read_at IS NULL").run(u.id);return json(res,200,{ok:true});}
 if(url.pathname.startsWith('/api/admin'))requireAdmin(u);
 if(method==='GET'&&url.pathname==='/api/admin/summary'){
  const totals={upcoming:db.prepare("SELECT COUNT(*) n FROM events WHERE status='open' AND start_at>?").get(new Date().toISOString()).n,
   pending:db.prepare("SELECT COUNT(*) n FROM applications WHERE status='pending'").get().n,
   approved:db.prepare("SELECT COUNT(*) n FROM applications WHERE status='approved'").get().n,
   waitlisted:db.prepare("SELECT COUNT(*) n FROM applications WHERE status='waitlisted'").get().n,
   students:db.prepare("SELECT COUNT(*) n FROM users WHERE role='student'").get().n};return json(res,200,{summary:totals});
 }
 if(method==='GET'&&url.pathname==='/api/admin/events'){
  const events=db.prepare(eventSelect+' ORDER BY start_at DESC').all().map(e=>({...e,positions:positions(e.id)}));return json(res,200,{events});
 }
 if(method==='POST'&&url.pathname==='/api/admin/events'){
  const title=assertText(body.title,'Event title',140),venue=assertText(body.venue,'Venue',160),city=assertText(body.city,'City',80),description=optionalText(body.description,1400),address=optionalText(body.address,300),notes=optionalText(body.notes,1000),startAt=body.startAt,endAt=body.endAt;
  if(!isValidIso(startAt)||!isValidIso(endAt)||new Date(startAt).getTime()<Date.now()+1800000||new Date(endAt).getTime()<=new Date(startAt).getTime())bad('Enter valid future event start and end times.');
  const roles=Array.isArray(body.roles)?body.roles:[];if(!roles.length||roles.length>jobRoles.length)bad('Select at least one role.');
  const seen=new Set();for(const r of roles){if(!jobRoles.includes(r.role)||seen.has(r.role)||!Number.isInteger(Number(r.slots))||Number(r.slots)<1||Number(r.slots)>200||!Number.isInteger(Number(r.pay))||Number(r.pay)<100||Number(r.pay)>100000)bad('Invalid role, worker count or pay.');seen.add(r.role)}
  const eventId=inTransaction(()=>{
   const id=Number(db.prepare('INSERT INTO events(title,venue,city,address,description,start_at,end_at,notes,created_by,is_demo) VALUES(?,?,?,?,?,?,?,?,?,0)').run(title,venue,city,address,description,startAt,endAt,notes,u.id).lastInsertRowid);
   const insert=db.prepare('INSERT INTO event_roles(event_id,role,slots,pay) VALUES(?,?,?,?)');for(const r of roles)insert.run(id,r.role,Number(r.slots),Number(r.pay));return id;
  });return json(res,201,{event:eventDetail(eventId)});
 }
 const changeStatus=url.pathname.match(/^\/api\/admin\/events\/(\d+)\/status$/);
 if(method==='PATCH'&&changeStatus){
  if(!['open','closed','cancelled'].includes(body.status))bad('Invalid event status.');
  inTransaction(()=>{const e=row(Number(changeStatus[1]));if(!e)bad('Event not found.',404);
   db.prepare('UPDATE events SET status=? WHERE id=?').run(body.status,e.id);
   if(body.status==='cancelled'){
    const apps=db.prepare("SELECT * FROM applications WHERE event_id=? AND status IN ('pending','approved','waitlisted')").all(e.id);
    for(const a of apps){db.prepare("UPDATE applications SET status='cancelled',updated_at=datetime('now') WHERE id=?").run(a.id);appHistory(a.id,a.status,'cancelled',u.id);notify(a.student_id,'Event cancelled',`The event ${e.title} has been cancelled. Your application is no longer active.`);}
   }
  });return json(res,200,{ok:true});
 }
 const applicantList=url.pathname.match(/^\/api\/admin\/events\/(\d+)\/applications$/);
 if(method==='GET'&&applicantList){
  const e=eventDetail(Number(applicantList[1]));if(!e)bad('Event not found.',404);
  const apps=db.prepare(`SELECT a.*,u.name,u.email,u.phone,er.role AS role_name,er.pay FROM applications a
   JOIN users u ON u.id=a.student_id JOIN event_roles er ON er.id=a.role_id WHERE a.event_id=? ORDER BY a.submitted_at ASC,a.id ASC`).all(e.id);
  return json(res,200,{event:e,applications:apps});
 }
 const statusApp=url.pathname.match(/^\/api\/admin\/applications\/(\d+)\/status$/);
 if(method==='PATCH'&&statusApp){
  if(!['approved','rejected','waitlisted','no_show'].includes(body.status))bad('Invalid action.');
  const result=inTransaction(()=>{
   const a=db.prepare(`SELECT a.*,e.title,e.venue,e.city,e.start_at,e.status AS event_status,er.role AS role_name,er.pay,er.slots
    FROM applications a JOIN events e ON e.id=a.event_id JOIN event_roles er ON er.id=a.role_id WHERE a.id=?`).get(Number(statusApp[1]));
   if(!a)bad('Application not found.',404);
   if(['cancelled','no_show'].includes(a.status))bad('This application cannot be changed.');
   if(a.event_status==='cancelled')bad('Event has been cancelled.');
   if(body.status==='no_show'&&(a.status!=='approved'||new Date(a.start_at).getTime()>Date.now()))bad('No-show can be marked only for approved students after event start.');
   if(body.status==='approved'&&a.status!=='approved'){
    const count=db.prepare("SELECT COUNT(*) n FROM applications WHERE role_id=? AND status='approved'").get(a.role_id).n;
    if(count>=a.slots)bad('This role is full. Use the waitlist instead.',409);
   }
   if(body.status==='waitlisted'&&a.status!=='waitlisted'){
    const count=db.prepare("SELECT COUNT(*) n FROM applications WHERE role_id=? AND status='waitlisted'").get(a.role_id).n;
    if(count>=2)bad('Waitlist is full for this role.',409);
   }
   db.prepare("UPDATE applications SET status=?,potential_fine=?,updated_at=datetime('now') WHERE id=?").run(body.status,body.status==='no_show'?500:0,a.id);
   appHistory(a.id,a.status,body.status,u.id);
   const context={...a,role:a.role_name};
   notify(a.student_id,body.status==='no_show'?'Attendance update':`Application ${body.status}`,body.status==='no_show'?`A possible ₹500 no-show penalty has been flagged for ${a.title}; this is not an automatic payment. Contact the organizer if incorrect.`:assignmentNotice(context,a.role_name,a.pay,`Application ${body.status}`));
   return {id:a.id,status:body.status};
  });return json(res,200,result);
 }
 bad('API endpoint not found.',404);
}
http.createServer((req,res)=>{Promise.resolve(handle(req,res)).catch(e=>{
 const code=e instanceof HttpError?e.code:500;
 if(code===500)console.error('Unexpected API error:',e);
 if(!res.headersSent)json(res,code,{error:code===500?'Internal server error.':e.message});
})}).listen(PORT,()=>console.log(`CaterEase API available at http://localhost:${PORT}`));
