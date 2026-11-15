import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { db } from './db.mjs';

export function hashPassword(password){
 const salt=randomBytes(16).toString('hex');
 const hash=scryptSync(password,salt,64).toString('hex');
 return `${salt}:${hash}`;
}
export function verifyPassword(password,stored){
 try{const [salt,hash]=stored.split(':');
  const actual=scryptSync(password,salt,64);const expected=Buffer.from(hash,'hex');
  return actual.length===expected.length&&timingSafeEqual(actual,expected);
 }catch{return false;}
}
const cookieName='caterease_session';
function cookieParse(str=''){
 const parts=String(str).split(';').map(x=>x.trim().split('='));
 return Object.fromEntries(parts.filter(x=>x.length===2));
}
const tokenHash=token=>createHash('sha256').update(token).digest('hex');
export function issueSession(res,userId,secure=false){
 const token=randomBytes(32).toString('hex');
 const expiry=new Date(Date.now()+1000*60*60*24*7).toISOString();
 db.prepare('INSERT INTO sessions(id,user_id,expires_at) VALUES(?,?,?)').run(tokenHash(token),userId,expiry);
 res.setHeader('Set-Cookie', `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${secure?'; Secure':''}`);
}
export function revokeSession(req,res){
 const token=cookieParse(req.headers.cookie)?.[cookieName];
 if(token)db.prepare('DELETE FROM sessions WHERE id=?').run(tokenHash(token));
 res.setHeader('Set-Cookie',`${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}
export function currentUser(req){
 const token=cookieParse(req.headers.cookie)?.[cookieName];
 if(!token||!/^[0-9a-f]{64}$/.test(token))return null;
 const u=db.prepare(`SELECT u.id,u.name,u.email,u.phone,u.dob,u.city,u.preferred_roles,u.role
  FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.id=? AND s.expires_at > ?`).get(tokenHash(token),new Date().toISOString());
 if(!u)return null;
 try{u.preferred_roles=JSON.parse(u.preferred_roles)}catch{u.preferred_roles=[]}
 return u;
}
export function ageOn(date){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return -1;
 const b=new Date(`${date}T00:00:00Z`);if(Number.isNaN(b.getTime())||b.toISOString().slice(0,10)!==date)return -1;
 const now=new Date();let age=now.getUTCFullYear()-b.getUTCFullYear();
 const after=now.getUTCMonth()>b.getUTCMonth()||(now.getUTCMonth()===b.getUTCMonth()&&now.getUTCDate()>=b.getUTCDate());
 return age-(after?0:1);
}
