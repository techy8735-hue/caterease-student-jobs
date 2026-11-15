import {db} from './db.mjs';
const email=(process.argv[2]||'').trim().toLowerCase();
if(!email){console.error('Usage: npm run make-admin -- name@example.com');process.exit(1);}
const user=db.prepare('SELECT id,name,email,role FROM users WHERE email=?').get(email);
if(!user){console.error('No registered user with that email. Register first.');process.exit(1);}
if(user.role==='admin'){console.log(`Already an admin: ${user.email}`);process.exit(0)}
db.prepare('UPDATE users SET role=? WHERE id=?').run('admin',user.id);
console.log(`Admin role granted to registered user ${user.email}`);
