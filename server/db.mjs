import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const dataDir = path.resolve(process.env.DATA_DIR || 'server/data');
fs.mkdirSync(dataDir, { recursive: true });
export const db = new DatabaseSync(path.join(dataDir, 'caterease.sqlite'));
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, phone TEXT NOT NULL,
 password_hash TEXT NOT NULL, dob TEXT NOT NULL, city TEXT NOT NULL DEFAULT '',
 preferred_roles TEXT NOT NULL DEFAULT '[]', role TEXT NOT NULL DEFAULT 'student' CHECK(role IN ('student','admin')),
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
 id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 title TEXT NOT NULL, venue TEXT NOT NULL, city TEXT NOT NULL,
 address TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
 start_at TEXT NOT NULL, end_at TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed','cancelled')),
 is_demo INTEGER NOT NULL DEFAULT 0, created_by INTEGER REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS event_roles (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
 role TEXT NOT NULL, slots INTEGER NOT NULL CHECK(slots > 0),
 pay INTEGER NOT NULL CHECK(pay >= 0), UNIQUE(event_id,role)
);
CREATE TABLE IF NOT EXISTS applications (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 event_id INTEGER NOT NULL REFERENCES events(id),
 role_id INTEGER NOT NULL REFERENCES event_roles(id),
 student_id INTEGER NOT NULL REFERENCES users(id),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','waitlisted','rejected','cancelled','no_show')),
 potential_fine INTEGER NOT NULL DEFAULT 0, submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
 updated_at TEXT NOT NULL DEFAULT (datetime('now')),
 UNIQUE(event_id,student_id)
);
CREATE TABLE IF NOT EXISTS application_history (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 application_id INTEGER NOT NULL REFERENCES applications(id),
 previous_status TEXT, next_status TEXT NOT NULL,
 actor_id INTEGER REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS notifications (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL REFERENCES users(id),
 title TEXT NOT NULL, body TEXT NOT NULL,
 read_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_start ON events(start_at);
CREATE INDEX IF NOT EXISTS idx_apps_role_status ON applications(role_id,status);
CREATE INDEX IF NOT EXISTS idx_apps_student ON applications(student_id);
`);

export const jobRoles = [
 'Cleaning', 'Kitchen cleaning', 'Dish washing', 'Serving', 'Waste management',
 'Welcome drinks', 'Host', 'Stage decoration', 'Pre-setup'
];
export const money = x => `₹${Number(x).toLocaleString('en-IN')}`;
export const addHours = (iso,h) => new Date(new Date(iso).getTime()+h*3600000).toISOString();
export function inTransaction(fn) {
 db.exec('BEGIN IMMEDIATE');
 try { const result=fn(); db.exec('COMMIT'); return result; }
 catch(e) { db.exec('ROLLBACK'); throw e; }
}

function seed() {
 const count = db.prepare('SELECT COUNT(*) n FROM events').get().n;
 if (count) return;
 const base = new Date();
 const demoEvents = [
  {after:3, title:'Banquet service crew',venue:'Convention Hall',city:'Thrissur',description:'Assist the event coordinator with service and guest-facing tasks.',positions:[['Serving',14,700],['Welcome drinks',5,700],['Host',3,1500]]},
  {after:5,title:'Evening reception setup',venue:'Community Event Centre',city:'Kochi',description:'Help with dining-area preparation, hosting and post-event cleaning.',positions:[['Pre-setup',6,700],['Cleaning',8,700],['Host',2,1800]]},
  {after:7,title:'Wedding catering support',venue:'Banquet Centre',city:'Chalakudy',description:'A student catering shift supporting a supervised event team.',positions:[['Serving',12,700],['Dish washing',6,700],['Kitchen cleaning',4,700]]},
  {after:9,title:'Corporate dinner support',venue:'Event Auditorium',city:'Irinjalakuda',description:'Support service, guest welcome and event operations.',positions:[['Serving',8,700],['Welcome drinks',3,700],['Waste management',4,700]]},
 ];
 const insertEvent=db.prepare(`INSERT INTO events (title,venue,city,description,start_at,end_at,notes,is_demo) VALUES (?,?,?,?,?,?,?,1)`);
 const insertRole=db.prepare('INSERT INTO event_roles(event_id,role,slots,pay) VALUES (?,?,?,?)');
 inTransaction(()=>{for(const e of demoEvents){
   const d=new Date(base.getTime()+e.after*86400000);d.setUTCHours(8,30,0,0); // 14:00 IST
   const start=d.toISOString();
   const id=Number(insertEvent.run(e.title,e.venue,e.city,e.description,start,addHours(start,10),'Formal black attire; bring a valid physical ID. Report one hour before the shift.').lastInsertRowid);
   for(const [role,slots,pay] of e.positions)insertRole.run(id,role,slots,pay);
 }});
}
seed();
