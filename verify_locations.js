const db = require('better-sqlite3')('emergency_calls.db');

const states = db.prepare("SELECT DISTINCT state FROM emergency_calls WHERE state != 'Unknown' ORDER BY state").all();
const cities = db.prepare("SELECT DISTINCT city FROM emergency_calls WHERE city != 'Unknown' ORDER BY city").all();
const districts = db.prepare("SELECT DISTINCT district FROM emergency_calls WHERE district != 'Unknown' ORDER BY district").all();

console.log('✅ States:', states.map(s => s.state).join(', '));
console.log('\n✅ Cities:', cities.map(c => c.city).join(', '));
console.log('\n✅ Districts:', districts.map(d => d.district).join(', '));

const totalValid = db.prepare("SELECT COUNT(*) as cnt FROM emergency_calls WHERE state != 'Unknown' AND city != 'Unknown'").get();
console.log('\n📊 Total valid location records:', totalValid.cnt);
