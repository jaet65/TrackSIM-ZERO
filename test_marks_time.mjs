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
      m.id,
      m.ncicle,
      s.dcicleperiod,
      m.ncicle * COALESCE(NULLIF(s.dcicleperiod, 0), 8.333) / 1000.0 as mark_time_sec,
      m.sdescription
    FROM idxmarkssessions im
    JOIN sessions s ON s.id = im.idsession
    JOIN marks m ON m.id = im.idmark
    WHERE im.idsession = 20660
    ORDER BY m.id DESC
    LIMIT 5;
  `;
  const res = await client.query(q);
  console.log('LATEST MARKS FOR ACTIVE SESSION:');
  console.log(res.rows);
  await client.end();
}
main().catch(console.error);
