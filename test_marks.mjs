import pg from 'pg';
const { Client } = pg;
const client = new Client({
  host: '192.168.153.2',
  port: 5496,
  database: 'landerlocaldb',
  user: 'administrator',
  password: 'landeraccess',
  connectionTimeoutMillis: 5000
});

async function main() {
  await client.connect();
  const q = `
    SELECT 
      sessions.id, 
      sessions.sstudentname, 
      sessions.sinstructorname, 
      sessions.sname, 
      sessions.ncicles, 
      sessions.dcicleperiod, 
      sessions.dttimecreation, 
      EXTRACT(EPOCH FROM NOW())::bigint - sessions.dttimecreation AS elapsed_seconds,
      COUNT(idxmarkssessions.idmark)::int AS mark_count
    FROM sessions 
    LEFT JOIN idxmarkssessions ON idxmarkssessions.idsession = sessions.id
    WHERE sessions.id = 20659
    GROUP BY sessions.id;
  `;
  const res = await client.query(q);
  console.log('Session with marks count:', res.rows[0]);
  await client.end();
}
main().catch(console.error);
