
const { Client } = require('pg');

async function checkSchema() {
    const client = new Client({
        connectionString: "postgres://postgres:123456@localhost:5432/fashionary"
    });
    await client.connect();
    const res = await client.query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'Task'
  `);
    console.log('Columns in Task table:');
    console.table(res.rows);
    await client.end();
}

checkSchema().catch(console.error);
