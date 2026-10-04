import fs from 'node:fs'; import path from 'node:path';
const D='/home/ohoridein/apps/oho/Backend/migration/_data';
const L=(t)=>{try{return JSON.parse(fs.readFileSync(path.join(D,t+'.json'),'utf8'))}catch{return null}};
const set=(rows,k)=>new Set((rows||[]).map(r=>String(r[k])));
const drivers=L('drivers'), users=L('users'), owners=L('owners'), vt=L('vehicle_types'), zones=L('zones'), zt=L('zone_types');
const targets={
  'drivers.id':set(drivers,'id'), 'drivers.user_id':set(drivers,'user_id'),
  'users.id':set(users,'id'), 'owners.id':set(owners,'id'), 'owners.user_id':set(owners,'user_id'),
  'vehicle_types.id':set(vt,'id'), 'zones.id':set(zones,'id'), 'zone_types.id':set(zt,'id'),
};
const check=(table,col)=>{
  const rows=L(table); if(!rows){console.log(table.padEnd(30),'MISSING');return;}
  const vals=rows.map(r=>String(r[col])).filter(v=>v&&v!=='null'&&v!=='undefined');
  const hits=Object.entries(targets).map(([n,s])=>[n,vals.filter(v=>s.has(v)).length]).filter(([,c])=>c>0).sort((a,b)=>b[1]-a[1]);
  const best=hits[0];
  console.log(`${(table+'.'+col).padEnd(38)} n=${String(vals.length).padStart(4)}  ->  ${best?best[0]+' ('+best[1]+'/'+vals.length+')':'NO MATCH'}${hits[1]?'   [next: '+hits[1][0]+' '+hits[1][1]+']':''}`);
};
console.log('=== which table does each FK really point at? ===');
check('reward_points','user_id'); check('owner_wallets','user_id');
check('request_cancellation_fees','user_id'); check('request_cancellation_fees','driver_id');
check('favourite_locations','user_id'); check('conversations','user_id');
check('sub_vehicle_types','vehicle_type_id'); check('sub_vehicle_types','sub_vehicle_type_id');
check('subscriptions','vehicle_type_id'); check('zone_types','zone_id'); check('zone_type_price','zone_type_id');
